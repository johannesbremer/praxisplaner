import type { Doc, Id } from "@/convex/_generated/dataModel";

import { UNSAVED_RULE_SET_DESCRIPTION } from "./-rule-set-diff";

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

export interface RuleSetLifecycleView {
  active: RuleSetSummary | undefined;
  draft: DraftRuleSetSummary | undefined;
  navigation: RuleSetLifecycleNavigation;
  selected: ResolvedRuleSetSummary | undefined;
  working: ResolvedRuleSetSummary | undefined;
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
}): RuleSetLifecycleView {
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
