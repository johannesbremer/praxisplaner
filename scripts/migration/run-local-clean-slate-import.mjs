import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;

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
    stdio: "inherit",
    ...options,
  });
}

assertLocalConvexDeployment();

run("pnpm", [
  "exec",
  "convex",
  "env",
  "set",
  "MIGRATION_REHEARSAL_ENABLED",
  "true",
]);
run("pnpm", ["seed:preview"]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--replace-all",
  "--yes",
  ".cache/seed/preview.zip",
]);
run("node", ["scripts/migration/import-local-reference-rehearsal.mjs"]);
run("node", [
  "scripts/migration/build-local-rehearsal-import.mjs",
  "patients",
  "--full",
]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--replace",
  "--yes",
  ".cache/migration/rehearsal/patients-rehearsal.zip",
]);
run("node", [
  "scripts/migration/build-local-rehearsal-import.mjs",
  "appointments",
  "--full",
]);
run("pnpm", [
  "exec",
  "convex",
  "import",
  "--replace",
  "--yes",
  ".cache/migration/rehearsal/appointments-rehearsal.zip",
]);
run("node", ["scripts/migration/correlate-legacy-appointments.mjs"]);
run("node", [
  "scripts/migration/import-booking-identity-associations-local.mjs",
]);
run("pnpm", [
  "exec",
  "convex",
  "run",
  "migrationRehearsal:countBookingIdentityAssociationImport",
  "--push",
  "--typecheck",
  "disable",
]);
