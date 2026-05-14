import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const identityPath = join(reportRoot, "booking-identities.source.jsonl");
const associationPath = join(
  reportRoot,
  "booking-identity-patient-associations.source.jsonl",
);
const legacyUsersPath = join(reportRoot, "legacy-users.source.jsonl");
const associationChunkSize = 25;
const userChunkSize = 500;

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
      "--push",
      "--typecheck",
      "disable",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function readLocalTable(tableName) {
  const output = execFileSync(
    "pnpm",
    ["exec", "convex", "data", tableName, "--format", "jsonLines"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/: (-?\d+)n([,}])/g, ": $1$2")));
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
const [practice] = readLocalTable("practices");
if (!practice?._id) {
  throw new Error("No local practice found. Seed/import baseline first.");
}

execFileSync(
  "pnpm",
  ["exec", "convex", "env", "set", "MIGRATION_REHEARSAL_ENABLED", "true"],
  {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const identityBySourceKey = new Map(
  identities.map((identity) => [identity.sourceKey, identity]),
);
const totals = {
  insertedAssociations: 0,
  insertedIdentities: 0,
  reusedAssociations: 0,
  reusedIdentities: 0,
  skippedMissingIdentity: 0,
  skippedMissingPatient: 0,
};

const userTotals = {
  insertedUsers: 0,
  reusedUsers: 0,
};

for (const userChunk of chunk(users, userChunkSize)) {
  const result = JSON.parse(
    runConvex("migrationRehearsal:importLegacyUsers", {
      users: userChunk,
    }),
  );
  userTotals.insertedUsers += result.insertedUsers ?? 0;
  userTotals.reusedUsers += result.reusedUsers ?? 0;
}

for (const associationChunk of chunk(associations, associationChunkSize)) {
  const sourceKeys = new Set(
    associationChunk.map((association) => association.bookingIdentitySourceKey),
  );
  const identityChunk = [...sourceKeys].map((sourceKey) => {
    const identity = identityBySourceKey.get(sourceKey);
    if (!identity) {
      throw new Error(`Missing identity source row for ${sourceKey}.`);
    }
    return identity;
  });

  const result = JSON.parse(
    runConvex("migrationRehearsal:importBookingIdentityAssociations", {
      associations: associationChunk,
      identities: identityChunk,
      practiceId: practice._id,
    }),
  );

  for (const key of Object.keys(totals)) {
    totals[key] += result[key] ?? 0;
  }
}

console.log(
  JSON.stringify(
    {
      associationSourceRows: associations.length,
      identitySourceRows: identities.length,
      practiceId: practice._id,
      userSourceRows: users.length,
      ...totals,
      ...userTotals,
    },
    null,
    2,
  ),
);
