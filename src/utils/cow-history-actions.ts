import type { RefObject } from "react";

import type {
  LocalHistoryAction,
  LocalHistoryResult,
} from "../hooks/use-local-history";
import type { LineageTrackedEntity } from "./cow-history";

import { resolveReplayEntity } from "./cow-history";

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
  label: string;
  lineageKey: TLineageKey;
  onRegisterHistoryAction: ((action: LocalHistoryAction) => void) | undefined;
  runCreate: () => Promise<ReplayStepResult<TEntityId>>;
  runDelete: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  validateBeforeCreate?: () => null | string;
}

interface RegisterLineageUpdateActionParams<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
> {
  entitiesRef: RefObject<TEntity[]>;
  initialEntityId: TEntityId;
  label: string;
  lineageKey: TLineageKey;
  onRegisterHistoryAction: ((action: LocalHistoryAction) => void) | undefined;
  redoMissingMessage: string;
  runRedo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  runUndo: (entityId: TEntityId) => Promise<ReplayStepResult<TEntityId>>;
  undoMissingMessage: string;
  validateRedo: (entity: TEntity) => null | string;
  validateUndo: (entity: TEntity) => null | string;
}

type ReplayStepResult<TId extends string> =
  | LocalHistoryResult
  | MutationStepResult<TId>;

const APPLIED_RESULT: LocalHistoryResult = { status: "applied" };

export function registerLineageCreateHistoryAction<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RegisterLineageCreateActionParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRegisterHistoryAction) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  params.onRegisterHistoryAction({
    label: params.label,
    redo: async () => {
      const existingByLineage = params.entitiesRef.current.find(
        (entity) => entity.lineageKey === params.lineageKey,
      );
      if (existingByLineage) {
        currentEntityId = existingByLineage._id;
        return APPLIED_RESULT;
      }

      const preflightConflict = params.validateBeforeCreate?.();
      if (preflightConflict) {
        return toConflict(preflightConflict);
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
          return APPLIED_RESULT;
        }
        return toConflict(
          error instanceof Error
            ? error.message
            : "Die Aktion konnte nicht ausgeführt werden.",
        );
      }
    },
  });
}

export function registerLineageUpdateHistoryAction<
  TEntityId extends string,
  TLineageKey extends string,
  TEntity extends LineageTrackedEntity<TEntityId, TLineageKey>,
>(
  params: RegisterLineageUpdateActionParams<TEntityId, TLineageKey, TEntity>,
): void {
  if (!params.onRegisterHistoryAction) {
    return;
  }
  let currentEntityId = params.initialEntityId;

  params.onRegisterHistoryAction({
    label: params.label,
    redo: async () => {
      const resolvedCurrent = resolveReplayEntity({
        currentEntityId,
        entities: params.entitiesRef.current,
        lineageKey: params.lineageKey,
        missingMessage: params.redoMissingMessage,
      });
      if (resolvedCurrent.status === "conflict") {
        return toConflict(resolvedCurrent.message);
      }

      const current = resolvedCurrent.entity;
      currentEntityId = resolvedCurrent.currentEntityId;
      const validationMessage = params.validateRedo(current);
      if (validationMessage) {
        return toConflict(validationMessage);
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
        return toConflict(resolvedCurrent.message);
      }

      const current = resolvedCurrent.entity;
      currentEntityId = resolvedCurrent.currentEntityId;
      const validationMessage = params.validateUndo(current);
      if (validationMessage) {
        return toConflict(validationMessage);
      }

      const result = await params.runUndo(currentEntityId);
      const next = withMutationResult(currentEntityId, result);
      currentEntityId = next.currentEntityId;
      return next.historyResult;
    },
  });
}

function isLocalHistoryResult<TId extends string>(
  value: ReplayStepResult<TId>,
): value is LocalHistoryResult {
  return "status" in value;
}

function toConflict(message: string): LocalHistoryResult {
  return {
    message,
    status: "conflict",
  };
}

function withMutationResult<TId extends string>(
  currentEntityId: TId,
  result: ReplayStepResult<TId>,
): {
  currentEntityId: TId;
  historyResult: LocalHistoryResult;
} {
  if (isLocalHistoryResult(result)) {
    return { currentEntityId, historyResult: result };
  }
  return {
    currentEntityId: result.entityId,
    historyResult: APPLIED_RESULT,
  };
}
