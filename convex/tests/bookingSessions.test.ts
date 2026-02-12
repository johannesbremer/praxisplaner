import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

async function createPracticeAndRuleSet(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Test Rule Set",
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    return { practiceId, ruleSetId };
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

describe("bookingSessions user identity handling", () => {
  test("create bootstraps missing authenticated user", async () => {
    const t = createTestContext();
    const { practiceId, ruleSetId } = await createPracticeAndRuleSet(t);

    const authId = "workos_missing_user";
    const authed = t.withIdentity({
      email: "missing@example.com",
      subject: authId,
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
    });

    const state = await t.run(async (ctx) => {
      const session = await ctx.db.get("bookingSessions", sessionId);
      const users = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authId))
        .collect();
      return { session, users };
    });

    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.email).toBe("missing@example.com");
    expect(state.session?.userId).toBe(state.users[0]?._id);
  });

  test("create and read session succeed with duplicate users for same authId", async () => {
    const t = createTestContext();
    const { practiceId, ruleSetId } = await createPracticeAndRuleSet(t);

    const authId = "workos_duplicate_user";

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId,
        createdAt: 1n,
        email: "first@example.com",
      });
      await ctx.db.insert("users", {
        authId,
        createdAt: 2n,
        email: "second@example.com",
      });
    });

    const authed = t.withIdentity({
      email: "identity@example.com",
      subject: authId,
    });

    const sessionId = await authed.mutation(api.bookingSessions.create, {
      practiceId,
      ruleSetId,
    });

    const expectedUserId = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authId))
        .collect();
      return users
        .toSorted((a, b) => {
          if (a._creationTime !== b._creationTime) {
            return a._creationTime - b._creationTime;
          }
          return a._id.localeCompare(b._id);
        })
        .at(0)?._id;
    });

    const session = await authed.query(api.bookingSessions.get, { sessionId });

    expect(expectedUserId).toBeDefined();
    expect(session?._id).toBe(sessionId);
    expect(session?.userId).toBe(expectedUserId);
  });
});
