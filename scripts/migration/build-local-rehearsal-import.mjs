import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const outputRoot = join(workspaceRoot, ".cache/migration/rehearsal");
const seedRoot = join(workspaceRoot, "seed_data_preview");
const importTimestamp = "1778751271000";
const fallbackDurationMinutes = 5;
const sampleAppointmentCount = 10;
const fullImport = process.argv.includes("--full");
const locationNameByRoomToken = [
  { locationName: "Bad Iburg", pattern: /ibur(?:g)?|\bibu\b/i },
  { locationName: "Dissen a.T.W.", pattern: /\bdiss(?:en)?\b/i },
];

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

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

function normalizeAppointmentInterval(startValue, endValue) {
  const start = toIsoDateTime(startValue);
  const parsedEnd = toIsoDateTime(endValue);

  if (toDate(endValue).getTime() > toDate(startValue).getTime()) {
    return { end: parsedEnd, inferredDuration: false, start };
  }

  const endDate = new Date(
    toDate(startValue).getTime() + fallbackDurationMinutes * 60 * 1000,
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
    readFileSync(join(workspaceRoot, "old-appointments.csv"), "utf8"),
  );
  const patientIds = new Set(
    (fullImport ? appointments : appointments.slice(0, sampleAppointmentCount))
      .map((appointment) => appointment.ID)
      .filter(Boolean),
  );
  const patients = parseCsv(
    readFileSync(join(workspaceRoot, "patients.csv"), "utf8"),
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
    readFileSync(join(workspaceRoot, "old-appointments.csv"), "utf8"),
  );
  const patientBySourceId = getLocalPatientsBySourceId();
  const practice = getSeedPractice();
  const appointmentTypeByName = new Map(
    getLocalTable("appointmentTypes").map((appointmentType) => [
      appointmentType.name,
      appointmentType,
    ]),
  );
  const locationByName = new Map(
    getLocalTable("locations").map((location) => [location.name, location]),
  );
  const practitionerByName = new Map(
    getLocalTable("practitioners").map((practitioner) => [
      practitioner.name,
      practitioner,
    ]),
  );

  const selectedAppointments = fullImport
    ? appointments
    : appointments.slice(0, sampleAppointmentCount);
  const stats = {
    appointmentsWithoutPatient: 0,
    written: 0,
  };
  const documents = selectedAppointments.map((appointment) => {
    const interval = normalizeAppointmentInterval(
      appointment.Beginn,
      appointment.Ende,
    );
    const appointmentType = appointmentTypeByName.get(appointment.Terminart);
    const location = locationByName.get(
      resolvePracticeLocationNameFromRoom(appointment.Raum),
    );
    const practitioner = practitionerByName.get(appointment.Arzt);

    if (!appointmentType || !location || !practitioner) {
      throw new Error(
        `Missing reference for appointment ${JSON.stringify(appointment)}`,
      );
    }

    const patientId = patientBySourceId.get(Number(appointment.ID));
    if (!patientId) {
      stats.appointmentsWithoutPatient += 1;
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
      practitionerLineageKey: practitioner.lineageKey,
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

  const inferredDurationCount = selectedAppointments.filter(
    (appointment) =>
      normalizeAppointmentInterval(appointment.Beginn, appointment.Ende)
        .inferredDuration,
  ).length;

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
    .map((lineageKey) => `"${lineageKey}"`)
    .join(" | ");

  writeZipTable(
    "appointments",
    documents,
    `{"practiceId": "${practice._id}", "start": string, "end": string, "title": string, "appointmentTypeLineageKey": ${appointmentTypeLineageKeyAlternatives}, "appointmentTypeTitle": string, "locationLineageKey": ${locationLineageKeyAlternatives}, "practitionerLineageKey": ${practitionerLineageKeyAlternatives}, "patientId": ${patientIdAlternatives}, "createdAt": int64, "lastModified": int64} | {"practiceId": "${practice._id}", "start": string, "end": string, "title": string, "appointmentTypeLineageKey": ${appointmentTypeLineageKeyAlternatives}, "appointmentTypeTitle": string, "locationLineageKey": ${locationLineageKeyAlternatives}, "practitionerLineageKey": ${practitionerLineageKeyAlternatives}, "createdAt": int64, "lastModified": int64}`,
  );

  createZip("appointments-rehearsal.zip");
  console.log(
    `Wrote ${stats.written} rehearsal appointments${fullImport ? " for full import" : ""}; ${stats.appointmentsWithoutPatient} without imported patient; inferred fallback duration for ${inferredDurationCount}.`,
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
        "--typecheck",
        "disable",
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
      },
    );
    const jsonStart = output.indexOf("[");
    const jsonEnd = output.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      throw new Error(`Could not parse patient mapping response: ${output}`);
    }
    mappings.push(...JSON.parse(output.slice(jsonStart, jsonEnd + 1)));
  }

  return new Map(
    mappings.map((patient) => [patient.patientId, patient.convexId]),
  );
}

function getLocalTable(tableName) {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "data",
      tableName,
      "--format",
      "jsonLines",
      "--limit",
      "8192",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
    },
  );
  const lines = output.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const json = line.replace(/: (-?\d+)n([,}])/g, ": $1$2");
    return JSON.parse(json);
  });
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
    "Usage: node scripts/migration/build-local-rehearsal-import.mjs patients|appointments",
  );
}
