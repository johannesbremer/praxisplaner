import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const localConvexDeploymentPath = join(workspaceRoot, ".convex/local/default");
const localConvexDataPaths = [
  join(localConvexDeploymentPath, "convex_local_backend.sqlite3"),
  join(localConvexDeploymentPath, "convex_local_storage"),
];
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

function resetLocalConvexDeployment() {
  if (!localConvexDeploymentPath.startsWith(join(workspaceRoot, ".convex/"))) {
    throw new Error("Refusing import: local Convex path is outside workspace.");
  }
  if (!existsSync(join(localConvexDeploymentPath, "config.json"))) {
    throw new Error(
      "Refusing import: local Convex deployment config is missing. Run `pnpm exec convex dev --configure --dev-deployment local` first.",
    );
  }
  for (const localDataPath of localConvexDataPaths) {
    if (!localDataPath.startsWith(`${localConvexDeploymentPath}/`)) {
      throw new Error("Refusing import: local Convex data path is invalid.");
    }
    if (existsSync(localDataPath)) {
      console.log(`Removing local Convex data at ${localDataPath}`);
      rmSync(localDataPath, { force: true, recursive: true });
    }
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

function startLocalBackend(): Promise<ChildProcess> {
  console.log("$ pnpm exec convex dev --typecheck disable --tail-logs disable");
  const backend = spawn(
    "pnpm",
    [
      "exec",
      "convex",
      "dev",
      "--typecheck",
      "disable",
      "--tail-logs",
      "disable",
    ],
    {
      cwd: workspaceRoot,
      env: convexCliEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      backend.kill();
      reject(error);
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(backend);
    };
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      if (text.includes("Convex functions ready!")) {
        finish();
      }
    };

    backend.stdout?.on("data", handleOutput);
    backend.stderr?.on("data", handleOutput);
    backend.on("error", fail);
    backend.on("exit", (code) => {
      if (!settled) {
        fail(new Error(`Local Convex backend exited before ready: ${code}`));
      }
    });
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

async function main() {
  assertLocalConvexDeployment();
  resetLocalConvexDeployment();

  run("pnpm", [
    "exec",
    "convex",
    "env",
    "set",
    "WORKOS_CLIENT_ID",
    "client_local_migration_rehearsal",
    "--deployment",
    "local",
  ]);
  run("pnpm", [
    "exec",
    "convex",
    "env",
    "set",
    "WORKOS_API_KEY",
    "sk_test_local_migration_rehearsal",
    "--deployment",
    "local",
  ]);
  run("pnpm", [
    "exec",
    "convex",
    "env",
    "set",
    "WORKOS_WEBHOOK_SECRET",
    "whsec_local_migration_rehearsal",
    "--deployment",
    "local",
  ]);
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

  const backend = await startLocalBackend();
  try {
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
  } finally {
    backend.kill();
  }
}

await main();
