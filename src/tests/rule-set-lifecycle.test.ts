import { describe, expect, it } from "vitest";

import { toTableId } from "../../convex/identity";
import { summarizeRuleSetsForLifecycle } from "../routes/regeln/-rule-set-lifecycle";

const activeRuleSetId = toTableId<"ruleSets">("rule_set_active");
const savedRuleSetId = toTableId<"ruleSets">("rule_set_saved");
const draftRuleSetId = toTableId<"ruleSets">("rule_set_draft");
const missingDraftRuleSetId = toTableId<"ruleSets">("rule_set_missing_draft");

const ruleSets = [
  {
    _id: activeRuleSetId,
    description: "Aktiv",
    draftRevision: 0,
    saved: true,
    version: 1,
  },
  {
    _id: savedRuleSetId,
    description: "Sommer",
    draftRevision: 0,
    saved: true,
    version: 2,
  },
  {
    _id: draftRuleSetId,
    description: "Ungespeicherte Änderungen",
    draftRevision: 3,
    parentVersion: savedRuleSetId,
    saved: false,
    version: 3,
  },
];

describe("summarizeRuleSetsForLifecycle", () => {
  it("selects the tracked draft as the working rule set", () => {
    const summary = summarizeRuleSetsForLifecycle({
      activeRuleSetId,
      routeRuleSetToken: undefined,
      ruleSets,
      trackedDraftRuleSetId: draftRuleSetId,
    });

    expect(summary.currentWorkingRuleSet?._id).toBe(draftRuleSetId);
    expect(summary.draftRuleSet).toMatchObject({
      _id: draftRuleSetId,
      draftRevision: 3,
      parentVersion: savedRuleSetId,
    });
    expect(summary.isShowingDraftRuleSet).toBe(true);
    expect(summary.resolvedTrackedDraftRuleSetId).toBe(draftRuleSetId);
  });

  it("uses the route token to select an explicit saved rule set", () => {
    const summary = summarizeRuleSetsForLifecycle({
      activeRuleSetId,
      routeRuleSetToken: "Sommer",
      ruleSets,
      trackedDraftRuleSetId: draftRuleSetId,
    });

    expect(summary.currentWorkingRuleSet?._id).toBe(savedRuleSetId);
    expect(summary.selectedRuleSet?._id).toBe(savedRuleSetId);
    expect(summary.isShowingDraftRuleSet).toBe(false);
    expect(summary.hasBlockingDraftChanges).toBe(true);
  });

  it("falls back to the active rule set when no draft is available", () => {
    const summary = summarizeRuleSetsForLifecycle({
      activeRuleSetId,
      routeRuleSetToken: undefined,
      ruleSets: ruleSets.filter((ruleSet) => ruleSet.saved),
      trackedDraftRuleSetId: null,
    });

    expect(summary.currentWorkingRuleSet?._id).toBe(activeRuleSetId);
    expect(summary.activeRuleSet?._id).toBe(activeRuleSetId);
    expect(summary.draftRuleSet).toBeUndefined();
    expect(summary.hasBlockingDraftChanges).toBe(false);
    expect(summary.selectedVersionId).toBe(activeRuleSetId);
  });

  it("recovers from a missing tracked draft by using the current draft record", () => {
    const summary = summarizeRuleSetsForLifecycle({
      activeRuleSetId,
      routeRuleSetToken: undefined,
      ruleSets,
      trackedDraftRuleSetId: missingDraftRuleSetId,
    });

    expect(summary.resolvedTrackedDraftRuleSetId).toBeNull();
    expect(summary.currentWorkingRuleSet?._id).toBe(draftRuleSetId);
    expect(summary.selectedVersionId).toBe(draftRuleSetId);
  });

  it("returns an empty lifecycle summary while rule sets are loading", () => {
    const summary = summarizeRuleSetsForLifecycle({
      activeRuleSetId,
      routeRuleSetToken: undefined,
      ruleSets: undefined,
      trackedDraftRuleSetId: draftRuleSetId,
    });

    expect(summary.currentWorkingRuleSet).toBeUndefined();
    expect(summary.summaries).toBeUndefined();
    expect(summary.hasBlockingDraftChanges).toBe(false);
  });
});
