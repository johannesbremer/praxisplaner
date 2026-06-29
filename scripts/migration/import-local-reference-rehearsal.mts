import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildReferenceImportRows } from "./reference-import-shaping.mts";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const seedRoot = join(workspaceRoot, "seed_data_preview");
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
const adminIdentityArgs = [
  "--identity",
  JSON.stringify({
    email: "admin@preview.test",
    issuer: "https://praxisplaner.local/dev-auth",
    subject: "dev-admin",
  }),
] as const;

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

function getSeedPractice() {
  const [practice] = readJsonl(join(seedRoot, "practices/documents.jsonl"));
  if (!practice?.currentActiveRuleSetId || !practice?._id) {
    throw new Error("Expected seed preview practice and active rule set.");
  }
  return practice;
}

const references = buildReferenceImportRows(
  readFileSync(migrationSourcePath("old-appointments.csv"), "utf8"),
);
const practice = getSeedPractice();

if (references.stats.durationFallbackAppointmentTypes > 0) {
  console.warn(
    `Fell back to 5 minute duration for ${references.stats.durationFallbackAppointmentTypes} appointment types covering ${references.stats.durationFallbackRows} source appointments.`,
  );
}

const result = execFileSync(
  "pnpm",
  [
    "exec",
    "convex",
    "run",
    "migrationRehearsal:replaceReferenceTables",
    JSON.stringify({
      appointmentTypes: references.appointmentTypes,
      locations: references.locations,
      practiceId: practice._id,
      practitioners: references.practitioners,
      ruleSetId: practice.currentActiveRuleSetId,
    }),
    ...adminIdentityArgs,
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
