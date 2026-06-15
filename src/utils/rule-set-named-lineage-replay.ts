import type { RefObject } from "react";

import type { LedgerResult } from "./command-ledger";
import type { LineageTrackedEntity } from "./cow-history";
import type {
  RecordRuleSetCommand,
  RuleSetNamedLineageCommand,
  RuleSetNamedLineageCreatePayload,
  RuleSetNamedLineageDeletePayload,
  RuleSetNamedLineageUpdatePayload,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { resolveReplayEntity } from "./cow-history";
import { recordRuleSetCommand } from "./rule-set-command-executor";
import { appliedLedgerResult, conflictLedgerResult } from "./rule-set-replay";
import {
  encodeRuleSetSnapshot,
  snapshotValueMatches,
} from "./rule-set-snapshot-codecs";

interface LegacyReplayConflict {
  message: string;
  status: "conflict";
}

interface MutationStepResult<TId extends string> {
  entityId: TId;
}

interface NamedLineageCreateReplayParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> extends NamedLineageReplayBaseParams<TEntityId, TLineageKey, TEntity> {
  isMissingEntityError: (error: unknown) => boolean;
  payload: RuleSetNamedLineageCreatePayload;
  runCreate: () => Promise<ReplayStepResult<TEntityId>>;
  runDelete: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
}

interface NamedLineageDeleteReplayParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey> & {
    name: string;
  },
> extends NamedLineageReplayBaseParams<TEntityId, TLineageKey, TEntity> {
  isMissingEntityError: (error: unknown) => boolean;
  payload: RuleSetNamedLineageDeletePayload;
  runCreate: () => Promise<ReplayStepResult<TEntityId>>;
  runDelete: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
}

interface NamedLineageReplayBaseParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  command: RuleSetNamedLineageCommand;
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  lineageKey: TLineageKey;
}

interface NamedLineageUpdateReplayParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey> & {
    name: string;
  },
> extends NamedLineageReplayBaseParams<TEntityId, TLineageKey, TEntity> {
  payload: RuleSetNamedLineageUpdatePayload;
  redoMissingMessage: string;
  runRedo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  runUndo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  undoMissingMessage: string;
}

type ReplayStepResult<TId extends string> =
  | LedgerResult
  | LegacyReplayConflict
  | MutationStepResult<TId>;

export function createNamedLineageCreateReplayAdapter<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: NamedLineageCreateReplayParams<TEntityId, TLineageKey, TEntity>,
): RuleSetReplayAdapter {
  let currentEntityId = params.initialEntityId;

  return {
    redo: async () => {
      const existingByLineage = params.entitiesRef.current.find(
        (entity) => entity.lineageKey === params.lineageKey,
      );
      if (existingByLineage) {
        currentEntityId = existingByLineage._id;
        return appliedLedgerResult();
      }

      const duplicate = params.entitiesRef.current.some(
        (entry) => "name" in entry && entry.name === params.payload.name,
      );
      if (duplicate) {
        return conflictLedgerResult(
          `${params.command.label}: Ein Eintrag mit diesem Namen existiert bereits.`,
          {
            code: "nameConflict",
            name: params.payload.name,
          },
        );
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
}

export function createNamedLineageDeleteReplayAdapter<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey> & {
    name: string;
  },
>(
  params: NamedLineageDeleteReplayParams<TEntityId, TLineageKey, TEntity>,
): RuleSetReplayAdapter {
  let currentEntityId = params.initialEntityId;

  return {
    redo: async () => {
      const existingByLineage = params.entitiesRef.current.find(
        (entity) => entity.lineageKey === params.lineageKey,
      );
      if (!existingByLineage) {
        return appliedLedgerResult();
      }

      currentEntityId = existingByLineage._id;
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
    undo: async () => {
      const existingByLineage = params.entitiesRef.current.find(
        (entity) => entity.lineageKey === params.lineageKey,
      );
      if (existingByLineage) {
        currentEntityId = existingByLineage._id;
        return appliedLedgerResult();
      }

      const duplicate = params.entitiesRef.current.some(
        (entity) => entity.name === params.payload.name,
      );
      if (duplicate) {
        return conflictLedgerResult(
          `${params.command.label}: Ein Eintrag mit diesem Namen existiert bereits.`,
          {
            code: "nameConflict",
            name: params.payload.name,
          },
        );
      }

      const result = await params.runCreate();
      const next = withMutationResult(currentEntityId, result);
      currentEntityId = next.currentEntityId;
      return next.historyResult;
    },
  };
}

export function createNamedLineageUpdateReplayAdapter<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey> & {
    name: string;
  },
>(
  params: NamedLineageUpdateReplayParams<TEntityId, TLineageKey, TEntity>,
): RuleSetReplayAdapter {
  let currentEntityId = params.initialEntityId;

  return {
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
      if (
        !snapshotValueMatches(encodeRuleSetSnapshot(params.payload.before), {
          name: current.name,
        })
      ) {
        return conflictLedgerResult(
          `${params.command.label}: Der aktuelle Stand weicht vom erwarteten Ausgangszustand ab.`,
        );
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
      if (
        !snapshotValueMatches(encodeRuleSetSnapshot(params.payload.after), {
          name: current.name,
        })
      ) {
        return conflictLedgerResult(
          `${params.command.label}: Der aktuelle Stand weicht vom erwarteten Zielzustand ab.`,
        );
      }

      const result = await params.runUndo(currentEntityId);
      const next = withMutationResult(currentEntityId, result);
      currentEntityId = next.currentEntityId;
      return next.historyResult;
    },
  };
}

export function recordNamedLineageReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetNamedLineageCommand,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, { ...command, replay });
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
