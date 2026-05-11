import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import {
  activateSavedRuleSet,
  saveDraftRuleSet,
  selectDraftRuleSetForEdit,
} from "../ruleSetLifecycle";

describe("rule set activation lifecycle properties", () => {
  test("drafts have parents, save-and-activate consumes the draft, and reactivation is invalid", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.string({ maxLength: 16, minLength: 1 }),
        async (suffix) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t);
          const result = await t.run(async (ctx) => {
            const draft = await selectDraftRuleSetForEdit(ctx.db, {
              expectedDraftRevision: null,
              practiceId: fixture.practiceId,
              selectedRuleSetId: fixture.ruleSetId,
            });
            const draftRuleSet = await ctx.db.get("ruleSets", draft.ruleSetId);
            const savedRuleSetId = await saveDraftRuleSet(ctx.db, {
              description: `Property activation ${suffix}`,
              practiceId: fixture.practiceId,
              setAsActive: true,
            });
            const remainingDrafts = await ctx.db
              .query("ruleSets")
              .withIndex("by_practiceId_saved", (q) =>
                q.eq("practiceId", fixture.practiceId).eq("saved", false),
              )
              .collect();
            const practice = await ctx.db.get("practices", fixture.practiceId);
            let reactivationRejected = false;
            try {
              await activateSavedRuleSet(ctx.db, {
                practiceId: fixture.practiceId,
                ruleSetId: savedRuleSetId,
              });
            } catch {
              reactivationRejected = true;
            }

            return {
              activeRuleSetId: practice?.currentActiveRuleSetId,
              draftParent: draftRuleSet?.parentVersion,
              reactivationRejected,
              remainingDraftCount: remainingDrafts.length,
              savedRuleSetId,
            };
          });

          expect(result.draftParent).toBe(fixture.ruleSetId);
          expect(result.activeRuleSetId).toBe(result.savedRuleSetId);
          expect(result.remainingDraftCount).toBe(0);
          expect(result.reactivationRejected).toBe(true);
        },
      ),
      "rule set activation consumes draft and rejects reactivation",
    );
  });
});
