import type { Doc, Id } from "@/convex/_generated/dataModel";

import { UNSAVED_RULE_SET_DESCRIPTION } from "./-rule-set-diff";

export interface DraftRuleSetSummary extends RuleSetSummary {
  draftRevision: number;
  parentVersion?: Id<"ruleSets">;
}

export interface RuleSetLifecycleSelection {
  activeRuleSet: RuleSetSummary | undefined;
  currentWorkingRuleSet:
    | Doc<"ruleSets">
    | DraftRuleSetSummary
    | RuleSetSummary
    | undefined;
  draftRuleSet: DraftRuleSetSummary | undefined;
  existingDraftRuleSet: RuleSetSummary | undefined;
  isShowingDraftRuleSet: boolean;
  resolvedRuleSetIdFromUrl: Id<"ruleSets"> | undefined;
  selectedRuleSet: Doc<"ruleSets"> | undefined;
  selectedVersionId: Id<"ruleSets"> | undefined;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
  workingRuleSetForQuery:
    | Doc<"ruleSets">
    | DraftRuleSetSummary
    | RuleSetSummary
    | undefined;
}

export interface RuleSetSummary {
  _id: Id<"ruleSets">;
  description: string;
  isActive: boolean;
  version: number;
}

export function selectRuleSetLifecycle(params: {
  rawRuleSetSearch: string | undefined;
  ruleSetIdFromUrl: Id<"ruleSets"> | undefined;
  ruleSets: Doc<"ruleSets">[] | undefined;
  ruleSetSummaries: RuleSetSummary[] | undefined;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
}): RuleSetLifecycleSelection {
  const activeRuleSet = params.ruleSetSummaries?.find(
    (ruleSet) => ruleSet.isActive,
  );
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
  const selectedRuleSet = params.ruleSets?.find(
    (ruleSet) => ruleSet._id === params.ruleSetIdFromUrl,
  );
  const resolvedRuleSetIdFromUrl = params.ruleSets?.some(
    (ruleSet) => ruleSet._id === params.ruleSetIdFromUrl,
  )
    ? params.ruleSetIdFromUrl
    : undefined;
  const currentWorkingRuleSet =
    selectedRuleSet ?? draftRuleSet ?? activeRuleSet;
  const workingRuleSetForQuery =
    currentWorkingRuleSet &&
    params.ruleSets?.some(
      (ruleSet) => ruleSet._id === currentWorkingRuleSet._id,
    )
      ? currentWorkingRuleSet
      : undefined;
  const isShowingDraftRuleSet = Boolean(
    draftRuleSet && currentWorkingRuleSet?._id === draftRuleSet._id,
  );

  return {
    activeRuleSet,
    currentWorkingRuleSet,
    draftRuleSet,
    existingDraftRuleSet,
    isShowingDraftRuleSet,
    resolvedRuleSetIdFromUrl,
    selectedRuleSet,
    selectedVersionId: resolvedRuleSetIdFromUrl ?? draftRuleSet?._id,
    trackedDraftRuleSetId,
    workingRuleSetForQuery,
  };
}

export function summarizeRuleSets(
  ruleSets: Doc<"ruleSets">[] | undefined,
  currentActiveRuleSetId: Id<"ruleSets"> | undefined,
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
