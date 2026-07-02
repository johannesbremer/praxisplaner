import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

async function createPracticeManager(
  t: ReturnType<typeof createTestContext>,
  authId: string,
): Promise<Id<"practices">> {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const userId = await ctx.db.insert("users", {
      authId,
      createdAt: now,
      email: `${authId}@example.com`,
    });
    const practiceId = await ctx.db.insert("practices", {
      name: "Migration Auth Practice",
    });
    await ctx.db.insert("organizationMembers", {
      createdAt: now,
      practiceId,
      role: "admin",
      userId,
    });
    return practiceId;
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

async function withMigrationEnv<T>(
  operatorIds: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previousEnabled = process.env["MIGRATION_REHEARSAL_ENABLED"];
  const previousOperators = process.env["MIGRATION_OPERATOR_WORKOS_USER_IDS"];
  process.env["MIGRATION_REHEARSAL_ENABLED"] = "true";
  if (operatorIds === undefined) {
    delete process.env["MIGRATION_OPERATOR_WORKOS_USER_IDS"];
  } else {
    process.env["MIGRATION_OPERATOR_WORKOS_USER_IDS"] = operatorIds;
  }

  try {
    return await fn();
  } finally {
    if (previousEnabled === undefined) {
      delete process.env["MIGRATION_REHEARSAL_ENABLED"];
    } else {
      process.env["MIGRATION_REHEARSAL_ENABLED"] = previousEnabled;
    }
    if (previousOperators === undefined) {
      delete process.env["MIGRATION_OPERATOR_WORKOS_USER_IDS"];
    } else {
      process.env["MIGRATION_OPERATOR_WORKOS_USER_IDS"] = previousOperators;
    }
  }
}

describe("migration rehearsal authorization", () => {
  test("rehearsal flag alone does not authorize public migration writes", async () => {
    const authId = "migration-auth-manager";
    const t = createTestContext();
    const practiceId = await createPracticeManager(t, authId);
    const manager = t.withIdentity({
      email: `${authId}@example.com`,
      subject: authId,
    });

    await withMigrationEnv(undefined, async () => {
      await expect(
        manager.mutation(api.migrationRehearsal.importBookingIdentities, {
          identities: [],
          practiceId,
        }),
      ).rejects.toThrow("Migration operator allowlist is empty");
    });
  });

  test("allowlisted practice manager can run public migration writes", async () => {
    const authId = "migration-auth-operator";
    const t = createTestContext();
    const practiceId = await createPracticeManager(t, authId);
    const manager = t.withIdentity({
      email: `${authId}@example.com`,
      subject: authId,
    });

    await withMigrationEnv(authId, async () => {
      await expect(
        manager.mutation(api.migrationRehearsal.importBookingIdentities, {
          identities: [],
          practiceId,
        }),
      ).resolves.toEqual({ insertedIdentities: 0, reusedIdentities: 0 });
    });
  });

  test("allowlisted practice manager can import PVS patients idempotently", async () => {
    const authId = "migration-auth-patient-operator";
    const t = createTestContext();
    const practiceId = await createPracticeManager(t, authId);
    const manager = t.withIdentity({
      email: `${authId}@example.com`,
      subject: authId,
    });

    await withMigrationEnv(authId, async () => {
      await expect(
        manager.mutation(api.migrationRehearsal.importPvsPatients, {
          patients: [
            {
              firstName: "Anke",
              lastName: "Artkamp",
              patientId: 1,
            },
          ],
          practiceId,
        }),
      ).resolves.toEqual({
        insertedPatients: 1,
        unchangedPatients: 0,
        updatedPatients: 0,
      });

      await expect(
        manager.mutation(api.migrationRehearsal.importPvsPatients, {
          patients: [
            {
              firstName: "Anke",
              lastName: "Artkamp",
              patientId: 1,
            },
          ],
          practiceId,
        }),
      ).resolves.toEqual({
        insertedPatients: 0,
        unchangedPatients: 1,
        updatedPatients: 0,
      });
    });
  });
});
