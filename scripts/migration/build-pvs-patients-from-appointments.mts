import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const termineRoot = "/Users/johannes/Code/termine";
const defaultInputPath = resolveInputPath("old-appointments.csv");
const defaultOutputPath = join(
  workspaceRoot,
  ".cache/migration/source/patients.csv",
);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    inputPath: args[0] ?? defaultInputPath,
    outputPath: args[1] ?? defaultOutputPath,
  };
}

function resolveInputPath(fileName) {
  for (const candidate of [
    join(workspaceRoot, ".cache/migration/source", fileName),
    join(workspaceRoot, fileName),
    join(termineRoot, fileName),
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
  const { inputPath, outputPath } = parseArgs();
  const appointments = parseCsv(readFileSync(inputPath, "utf8"))
    .filter((row) => row.ID.trim().length > 0 && row.ID !== "-1")
    .toSorted((left, right) => {
      const idOrder = Number(left.ID) - Number(right.ID);
      return idOrder === 0 ? left.Beginn.localeCompare(right.Beginn) : idOrder;
    });

  const latestByPatientId = new Map();
  for (const appointment of appointments) {
    latestByPatientId.set(appointment.ID, appointment);
  }

  const patients = [...latestByPatientId.entries()]
    .map(([ID, appointment]) => ({
      ID,
      Nachname: appointment.Nachname,
      Titel: appointment.Titel,
      Vorname: appointment.Vorname,
    }))
    .toSorted((left, right) => Number(left.ID) - Number(right.ID));

  mkdirSync(dirname(outputPath), { recursive: true });
  const headers = ["ID", "Titel", "Vorname", "Nachname"];
  writeFileSync(
    outputPath,
    [
      headers.join(","),
      ...patients.map((patient) =>
        headers.map((header) => csvCell(patient[header] ?? "")).join(","),
      ),
    ].join("\n") + "\n",
  );
  console.log(`Wrote ${patients.length} patients to ${outputPath}`);
}

main();
