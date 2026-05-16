import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};

function assertLocalConvexDeployment() {
  const envLocal = readFileSync(join(workspaceRoot, ".env.local"), "utf8");
  if (!/^CONVEX_DEPLOYMENT=local:/mu.test(envLocal)) {
    throw new Error("Refusing import: CONVEX_DEPLOYMENT is not local.");
  }
  if (!/^VITE_CONVEX_URL=http:\/\/127\.0\.0\.1:3210$/mu.test(envLocal)) {
    throw new Error("Refusing import: VITE_CONVEX_URL is not local.");
  }
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: convexCliEnv,
    stdio: "inherit",
    ...options,
  });
}

function pushFunctions() {
  run("pnpm", [
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
  ]);
}

assertLocalConvexDeployment();

run("pnpm", [
  "exec",
  "convex",
  "env",
  "set",
  "MIGRATION_REHEARSAL_ENABLED",
  "true",
  "--deployment",
  "local",
]);
pushFunctions();
run("pnpm", ["seed:preview"]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--deployment",
  "local",
  "--replace-all",
  "--yes",
  ".cache/seed/preview.zip",
]);
run("node", ["scripts/migration/import-local-reference-rehearsal.mts"]);
run("node", [
  "scripts/migration/build-local-rehearsal-import.mts",
  "patients",
  "--full",
]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--deployment",
  "local",
  "--replace",
  "--yes",
  ".cache/migration/rehearsal/patients-rehearsal.zip",
]);
run("node", [
  "scripts/migration/build-local-rehearsal-import.mts",
  "appointments",
  "--full",
]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--deployment",
  "local",
  "--replace",
  "--yes",
  ".cache/migration/rehearsal/appointments-rehearsal.zip",
]);
run("node", ["scripts/migration/correlate-legacy-appointments.mts"]);
run("node", ["scripts/migration/build-legacy-booking-step-replay.mts"]);
run("node", [
  "scripts/migration/import-booking-identity-associations-local.mts",
]);
run("node", ["scripts/migration/check-local-rehearsal-counts.mts"]);
