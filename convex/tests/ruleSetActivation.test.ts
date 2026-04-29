import { convexTest } from "convex-test";
import { expect } from "vitest";
import { describe, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";
import { assertDefined } from "./test_utils";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "ruleset-activation@example.com",
    subject: "workos_ruleset_activation",
  });
}

async function getPracticeRuleSetIds(
  t: ReturnType<typeof createAuthedTestContext>,
  practiceId: Id<"practices">,
) {
  const practice = await t.run(
    async (ctx) => await ctx.db.get("practices", practiceId),
  );
  assertDefined(practice);
  assertDefined(practice.currentActiveRuleSetId);
  return { activeRuleSetId: practice.currentActiveRuleSetId };
}

async function insertPractitioner(
  ctx: MutationCtx,
  args: {
    name: string;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"practitioners">> {
  return await insertSelfLineageEntity(ctx.db, "practitioners", {
    name: args.name,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
  });
}

describe("rule set activation", () => {
  test("records the initial activation when a practice is created", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Activation History Practice",
    });
    const { activeRuleSetId } = await getPracticeRuleSetIds(t, practiceId);

    const activations = await t.query(api.ruleSets.getActivationHistory, {
      practiceId,
    });

    expect(activations).toHaveLength(1);
    expect(activations[0]?.activatedRuleSetId).toBe(activeRuleSetId);
    expect(activations[0]?.previousActiveRuleSetId).toBeUndefined();
  });

  test("records saved draft activation with the previous active rule set", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Draft Activation Practice",
    });
    const { activeRuleSetId: initialRuleSetId } = await getPracticeRuleSetIds(
      t,
      practiceId,
    );
    const practitionerId = await t.run(
      async (ctx) =>
        await insertPractitioner(ctx, {
          name: "Dr. Activation",
          practiceId,
          ruleSetId: initialRuleSetId,
        }),
    );

    await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Activation Type",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });

    const activatedRuleSetId = await t.mutation(
      api.ruleSets.saveUnsavedRuleSet,
      {
        description: "Activated draft",
        practiceId,
        setAsActive: true,
      },
    );

    const activations = await t.query(api.ruleSets.getActivationHistory, {
      practiceId,
    });

    expect(activations).toHaveLength(2);
    expect(activations[1]?.activatedRuleSetId).toBe(activatedRuleSetId);
    expect(activations[1]?.previousActiveRuleSetId).toBe(initialRuleSetId);
  });

  test("rejects activating the already active rule set", async () => {
    const t = createAuthedTestContext();
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Duplicate Activation Practice",
    });
    const { activeRuleSetId } = await getPracticeRuleSetIds(t, practiceId);

    await expect(
      t.mutation(api.ruleSets.setActiveRuleSet, {
        practiceId,
        ruleSetId: activeRuleSetId,
      }),
    ).rejects.toThrow("already active");
  });
});
