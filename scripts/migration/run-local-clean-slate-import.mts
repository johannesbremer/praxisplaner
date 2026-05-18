import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const envLocalPath = join(workspaceRoot, ".env.local");
const localConvexDeploymentPath = join(workspaceRoot, ".convex/local/default");
const localConvexDataPaths = [
  join(localConvexDeploymentPath, "convex_local_backend.sqlite3"),
  join(localConvexDeploymentPath, "convex_local_storage"),
];
const localRehearsalWorkosEnv = {
  MIGRATION_REHEARSAL_ENABLED: "true",
  WORKOS_API_KEY: "sk_test_local_migration_rehearsal",
  WORKOS_CLIENT_ID: "client_local_migration_rehearsal",
  WORKOS_WEBHOOK_SECRET: "whsec_local_migration_rehearsal",
};
const convexCliEnv = {
  ...process.env,
  CI: "1",
  ...localRehearsalWorkosEnv,
};

function assertLocalConvexDeployment() {
  const envLocal = readFileSync(envLocalPath, "utf8");
  if (!/^CONVEX_DEPLOYMENT=local:/mu.test(envLocal)) {
    throw new Error("Refusing import: CONVEX_DEPLOYMENT is not local.");
  }
  if (!/^VITE_CONVEX_URL=http:\/\/127\.0\.0\.1:3210$/mu.test(envLocal)) {
    throw new Error("Refusing import: VITE_CONVEX_URL is not local.");
  }
}

function withLocalRehearsalEnv<T>(fn: () => Promise<T>): Promise<T> {
  const originalEnvLocal = readFileSync(envLocalPath, "utf8");
  const sanitizedEnvLocal = originalEnvLocal
    .replace(/^MIGRATION_REHEARSAL_ENABLED=.*$/gmu, "")
    .replace(/^WORKOS_API_KEY=.*$/gmu, "")
    .replace(/^WORKOS_CLIENT_ID=.*$/gmu, "")
    .replace(/^WORKOS_WEBHOOK_SECRET=.*$/gmu, "")
    .replace(/\n{3,}/gmu, "\n\n")
    .trimEnd();
  const rehearsalEnvBlock = [
    "# Local migration rehearsal auth",
    ...Object.entries(localRehearsalWorkosEnv).map(
      ([key, value]) => `${key}=${value}`,
    ),
  ].join("\n");
  const nextEnvLocal = `${sanitizedEnvLocal}\n\n${rehearsalEnvBlock}\n`;

  writeFileSync(envLocalPath, nextEnvLocal, "utf8");

  const restore = () => {
    writeFileSync(envLocalPath, originalEnvLocal, "utf8");
  };

  return fn().finally(restore);
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

function readLocalDeploymentConfig() {
  const configPath = join(localConvexDeploymentPath, "config.json");
  return JSON.parse(readFileSync(configPath, "utf8"));
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
  const config = readLocalDeploymentConfig();
  const backendBinaryPath = join(
    homedir(),
    ".cache/convex/binaries",
    config.backendVersion,
    "convex-local-backend",
  );
  const sqlitePath = join(
    localConvexDeploymentPath,
    "convex_local_backend.sqlite3",
  );
  const storagePath = join(localConvexDeploymentPath, "convex_local_storage");
  const backendArgs = [
    "--port",
    String(config.ports.cloud),
    "--site-proxy-port",
    String(config.ports.site),
    "--sentry-identifier",
    config.deploymentName,
    "--instance-name",
    config.deploymentName,
    "--instance-secret",
    config.instanceSecret,
    "--local-storage",
    storagePath,
    "--beacon-tag",
    "cli-local-dev",
    sqlitePath,
  ];
  console.log(`$ ${[backendBinaryPath, ...backendArgs].join(" ")}`);
  const backend = spawn(backendBinaryPath, backendArgs, {
    cwd: workspaceRoot,
    env: convexCliEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });

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
    const readyUrl = `http://127.0.0.1:${config.ports.cloud}/instance_name`;
    const expectedInstanceName = config.deploymentName;
    const startupDeadline = Date.now() + 120_000;
    const poll = async () => {
      if (settled) {
        return;
      }
      if (Date.now() > startupDeadline) {
        fail(
          new Error("Local Convex backend did not start within 120 seconds."),
        );
        return;
      }
      try {
        const response = await fetch(readyUrl);
        const instanceName = await response.text();
        if (response.ok && instanceName === expectedInstanceName) {
          finish();
          return;
        }
      } catch {
        // Keep polling until the backend is ready or the timeout expires.
      }
      setTimeout(() => {
        void poll();
      }, 500);
    };

    backend.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    backend.on("error", fail);
    backend.on("exit", (code) => {
      if (!settled) {
        fail(new Error(`Local Convex backend exited before ready: ${code}`));
      }
    });
    void poll();
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

  await withLocalRehearsalEnv(async () => {
    const backend = await startLocalBackend();
    try {
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
  });
}

await main();
