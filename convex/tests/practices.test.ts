import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

const TEST_AUTH_ID = "workos_practices";
const TEST_EMAIL = "practices@example.com";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: TEST_EMAIL,
    subject: TEST_AUTH_ID,
  });
}

async function createManagedPractice(
  t: ReturnType<typeof createAuthedTestContext>,
): Promise<Id<"practices">> {
  return await t.mutation(
    internal.workosOrganizations.createPracticeForWorkOSOrganization,
    {
      name: "TelefonKI Secret Practice",
      organizationId: "org_test_practices",
      role: "owner",
      workOSUserId: TEST_AUTH_ID,
    },
  );
}

async function provisionTestUser(
  t: ReturnType<typeof createAuthedTestContext>,
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", TEST_AUTH_ID))
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("users", {
      authId: TEST_AUTH_ID,
      createdAt: BigInt(Date.now()),
      email: TEST_EMAIL,
    });
  });
}

describe("Practices", () => {
  test("initializeDefaultPractice is not available to normal authenticated users", async () => {
    const t = createAuthedTestContext();

    await expect(
      t.mutation(api.practices.initializeDefaultPractice, {}),
    ).rejects.toThrow("only available in bypass mode");
  });

  test("public practice queries omit TelefonKI integration secret hashes", async () => {
    const t = createAuthedTestContext();
    await provisionTestUser(t);
    const practiceId = await createManagedPractice(t);
    const practiceSlug = await t.run(async (ctx) => {
      await ctx.db.patch("practices", practiceId, {
        telefonkiIntegrationSecretHash:
          "f01d8b6548aa0bdef2585e628eed24d8c6a71fe8b02a4cf9498fb38b92fbc841",
      });
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.slug) {
        throw new Error("Expected created practice to have a slug.");
      }
      return practice.slug;
    });

    const allPractices = await t.query(api.practices.getAllPractices, {});
    const allPracticesIfAuthenticated = await t.query(
      api.practices.getAllPracticesIfAuthenticated,
      {},
    );
    const bookingPractices = await t.query(
      api.practices.getBookingPractices,
      {},
    );
    const practice = await t.query(api.practices.getPractice, {
      practiceId,
    });
    const accessiblePracticeBySlug = await t.query(
      api.practices.getAccessiblePracticeBySlug,
      {
        slug: practiceSlug,
      },
    );
    const bookingPracticeBySlug = await t.query(
      api.practices.getBookingPracticeBySlug,
      {
        slug: practiceSlug,
      },
    );

    const returnedPractices = [
      ...allPractices,
      ...allPracticesIfAuthenticated,
      ...bookingPractices,
      practice,
      accessiblePracticeBySlug,
      bookingPracticeBySlug,
    ];
    for (const returnedPractice of returnedPractices) {
      expect(returnedPractice).not.toBeNull();
      expect(returnedPractice).not.toHaveProperty(
        "telefonkiIntegrationSecretHash",
      );
    }
  });
});
