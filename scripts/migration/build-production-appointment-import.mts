import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeImportedPractitionerName } from "./practitioner-name-normalization.mts";
import { buildReferenceImportRows } from "./reference-import-shaping.mts";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const sourceRoot = join(workspaceRoot, ".cache/migration/source");
const matchesPath = join(
  reportRoot,
  "legacy-appointment-correlation-matches.csv",
);
const outputPath = join(reportRoot, "production-appointments.documents.jsonl");
const zipRoot = join(reportRoot, "production-appointments-import");
const zipPath = join(reportRoot, "production-appointments-import.zip");
const summaryPath = join(reportRoot, "production-appointments-summary.json");
const importTimestamp = "1778751271000";
const fallbackDurationMinutes = 5;
const locationNameByRoomToken = [
  { locationName: "Bad Iburg", pattern: /ibur(?:g)?|\bibu\b/iu },
  { locationName: "Dissen a.T.W.", pattern: /\bdiss(?:en)?\b/iu },
] as const;
const calendarResourceColumnByDoctorName = new Map([
  ["Labor Dissen", "labor"],
  ["Labor Iburg", "labor"],
  ["Mufu Dissen", "ekg"],
  ["Mufu Iburg", "ekg"],
]);

interface CsvRow {
  readonly [key: string]: string | undefined;
}

interface ProductionReference {
  readonly lineageKey: string;
  readonly name: string;
}

interface ProductionReferences {
  readonly appointmentTypes: readonly ProductionReference[];
  readonly locations: readonly ProductionReference[];
  readonly practitioners: readonly ProductionReference[];
}

interface PatientMapping {
  readonly convexId: string;
  readonly patientId: number;
}

interface AppointmentDocument {
  readonly appointmentTypeLineageKey: string;
  readonly appointmentTypeTitle: string;
  readonly color: "blue";
  readonly createdAt: string;
  readonly end: string;
  readonly lastModified: string;
  readonly locationLineageKey: string;
  readonly occupancyScope:
    | {
        readonly kind: "practitioner";
        readonly practitionerLineageKey: string;
      }
    | {
        readonly calendarResourceColumn: string;
        readonly kind: "resource";
      };
  readonly patientId?: string;
  readonly practiceId: string;
  readonly start: string;
  readonly title: string;
}

interface ReasonNormalization {
  readonly matchedLegacyAppointmentRows: number;
  readonly matchedPvsAppointments: number;
  readonly strippableMatchedPvsAppointmentsByPrefix: ReadonlyMap<
    string,
    number
  >;
  readonly stripPrefixesByPvsMatchKey: ReadonlyMap<string, ReadonlySet<string>>;
}

const options = parseArgs(process.argv.slice(2));
const oldAppointmentsCsv = readFileSync(
  join(sourceRoot, "old-appointments.csv"),
  "utf8",
);
const appointmentTypeDurationsByName = new Map(
  buildReferenceImportRows(oldAppointmentsCsv).appointmentTypes.map((row) => [
    row.name,
    row.duration,
  ]),
);
const appointments = parseCsv(oldAppointmentsCsv);
const references = fetchProductionReferences();
const reasonNormalization = readMatchedPvsReasonNormalization();
const patientBySourceId = fetchPatientMappings();

const appointmentTypeByName = new Map(
  references.appointmentTypes.map((appointmentType) => [
    appointmentType.name,
    appointmentType,
  ]),
);
const locationByName = new Map(
  references.locations.map((location) => [location.name, location]),
);
const practitionerByName = new Map(
  references.practitioners.map((practitioner) => [
    practitioner.name,
    practitioner,
  ]),
);

const stats = {
  appointmentsWithoutPatient: 0,
  byLocationName: new Map<string, number>(),
  inferredDurationFromType: 0,
  strippedReasonPrefixesByPrefix: new Map<string, number>(),
  written: 0,
};
const inferredDurationRows: CsvRow[] = [];
const documents = appointments.map((appointment): AppointmentDocument => {
  const appointmentTypeTitle = readRequired(appointment, "Terminart");
  const appointmentType = appointmentTypeByName.get(appointmentTypeTitle);
  const location = locationByName.get(
    resolvePracticeLocationNameFromRoom(readRequired(appointment, "Raum")),
  );
  const doctorName = readRequired(appointment, "Arzt");
  const calendarResourceColumn =
    calendarResourceColumnByDoctorName.get(doctorName);
  const practitioner =
    calendarResourceColumn === undefined
      ? practitionerByName.get(normalizeImportedPractitionerName(doctorName))
      : undefined;

  if (
    appointmentType === undefined ||
    location === undefined ||
    (calendarResourceColumn === undefined && practitioner === undefined)
  ) {
    throw new Error(`Missing reference for ${JSON.stringify(appointment)}`);
  }

  const startValue = readRequired(appointment, "Beginn");
  const endValue = readRequired(appointment, "Ende");
  const interval = normalizeAppointmentInterval(
    startValue,
    endValue,
    appointmentTypeDurationsByName.get(appointmentTypeTitle),
  );
  const normalizedReason = normalizeMatchedPvsReason(
    readRequired(appointment, "Termingrund"),
    reasonNormalization.stripPrefixesByPvsMatchKey.get(
      pvsMatchKey({
        doctorName,
        end: endValue,
        locationRoom: readRequired(appointment, "Raum"),
        patientSourceId: readRequired(appointment, "ID"),
        reasonDescription: readRequired(appointment, "Termingrund"),
        start: startValue,
        typeTitle: appointmentTypeTitle,
      }),
    ),
  );
  const reasonDescription = normalizedReason.reasonDescription ?? "";
  stats.byLocationName.set(
    location.name,
    (stats.byLocationName.get(location.name) ?? 0) + 1,
  );
  if (normalizedReason.strippedPrefix !== undefined) {
    stats.strippedReasonPrefixesByPrefix.set(
      normalizedReason.strippedPrefix,
      (stats.strippedReasonPrefixesByPrefix.get(
        normalizedReason.strippedPrefix,
      ) ?? 0) + 1,
    );
  }

  const patientSourceId = Number(readRequired(appointment, "ID"));
  const patientId = patientBySourceId.get(patientSourceId);
  if (patientId === undefined) {
    stats.appointmentsWithoutPatient += 1;
  }
  if (interval.inferredDuration) {
    stats.inferredDurationFromType += 1;
    inferredDurationRows.push({
      appointmentTypeTitle,
      doctorName,
      end: endValue,
      inferredDurationMinutes: String(
        appointmentTypeDurationsByName.get(appointmentTypeTitle) ??
          fallbackDurationMinutes,
      ),
      patientSourceId: String(patientSourceId),
      reasonDescription,
      room: readRequired(appointment, "Raum"),
      start: startValue,
    });
  }

  return {
    appointmentTypeLineageKey: appointmentType.lineageKey,
    appointmentTypeTitle,
    color: "blue",
    createdAt: importTimestamp,
    end: interval.end,
    lastModified: importTimestamp,
    locationLineageKey: location.lineageKey,
    occupancyScope:
      calendarResourceColumn === undefined
        ? {
            kind: "practitioner",
            practitionerLineageKey: practitioner.lineageKey,
          }
        : { calendarResourceColumn, kind: "resource" },
    ...(patientId === undefined ? {} : { patientId }),
    practiceId: options.practiceId,
    start: interval.start,
    title: reasonDescription,
  };
});
stats.written = documents.length;

mkdirSync(reportRoot, { recursive: true });
writeFileSync(
  outputPath,
  documents.map((document) => JSON.stringify(document)).join("\n") + "\n",
);
rmSync(zipRoot, { force: true, recursive: true });
mkdirSync(join(zipRoot, "appointments"), { recursive: true });
writeFileSync(
  join(zipRoot, "appointments", "documents.jsonl"),
  documents.map((document) => JSON.stringify(document)).join("\n") + "\n",
);
writeFileSync(
  join(zipRoot, "appointments", "generated_schema.jsonl"),
  `${JSON.stringify(buildGeneratedSchema(documents))}\n`,
);
rmSync(zipPath, { force: true });
execFileSync("zip", ["-qr", zipPath, "."], { cwd: zipRoot });
writeFileSync(
  join(reportRoot, "production-praxistimer-inferred-durations.report.jsonl"),
  inferredDurationRows.map((row) => JSON.stringify(row)).join("\n") +
    (inferredDurationRows.length === 0 ? "" : "\n"),
);
writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      appointments: {
        appointmentsWithoutPatient: stats.appointmentsWithoutPatient,
        inferredDurationFromType: stats.inferredDurationFromType,
        locationDistribution: Object.fromEntries(stats.byLocationName),
        strippedReasonPrefixes: Object.fromEntries(
          stats.strippedReasonPrefixesByPrefix,
        ),
        written: stats.written,
      },
      inputs: {
        deployment: options.deployment,
        practiceId: options.practiceId,
        ruleSetId: options.ruleSetId,
      },
      reasonNormalization: {
        matchedLegacyAppointmentRows:
          reasonNormalization.matchedLegacyAppointmentRows,
        matchedPvsAppointments: reasonNormalization.matchedPvsAppointments,
        strippableMatchedPvsAppointmentsByPrefix: Object.fromEntries(
          reasonNormalization.strippableMatchedPvsAppointmentsByPrefix,
        ),
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `Wrote ${documents.length} production appointments to ${outputPath}`,
);
console.log(`Wrote production appointment import zip to ${zipPath}`);

function parseArgs(args: readonly string[]): {
  deployment: string;
  identity: string;
  practiceId: string;
  ruleSetId: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(
        "Usage: node scripts/migration/build-production-appointment-import.mts --deployment <deployment> --identity <json> --practice-id <id> --rule-set-id <id>",
      );
    }
    values.set(key, value);
  }

  return {
    deployment: readRequiredOption(values, "--deployment"),
    identity: readRequiredOption(values, "--identity"),
    practiceId: readRequiredOption(values, "--practice-id"),
    ruleSetId: readRequiredOption(values, "--rule-set-id"),
  };
}

function buildGeneratedSchema(
  documents: readonly AppointmentDocument[],
): string {
  const appointmentTypeLineageKeyAlternatives = stringAlternatives(
    documents.map((document) => document.appointmentTypeLineageKey),
  );
  const locationLineageKeyAlternatives = stringAlternatives(
    documents.map((document) => document.locationLineageKey),
  );
  const patientIdAlternatives = stringAlternatives(
    documents.flatMap((document) =>
      document.patientId === undefined ? [] : [document.patientId],
    ),
  );
  const practitionerLineageKeyAlternatives = stringAlternatives(
    documents.flatMap((document) =>
      document.occupancyScope.kind === "practitioner"
        ? [document.occupancyScope.practitionerLineageKey]
        : [],
    ),
  );
  const calendarResourceColumnAlternatives = stringAlternatives(
    documents.flatMap((document) =>
      document.occupancyScope.kind === "resource"
        ? [document.occupancyScope.calendarResourceColumn]
        : [],
    ),
  );
  const patientField =
    patientIdAlternatives.length === 0
      ? ""
      : `, "patientId": ${patientIdAlternatives}`;
  const baseSchemaPrefix = `{"practiceId": "${options.practiceId}", "start": string, "end": string, "title": string, "appointmentTypeLineageKey": ${appointmentTypeLineageKeyAlternatives}, "appointmentTypeTitle": string, "color": "blue", "locationLineageKey": ${locationLineageKeyAlternatives}`;
  const baseSchemaSuffix = `, "createdAt": int64, "lastModified": int64}`;
  const schemaVariants = [
    ...(practitionerLineageKeyAlternatives.length === 0
      ? []
      : [
          `${baseSchemaPrefix}, "occupancyScope": {"kind": "practitioner", "practitionerLineageKey": ${practitionerLineageKeyAlternatives}}${patientField}${baseSchemaSuffix}`,
          `${baseSchemaPrefix}, "occupancyScope": {"kind": "practitioner", "practitionerLineageKey": ${practitionerLineageKeyAlternatives}}${baseSchemaSuffix}`,
        ]),
    ...(calendarResourceColumnAlternatives.length === 0
      ? []
      : [
          `${baseSchemaPrefix}, "occupancyScope": {"kind": "resource", "calendarResourceColumn": ${calendarResourceColumnAlternatives}}${patientField}${baseSchemaSuffix}`,
          `${baseSchemaPrefix}, "occupancyScope": {"kind": "resource", "calendarResourceColumn": ${calendarResourceColumnAlternatives}}${baseSchemaSuffix}`,
        ]),
  ];
  if (schemaVariants.length === 0) {
    throw new Error(
      "Production appointment import generated no schema variants.",
    );
  }
  return schemaVariants.join(" | ");
}

function stringAlternatives(values: readonly string[]): string {
  return [...new Set(values)]
    .filter((value) => value.length > 0)
    .map((value) => JSON.stringify(value))
    .join(" | ");
}

function readRequiredOption(values: ReadonlyMap<string, string>, key: string) {
  const value = values.get(key);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing ${key}.`);
  }
  return value;
}

function fetchProductionReferences(): ProductionReferences {
  const output = execConvexRun("migrationRehearsal:listReferenceTableRows", {
    ruleSetId: options.ruleSetId,
  });
  const parsed = parseConvexJson(output);
  if (!isProductionReferences(parsed)) {
    throw new Error("Production reference response had an unexpected shape.");
  }
  return parsed;
}

function fetchPatientMappings(): Map<number, string> {
  const mappings: PatientMapping[] = [];
  const pageSize = 250;
  for (
    let fromInclusive = 0;
    fromInclusive < 27000;
    fromInclusive += pageSize
  ) {
    const output = execConvexRun(
      "migrationRehearsal:listPatientMappingsByPatientIdRange",
      {
        fromInclusive,
        practiceId: options.practiceId,
        toExclusive: fromInclusive + pageSize,
      },
    );
    const parsed = parseConvexJson(output);
    if (!isPatientMappings(parsed)) {
      throw new Error("Patient mapping response had an unexpected shape.");
    }
    mappings.push(...parsed);
  }
  return new Map(
    mappings.map((patient) => [patient.patientId, patient.convexId]),
  );
}

function execConvexRun(functionName: string, payload: object): string {
  return execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      "--deployment",
      options.deployment,
      "--identity",
      options.identity,
      "--typecheck",
      "disable",
      functionName,
      JSON.stringify(payload),
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function parseConvexJson(output: string): unknown {
  const trimmed = output.trim();
  const jsonStart = trimmed.search(/[\[{]/u);
  if (jsonStart === -1) {
    throw new Error(`Could not parse Convex response: ${output}`);
  }
  return JSON.parse(
    trimmed.slice(jsonStart).replace(/: (-?\d+)n([,}\]])/gu, ": $1$2"),
  ) as unknown;
}

function isProductionReferences(value: unknown): value is ProductionReferences {
  return (
    isRecord(value) &&
    isReferenceArray(value.appointmentTypes) &&
    isReferenceArray(value.locations) &&
    isReferenceArray(value.practitioners)
  );
}

function isReferenceArray(value: unknown): value is ProductionReference[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.lineageKey === "string" &&
        typeof item.name === "string",
    )
  );
}

function isPatientMappings(value: unknown): value is PatientMapping[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.convexId === "string" &&
        typeof item.patientId === "number",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (headers === undefined) {
    return [];
  }

  return records
    .filter((record) => record.length === headers.length)
    .map((record) =>
      Object.fromEntries(
        headers.map((header, index) => [header, record[index] ?? ""]),
      ),
    );
}

function readRequired(row: CsvRow, key: string): string {
  const value = row[key];
  if (value === undefined) {
    throw new Error(`Missing required CSV field ${key}.`);
  }
  return value;
}

function pvsMatchKey(args: {
  doctorName: string;
  end: string;
  locationRoom: string;
  patientSourceId: string;
  reasonDescription: string;
  start: string;
  typeTitle: string;
}): string {
  return JSON.stringify([
    args.doctorName,
    args.end,
    args.locationRoom,
    args.patientSourceId,
    args.reasonDescription,
    args.start,
    args.typeTitle,
  ]);
}

function stripPrefixForSourceKind(sourceKind: string): string | undefined {
  if (sourceKind === "online" || sourceKind === "online_old") {
    return "Online";
  }
  if (sourceKind === "telefonki") {
    return "TelefonKI";
  }
  return undefined;
}

function normalizeMatchedPvsReason(
  value: string,
  stripPrefixes: ReadonlySet<string> | undefined,
): {
  reasonDescription: string | undefined;
  strippedPrefix: string | undefined;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { reasonDescription: undefined, strippedPrefix: undefined };
  }

  if (stripPrefixes?.has("Online")) {
    const normalized = trimmed.replace(/^Online:\s*/u, "").trim();
    if (normalized !== trimmed) {
      return {
        reasonDescription: normalized,
        strippedPrefix: "Online",
      };
    }
  }
  if (stripPrefixes?.has("TelefonKI")) {
    const normalized = trimmed.replace(/^TelefonKI:\s*/u, "").trim();
    if (normalized !== trimmed) {
      return {
        reasonDescription: normalized,
        strippedPrefix: "TelefonKI",
      };
    }
  }

  return { reasonDescription: trimmed, strippedPrefix: undefined };
}

function readMatchedPvsReasonNormalization(): ReasonNormalization {
  const matches = parseCsv(readFileSync(matchesPath, "utf8"));
  const stripPrefixesByPvsMatchKey = new Map<string, Set<string>>();
  const rawReasonByPvsMatchKey = new Map<string, string>();

  for (const match of matches) {
    const key = pvsMatchKey({
      doctorName: readRequired(match, "pvsDoctor"),
      end: readRequired(match, "pvsEnd"),
      locationRoom: readRequired(match, "pvsLocationRoom"),
      patientSourceId: readRequired(match, "pvsPatientSourceId"),
      reasonDescription: readRequired(match, "pvsReason"),
      start: readRequired(match, "pvsStart"),
      typeTitle: readRequired(match, "pvsType"),
    });
    rawReasonByPvsMatchKey.set(key, readRequired(match, "pvsReason"));

    const stripPrefix = stripPrefixForSourceKind(
      readRequired(match, "sourceKind"),
    );
    if (stripPrefix === undefined) {
      continue;
    }

    const stripPrefixes = stripPrefixesByPvsMatchKey.get(key) ?? new Set();
    stripPrefixes.add(stripPrefix);
    stripPrefixesByPvsMatchKey.set(key, stripPrefixes);
  }

  const strippableMatchedPvsAppointmentsByPrefix = new Map<string, number>();
  for (const [key, stripPrefixes] of stripPrefixesByPvsMatchKey) {
    const normalizedReason = normalizeMatchedPvsReason(
      rawReasonByPvsMatchKey.get(key) ?? "",
      stripPrefixes,
    );
    if (normalizedReason.strippedPrefix === undefined) {
      continue;
    }
    strippableMatchedPvsAppointmentsByPrefix.set(
      normalizedReason.strippedPrefix,
      (strippableMatchedPvsAppointmentsByPrefix.get(
        normalizedReason.strippedPrefix,
      ) ?? 0) + 1,
    );
  }

  return {
    matchedLegacyAppointmentRows: matches.length,
    matchedPvsAppointments: rawReasonByPvsMatchKey.size,
    strippableMatchedPvsAppointmentsByPrefix,
    stripPrefixesByPvsMatchKey,
  };
}

function toIsoDateTime(value: string): string {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/u,
  );
  if (match === null) {
    throw new Error(`Unsupported date format: ${value}`);
  }
  return `${match[1]}T${match[2]}${match[3]}[Europe/Berlin]`;
}

function toDate(value: string): Date {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/u,
  );
  if (match === null) {
    throw new Error(`Unsupported date format: ${value}`);
  }
  return new Date(`${match[1]}T${match[2]}${match[3]}`);
}

function normalizeAppointmentInterval(
  startValue: string,
  endValue: string,
  durationMinutes = fallbackDurationMinutes,
): { end: string; inferredDuration: boolean; start: string } {
  const start = toIsoDateTime(startValue);
  const parsedEnd = toIsoDateTime(endValue);

  if (toDate(endValue).getTime() > toDate(startValue).getTime()) {
    return { end: parsedEnd, inferredDuration: false, start };
  }

  const resolvedDurationMinutes =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : fallbackDurationMinutes;
  const endDate = new Date(
    toDate(startValue).getTime() + resolvedDurationMinutes * 60 * 1000,
  );
  const localEnd = new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset",
    year: "numeric",
  })
    .format(endDate)
    .replace(" ", "T")
    .replace(" GMT", "");
  return { end: `${localEnd}[Europe/Berlin]`, inferredDuration: true, start };
}

function resolvePracticeLocationNameFromRoom(room: string): string {
  for (const mapping of locationNameByRoomToken) {
    if (mapping.pattern.test(room)) {
      return mapping.locationName;
    }
  }

  throw new Error(`Could not resolve practice location from room "${room}".`);
}
