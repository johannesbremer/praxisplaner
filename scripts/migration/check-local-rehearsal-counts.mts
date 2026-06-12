import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const localDeploymentConfigPath = join(
  workspaceRoot,
  ".convex/local/default/config.json",
);
function localConvexCliEnv() {
  const config = JSON.parse(readFileSync(localDeploymentConfigPath, "utf8"));
  const env = {
    ...process.env,
    CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey,
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
  };
  delete env.CONVEX_DEPLOYMENT;
  delete env.CONVEX_DEPLOY_KEY;
  delete env.CONVEX_DEPLOYMENT_TOKEN;
  return env;
}
const convexCliEnv = {
  ...localConvexCliEnv(),
  CI: "1",
};
const tables = [
  "bookingPrivacySteps",
  "bookingLocationSteps",
  "bookingPatientStatusSteps",
  "bookingExistingDoctorSelectionSteps",
  "bookingPersonalDataSteps",
  "bookingNewInsuranceTypeSteps",
  "bookingNewGkvDetailSteps",
  "bookingNewPkvConsentSteps",
  "bookingNewPkvDetailSteps",
  "bookingNewDataSharingSteps",
  "bookingIdentities",
  "bookingIdentityPatientAssociations",
  "onlineAccountBlocks",
  "legacyUnmatchedFutureBookingHolds",
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
