import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const defaultInputPath = resolveInputPath("old-appointments.csv");
const defaultOutputPath = join(
  workspaceRoot,
  ".cache/migration/reports/pvs-patient-name-changes.csv",
);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    includePlaceholderIds: args.includes("--include-placeholder-ids"),
    inputPath: args.find((arg) => !arg.startsWith("--")) ?? defaultInputPath,
    outputPath:
      args.at(-1)?.startsWith("--") === false && args.length > 1
        ? (args.at(-1) ?? defaultOutputPath)
        : defaultOutputPath,
  };
}

function resolveInputPath(fileName) {
  for (const candidate of [
    join(workspaceRoot, ".cache/migration/source", fileName),
    join(workspaceRoot, fileName),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return join(workspaceRoot, ".cache/migration/source", fileName);
}

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

function csvCell(value) {
  if (/[",\n\r]/u.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function main() {
  const { includePlaceholderIds, inputPath, outputPath } = parseArgs();
  const appointmentsByPatientId = Map.groupBy(
    parseCsv(readFileSync(inputPath, "utf8"))
      .filter((row) => row.ID.trim().length > 0)
      .filter((row) => includePlaceholderIds || row.ID !== "-1")
      .toSorted((left, right) => {
        const idOrder = Number(left.ID) - Number(right.ID);
        return idOrder === 0
          ? left.Beginn.localeCompare(right.Beginn)
          : idOrder;
      }),
    (row) => row.ID,
  );
  const changes = [];

  for (const [patientId, appointments] of appointmentsByPatientId.entries()) {
    for (let index = 1; index < appointments.length; index += 1) {
      const previous = appointments[index - 1];
      const current = appointments[index];
      if (
        previous.Nachname !== current.Nachname ||
        previous.Vorname !== current.Vorname
      ) {
        changes.push({
          ID: patientId,
          nachname_aktuell: current.Nachname,
          nachname_vorher: previous.Nachname,
          vorname_aktuell: current.Vorname,
          vorname_vorher: previous.Vorname,
        });
      }
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const headers = [
    "ID",
    "nachname_vorher",
    "nachname_aktuell",
    "vorname_vorher",
    "vorname_aktuell",
  ];
  writeFileSync(
    outputPath,
    [
      headers.join(","),
      ...changes.map((change) =>
        headers.map((header) => csvCell(change[header] ?? "")).join(","),
      ),
    ].join("\n") + "\n",
  );
  console.log(`Wrote ${changes.length} patient name changes to ${outputPath}`);
}

main();
