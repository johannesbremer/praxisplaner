import { describe, expect, it } from "vitest";

import { toTableId } from "@/convex/identity";

import type { Id } from "../../convex/_generated/dataModel";
import type { RuleFromDB } from "../components/rule-builder-types";

import { getSchedulingRuleCopySource } from "../utils/scheduling-rule-replay";

const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");

function ruleCopyInput(params: {
  copyFromId?: Id<"ruleConditions">;
  id: string;
  ruleSetId: Id<"ruleSets">;
}): Pick<RuleFromDB, "_id" | "copyFromId" | "ruleSetId"> {
  return {
    _id: toTableId<"ruleConditions">(params.id),
    copyFromId: params.copyFromId,
    ruleSetId: params.ruleSetId,
  };
}

describe("scheduling rule replay copy sources", () => {
  it("uses a saved parent rule id as the copy source for replacement replays", () => {
    const savedRuleId = toTableId<"ruleConditions">("saved-rule");

    expect(
      getSchedulingRuleCopySource(
        ruleCopyInput({
          id: savedRuleId,
          ruleSetId: parentRuleSetId,
        }),
        parentRuleSetId,
      ),
    ).toEqual({ copyFromId: savedRuleId });
  });

  it("preserves an existing root copy source for draft copies", () => {
    const savedRuleId = toTableId<"ruleConditions">("saved-rule");

    expect(
      getSchedulingRuleCopySource(
        ruleCopyInput({
          copyFromId: savedRuleId,
          id: "draft-copy",
          ruleSetId: draftRuleSetId,
        }),
        parentRuleSetId,
      ),
    ).toEqual({ copyFromId: savedRuleId });
  });

  it("does not invent copy sources for new draft-only rules", () => {
    expect(
      getSchedulingRuleCopySource(
        ruleCopyInput({
          id: "new-draft-rule",
          ruleSetId: draftRuleSetId,
        }),
        parentRuleSetId,
      ),
    ).toEqual({});
  });
});
