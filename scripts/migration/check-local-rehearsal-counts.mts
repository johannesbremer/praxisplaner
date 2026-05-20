import { execFileSync } from "node:child_process";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};
const tables = [
  "bookingSessions",
  "bookingPrivacySteps",
  "bookingLocationSteps",
  "bookingPatientStatusSteps",
  "bookingExistingDoctorSelectionSteps",
  "bookingPersonalDataSteps",
  "bookingCalendarSelectionSteps",
  "bookingConfirmationSteps",
  "bookingNewInsuranceTypeSteps",
  "bookingNewGkvDetailSteps",
  "bookingNewPkvConsentSteps",
  "bookingNewPkvDetailSteps",
  "bookingNewDataSharingSteps",
  "bookingIdentities",
  "bookingIdentityPatientAssociations",
  "legacyBookingBlocks",
  "practitionerAssociations",
] as const;

function pushFunctions() {
  execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      "migrationRehearsal:countBookingIdentityAssociationImport",
      "{}",
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
      maxBuffer: 50 * 1024 * 1024,
    },
  );
}

function readConvexJson(output) {
  const trimmed = output.trim();
  if (/^-?\d+$/u.test(trimmed)) {
    return Number(trimmed);
  }
  const jsonStart = trimmed.search(/[\[{]/u);
  if (jsonStart === -1) {
    throw new Error(`Could not parse Convex response: ${output}`);
  }
  return JSON.parse(
    trimmed.slice(jsonStart).replace(/: (-?\d+)n([,}\]])/g, ": $1$2"),
  );
}

function countTable(tableName) {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      "migrationRehearsal:countRehearsalTable",
      JSON.stringify({ tableName }),
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

pushFunctions();
const counts = Object.fromEntries(
  tables.map((tableName) => [tableName, countTable(tableName)]),
);

console.log(JSON.stringify(counts, null, 2));
