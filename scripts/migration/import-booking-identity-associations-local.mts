import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

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
const pvsPractitionerAssociationPath = join(
  reportRoot,
  "pvs-patient-practitioner-associations.source.jsonl",
);
const associationChunkSize = 25;
const identityChunkSize = 500;
const pvsPractitionerAssociationChunkSize = 500;
const replayChunkSize = 20;
const userChunkSize = 2_000;
const convexCliEnv = {
  ...process.env,
  CI: "1",
};
const localDeploymentConfigPath = join(
  workspaceRoot,
  ".convex/local/default/config.json",
);
const migrationFunctionReferences = {
  importBookingIdentities: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importBookingIdentities"),
  importBookingIdentityAssociations: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importBookingIdentityAssociations"),
  importLegacyBookingBlocks: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importLegacyBookingBlocks"),
  importLegacyBookingStepReplay: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importLegacyBookingStepReplay"),
  importLegacyUsers: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importLegacyUsers"),
  importPvsPatientPractitionerAssociations: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migrationRehearsal:importPvsPatientPractitionerAssociations"),
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

function getLocalAdminKey() {
  const config = JSON.parse(readFileSync(localDeploymentConfigPath, "utf8"));
  if (typeof config.adminKey !== "string") {
    throw new Error("Expected local Convex deployment admin key.");
  }
  return config.adminKey;
}

function createLocalConvexClient() {
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  client.setAdminAuth(getLocalAdminKey());
  return client;
}

function numberResult(result, key) {
  return typeof result[key] === "number" ? result[key] : 0;
}

async function runMigrationMutation(client, functionReference, args) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const result = await client.mutation(functionReference, args);
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result)
      ) {
        throw new Error("Expected migration mutation to return an object.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTooManyWrites = message.includes('"code":"TooManyWrites"');
      if (!isTooManyWrites || attempt === 8) {
        throw error;
      }
      const backoffMs = attempt * 500;
      console.warn(
        `TooManyWrites from ${String(functionReference)}; retrying in ${backoffMs}ms (attempt ${attempt}/8).`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error("Migration mutation retry loop exhausted unexpectedly.");
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

async function main() {
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
  const pvsPractitionerAssociations = existsSync(pvsPractitionerAssociationPath)
    ? readJsonl(pvsPractitionerAssociationPath)
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
  const convex = createLocalConvexClient();

  const identityTotals = {
    insertedIdentities: 0,
    reusedIdentities: 0,
  };
  const associationTotals = {
    associatedPractitionersFromIdentityLinks: 0,
    insertedAssociations: 0,
    reusedAssociations: 0,
    skippedNoClearPractitioner: 0,
    skippedMissingIdentity: 0,
    skippedMissingPatient: 0,
  };

  const userTotals = {
    insertedUsers: 0,
    reusedUsers: 0,
  };
  const pvsPractitionerAssociationTotals = {
    importedPvsPractitionerAssociations: 0,
    skippedMissingPvsPractitionerAssociationPatients: 0,
  };
  const blockTotals = {
    insertedBlocks: 0,
    reusedBlocks: 0,
  };
  const replayTotals = {
    associatedPractitionersFromReplay: 0,
    insertedSessions: 0,
    reusedSessions: 0,
    skippedMissingAppointment: 0,
  };
  const skippedReplayRows = [];
  const practitionerAssociationDivergences = [];

  mkdirSync(reportRoot, { recursive: true });

  for (const pvsPractitionerAssociationChunk of chunk(
    pvsPractitionerAssociations,
    pvsPractitionerAssociationChunkSize,
  )) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importPvsPatientPractitionerAssociations,
      {
        associations: pvsPractitionerAssociationChunk,
        practiceId: practice._id,
      },
    );
    pvsPractitionerAssociationTotals.importedPvsPractitionerAssociations +=
      numberResult(result, "importedAssociations");
    pvsPractitionerAssociationTotals.skippedMissingPvsPractitionerAssociationPatients +=
      numberResult(result, "skippedMissingPatient");
  }

  for (const userChunk of chunk(users, userChunkSize)) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importLegacyUsers,
      {
        users: userChunk,
      },
    );
    userTotals.insertedUsers += numberResult(result, "insertedUsers");
    userTotals.reusedUsers += numberResult(result, "reusedUsers");
  }

  for (const identityChunk of chunk(identities, identityChunkSize)) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importBookingIdentities,
      {
        identities: identityChunk,
        practiceId: practice._id,
      },
    );
    identityTotals.insertedIdentities += numberResult(
      result,
      "insertedIdentities",
    );
    identityTotals.reusedIdentities += numberResult(result, "reusedIdentities");
  }

  for (const associationChunk of chunk(associations, associationChunkSize)) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importBookingIdentityAssociations,
      {
        associations: associationChunk,
        practiceId: practice._id,
      },
    );

    for (const key of Object.keys(associationTotals)) {
      associationTotals[key] += numberResult(result, key);
    }
    associationTotals.associatedPractitionersFromIdentityLinks += numberResult(
      result,
      "associatedPractitioners",
    );
  }

  for (const blockChunk of chunk(bookingBlocks, userChunkSize)) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importLegacyBookingBlocks,
      {
        blocks: blockChunk,
        practiceId: practice._id,
      },
    );
    blockTotals.insertedBlocks += numberResult(result, "insertedBlocks");
    blockTotals.reusedBlocks += numberResult(result, "reusedBlocks");
    userTotals.insertedUsers += numberResult(result, "insertedUsers");
    userTotals.reusedUsers += numberResult(result, "reusedUsers");
  }

  for (const replayChunk of chunk(bookingStepReplayRows, replayChunkSize)) {
    const result = await runMigrationMutation(
      convex,
      migrationFunctionReferences.importLegacyBookingStepReplay,
      {
        practiceId: practice._id,
        replayRows: replayChunk,
        ruleSetId: practice.currentActiveRuleSetId,
      },
    );
    replayTotals.insertedSessions += numberResult(result, "insertedSessions");
    replayTotals.reusedSessions += numberResult(result, "reusedSessions");
    replayTotals.skippedMissingAppointment += numberResult(
      result,
      "skippedMissingAppointment",
    );
    replayTotals.associatedPractitionersFromReplay += numberResult(
      result,
      "associatedPractitioners",
    );
    if (Array.isArray(result.skippedRows)) {
      skippedReplayRows.push(...result.skippedRows);
    }
    if (Array.isArray(result.practitionerAssociationDivergences)) {
      practitionerAssociationDivergences.push(
        ...result.practitionerAssociationDivergences,
      );
    }
    userTotals.insertedUsers += numberResult(result, "insertedUsers");
    userTotals.reusedUsers += numberResult(result, "reusedUsers");
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
  const practitionerDivergenceReportPath = join(
    reportRoot,
    "practitioner-association-divergences.import-report.jsonl",
  );
  writeFileSync(
    practitionerDivergenceReportPath,
    practitionerAssociationDivergences
      .map((row) => JSON.stringify(row))
      .join("\n") +
      (practitionerAssociationDivergences.length === 0 ? "" : "\n"),
  );

  console.log(
    JSON.stringify(
      {
        associationSourceRows: associations.length,
        bookingBlockSourceRows: bookingBlocks.length,
        bookingStepReplaySourceRows: bookingStepReplayRows.length,
        identitySourceRows: identities.length,
        practitionerAssociationDivergenceReportPath:
          practitionerDivergenceReportPath,
        practitionerAssociationDivergences:
          practitionerAssociationDivergences.length,
        pvsPractitionerAssociationSourceRows:
          pvsPractitionerAssociations.length,
        practiceId: practice._id,
        skippedReplayReportPath,
        skippedReplayRows: skippedReplayRows.length,
        userSourceRows: users.length,
        ...associationTotals,
        ...blockTotals,
        ...pvsPractitionerAssociationTotals,
        ...replayTotals,
        ...identityTotals,
        ...userTotals,
      },
      null,
      2,
    ),
  );
}

await main();
