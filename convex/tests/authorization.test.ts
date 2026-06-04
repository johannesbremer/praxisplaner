import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

async function createPracticeForUser(
  t: ReturnType<typeof createTestContext>,
  authId: string,
  email: string,
) {
  const authed = t.withIdentity({ email, subject: authId });
  const practiceId = await authed.mutation(api.practices.createPractice, {
    name: `${authId} practice`,
  });
  const practice = await t.run(
    async (ctx) => await ctx.db.get("practices", practiceId),
  );
  if (!practice?.currentActiveRuleSetId) {
    throw new Error("Expected created practice to have an active rule set.");
  }
  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .first();
  });
  if (!user) {
    throw new Error("Expected created practice to provision a user.");
  }
  return {
    authed,
    practiceId,
    ruleSetId: practice.currentActiveRuleSetId,
    userId: user._id,
  };
}

function createTestContext() {
  return convexTest(schema, modules);
}

async function createUser(
  t: ReturnType<typeof createTestContext>,
  authId: string,
  email: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
  });
}

async function setMembershipRole(
  t: ReturnType<typeof createTestContext>,
  args: {
    practiceId: Id<"practices">;
    role: "admin" | "owner" | "staff";
    userId: Id<"users">;
  },
) {
  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", args.practiceId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: args.practiceId,
        role: args.role,
        userId: args.userId,
      });
      return;
    }
    await ctx.db.patch("practiceMembers", membership._id, { role: args.role });
  });
}

describe("Convex query authorization", () => {
  test("queries do not use an unauthenticated local fallback identity", async () => {
    const t = createTestContext();

    await expect(t.query(api.practices.getAllPractices, {})).rejects.toThrow(
      "Authenticated user is not provisioned",
    );
  });

  test("staff can read practice data but not manager-only practice data", async () => {
    const t = createTestContext();
    const authId = "workos_authz_staff";
    const email = "authz-staff@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      authId,
      email,
    );
    await setMembershipRole(t, { practiceId, role: "staff", userId });

    await expect(
      authed.query(api.practices.getPractice, { practiceId }),
    ).resolves.toMatchObject({ _id: practiceId });
    await expect(
      authed.query(api.practices.getPracticeMembers, { practiceId }),
    ).rejects.toThrow("Role staff is insufficient");
  });

  test("admin can read manager-only practice data", async () => {
    const t = createTestContext();
    const authId = "workos_authz_admin";
    const email = "authz-admin@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      authId,
      email,
    );
    await setMembershipRole(t, { practiceId, role: "admin", userId });

    await expect(
      authed.query(api.practices.getPracticeMembers, { practiceId }),
    ).resolves.toHaveLength(1);
  });

  test("patient booking scope rejects mismatched practice and rule set", async () => {
    const t = createTestContext();
    const first = await createPracticeForUser(
      t,
      "workos_authz_first_owner",
      "authz-first-owner@example.com",
    );
    const second = await createPracticeForUser(
      t,
      "workos_authz_second_owner",
      "authz-second-owner@example.com",
    );
    const patientAuthId = "workos_authz_patient";
    const patientEmail = "authz-patient@example.com";
    await createUser(t, patientAuthId, patientEmail);
    const patient = t.withIdentity({
      email: patientEmail,
      subject: patientAuthId,
    });

    await expect(
      patient.query(api.scheduling.getSlotsForDay, {
        date: "2026-01-05",
        practiceId: first.practiceId,
        ruleSetId: second.ruleSetId,
        simulatedContext: {
          patient: { isNew: true },
        },
      }),
    ).rejects.toThrow("Rule set does not belong to this practice");
  });

  test("practice-scoped user display query does not expose unrelated users", async () => {
    const t = createTestContext();
    const { authed, practiceId } = await createPracticeForUser(
      t,
      "workos_authz_display_owner",
      "authz-display-owner@example.com",
    );
    const unrelatedUserId = await createUser(
      t,
      "workos_authz_unrelated",
      "authz-unrelated@example.com",
    );

    await expect(
      authed.query(api.users.getUsersByIds, {
        practiceId,
        userIds: [unrelatedUserId],
      }),
    ).resolves.toEqual({});
  });
});
