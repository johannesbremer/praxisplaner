import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeImportedPractitionerName } from "./practitioner-name-normalization.mts";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const seedRoot = join(workspaceRoot, "seed_data_preview");
const fallbackDurationMinutes = 5;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};
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

function migrationSourcePath(fileName) {
  const rootPath = join(workspaceRoot, fileName);
  if (existsSync(rootPath)) {
    return rootPath;
  }
  return join(workspaceRoot, ".cache/migration/source", fileName);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right, "de"),
  );
}

const migratedTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/u;
const durationFallbackStats = {
  appointmentTypes: 0,
  rows: 0,
};

function parseMigratedTimestamp(value) {
  const trimmed = value.trim();
  const match = migratedTimestampPattern.exec(trimmed);
  const normalized = match
    ? `${match[1]}T${match[2]}${match[3]}`
    : trimmed.replace(" ", "T").replace(" GMT", "");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function inferDurationMinutes(rows) {
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
    durationFallbackStats.appointmentTypes += 1;
    durationFallbackStats.rows += rows.length;
    return fallbackDurationMinutes;
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

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getSeedPractice() {
  const [practice] = readJsonl(join(seedRoot, "practices/documents.jsonl"));
  if (!practice?.currentActiveRuleSetId || !practice?._id) {
    throw new Error("Expected seed preview practice and active rule set.");
  }
  return practice;
}

const appointments = parseCsv(
  readFileSync(migrationSourcePath("old-appointments.csv"), "utf8"),
);
const practice = getSeedPractice();

const rowsByType = Map.groupBy(appointments, (row) => row.Terminart);
const appointmentTypes = uniqueSorted(
  appointments.map((row) => row.Terminart),
).map((name) => ({
  duration: inferDurationMinutes(rowsByType.get(name) ?? []),
  name,
}));
if (durationFallbackStats.appointmentTypes > 0) {
  console.warn(
    `Fell back to ${fallbackDurationMinutes} minute duration for ${durationFallbackStats.appointmentTypes} appointment types covering ${durationFallbackStats.rows} source appointments.`,
  );
}
const practitioners = uniqueSorted(
  appointments
    .map((row) => row.Arzt)
    .map((name) => normalizeImportedPractitionerName(name))
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
    "--deployment",
    "local",
    "--push",
    "--typecheck",
    "disable",
  ],
  {
    cwd: workspaceRoot,
    env: convexCliEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

console.log(result.trim());
