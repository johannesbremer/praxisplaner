import type { RefObject } from "react";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { RESERVED_UNSAVED_DESCRIPTION } from "@/convex/ruleSetValidation";

import { UNSAVED_RULE_SET_DESCRIPTION } from "./-rule-set-diff";

export interface DraftRuleSetLifecycleController {
  clearDraftSelection: () => void;
  draftRevisionOverride: null | number;
  isDraftEquivalentToParent: boolean;
  markDraftMutation: (result: DraftRuleSetMutationResult) => void;
  pendingDraftRuleSetNavigationIdRef: RefObject<Id<"ruleSets"> | null>;
  restoreDraftSelection: (draft: DraftRuleSetSummary) => void;
  setDraftEquivalentToParent: (isEquivalent: boolean) => void;
  setDraftRevisionOverride: (draftRevision: null | number) => void;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
}

export interface DraftRuleSetMutationResult {
  draftRevision: number;
  ruleSetId: Id<"ruleSets">;
}

export interface DraftRuleSetSummary extends RuleSetSummary {
  draftRevision: number;
  parentVersion?: Id<"ruleSets">;
}

export type ResolvedRuleSetSummary = DraftRuleSetSummary | RuleSetSummary;

export interface RuleSetLifecycleNavigation {
  resolvedUrlRuleSetId: Id<"ruleSets"> | undefined;
  selectedVersionId: Id<"ruleSets"> | undefined;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
}

export interface RuleSetLifecycleSelection {
  active: RuleSetSummary | undefined;
  draft: DraftRuleSetSummary | undefined;
  navigation: RuleSetLifecycleNavigation;
  selected: ResolvedRuleSetSummary | undefined;
  working: ResolvedRuleSetSummary | undefined;
}

export interface RuleSetLifecycleView extends RuleSetLifecycleSelection {
  draftRevisionOverride: null | number;
  hasBlockingUnsavedChanges: boolean;
  isDraftEquivalentToParent: boolean;
  setDraftEquivalentToParent: (isEquivalent: boolean) => void;
  setDraftRevisionOverride: (draftRevision: null | number) => void;
}

export interface RuleSetSummary {
  _id: Id<"ruleSets">;
  description: string;
  isActive: boolean;
  version: number;
}

export function resolveRuleSetIdFromRawSearch(params: {
  rawRuleSetSearch: string | undefined;
  ruleSets: Doc<"ruleSets">[] | undefined;
}): Id<"ruleSets"> | undefined {
  if (!params.rawRuleSetSearch) {
    return;
  }
  if (params.rawRuleSetSearch === RESERVED_UNSAVED_DESCRIPTION) {
    return params.ruleSets?.find((ruleSet) => !ruleSet.saved)?._id;
  }
  return params.ruleSets?.find(
    (ruleSet) => ruleSet.description === params.rawRuleSetSearch,
  )?._id;
}

export function selectRuleSetLifecycle(params: {
  rawRuleSetSearch: string | undefined;
  ruleSetIdFromUrl: Id<"ruleSets"> | undefined;
  ruleSets: Doc<"ruleSets">[] | undefined;
  ruleSetSummaries: RuleSetSummary[] | undefined;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
}): RuleSetLifecycleSelection {
  const active = params.ruleSetSummaries?.find((ruleSet) => ruleSet.isActive);
  const existingDraftRuleSet = params.ruleSetSummaries?.find(
    (ruleSet) =>
      !ruleSet.isActive && ruleSet.description === UNSAVED_RULE_SET_DESCRIPTION,
  );
  const resolvedTrackedDraftRuleSetId =
    params.trackedDraftRuleSetId &&
    params.ruleSets?.some(
      (ruleSet) =>
        ruleSet._id === params.trackedDraftRuleSetId && !ruleSet.saved,
    )
      ? params.trackedDraftRuleSetId
      : null;
  const trackedDraftRuleSetId =
    resolvedTrackedDraftRuleSetId ??
    (params.rawRuleSetSearch && params.rawRuleSetSearch !== "ungespeichert"
      ? null
      : (existingDraftRuleSet?._id ?? null));
  const draftRuleSet = toDraftRuleSetSummary({
    rawDraftRuleSet: trackedDraftRuleSetId
      ? params.ruleSets?.find(
          (ruleSet) => ruleSet._id === trackedDraftRuleSetId,
        )
      : undefined,
    ruleSetSummaries: params.ruleSetSummaries,
  });
  const resolvedUrlRuleSetId = params.ruleSets?.some(
    (ruleSet) => ruleSet._id === params.ruleSetIdFromUrl,
  )
    ? params.ruleSetIdFromUrl
    : undefined;
  const selected = resolvedUrlRuleSetId
    ? resolveRuleSetSummary(params.ruleSetSummaries, resolvedUrlRuleSetId)
    : undefined;
  const working = selected ?? draftRuleSet ?? active;

  return {
    active,
    draft: draftRuleSet,
    navigation: {
      resolvedUrlRuleSetId,
      selectedVersionId: resolvedUrlRuleSetId ?? draftRuleSet?._id,
      trackedDraftRuleSetId,
    },
    selected,
    working,
  };
}

export function summarizeRuleSets(
  ruleSets: Doc<"ruleSets">[] | undefined,
  currentActiveRuleSetId?: Id<"ruleSets">,
): RuleSetSummary[] | undefined {
  if (!ruleSets) {
    return;
  }

  return ruleSets.map((ruleSet) => ({
    _id: ruleSet._id,
    description: ruleSet.description,
    isActive: currentActiveRuleSetId === ruleSet._id,
    version: ruleSet.version,
  }));
}

export function useDraftRuleSetLifecycleController(): DraftRuleSetLifecycleController {
  const [trackedDraftRuleSetId, setTrackedDraftRuleSetId] =
    useState<Id<"ruleSets"> | null>(null);
  const [draftRevisionOverride, setDraftRevisionOverride] = useState<
    null | number
  >(null);
  const [isDraftEquivalentToParent, setDraftEquivalentToParent] =
    useState(false);
  const pendingDraftRuleSetNavigationIdRef = useRef<Id<"ruleSets"> | null>(
    null,
  );

  const clearDraftSelection = useMemo(
    () => () => {
      setTrackedDraftRuleSetId(null);
      setDraftEquivalentToParent(false);
      setDraftRevisionOverride(null);
    },
    [],
  );

  const markDraftMutation = useMemo(
    () => (result: DraftRuleSetMutationResult) => {
      setTrackedDraftRuleSetId(result.ruleSetId);
      setDraftEquivalentToParent(false);
      setDraftRevisionOverride(result.draftRevision);
      pendingDraftRuleSetNavigationIdRef.current = result.ruleSetId;
    },
    [],
  );

  const restoreDraftSelection = useMemo(
    () => (draftToRestore: DraftRuleSetSummary) => {
      setTrackedDraftRuleSetId(draftToRestore._id);
      setDraftEquivalentToParent(false);
      setDraftRevisionOverride(draftToRestore.draftRevision);
    },
    [],
  );

  return {
    clearDraftSelection,
    draftRevisionOverride,
    isDraftEquivalentToParent,
    markDraftMutation,
    pendingDraftRuleSetNavigationIdRef,
    restoreDraftSelection,
    setDraftEquivalentToParent,
    setDraftRevisionOverride,
    trackedDraftRuleSetId,
  };
}

export function useDraftRuleSetLifecycleView(params: {
  controller: DraftRuleSetLifecycleController;
  pushRuleSetUrl: (ruleSetId: Id<"ruleSets"> | undefined) => void;
  rawRuleSetSearch: string | undefined;
  ruleSetIdFromUrl: Id<"ruleSets"> | undefined;
  ruleSets: Doc<"ruleSets">[] | undefined;
  ruleSetSummaries: RuleSetSummary[] | undefined;
  selectedDate: Date;
}): RuleSetLifecycleView & {
  clearDraftSelection: () => void;
  markDraftMutation: (result: DraftRuleSetMutationResult) => void;
  restoreDraftSelection: (draft: DraftRuleSetSummary) => void;
} {
  const {
    clearDraftSelection,
    draftRevisionOverride,
    isDraftEquivalentToParent,
    markDraftMutation,
    pendingDraftRuleSetNavigationIdRef,
    restoreDraftSelection,
    setDraftEquivalentToParent,
    setDraftRevisionOverride,
    trackedDraftRuleSetId,
  } = params.controller;
  const {
    pushRuleSetUrl,
    rawRuleSetSearch,
    ruleSetIdFromUrl,
    ruleSets,
    ruleSetSummaries,
    selectedDate,
  } = params;
  const lifecycle = useMemo(
    () =>
      selectRuleSetLifecycle({
        rawRuleSetSearch,
        ruleSetIdFromUrl,
        ruleSets,
        ruleSetSummaries,
        trackedDraftRuleSetId,
      }),
    [
      rawRuleSetSearch,
      ruleSetIdFromUrl,
      ruleSets,
      ruleSetSummaries,
      trackedDraftRuleSetId,
    ],
  );

  const draft = lifecycle.draft;

  useEffect(() => {
    if (!draft) {
      return;
    }
    if (rawRuleSetSearch) {
      return;
    }
    if (ruleSetIdFromUrl === draft._id) {
      return;
    }
    if (!(selectedDate instanceof Date)) {
      return;
    }

    pushRuleSetUrl(draft._id);
  }, [draft, pushRuleSetUrl, rawRuleSetSearch, ruleSetIdFromUrl, selectedDate]);

  useEffect(() => {
    const pendingDraftRuleSetId = pendingDraftRuleSetNavigationIdRef.current;
    if (!pendingDraftRuleSetId || draft?._id !== pendingDraftRuleSetId) {
      return;
    }

    pendingDraftRuleSetNavigationIdRef.current = null;
    if (ruleSetIdFromUrl !== pendingDraftRuleSetId) {
      pushRuleSetUrl(pendingDraftRuleSetId);
    }
  }, [
    draft?._id,
    pendingDraftRuleSetNavigationIdRef,
    pushRuleSetUrl,
    ruleSetIdFromUrl,
  ]);

  return {
    ...lifecycle,
    clearDraftSelection,
    draftRevisionOverride,
    hasBlockingUnsavedChanges: Boolean(draft && !isDraftEquivalentToParent),
    isDraftEquivalentToParent,
    markDraftMutation,
    restoreDraftSelection,
    setDraftEquivalentToParent,
    setDraftRevisionOverride,
  };
}

function resolveRuleSetSummary(
  ruleSetSummaries: RuleSetSummary[] | undefined,
  ruleSetId: Id<"ruleSets">,
): RuleSetSummary | undefined {
  return ruleSetSummaries?.find((ruleSet) => ruleSet._id === ruleSetId);
}

function toDraftRuleSetSummary(params: {
  rawDraftRuleSet: Doc<"ruleSets"> | undefined;
  ruleSetSummaries: RuleSetSummary[] | undefined;
}): DraftRuleSetSummary | undefined {
  if (!params.rawDraftRuleSet || params.rawDraftRuleSet.saved) {
    return;
  }

  const summary = params.ruleSetSummaries?.find(
    (ruleSet) => ruleSet._id === params.rawDraftRuleSet?._id,
  );
  if (!summary) {
    return;
  }

  return {
    _id: summary._id,
    description: summary.description,
    draftRevision: params.rawDraftRuleSet.draftRevision,
    isActive: summary.isActive,
    ...(params.rawDraftRuleSet.parentVersion
      ? { parentVersion: params.rawDraftRuleSet.parentVersion }
      : {}),
    version: summary.version,
  };
}
