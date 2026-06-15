import type { Id } from "@/convex/_generated/dataModel";

import type { ConditionTreeNode } from "../../lib/condition-tree";
import type { RuleFromDB } from "../components/rule-builder-types";
import type {
  RecordRuleSetCommand,
  RuleSetCommandRuntimeAdapter,
  RuleSetSchedulingRuleCommand,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

interface DraftMutationResult {
  draftRevision: number;
  entityId: Id<"ruleConditions">;
  ruleSetId: Id<"ruleSets">;
}

interface RuleReplayContext {
  deleteRule: (ruleId: Id<"ruleConditions">) => Promise<DraftMutationResult>;
  getCopySource: (rule: Pick<RuleFromDB, "_id" | "copyFromId">) => {
    copyFromId?: Id<"ruleConditions">;
  };
  handleDraftMutationResult: (result: DraftMutationResult) => void;
  isMissingEntityError: (error: unknown) => boolean;
  prepareRule: (conditionTree: ConditionTreeNode) => RuleReplayPreparation;
  rules: () => RuleFromDB[];
  runCreateRule: (params: {
    conditionTree: ConditionTreeNode;
    copyFromId?: Id<"ruleConditions">;
    enabled: boolean;
    name: string;
  }) => Promise<DraftMutationResult>;
  serializeRule: (rule: RuleFromDB) => string;
}

type RuleReplayPreparation =
  | { conditionTree: ConditionTreeNode; status: "ok" }
  | { message: string; status: "conflict" };

export function createSchedulingRuleCreateReplayAdapter(params: {
  context: RuleReplayContext;
  createdRuleLineageTree: ConditionTreeNode;
  initialRuleId: Id<"ruleConditions">;
  ruleName: string;
}): RuleSetCommandRuntimeAdapter {
  let currentRuleId = params.initialRuleId;

  return {
    redo: async () => {
      const preparedRule = params.context.prepareRule(
        params.createdRuleLineageTree,
      );
      if (preparedRule.status === "conflict") {
        return {
          message: preparedRule.message,
          status: "conflict" as const,
        };
      }
      const result = await params.context.runCreateRule({
        conditionTree: preparedRule.conditionTree,
        enabled: true,
        name: params.ruleName,
      });
      params.context.handleDraftMutationResult(result);
      currentRuleId = result.entityId;
      return { status: "applied" as const };
    },
    undo: async () => {
      try {
        const result = await params.context.deleteRule(currentRuleId);
        params.context.handleDraftMutationResult(result);
        return { status: "applied" as const };
      } catch (error: unknown) {
        if (params.context.isMissingEntityError(error)) {
          return { status: "applied" as const };
        }
        return {
          message:
            error instanceof Error
              ? error.message
              : "Die Regel konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
  };
}

export function createSchedulingRuleDeleteReplayAdapter(params: {
  context: RuleReplayContext;
  deletedRule: RuleFromDB;
  deletedRuleLineageTree: ConditionTreeNode;
  deletedRuleName: string;
  deletedRuleState: string;
  initialRuleId: Id<"ruleConditions">;
}): RuleSetCommandRuntimeAdapter {
  let currentRuleId = params.initialRuleId;

  return {
    redo: async () => {
      const existing =
        params.context.rules().find((rule) => rule._id === currentRuleId) ??
        params.context
          .rules()
          .find(
            (rule) =>
              params.context.serializeRule(rule) === params.deletedRuleState,
          );
      if (
        existing &&
        params.context.serializeRule(existing) !== params.deletedRuleState
      ) {
        return {
          message:
            "Die Regel wurde zwischenzeitlich geändert und kann nicht erneut gelöscht werden.",
          status: "conflict" as const,
        };
      }

      if (!existing) {
        return { status: "applied" as const };
      }

      currentRuleId = existing._id;

      try {
        const result = await params.context.deleteRule(currentRuleId);
        params.context.handleDraftMutationResult(result);
        return { status: "applied" as const };
      } catch (error: unknown) {
        if (params.context.isMissingEntityError(error)) {
          return { status: "applied" as const };
        }
        return {
          message:
            error instanceof Error
              ? error.message
              : "Die Regel konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
    undo: async () => {
      const preparedRule = params.context.prepareRule(
        params.deletedRuleLineageTree,
      );
      if (preparedRule.status === "conflict") {
        return {
          message: preparedRule.message,
          status: "conflict" as const,
        };
      }
      const result = await params.context.runCreateRule({
        conditionTree: preparedRule.conditionTree,
        ...params.context.getCopySource(params.deletedRule),
        enabled: params.deletedRule.enabled,
        name: params.deletedRuleName,
      });
      params.context.handleDraftMutationResult(result);
      currentRuleId = result.entityId;
      return { status: "applied" as const };
    },
  };
}

export function createSchedulingRuleUpdateReplayAdapter(params: {
  context: RuleReplayContext;
  currentRuleLineageTree: ConditionTreeNode;
  currentRuleState: string;
  initialRuleId: Id<"ruleConditions">;
  previousRule: RuleFromDB;
  previousRuleLineageTree: ConditionTreeNode;
  previousRuleName: string;
  previousRuleState: string;
  ruleName: string;
}): RuleSetCommandRuntimeAdapter {
  let currentRuleId = params.initialRuleId;

  const findRuleIdsBySerializedState = (
    serializedState: string,
  ): Id<"ruleConditions">[] =>
    params.context
      .rules()
      .filter((rule) => params.context.serializeRule(rule) === serializedState)
      .map((rule) => rule._id);

  const resolveRuleIdForReplay = (input: {
    ambiguousMessage: string;
    missingMessage: string;
    requiredState: string;
    staleMessage: string;
  }):
    | { message: string; status: "conflict" }
    | { ruleId: Id<"ruleConditions">; status: "ok" } => {
    const byId = params.context
      .rules()
      .find((rule) => rule._id === currentRuleId);
    if (byId) {
      const byIdState = params.context.serializeRule(byId);
      if (byIdState === input.requiredState) {
        return { ruleId: byId._id, status: "ok" };
      }
      return {
        message: input.staleMessage,
        status: "conflict",
      };
    }

    const matches = findRuleIdsBySerializedState(input.requiredState);
    const [singleMatch] = matches;
    if (singleMatch) {
      return { ruleId: singleMatch, status: "ok" };
    }
    if (matches.length > 1) {
      return {
        message: input.ambiguousMessage,
        status: "conflict",
      };
    }
    return {
      message: input.missingMessage,
      status: "conflict",
    };
  };

  return {
    redo: async () =>
      replayRuleReplacement({
        copySourceRule: params.previousRule,
        fallbackState: params.currentRuleState,
        missingFallbackState: params.currentRuleState,
        missingMessage:
          "Die Regel kann nicht wiederhergestellt werden, weil der vorherige Regelzustand nicht mehr vorhanden ist.",
        multipleMessage:
          "Die Regel kann nicht wiederhergestellt werden, weil der vorherige Regelzustand mehrfach vorhanden ist.",
        nextEnabled: true,
        nextRuleLineageTree: params.currentRuleLineageTree,
        nextRuleName: params.ruleName,
        requiredState: params.previousRuleState,
        staleMessage:
          "Die vorherige Regel wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
      }),
    undo: async () =>
      replayRuleReplacement({
        copySourceRule: params.previousRule,
        fallbackState: params.previousRuleState,
        missingFallbackState: params.previousRuleState,
        missingMessage:
          "Die aktualisierte Regel wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
        multipleMessage:
          "Die aktualisierte Regel kann nicht zurückgesetzt werden, weil der aktuelle Regelzustand mehrfach vorhanden ist.",
        nextEnabled: params.previousRule.enabled,
        nextRuleLineageTree: params.previousRuleLineageTree,
        nextRuleName: params.previousRuleName,
        requiredState: params.currentRuleState,
        staleMessage:
          "Die aktualisierte Regel wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
      }),
  };

  async function replayRuleReplacement(input: {
    copySourceRule: RuleFromDB;
    fallbackState: string;
    missingFallbackState: string;
    missingMessage: string;
    multipleMessage: string;
    nextEnabled: boolean;
    nextRuleLineageTree: ConditionTreeNode;
    nextRuleName: string;
    requiredState: string;
    staleMessage: string;
  }) {
    const resolvedRule = resolveRuleIdForReplay({
      ambiguousMessage: input.multipleMessage,
      missingMessage: input.missingMessage,
      requiredState: input.requiredState,
      staleMessage: input.staleMessage,
    });
    if (resolvedRule.status === "conflict") {
      if (resolvedRule.message === input.missingMessage) {
        const fallbackMatches = findRuleIdsBySerializedState(
          input.fallbackState,
        );
        if (fallbackMatches.length === 1) {
          const resolvedFallbackRuleId = fallbackMatches.at(0);
          if (!resolvedFallbackRuleId) {
            return {
              message: resolvedRule.message,
              status: "conflict" as const,
            };
          }
          currentRuleId = resolvedFallbackRuleId;
          return { status: "applied" as const };
        }
      }
      return {
        message: resolvedRule.message,
        status: "conflict" as const,
      };
    }
    currentRuleId = resolvedRule.ruleId;
    const preparedRule = params.context.prepareRule(input.nextRuleLineageTree);
    if (preparedRule.status === "conflict") {
      return {
        message: preparedRule.message,
        status: "conflict" as const,
      };
    }

    const deleteResult = await params.context.deleteRule(currentRuleId);
    params.context.handleDraftMutationResult(deleteResult);

    const result = await params.context.runCreateRule({
      conditionTree: preparedRule.conditionTree,
      ...params.context.getCopySource(input.copySourceRule),
      enabled: input.nextEnabled,
      name: input.nextRuleName,
    });
    params.context.handleDraftMutationResult(result);
    currentRuleId = result.entityId;
    return { status: "applied" as const };
  }
}

export function recordSchedulingRuleCreateReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetSchedulingRuleCommand,
  params: Parameters<typeof createSchedulingRuleCreateReplayAdapter>[0],
): void {
  const replay = createSchedulingRuleCreateReplayAdapter(params);
  recordRuleSetCommand(record, command, replay);
}

export function recordSchedulingRuleDeleteReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetSchedulingRuleCommand,
  params: Parameters<typeof createSchedulingRuleDeleteReplayAdapter>[0],
): void {
  const replay = createSchedulingRuleDeleteReplayAdapter(params);
  recordRuleSetCommand(record, command, replay);
}

export function recordSchedulingRuleUpdateReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetSchedulingRuleCommand,
  params: Parameters<typeof createSchedulingRuleUpdateReplayAdapter>[0],
): void {
  const replay = createSchedulingRuleUpdateReplayAdapter(params);
  recordRuleSetCommand(record, command, replay);
}
