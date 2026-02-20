import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LocalHistoryAction {
  label: string;
  redo: () => LocalHistoryResult | Promise<LocalHistoryResult>;
  undo: () => LocalHistoryResult | Promise<LocalHistoryResult>;
}

export interface LocalHistoryResult {
  canRedoAfter?: boolean;
  canUndoAfter?: boolean;
  message?: string;
  status: LocalHistoryStatus;
}

export type LocalHistoryStatus = "applied" | "conflict" | "noop";

interface LocalHistoryState {
  canRedo: boolean;
  canUndo: boolean;
  isRunning: boolean;
}

interface UseLocalHistoryOptions {
  maxDepth?: number;
  onConflict?: (action: LocalHistoryAction, result: LocalHistoryResult) => void;
  onError?: (
    action: LocalHistoryAction,
    operation: "redo" | "undo",
    error: unknown,
  ) => void;
  onSuccess?: (
    action: LocalHistoryAction,
    operation: "redo" | "undo",
    result: LocalHistoryResult,
  ) => void;
}

const DEFAULT_STATE: LocalHistoryState = {
  canRedo: false,
  canUndo: false,
  isRunning: false,
};

const EMPTY_OPTIONS: UseLocalHistoryOptions = {};
const DEFAULT_ERROR_MESSAGE = "Aktion konnte nicht ausgeführt werden.";
const DEFAULT_MAX_DEPTH = 100;
const clearQueueResult = () => null;

export function useLocalHistory(options?: UseLocalHistoryOptions) {
  const resolvedOptions = options ?? EMPTY_OPTIONS;
  const optionsRef = useRef(resolvedOptions);
  const historyRef = useRef<LocalHistoryAction[]>([]);
  const redoRef = useRef<LocalHistoryAction[]>([]);
  const queuedOperationCountRef = useRef(0);
  const operationQueueRef = useRef(Promise.resolve<null>(null));
  const [state, setState] = useState<LocalHistoryState>(DEFAULT_STATE);

  useEffect(() => {
    optionsRef.current = resolvedOptions;
  }, [resolvedOptions]);

  const syncState = useCallback(() => {
    setState({
      canRedo: redoRef.current.length > 0,
      canUndo: historyRef.current.length > 0,
      isRunning: queuedOperationCountRef.current > 0,
    });
  }, []);

  const pushAction = useCallback(
    (action: LocalHistoryAction) => {
      const maxDepthRaw = optionsRef.current.maxDepth ?? DEFAULT_MAX_DEPTH;
      const maxDepth =
        Number.isFinite(maxDepthRaw) && maxDepthRaw > 0
          ? Math.floor(maxDepthRaw)
          : DEFAULT_MAX_DEPTH;
      const nextHistory = [...historyRef.current, action];
      historyRef.current = nextHistory.slice(-maxDepth);
      redoRef.current = [];
      syncState();
    },
    [syncState],
  );

  const clear = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    syncState();
  }, [syncState]);

  const execute = useCallback(
    (
      operation: "redo" | "undo",
      from: RefObject<LocalHistoryAction[]>,
      to: RefObject<LocalHistoryAction[]>,
    ): Promise<LocalHistoryResult> => {
      queuedOperationCountRef.current += 1;
      syncState();

      const executeOperation = async (): Promise<LocalHistoryResult> => {
        const action = from.current.at(-1);
        if (!action) {
          return withHistoryState({ status: "noop" }, historyRef, redoRef);
        }

        try {
          const rawResult = await action[operation]();
          const result = toResult(rawResult);

          if (result.status === "applied") {
            from.current = from.current.slice(0, -1);
            to.current = [...to.current, action];
            optionsRef.current.onSuccess?.(action, operation, result);
          } else if (result.status === "conflict") {
            optionsRef.current.onConflict?.(action, result);
          } else {
            optionsRef.current.onSuccess?.(action, operation, result);
          }

          return withHistoryState(result, historyRef, redoRef);
        } catch (error) {
          optionsRef.current.onError?.(action, operation, error);
          return withHistoryState(
            {
              message:
                error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE,
              status: "conflict",
            },
            historyRef,
            redoRef,
          );
        }
      };

      const queued = operationQueueRef.current.then(executeOperation);
      operationQueueRef.current = queued.then(
        clearQueueResult,
        clearQueueResult,
      );

      return queued.finally(() => {
        queuedOperationCountRef.current = Math.max(
          0,
          queuedOperationCountRef.current - 1,
        );
        syncState();
      });
    },
    [syncState],
  );

  const undo = useCallback(
    async () => execute("undo", historyRef, redoRef),
    [execute],
  );

  const redo = useCallback(
    async () => execute("redo", redoRef, historyRef),
    [execute],
  );

  return {
    canRedo: state.canRedo,
    canUndo: state.canUndo,
    clear,
    isRunning: state.isRunning,
    pushAction,
    redo,
    undo,
  };
}

function toResult(result: LocalHistoryResult): LocalHistoryResult {
  if (result.status === "applied" || result.status === "noop") {
    return result;
  }

  return {
    message: result.message ?? DEFAULT_ERROR_MESSAGE,
    status: "conflict",
  };
}

function withHistoryState(
  result: LocalHistoryResult,
  historyRef: RefObject<LocalHistoryAction[]>,
  redoRef: RefObject<LocalHistoryAction[]>,
): LocalHistoryResult {
  return {
    ...result,
    canRedoAfter: redoRef.current.length > 0,
    canUndoAfter: historyRef.current.length > 0,
  };
}
