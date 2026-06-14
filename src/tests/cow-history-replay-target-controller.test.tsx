import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { toTableId } from "@/convex/identity";

import { useRuleSetReplayTargetController } from "../utils/cow-history";

describe("useRuleSetReplayTargetController", () => {
  it("advances from saved parent args to draft revision args after mutation results", () => {
    const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
    const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");
    const onDraftMutation = vi.fn();
    const onRuleSetCreated = vi.fn();
    const { result } = renderHook(() =>
      useRuleSetReplayTargetController({
        onDraftMutation,
        onRuleSetCreated,
        ruleSetId: parentRuleSetId,
        ruleSetReplayTarget: {
          kind: "saved-parent",
          parentRuleSetId,
        },
      }),
    );

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: null,
      selectedRuleSetId: parentRuleSetId,
    });

    act(() => {
      result.current.handleDraftMutationResult({
        draftRevision: 3,
        ruleSetId: draftRuleSetId,
      });
    });

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: 3,
      selectedRuleSetId: draftRuleSetId,
    });
    expect(onDraftMutation).toHaveBeenCalledWith({
      draftRevision: 3,
      ruleSetId: draftRuleSetId,
    });
    expect(onRuleSetCreated).toHaveBeenCalledWith(draftRuleSetId);
  });
});
