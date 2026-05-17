import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const outputRoot = join(workspaceRoot, ".cache/migration/rehearsal");
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const seedRoot = join(workspaceRoot, "seed_data_preview");
const importTimestamp = "1778751271000";
const fallbackDurationMinutes = 5;
const sampleAppointmentCount = 10;
const fullImport = process.argv.includes("--full");
const convexCliEnv = {
  ...process.env,
  CI: "1",
};
const locationNameByRoomToken = [
  { locationName: "Bad Iburg", pattern: /ibur(?:g)?|\bibu\b/i },
  { locationName: "Dissen a.T.W.", pattern: /\bdiss(?:en)?\b/i },
];
const calendarResourceColumnByDoctorName = new Map([
  ["Labor Dissen", "labor"],
  ["Labor Iburg", "labor"],
  ["Mufu Dissen", "ekg"],
  ["Mufu Iburg", "ekg"],
]);

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      field += char;
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
  if (!headers) {
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

function migrationSourcePath(fileName) {
  const rootPath = join(workspaceRoot, fileName);
  if (existsSync(rootPath)) {
    return rootPath;
  }
  return join(workspaceRoot, ".cache/migration/source", fileName);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readConvexJson(output) {
  const trimmed = output.trim();
  const jsonStart = trimmed.search(/[\[{]/u);
  if (jsonStart === -1) {
    throw new Error(`Could not parse Convex response: ${output}`);
  }
  const jsonText = trimmed
    .slice(jsonStart)
    .replace(/: (-?\d+)n([,}\]])/g, ": $1$2");
  return JSON.parse(jsonText);
}

function normalizeSearch(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim().toLowerCase();
}

function toIsoDateTime(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported date format: ${value}`);
  }
  return `${match[1]}T${match[2]}${match[3]}[Europe/Berlin]`;
}

function toDate(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported date format: ${value}`);
  }
  return new Date(`${match[1]}T${match[2]}${match[3]}`);
}

function normalizeAppointmentInterval(
  startValue,
  endValue,
  durationMinutes = fallbackDurationMinutes,
) {
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
  const end = `${localEnd}[Europe/Berlin]`;
  return { end, inferredDuration: true, start };
}

function resolvePracticeLocationNameFromRoom(room) {
  for (const mapping of locationNameByRoomToken) {
    if (mapping.pattern.test(room)) {
      return mapping.locationName;
    }
  }

  throw new Error(`Could not resolve practice location from room "${room}".`);
}

function resolveCalendarResourceColumn(doctorName) {
  return calendarResourceColumnByDoctorName.get(doctorName);
}

function writeZipTable(tableName, documents, generatedSchema) {
  const tableDir = join(outputRoot, "zip", tableName);
  mkdirSync(tableDir, { recursive: true });
  writeFileSync(
    join(tableDir, "documents.jsonl"),
    documents.map((document) => JSON.stringify(document)).join("\n") + "\n",
  );
  writeFileSync(
    join(tableDir, "generated_schema.jsonl"),
    `${JSON.stringify(generatedSchema)}\n`,
  );
}

function buildPatientsZip() {
  const appointments = parseCsv(
    readFileSync(migrationSourcePath("old-appointments.csv"), "utf8"),
  );
  const patientIds = new Set(
    (fullImport ? appointments : appointments.slice(0, sampleAppointmentCount))
      .map((appointment) => appointment.ID)
      .filter(Boolean),
  );
  const patients = parseCsv(
    readFileSync(migrationSourcePath("patients.csv"), "utf8"),
  )
    .filter((patient) => patientIds.has(patient.ID))
    .map((patient) => ({
      createdAt: importTimestamp,
      firstName: patient.Vorname,
      lastModified: importTimestamp,
      lastName: patient.Nachname,
      patientId: Number(patient.ID),
      practiceId: getSeedPractice()._id,
      recordType: "pvs",
      searchFirstName: normalizeSearch(patient.Vorname, patient.Nachname),
      searchLastName: normalizeSearch(patient.Nachname, patient.Vorname),
    }));

  writeZipTable(
    "patients",
    patients,
    `{"practiceId": "${getSeedPractice()._id}", "recordType": "pvs", "patientId": normalfloat64, "firstName": string, "lastName": string, "searchFirstName": string, "searchLastName": string, "createdAt": int64, "lastModified": int64}`,
  );

  createZip("patients-rehearsal.zip");
  console.log(
    `Wrote ${patients.length} rehearsal patients${fullImport ? " for full import" : ""}.`,
  );
}

function buildAppointmentsZip() {
  const appointments = parseCsv(
    readFileSync(migrationSourcePath("old-appointments.csv"), "utf8"),
  );
  const patientBySourceId = getLocalPatientsBySourceId();
  const practice = getSeedPractice();
  const references = getLocalReferences();
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

  const selectedAppointments = fullImport
    ? appointments
    : appointments.slice(0, sampleAppointmentCount);
  const stats = {
    appointmentsWithoutPatient: 0,
    byLocationName: new Map(),
    inferredDurationFromType: 0,
    written: 0,
  };
  const inferredDurationRows = [];
  const documents = selectedAppointments.map((appointment) => {
    const appointmentType = appointmentTypeByName.get(appointment.Terminart);
    const location = locationByName.get(
      resolvePracticeLocationNameFromRoom(appointment.Raum),
    );
    const calendarResourceColumn = resolveCalendarResourceColumn(
      appointment.Arzt,
    );
    const practitioner =
      calendarResourceColumn === undefined
        ? practitionerByName.get(appointment.Arzt)
        : undefined;

    if (
      !appointmentType ||
      !location ||
      (calendarResourceColumn === undefined && !practitioner)
    ) {
      throw new Error(
        `Missing reference for appointment ${JSON.stringify(appointment)}`,
      );
    }
    const interval = normalizeAppointmentInterval(
      appointment.Beginn,
      appointment.Ende,
      appointmentType.duration,
    );
    stats.byLocationName.set(
      location.name,
      (stats.byLocationName.get(location.name) ?? 0) + 1,
    );

    const patientId = patientBySourceId.get(Number(appointment.ID));
    if (!patientId) {
      stats.appointmentsWithoutPatient += 1;
    }
    if (interval.inferredDuration) {
      stats.inferredDurationFromType += 1;
      inferredDurationRows.push({
        appointmentTypeTitle: appointment.Terminart,
        doctorName: appointment.Arzt,
        end: appointment.Ende,
        inferredDurationMinutes: appointmentType.duration,
        patientSourceId: appointment.ID,
        reasonDescription: appointment.Termingrund,
        room: appointment.Raum,
        start: appointment.Beginn,
      });
    }

    return {
      appointmentTypeLineageKey: appointmentType.lineageKey,
      appointmentTypeTitle: appointment.Terminart,
      createdAt: importTimestamp,
      end: interval.end,
      lastModified: importTimestamp,
      locationLineageKey: location.lineageKey,
      ...(patientId ? { patientId } : {}),
      practiceId: practice._id,
      ...(calendarResourceColumn === undefined
        ? { practitionerLineageKey: practitioner.lineageKey }
        : { calendarResourceColumn }),
      start: interval.start,
      title: [
        appointment.Vorname,
        appointment.Nachname,
        appointment.Termingrund,
      ]
        .filter(Boolean)
        .join(" - "),
    };
  });
  stats.written = documents.length;
  const missingLocationLineageKey = documents.find(
    (document) => document.locationLineageKey === undefined,
  );
  if (missingLocationLineageKey) {
    throw new Error(
      `Appointment missing locationLineageKey: ${JSON.stringify(missingLocationLineageKey)}`,
    );
  }

  const patientIdAlternatives = [
    ...new Set(documents.map((document) => document.patientId)),
  ]
    .filter(Boolean)
    .map((patientId) => `"${patientId}"`)
    .join(" | ");
  const appointmentTypeLineageKeyAlternatives = [
    ...new Set(documents.map((document) => document.appointmentTypeLineageKey)),
  ]
    .map((lineageKey) => `"${lineageKey}"`)
    .join(" | ");
  const locationLineageKeyAlternatives = [
    ...new Set(documents.map((document) => document.locationLineageKey)),
  ]
    .map((lineageKey) => `"${lineageKey}"`)
    .join(" | ");
  const practitionerLineageKeyAlternatives = [
    ...new Set(documents.map((document) => document.practitionerLineageKey)),
  ]
    .filter(Boolean)
    .map((lineageKey) => `"${lineageKey}"`)
    .join(" | ");
  const calendarResourceColumnAlternatives = [
    ...new Set(documents.map((document) => document.calendarResourceColumn)),
  ]
    .filter(Boolean)
    .map((column) => `"${column}"`)
    .join(" | ");
  const patientField =
    patientIdAlternatives.length === 0
      ? ""
      : `, "patientId": ${patientIdAlternatives}`;
  const baseSchemaPrefix = `{"practiceId": "${practice._id}", "start": string, "end": string, "title": string, "appointmentTypeLineageKey": ${appointmentTypeLineageKeyAlternatives}, "appointmentTypeTitle": string, "locationLineageKey": ${locationLineageKeyAlternatives}`;
  const baseSchemaSuffix = `, "createdAt": int64, "lastModified": int64}`;
  const schemaVariants = [
    ...(practitionerLineageKeyAlternatives.length === 0
      ? []
      : [
          `${baseSchemaPrefix}, "practitionerLineageKey": ${practitionerLineageKeyAlternatives}${patientField}${baseSchemaSuffix}`,
          `${baseSchemaPrefix}, "practitionerLineageKey": ${practitionerLineageKeyAlternatives}${baseSchemaSuffix}`,
        ]),
    ...(calendarResourceColumnAlternatives.length === 0
      ? []
      : [
          `${baseSchemaPrefix}, "calendarResourceColumn": ${calendarResourceColumnAlternatives}${patientField}${baseSchemaSuffix}`,
          `${baseSchemaPrefix}, "calendarResourceColumn": ${calendarResourceColumnAlternatives}${baseSchemaSuffix}`,
        ]),
  ];
  if (schemaVariants.length === 0) {
    throw new Error(
      "Appointment rehearsal import generated no schema variants.",
    );
  }

  writeZipTable("appointments", documents, schemaVariants.join(" | "));
  mkdirSync(reportRoot, { recursive: true });
  writeFileSync(
    join(reportRoot, "praxistimer-inferred-durations.report.jsonl"),
    inferredDurationRows.map((row) => JSON.stringify(row)).join("\n") +
      (inferredDurationRows.length === 0 ? "" : "\n"),
  );

  createZip("appointments-rehearsal.zip");
  console.log(
    `Wrote ${stats.written} rehearsal appointments${fullImport ? " for full import" : ""}; ${stats.appointmentsWithoutPatient} without imported patient; inferred duration from appointment type for ${stats.inferredDurationFromType}.`,
  );
  console.log(
    `Location lineage distribution: ${[...stats.byLocationName.entries()]
      .map(([name, count]) => `${name}=${count}`)
      .join(", ")}.`,
  );
}

function createZip(fileName) {
  execFileSync("zip", ["-qr", join(outputRoot, fileName), "."], {
    cwd: join(outputRoot, "zip"),
  });
}

function getSeedPractice() {
  return readJsonl(join(seedRoot, "practices/documents.jsonl"))[0];
}

function getLocalReferences() {
  const practice = getSeedPractice();
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      "migrationRehearsal:listReferenceTableRows",
      JSON.stringify({
        ruleSetId: practice.currentActiveRuleSetId,
      }),
      "--deployment",
      "local",
      "--typecheck",
      "disable",
    ],
    {
      cwd: workspaceRoot,
      env: convexCliEnv,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  return readConvexJson(output);
}

function getLocalPatientsBySourceId() {
  const practice = getSeedPractice();
  const mappings = [];
  const pageSize = 250;
  for (
    let fromInclusive = 0;
    fromInclusive < 27000;
    fromInclusive += pageSize
  ) {
    const output = execFileSync(
      "pnpm",
      [
        "exec",
        "convex",
        "run",
        "migrationRehearsal:listPatientMappingsByPatientIdRange",
        JSON.stringify({
          fromInclusive,
          practiceId: practice._id,
          toExclusive: fromInclusive + pageSize,
        }),
        "--deployment",
        "local",
        "--typecheck",
        "disable",
      ],
      {
        cwd: workspaceRoot,
        env: convexCliEnv,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    mappings.push(...readConvexJson(output));
  }

  return new Map(
    mappings.map((patient) => [patient.patientId, patient.convexId]),
  );
}

const command = process.argv[2];
rmSync(join(outputRoot, "zip"), { force: true, recursive: true });
mkdirSync(join(outputRoot, "zip"), { recursive: true });

if (command === "patients") {
  buildPatientsZip();
} else if (command === "appointments") {
  buildAppointmentsZip();
} else {
  throw new Error(
    "Usage: node scripts/migration/build-local-rehearsal-import.mts patients|appointments",
  );
}
