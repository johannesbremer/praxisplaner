import type { RefObject } from "react";

import type { LedgerResult } from "./command-ledger";
import type { LineageTrackedEntity } from "./cow-history";
import type {
  RecordRuleSetCommand,
  RuleSetCommandKind,
  RuleSetCommandSnapshot,
} from "./rule-set-replay";

import { resolveReplayEntity } from "./cow-history";
import {
  appliedLedgerResult,
  conflictLedgerResult,
  createRuleSetCommand,
} from "./rule-set-replay";

interface LegacyReplayConflict {
  message: string;
  status: "conflict";
}

interface MutationStepResult<TId extends string> {
  entityId: TId;
}

interface RegisterLineageCreateActionParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  isMissingEntityError: (error: unknown) => boolean;
  kind?: RuleSetCommandKind;
  label: string;
  lineageKey: TLineageKey;
  onRecordCommand: RecordRuleSetCommand | undefined;
  runCreate: () => Promise<ReplayStepResult<TEntityId>>;
  runDelete: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  validateBeforeCreate?: () => null | string;
}

interface RegisterLineageUpdateActionParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  kind?: RuleSetCommandKind;
  label: string;
  lineageKey: TLineageKey;
  onRecordCommand: RecordRuleSetCommand | undefined;
  redoMissingMessage: string;
  runRedo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  runUndo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  undoMissingMessage: string;
  validateRedo: (entity: TEntity) => null | string;
  validateUndo: (entity: TEntity) => null | string;
}

type ReplayStepResult<TId extends string> =
  | LedgerResult
  | LegacyReplayConflict
  | MutationStepResult<TId>;

export function registerLineageCreateHistoryAction<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RegisterLineageCreateActionParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRecordCommand) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  params.onRecordCommand(
    createRuleSetCommand({
      kind: params.kind ?? "appointmentType.update",
      label: params.label,
      replay: {
        redo: async () => {
          const existingByLineage = params.entitiesRef.current.find(
            (entity) => entity.lineageKey === params.lineageKey,
          );
          if (existingByLineage) {
            currentEntityId = existingByLineage._id;
            return appliedLedgerResult();
          }

          const preflightConflict = params.validateBeforeCreate?.();
          if (preflightConflict) {
            return conflictLedgerResult(preflightConflict);
          }

          const result = await params.runCreate();
          const next = withMutationResult(currentEntityId, result);
          currentEntityId = next.currentEntityId;
          return next.historyResult;
        },
        undo: async () => {
          try {
            const result = await params.runDelete(currentEntityId);
            const next = withMutationResult(currentEntityId, result);
            currentEntityId = next.currentEntityId;
            return next.historyResult;
          } catch (error: unknown) {
            if (params.isMissingEntityError(error)) {
              return appliedLedgerResult();
            }
            return conflictLedgerResult(
              error instanceof Error
                ? error.message
                : "Die Aktion konnte nicht ausgeführt werden.",
            );
          }
        },
      },
      ...(params.scope && { scope: params.scope }),
      ...(params.snapshots && { snapshots: params.snapshots }),
      target: {
        entityId: params.initialEntityId,
        lineageKey: params.lineageKey,
      },
    }),
  );
}

export function registerLineageUpdateHistoryAction<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RegisterLineageUpdateActionParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRecordCommand) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  params.onRecordCommand(
    createRuleSetCommand({
      kind: params.kind ?? "appointmentType.update",
      label: params.label,
      replay: {
        redo: async () => {
          const resolvedCurrent = resolveReplayEntity({
            currentEntityId,
            entities: params.entitiesRef.current,
            lineageKey: params.lineageKey,
            missingMessage: params.redoMissingMessage,
          });
          if (resolvedCurrent.status === "conflict") {
            return conflictLedgerResult(resolvedCurrent.message);
          }

          const current = resolvedCurrent.entity;
          currentEntityId = resolvedCurrent.currentEntityId;
          const validationMessage = params.validateRedo(current);
          if (validationMessage) {
            return conflictLedgerResult(validationMessage);
          }

          const result = await params.runRedo(currentEntityId);
          const next = withMutationResult(currentEntityId, result);
          currentEntityId = next.currentEntityId;
          return next.historyResult;
        },
        undo: async () => {
          const resolvedCurrent = resolveReplayEntity({
            currentEntityId,
            entities: params.entitiesRef.current,
            lineageKey: params.lineageKey,
            missingMessage: params.undoMissingMessage,
          });
          if (resolvedCurrent.status === "conflict") {
            return conflictLedgerResult(resolvedCurrent.message);
          }

          const current = resolvedCurrent.entity;
          currentEntityId = resolvedCurrent.currentEntityId;
          const validationMessage = params.validateUndo(current);
          if (validationMessage) {
            return conflictLedgerResult(validationMessage);
          }

          const result = await params.runUndo(currentEntityId);
          const next = withMutationResult(currentEntityId, result);
          currentEntityId = next.currentEntityId;
          return next.historyResult;
        },
      },
      ...(params.scope && { scope: params.scope }),
      ...(params.snapshots && { snapshots: params.snapshots }),
      target: {
        entityId: params.initialEntityId,
        lineageKey: params.lineageKey,
      },
    }),
  );
}

function isLedgerResult<TId extends string>(
  value: ReplayStepResult<TId>,
): value is LedgerResult {
  return "status" in value && value.status !== "conflict"
    ? true
    : "status" in value && "conflict" in value;
}

function isLegacyReplayConflict<TId extends string>(
  value: ReplayStepResult<TId>,
): value is LegacyReplayConflict {
  return (
    "status" in value && value.status === "conflict" && !("conflict" in value)
  );
}

function withMutationResult<TId extends string>(
  currentEntityId: TId,
  result: ReplayStepResult<TId>,
): {
  currentEntityId: TId;
  historyResult: LedgerResult;
} {
  if (isLegacyReplayConflict(result)) {
    return {
      currentEntityId,
      historyResult: conflictLedgerResult(result.message),
    };
  }
  if (isLedgerResult(result)) {
    return { currentEntityId, historyResult: result };
  }
  return {
    currentEntityId: result.entityId,
    historyResult: appliedLedgerResult(),
  };
}
