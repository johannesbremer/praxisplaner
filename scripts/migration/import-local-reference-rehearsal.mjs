import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const practiceLocations = ["Bad Iburg", "Dissen a.T.W."];
const resourceDoctorNames = new Set([
  "Labor Dissen",
  "Labor Iburg",
  "Mufu Dissen",
  "Mufu Iburg",
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

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right, "de"),
  );
}

function inferDurationMinutes(rows) {
  const durations = rows
    .map((row) => {
      const start = new Date(row.Beginn.replace(" ", "T"));
      const end = new Date(row.Ende.replace(" ", "T"));
      const minutes = (end.getTime() - start.getTime()) / 60_000;
      return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    })
    .filter((minutes) => minutes !== null);

  if (durations.length === 0) {
    return 5;
  }

  const counts = new Map();
  for (const duration of durations) {
    counts.set(duration, (counts.get(duration) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0] - right[0];
  })[0][0];
}

function readLocalJsonLines(tableName) {
  const output = execFileSync(
    "pnpm",
    ["exec", "convex", "data", tableName, "--format", "jsonLines"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/: (-?\d+)n([,}])/g, ": $1$2")));
}

const appointments = parseCsv(
  readFileSync(join(workspaceRoot, "old-appointments.csv"), "utf8"),
);
const [practice] = readLocalJsonLines("practices");
const [ruleSet] = readLocalJsonLines("ruleSets");

if (!practice?.currentActiveRuleSetId || !ruleSet?._id) {
  throw new Error("Expected local seed practice and rule set to exist.");
}

const rowsByType = Map.groupBy(appointments, (row) => row.Terminart);
const appointmentTypes = uniqueSorted(
  appointments.map((row) => row.Terminart),
).map((name) => ({
  duration: inferDurationMinutes(rowsByType.get(name) ?? []),
  name,
}));
const practitioners = uniqueSorted(
  appointments
    .map((row) => row.Arzt)
    .filter((name) => !resourceDoctorNames.has(name)),
);

const result = execFileSync(
  "pnpm",
  [
    "exec",
    "convex",
    "run",
    "migrationRehearsal:replaceReferenceTables",
    JSON.stringify({
      appointmentTypes,
      locations: practiceLocations,
      practiceId: practice._id,
      practitioners,
      ruleSetId: practice.currentActiveRuleSetId,
    }),
    "--push",
    "--typecheck",
    "disable",
  ],
  {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

console.log(result.trim());
