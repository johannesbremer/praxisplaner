import type { Id } from "@/convex/_generated/dataModel";

import { UNSAVED_RULE_SET_DESCRIPTION } from "./-rule-set-diff";

interface DraftRuleSetSummary {
  _id: Id<"ruleSets">;
  description: string;
  draftRevision: number;
  isActive: boolean;
  parentVersion?: Id<"ruleSets">;
  version: number;
}

interface RuleSetRecord {
  _id: Id<"ruleSets">;
  description: string;
  draftRevision: number;
  parentVersion?: Id<"ruleSets">;
  saved: boolean;
  version: number;
}

interface RuleSetSummary {
  _id: Id<"ruleSets">;
  description: string;
  isActive: boolean;
  version: number;
}

export function summarizeRuleSetsForLifecycle(args: {
  activeRuleSetId: Id<"ruleSets"> | undefined;
  routeRuleSetToken: string | undefined;
  ruleSets: RuleSetRecord[] | undefined;
  selectedRuleSetId?: Id<"ruleSets"> | undefined;
  trackedDraftRuleSetId: Id<"ruleSets"> | null;
}): {
  activeRuleSet: RuleSetSummary | undefined;
  currentWorkingRuleSet:
    | DraftRuleSetSummary
    | RuleSetRecord
    | RuleSetSummary
    | undefined;
  draftRuleSet: DraftRuleSetSummary | undefined;
  hasBlockingDraftChanges: boolean;
  isShowingDraftRuleSet: boolean;
  resolvedTrackedDraftRuleSetId: Id<"ruleSets"> | null;
  selectedRuleSet: RuleSetRecord | undefined;
  selectedVersionId: Id<"ruleSets"> | undefined;
  summaries: RuleSetSummary[] | undefined;
} {
  if (!args.ruleSets) {
    return {
      activeRuleSet: undefined,
      currentWorkingRuleSet: undefined,
      draftRuleSet: undefined,
      hasBlockingDraftChanges: false,
      isShowingDraftRuleSet: false,
      resolvedTrackedDraftRuleSetId: null,
      selectedRuleSet: undefined,
      selectedVersionId: undefined,
      summaries: undefined,
    };
  }

  const summaries = args.ruleSets.map((ruleSet) => ({
    _id: ruleSet._id,
    description: ruleSet.description,
    isActive: args.activeRuleSetId === ruleSet._id,
    version: ruleSet.version,
  }));
  const activeRuleSet = summaries.find((ruleSet) => ruleSet.isActive);
  const resolvedTrackedDraftRuleSetId =
    args.trackedDraftRuleSetId &&
    args.ruleSets.some(
      (ruleSet) => ruleSet._id === args.trackedDraftRuleSetId && !ruleSet.saved,
    )
      ? args.trackedDraftRuleSetId
      : null;
  const existingDraftRuleSet = summaries.find(
    (ruleSet) =>
      !ruleSet.isActive && ruleSet.description === UNSAVED_RULE_SET_DESCRIPTION,
  );
  const draftRuleSetId =
    resolvedTrackedDraftRuleSetId ??
    (args.routeRuleSetToken && args.routeRuleSetToken !== "ungespeichert"
      ? null
      : (existingDraftRuleSet?._id ?? null));
  const draftRecord = draftRuleSetId
    ? args.ruleSets.find((ruleSet) => ruleSet._id === draftRuleSetId)
    : undefined;
  const draftRuleSet =
    draftRecord && !draftRecord.saved
      ? {
          _id: draftRecord._id,
          description: draftRecord.description,
          draftRevision: draftRecord.draftRevision,
          isActive: args.activeRuleSetId === draftRecord._id,
          ...(draftRecord.parentVersion
            ? { parentVersion: draftRecord.parentVersion }
            : {}),
          version: draftRecord.version,
        }
      : undefined;
  const selectedRuleSet = args.selectedRuleSetId
    ? args.ruleSets.find((ruleSet) => ruleSet._id === args.selectedRuleSetId)
    : undefined;
  const currentWorkingRuleSet =
    selectedRuleSet ?? draftRuleSet ?? activeRuleSet;
  const isShowingDraftRuleSet =
    Boolean(draftRuleSet) && currentWorkingRuleSet?._id === draftRuleSet?._id;

  return {
    activeRuleSet,
    currentWorkingRuleSet,
    draftRuleSet,
    hasBlockingDraftChanges: Boolean(draftRuleSet),
    isShowingDraftRuleSet,
    resolvedTrackedDraftRuleSetId,
    selectedRuleSet,
    selectedVersionId:
      selectedRuleSet?._id ?? draftRuleSet?._id ?? activeRuleSet?._id,
    summaries,
  };
}
