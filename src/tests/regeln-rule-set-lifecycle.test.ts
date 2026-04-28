import { describe, expect, it } from "vitest";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { toTableId } from "@/convex/identity";

import { UNSAVED_RULE_SET_DESCRIPTION } from "../routes/regeln/-rule-set-diff";
import {
  selectRuleSetLifecycle,
  summarizeRuleSets,
} from "../routes/regeln/-rule-set-lifecycle";

describe("Regeln rule set lifecycle selection", () => {
  it("keeps rule set summaries available when no active rule set is recorded", () => {
    const ruleSets = [
      ruleSetDoc({ id: "rule-set-a", saved: true, version: 1 }),
      ruleSetDoc({ id: "rule-set-b", saved: true, version: 2 }),
    ];

    const summaries = summarizeRuleSets(ruleSets);

    expect(summaries).toEqual([
      {
        _id: ruleSets[0]?._id,
        description: "Rule Set 1",
        isActive: false,
        version: 1,
      },
      {
        _id: ruleSets[1]?._id,
        description: "Rule Set 2",
        isActive: false,
        version: 2,
      },
    ]);
  });

  it("resolves a saved rule set from the URL even before a practice has an active rule set", () => {
    const savedRuleSet = ruleSetDoc({
      description: "Saved Rule Set",
      id: "saved-rule-set",
      saved: true,
      version: 3,
    });
    const summaries = summarizeRuleSets([savedRuleSet]);

    const selection = selectRuleSetLifecycle({
      rawRuleSetSearch: savedRuleSet._id,
      ruleSetIdFromUrl: savedRuleSet._id,
      ruleSets: [savedRuleSet],
      ruleSetSummaries: summaries,
      trackedDraftRuleSetId: null,
    });

    expect(selection.selected?._id).toBe(savedRuleSet._id);
    expect(selection.working?._id).toBe(savedRuleSet._id);
    expect(selection.navigation.resolvedUrlRuleSetId).toBe(savedRuleSet._id);
    expect(selection.navigation.selectedVersionId).toBe(savedRuleSet._id);
    expect(selection.active).toBeUndefined();
  });

  it("selects the current Draft Rule Set when the URL has no rule set segment", () => {
    const parentRuleSet = ruleSetDoc({
      id: "parent-rule-set",
      saved: true,
      version: 4,
    });
    const draftRuleSet = ruleSetDoc({
      description: UNSAVED_RULE_SET_DESCRIPTION,
      id: "draft-rule-set",
      parentVersion: parentRuleSet._id,
      saved: false,
      version: 5,
    });
    const summaries = summarizeRuleSets(
      [parentRuleSet, draftRuleSet],
      parentRuleSet._id,
    );

    const selection = selectRuleSetLifecycle({
      rawRuleSetSearch: undefined,
      ruleSetIdFromUrl: undefined,
      ruleSets: [parentRuleSet, draftRuleSet],
      ruleSetSummaries: summaries,
      trackedDraftRuleSetId: null,
    });

    expect(selection.active?._id).toBe(parentRuleSet._id);
    expect(selection.draft?._id).toBe(draftRuleSet._id);
    expect(selection.working?._id).toBe(draftRuleSet._id);
    expect(selection.navigation.selectedVersionId).toBe(draftRuleSet._id);
  });
});

function ruleSetDoc(args: {
  description?: string;
  id: string;
  parentVersion?: Id<"ruleSets">;
  saved: boolean;
  version: number;
}): Doc<"ruleSets"> {
  return {
    _creationTime: 1,
    _id: toTableId<"ruleSets">(args.id),
    createdAt: 1,
    description: args.description ?? `Rule Set ${args.version}`,
    draftRevision: args.saved ? 0 : 1,
    ...(args.parentVersion ? { parentVersion: args.parentVersion } : {}),
    practiceId: toTableId<"practices">("practice"),
    saved: args.saved,
    version: args.version,
  };
}
