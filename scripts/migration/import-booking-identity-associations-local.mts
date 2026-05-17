import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const seedRoot = join(workspaceRoot, "seed_data_preview");
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const identityPath = join(reportRoot, "booking-identities.source.jsonl");
const associationPath = join(
  reportRoot,
  "booking-identity-patient-associations.source.jsonl",
);
const legacyUsersPath = join(reportRoot, "legacy-users.source.jsonl");
const bookingBlocksPath = join(
  reportRoot,
  "legacy-booking-blocks.source.jsonl",
);
const bookingStepReplayPath = join(
  reportRoot,
  "legacy-booking-step-replay.source.jsonl",
);
const associationChunkSize = 200;
const identityChunkSize = 500;
const replayChunkSize = 20;
const userChunkSize = 2_000;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertLocalConvexDeployment() {
  const envLocal = readFileSync(join(workspaceRoot, ".env.local"), "utf8");
  if (!/^CONVEX_DEPLOYMENT=local:/mu.test(envLocal)) {
    throw new Error("Refusing import: CONVEX_DEPLOYMENT is not local.");
  }
  if (!/^VITE_CONVEX_URL=http:\/\/127\.0\.0\.1:3210$/mu.test(envLocal)) {
    throw new Error("Refusing import: VITE_CONVEX_URL is not local.");
  }
}

function runConvex(functionName, args) {
  return execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      functionName,
      JSON.stringify(args),
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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function getSeedPractice() {
  const [practice] = readJsonl(join(seedRoot, "practices/documents.jsonl"));
  if (!practice?._id || !practice.currentActiveRuleSetId) {
    throw new Error("Expected seed preview practice and active rule set.");
  }
  return practice;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

assertLocalConvexDeployment();

const identities = readJsonl(identityPath);
const associations = readJsonl(associationPath);
const users = readJsonl(legacyUsersPath);
const bookingBlocks = existsSync(bookingBlocksPath)
  ? readJsonl(bookingBlocksPath)
  : [];
const bookingStepReplayRows = existsSync(bookingStepReplayPath)
  ? readJsonl(bookingStepReplayPath)
  : [];
const practice = getSeedPractice();

execFileSync(
  "pnpm",
  [
    "exec",
    "convex",
    "env",
    "set",
    "MIGRATION_REHEARSAL_ENABLED",
    "true",
    "--deployment",
    "local",
  ],
  {
    cwd: workspaceRoot,
    env: convexCliEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
pushFunctions();

const identityTotals = {
  insertedIdentities: 0,
  reusedIdentities: 0,
};
const associationTotals = {
  insertedAssociations: 0,
  reusedAssociations: 0,
  skippedMissingIdentity: 0,
  skippedMissingPatient: 0,
};

const userTotals = {
  insertedUsers: 0,
  reusedUsers: 0,
};
const blockTotals = {
  insertedBlocks: 0,
  reusedBlocks: 0,
};
const replayTotals = {
  insertedSessions: 0,
  reusedSessions: 0,
  skippedMissingAppointment: 0,
};
const skippedReplayRows = [];

mkdirSync(reportRoot, { recursive: true });

for (const userChunk of chunk(users, userChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importLegacyUsers", {
      users: userChunk,
    }),
  );
  userTotals.insertedUsers += result.insertedUsers ?? 0;
  userTotals.reusedUsers += result.reusedUsers ?? 0;
}

for (const identityChunk of chunk(identities, identityChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importBookingIdentities", {
      identities: identityChunk,
      practiceId: practice._id,
    }),
  );
  identityTotals.insertedIdentities += result.insertedIdentities ?? 0;
  identityTotals.reusedIdentities += result.reusedIdentities ?? 0;
}

for (const associationChunk of chunk(associations, associationChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importBookingIdentityAssociations", {
      associations: associationChunk,
      practiceId: practice._id,
    }),
  );

  for (const key of Object.keys(associationTotals)) {
    associationTotals[key] += result[key] ?? 0;
  }
}

for (const blockChunk of chunk(bookingBlocks, userChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importLegacyBookingBlocks", {
      blocks: blockChunk,
      practiceId: practice._id,
    }),
  );
  blockTotals.insertedBlocks += result.insertedBlocks ?? 0;
  blockTotals.reusedBlocks += result.reusedBlocks ?? 0;
  userTotals.insertedUsers += result.insertedUsers ?? 0;
  userTotals.reusedUsers += result.reusedUsers ?? 0;
}

for (const replayChunk of chunk(bookingStepReplayRows, replayChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importLegacyBookingStepReplay", {
      practiceId: practice._id,
      replayRows: replayChunk,
      ruleSetId: practice.currentActiveRuleSetId,
    }),
  );
  replayTotals.insertedSessions += result.insertedSessions ?? 0;
  replayTotals.reusedSessions += result.reusedSessions ?? 0;
  replayTotals.skippedMissingAppointment +=
    result.skippedMissingAppointment ?? 0;
  skippedReplayRows.push(...(result.skippedRows ?? []));
  userTotals.insertedUsers += result.insertedUsers ?? 0;
  userTotals.reusedUsers += result.reusedUsers ?? 0;
}

const skippedReplayReportPath = join(
  reportRoot,
  "legacy-booking-step-replay-skipped.import-report.jsonl",
);
writeFileSync(
  skippedReplayReportPath,
  skippedReplayRows.map((row) => JSON.stringify(row)).join("\n") +
    (skippedReplayRows.length === 0 ? "" : "\n"),
);

console.log(
  JSON.stringify(
    {
      associationSourceRows: associations.length,
      bookingBlockSourceRows: bookingBlocks.length,
      bookingStepReplaySourceRows: bookingStepReplayRows.length,
      identitySourceRows: identities.length,
      practiceId: practice._id,
      skippedReplayReportPath,
      skippedReplayRows: skippedReplayRows.length,
      userSourceRows: users.length,
      ...associationTotals,
      ...blockTotals,
      ...replayTotals,
      ...identityTotals,
      ...userTotals,
    },
    null,
    2,
  ),
);
