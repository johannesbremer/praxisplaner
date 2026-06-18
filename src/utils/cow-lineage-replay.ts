import type { RefObject } from "react";

import type { LedgerResult } from "./command-ledger";
import type { LineageTrackedEntity } from "./cow-history";
import type {
  RecordRuleSetCommand,
  RuleSetCommandKind,
  RuleSetCommandPayload,
  RuleSetCommandSnapshot,
} from "./rule-set-replay";

import { resolveReplayEntity } from "./cow-history";
import { recordRuleSetCommand } from "./rule-set-command-executor";
import {
  appliedLedgerResult,
  conflictLedgerResult,
  createRuleSetSnapshotCommand,
} from "./rule-set-replay";

type CowLineageRuleSetCommandKind = Exclude<
  RuleSetCommandKind,
  | "absence.create"
  | "absence.delete"
  | "absence.update"
  | "location.create"
  | "location.update"
  | "mfa.create"
  | "mfa.delete"
  | "practice.appointmentSmileyOptions.update"
  | "practitioner.create"
  | "practitioner.update"
  | "schedulingRule.create"
  | "schedulingRule.delete"
  | "schedulingRule.update"
>;

interface LegacyReplayConflict {
  message: string;
  status: "conflict";
}

interface MutationStepResult<TId extends string> {
  entityId: TId;
}

interface RecordLineageCreateCommandParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  isMissingEntityError: (error: unknown) => boolean;
  kind: CowLineageRuleSetCommandKind;
  label: string;
  lineageKey: TLineageKey;
  onRecordCommand: RecordRuleSetCommand | undefined;
  payload?: RuleSetCommandPayload;
  runCreate: () => Promise<ReplayStepResult<TEntityId>>;
  runDelete: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  validateBeforeCreate?: () => null | string;
  validateExistingForCreate?: (entity: TEntity) => null | string;
}

interface RecordLineageUpdateCommandParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  kind: CowLineageRuleSetCommandKind;
  label: string;
  lineageKey: TLineageKey;
  onRecordCommand: RecordRuleSetCommand | undefined;
  payload?: RuleSetCommandPayload;
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

export function recordLineageCreateRuleSetCommand<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RecordLineageCreateCommandParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRecordCommand) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  const command = createRuleSetSnapshotCommand({
    kind: params.kind,
    label: params.label,
    ...(params.payload && { payload: params.payload }),
    ...(params.scope && { scope: params.scope }),
    ...(params.snapshots && { snapshots: params.snapshots }),
    target: {
      entityId: params.initialEntityId,
      lineageKey: params.lineageKey,
    },
  });

  const replay = {
    redo: async () => {
      const existingByLineage = params.entitiesRef.current.find(
        (entity) => entity.lineageKey === params.lineageKey,
      );
      if (existingByLineage) {
        const validationMessage =
          params.validateExistingForCreate?.(existingByLineage);
        if (validationMessage) {
          return conflictLedgerResult(validationMessage);
        }
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
  };
  recordRuleSetCommand(params.onRecordCommand, command, replay);
}

export function recordLineageUpdateRuleSetCommand<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RecordLineageUpdateCommandParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRecordCommand) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  const command = createRuleSetSnapshotCommand({
    kind: params.kind,
    label: params.label,
    ...(params.payload && { payload: params.payload }),
    ...(params.scope && { scope: params.scope }),
    ...(params.snapshots && { snapshots: params.snapshots }),
    target: {
      entityId: params.initialEntityId,
      lineageKey: params.lineageKey,
    },
  });

  const replay = {
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
  };
  recordRuleSetCommand(params.onRecordCommand, command, replay);
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
