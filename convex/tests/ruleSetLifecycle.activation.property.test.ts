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

const activationSequenceArbitrary = fc.uniqueArray(
  fc.tuple(
    fc
      .string({ maxLength: 16, minLength: 1 })
      .filter((description) => description.trim().length > 0),
    fc.integer({ max: 3, min: 1 }),
  ),
  {
    maxLength: 3,
    minLength: 1,
    selector: ([description]) => description.trim(),
  },
);

describe("rule set activation lifecycle properties", () => {
  test("drafts have parents, repeated draft selection is stable, activation consumes drafts, and reactivation is invalid", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(activationSequenceArbitrary, async (steps) => {
        const t = createPropertyTestContext();
        const fixture = await createPropertySchedulingFixture(t);
        const result = await t.run(async (ctx) => {
          const initialRuleSet = await ctx.db.get(
            "ruleSets",
            fixture.ruleSetId,
          );
          let currentActiveRuleSetId = fixture.ruleSetId;
          const cycleResults = [];

          for (const [description, reselectionCount] of steps) {
            let firstDraftRuleSetId = null;
            let repeatedDraftIdsMatch = true;
            for (
              let selectionIndex = 0;
              selectionIndex < reselectionCount;
              selectionIndex += 1
            ) {
              const draft = await selectDraftRuleSetForEdit(ctx.db, {
                expectedDraftRevision: selectionIndex === 0 ? null : 0,
                practiceId: fixture.practiceId,
                selectedRuleSetId: currentActiveRuleSetId,
              });
              if (firstDraftRuleSetId === null) {
                firstDraftRuleSetId = draft.ruleSetId;
              } else if (draft.ruleSetId !== firstDraftRuleSetId) {
                repeatedDraftIdsMatch = false;
              }
            }

            const draftRuleSet =
              firstDraftRuleSetId === null
                ? null
                : await ctx.db.get("ruleSets", firstDraftRuleSetId);
            const savedRuleSetId = await saveDraftRuleSet(ctx.db, {
              description: `Property activation ${description}`,
              practiceId: fixture.practiceId,
              setAsActive: true,
            });
            const savedRuleSet = await ctx.db.get("ruleSets", savedRuleSetId);
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

            cycleResults.push({
              activeRuleSetId: practice?.currentActiveRuleSetId ?? null,
              draftParent: draftRuleSet?.parentVersion ?? null,
              draftSaved: draftRuleSet?.saved ?? null,
              reactivationRejected,
              remainingDraftCount: remainingDrafts.length,
              repeatedDraftIdsMatch,
              savedParent: savedRuleSet?.parentVersion ?? null,
              savedRuleSetId,
              sourceRuleSetId: currentActiveRuleSetId,
            });
            currentActiveRuleSetId = savedRuleSetId;
          }

          return {
            cycleResults,
            initialParent: initialRuleSet?.parentVersion ?? null,
          };
        });

        expect(result.initialParent).toBe(null);
        for (const cycle of result.cycleResults) {
          expect(cycle.draftParent).toBe(cycle.sourceRuleSetId);
          expect(cycle.draftSaved).toBe(false);
          expect(cycle.repeatedDraftIdsMatch).toBe(true);
          expect(cycle.savedParent).toBe(cycle.sourceRuleSetId);
          expect(cycle.activeRuleSetId).toBe(cycle.savedRuleSetId);
          expect(cycle.remainingDraftCount).toBe(0);
          expect(cycle.reactivationRejected).toBe(true);
        }
      }),
      "rule set activation consumes draft and rejects reactivation",
    );
  });
});
