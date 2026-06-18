import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { toTableId } from "@/convex/identity";

import {
  ruleSetHistoryScopeFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";

describe("ruleSetHistoryScopeFromReplayTarget", () => {
  it("uses the CoW parent rule set for saved parents and drafts", () => {
    const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
    const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");

    expect(
      ruleSetHistoryScopeFromReplayTarget({
        kind: "saved-parent",
        parentRuleSetId,
      }),
    ).toBe(parentRuleSetId);
    expect(
      ruleSetHistoryScopeFromReplayTarget({
        draftRevision: 1,
        draftRuleSetId,
        kind: "draft",
        parentRuleSetId,
      }),
    ).toBe(parentRuleSetId);
    expect(ruleSetHistoryScopeFromReplayTarget(null)).toBeNull();
  });
});

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

  it("resets to saved parent props when the preserved draft was discarded", () => {
    const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
    const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");
    const { rerender, result } = renderHook(
      ({
        discardedDraftRuleSetId,
      }: {
        discardedDraftRuleSetId?: typeof draftRuleSetId;
      }) =>
        useRuleSetReplayTargetController({
          ruleSetId: parentRuleSetId,
          ruleSetReplayTarget: {
            ...(discardedDraftRuleSetId ? { discardedDraftRuleSetId } : {}),
            kind: "saved-parent",
            parentRuleSetId,
          },
        }),
      {
        initialProps: {},
      },
    );

    act(() => {
      result.current.handleDraftMutationResult({
        draftRevision: 1,
        ruleSetId: draftRuleSetId,
      });
    });
    rerender({});

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: 1,
      selectedRuleSetId: draftRuleSetId,
    });

    rerender({ discardedDraftRuleSetId: draftRuleSetId });

    expect(result.current.getCowMutationArgs()).toEqual({
      expectedDraftRevision: null,
      selectedRuleSetId: parentRuleSetId,
    });
  });
});
