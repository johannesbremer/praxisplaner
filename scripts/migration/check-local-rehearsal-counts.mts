import { execFileSync } from "node:child_process";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};
const pageSize = 200;
const tables = [
  "bookingSessions",
  "bookingPrivacySteps",
  "bookingLocationSteps",
  "bookingPatientStatusSteps",
  "bookingExistingDoctorSelectionSteps",
  "bookingExistingPersonalDataSteps",
  "bookingExistingDataSharingSteps",
  "bookingExistingCalendarSelectionSteps",
  "bookingExistingConfirmationSteps",
  "bookingIdentities",
  "bookingIdentityPatientAssociations",
  "legacyBookingBlocks",
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
  const jsonStart = trimmed.search(/[\[{]/u);
  if (jsonStart === -1) {
    throw new Error(`Could not parse Convex response: ${output}`);
  }
  return JSON.parse(
    trimmed.slice(jsonStart).replace(/: (-?\d+)n([,}\]])/g, ": $1$2"),
  );
}

function countTable(tableName) {
  let count = 0;
  let cursor = null;

  while (true) {
    const output = execFileSync(
      "pnpm",
      [
        "exec",
        "convex",
        "run",
        "migrationRehearsal:countRehearsalTablePage",
        JSON.stringify({
          paginationOpts: {
            cursor,
            numItems: pageSize,
          },
          tableName,
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
    const result = readConvexJson(output);
    count += result.count;
    if (result.isDone) {
      return count;
    }
    cursor = result.continueCursor;
  }
}

pushFunctions();
const counts = Object.fromEntries(
  tables.map((tableName) => [tableName, countTable(tableName)]),
);

console.log(JSON.stringify(counts, null, 2));
