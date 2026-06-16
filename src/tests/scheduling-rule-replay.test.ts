import { describe, expect, it, vi } from "vitest";

import { toTableId } from "@/convex/identity";

import type { Id } from "../../convex/_generated/dataModel";
import type { RuleFromDB } from "../components/rule-builder-types";

import {
  createSchedulingRuleUpdateReplayAdapter,
  getSchedulingRuleCopySource,
} from "../utils/scheduling-rule-replay";

const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");

function rule(params: { id: string; ruleSetId: Id<"ruleSets"> }): RuleFromDB {
  return {
    _id: toTableId<"ruleConditions">(params.id),
    conditionTree: {
      conditionType: "APPOINTMENT_TYPE",
      nodeType: "CONDITION",
      operator: "IS",
      valueIds: ["appointment-type"],
    },
    copyFromId: undefined,
    createdAt: 0n,
    enabled: true,
    lastModified: 0n,
    practiceId: toTableId<"practices">("practice"),
    ruleSetId: params.ruleSetId,
  };
}

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

  it("reports duplicate serialized rule matches instead of selecting the first one", async () => {
    const firstDuplicate = rule({
      id: "duplicate-1",
      ruleSetId: draftRuleSetId,
    });
    const secondDuplicate = rule({
      id: "duplicate-2",
      ruleSetId: draftRuleSetId,
    });
    const replay = createSchedulingRuleUpdateReplayAdapter({
      context: {
        deleteRule: vi.fn(),
        getCopySource: () => ({}),
        handleDraftMutationResult: vi.fn(),
        isMissingEntityError: () => false,
        prepareRule: (conditionTree) => ({ conditionTree, status: "ok" }),
        rules: () => [firstDuplicate, secondDuplicate],
        runCreateRule: vi.fn(),
        serializeRule: () => "same-state",
      },
      currentRuleLineageTree: firstDuplicate.conditionTree,
      currentRuleState: "next-state",
      initialRuleId: toTableId<"ruleConditions">("missing-rule"),
      previousRule: firstDuplicate,
      previousRuleLineageTree: firstDuplicate.conditionTree,
      previousRuleName: "Previous",
      previousRuleState: "same-state",
      ruleName: "Current",
    });

    await expect(replay.redo()).resolves.toEqual({
      message:
        "Die Regel kann nicht wiederhergestellt werden, weil der vorherige Regelzustand mehrfach vorhanden ist.",
      status: "conflict",
    });
  });
});
