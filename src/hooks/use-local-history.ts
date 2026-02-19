import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LocalHistoryAction {
  label: string;
  redo: () => LocalHistoryResult | Promise<LocalHistoryResult>;
  undo: () => LocalHistoryResult | Promise<LocalHistoryResult>;
}

export interface LocalHistoryResult {
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

export function useLocalHistory(options?: UseLocalHistoryOptions) {
  const resolvedOptions = options ?? EMPTY_OPTIONS;
  const optionsRef = useRef(resolvedOptions);
  const historyRef = useRef<LocalHistoryAction[]>([]);
  const redoRef = useRef<LocalHistoryAction[]>([]);
  const isRunningRef = useRef(false);
  const [state, setState] = useState<LocalHistoryState>(DEFAULT_STATE);

  useEffect(() => {
    optionsRef.current = resolvedOptions;
  }, [resolvedOptions]);

  const syncState = useCallback(() => {
    setState({
      canRedo: redoRef.current.length > 0,
      canUndo: historyRef.current.length > 0,
      isRunning: isRunningRef.current,
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
    async (
      operation: "redo" | "undo",
      from: RefObject<LocalHistoryAction[]>,
      to: RefObject<LocalHistoryAction[]>,
    ): Promise<LocalHistoryResult> => {
      if (isRunningRef.current) {
        return { status: "noop" };
      }

      const action = from.current.at(-1);
      if (!action) {
        return { status: "noop" };
      }

      isRunningRef.current = true;
      syncState();

      try {
        const rawResult = await action[operation]();
        const result = toResult(rawResult);

        if (result.status === "applied" || result.status === "noop") {
          from.current = from.current.slice(0, -1);
          to.current = [...to.current, action];
          optionsRef.current.onSuccess?.(action, operation, result);
        } else {
          optionsRef.current.onConflict?.(action, result);
        }

        return result;
      } catch (error) {
        optionsRef.current.onError?.(action, operation, error);
        return {
          message:
            error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE,
          status: "conflict",
        };
      } finally {
        isRunningRef.current = false;
        syncState();
      }
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
