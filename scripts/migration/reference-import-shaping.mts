import { normalizeImportedPractitionerName } from "./practitioner-name-normalization.mts";

const fallbackDurationMinutes = 5;
const practiceLocations = ["Bad Iburg", "Dissen a.T.W."] as const;
const resourceDoctorNames = new Set([
  "Labor Dissen",
  "Labor Iburg",
  "Mufu Dissen",
  "Mufu Iburg",
]);

export interface AppointmentTypeReferenceImport {
  duration: number;
  name: string;
}

export interface ReferenceImportRows {
  appointmentTypes: AppointmentTypeReferenceImport[];
  locations: string[];
  practitioners: string[];
  stats: {
    durationFallbackAppointmentTypes: number;
    durationFallbackRows: number;
    sourceAppointments: number;
  };
}

interface PraxistimerAppointmentCsvRow {
  Arzt: string;
  Beginn: string;
  Ende: string;
  Terminart: string;
}

export function buildReferenceImportRows(
  oldAppointmentsCsv: string,
): ReferenceImportRows {
  const appointments = parseCsv(oldAppointmentsCsv);
  const durationFallbackStats = {
    appointmentTypes: 0,
    rows: 0,
  };
  const rowsByType = groupBy(appointments, (row) => row.Terminart);
  const appointmentTypes = uniqueSorted(
    appointments.map((row) => row.Terminart),
  ).map((name) => ({
    duration: inferDurationMinutes(
      rowsByType.get(name) ?? [],
      durationFallbackStats,
    ),
    name,
  }));
  const practitioners = uniqueSorted(
    appointments
      .map((row) => row.Arzt)
      .map((name) => normalizeImportedPractitionerName(name))
      .filter((name) => !resourceDoctorNames.has(name)),
  );

  return {
    appointmentTypes,
    locations: [...practiceLocations],
    practitioners,
    stats: {
      durationFallbackAppointmentTypes: durationFallbackStats.appointmentTypes,
      durationFallbackRows: durationFallbackStats.rows,
      sourceAppointments: appointments.length,
    },
  };
}

function parseCsv(text: string): PraxistimerAppointmentCsvRow[] {
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
  if (quoted) {
    throw new Error(
      "Malformed old-appointments.csv: unterminated quoted field.",
    );
  }

  const [headers, ...records] = rows;
  if (!headers) {
    return [];
  }

  const malformedRows = records
    .map((record, index) => ({
      actualFields: record.length,
      expectedFields: headers.length,
      line: index + 2,
    }))
    .filter((record) => record.actualFields !== record.expectedFields);
  if (malformedRows.length > 0) {
    throw new Error(
      `Malformed old-appointments.csv rows: ${malformedRows
        .slice(0, 20)
        .map(
          (row) =>
            `line ${row.line}: expected ${row.expectedFields} fields, got ${row.actualFields}`,
        )
        .join("; ")}`,
    );
  }

  return records.map((record) => {
    const parsed = Object.fromEntries(
      headers.map((header, index) => [header, record[index] ?? ""]),
    );
    return {
      Arzt: readCsvString(parsed, "Arzt"),
      Beginn: readCsvString(parsed, "Beginn"),
      Ende: readCsvString(parsed, "Ende"),
      Terminart: readCsvString(parsed, "Terminart"),
    };
  });
}

function readCsvString(row: Record<string, string>, key: string): string {
  return row[key] ?? "";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right, "de"),
  );
}

const migratedTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/u;

function parseMigratedTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const match = migratedTimestampPattern.exec(trimmed);
  const normalized = match
    ? `${match[1]}T${match[2]}${match[3]}`
    : trimmed.replace(" ", "T").replace(" GMT", "");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function inferDurationMinutes(
  rows: PraxistimerAppointmentCsvRow[],
  fallbackStats: {
    appointmentTypes: number;
    rows: number;
  },
): number {
  const durations = rows
    .map((row) => {
      const start = parseMigratedTimestamp(row.Beginn);
      const end = parseMigratedTimestamp(row.Ende);
      const minutes =
        start === null || end === null ? NaN : (end - start) / 60_000;
      return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    })
    .filter((minutes) => minutes !== null);

  if (durations.length === 0) {
    fallbackStats.appointmentTypes += 1;
    fallbackStats.rows += rows.length;
    return fallbackDurationMinutes;
  }

  const counts = new Map<number, number>();
  for (const duration of durations) {
    counts.set(duration, (counts.get(duration) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0] - right[0];
    })[0]?.[0] ?? fallbackDurationMinutes
  );
}

function groupBy<Value, Key>(
  values: Value[],
  getKey: (value: Value) => Key,
): Map<Key, Value[]> {
  const grouped = new Map<Key, Value[]>();
  for (const value of values) {
    const key = getKey(value);
    const group = grouped.get(key);
    if (group === undefined) {
      grouped.set(key, [value]);
    } else {
      group.push(value);
    }
  }
  return grouped;
}
