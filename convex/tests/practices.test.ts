import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "practices@example.com",
    subject: "workos_practices",
  });
}

describe("Practices", () => {
  test("initializeDefaultPractice recreates a practice when memberships point to deleted practices", async () => {
    const t = createAuthedTestContext();

    const originalPracticeId = await t.mutation(api.practices.createPractice, {
      name: "Deleted Practice",
    });

    await t.run(async (ctx) => {
      await ctx.db.delete("practices", originalPracticeId);
    });

    const recreatedPracticeId = await t.mutation(
      api.practices.initializeDefaultPractice,
      {},
    );

    expect(recreatedPracticeId).not.toEqual(originalPracticeId);

    const state = await t.run(async (ctx) => {
      const recreatedPractice = await ctx.db.get(
        "practices",
        recreatedPracticeId,
      );
      const memberships = await ctx.db
        .query("practiceMembers")
        .withIndex("by_practiceId", (q) =>
          q.eq("practiceId", recreatedPracticeId),
        )
        .collect();
      const danglingMemberships = await ctx.db
        .query("practiceMembers")
        .withIndex("by_practiceId", (q) =>
          q.eq("practiceId", originalPracticeId),
        )
        .collect();

      return {
        danglingMemberships,
        memberships,
        recreatedPractice,
      };
    });

    expect(state.recreatedPractice?.name).toEqual("Standardpraxis");
    expect(state.recreatedPractice?.currentActiveRuleSetId).toBeDefined();
    expect(state.memberships).toHaveLength(1);
    expect(state.danglingMemberships).toHaveLength(0);
  });
});
