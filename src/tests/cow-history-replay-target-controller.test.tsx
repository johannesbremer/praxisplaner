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

  it("does not regress to a stale draft revision from props after local replay advances", () => {
    const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
    const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");
    const { rerender, result } = renderHook(
      ({ draftRevision }: { draftRevision: number }) =>
        useRuleSetReplayTargetController({
          ruleSetId: parentRuleSetId,
          ruleSetReplayTarget: {
            draftRevision,
            draftRuleSetId,
            kind: "draft",
            parentRuleSetId,
          },
        }),
      {
        initialProps: { draftRevision: 2 },
      },
    );

    act(() => {
      result.current.handleDraftMutationResult({
        draftRevision: 4,
        ruleSetId: draftRuleSetId,
      });
    });
    rerender({ draftRevision: 2 });

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: 4,
      selectedRuleSetId: draftRuleSetId,
    });
  });

  it("does not regress to saved parent props after local replay creates a draft", () => {
    const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
    const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");
    const { rerender, result } = renderHook(() =>
      useRuleSetReplayTargetController({
        ruleSetId: parentRuleSetId,
        ruleSetReplayTarget: {
          kind: "saved-parent",
          parentRuleSetId,
        },
      }),
    );

    act(() => {
      result.current.handleDraftMutationResult({
        draftRevision: 1,
        ruleSetId: draftRuleSetId,
      });
    });
    rerender();

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: 1,
      selectedRuleSetId: draftRuleSetId,
    });
  });
});
