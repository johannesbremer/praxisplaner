import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import { regex } from "@/lib/arkregex";

export interface LedgerCommand {
  clearHistoryBefore?: boolean;
  label: string;
  scope?: string;
}

export type LedgerConflict =
  | {
      code: "nameConflict";
      message: string;
      name: string;
    }
  | {
      code: "occupancyConflict";
      message: string;
    }
  | {
      code: "referenceMissing";
      message: string;
      reference: string;
    }
  | {
      code: "staleState";
      message: string;
    }
  | {
      code: "targetMissing";
      message: string;
      target: string;
    };

export type LedgerConflictCode =
  | "nameConflict"
  | "occupancyConflict"
  | "referenceMissing"
  | "staleState"
  | "targetMissing";

export type LedgerExecutionResult =
  | LedgerResult
  | {
      message: string;
      status: "conflict";
    };

export type LedgerOperation = "redo" | "undo";

export type LedgerResult =
  | {
      canRedoAfter?: boolean;
      canUndoAfter?: boolean;
      conflict: LedgerConflict;
      conflictCode?: LedgerConflictCode;
      message: string;
      status: "conflict";
    }
  | {
      canRedoAfter?: boolean;
      canUndoAfter?: boolean;
      status: "applied";
    }
  | {
      canRedoAfter?: boolean;
      canUndoAfter?: boolean;
      status: "noop";
    };

export type LedgerStatus = "applied" | "conflict" | "noop";

export interface ReplayableLedgerCommand extends LedgerCommand {
  redo: () => LedgerExecutionResult | Promise<LedgerExecutionResult>;
  undo: () => LedgerExecutionResult | Promise<LedgerExecutionResult>;
}

interface CommandLedgerState {
  canRedo: boolean;
  canUndo: boolean;
  isRunning: boolean;
  redoDepth: number;
  undoDepth: number;
}

interface UseCommandLedgerOptions<TCommand extends ReplayableLedgerCommand> {
  maxDepth?: number;
  onConflict?: (command: TCommand, result: LedgerResult) => void;
  onError?: (
    command: TCommand,
    operation: LedgerOperation,
    error: unknown,
  ) => void;
  onSuccess?: (
    command: TCommand,
    operation: LedgerOperation,
    result: LedgerResult,
  ) => void;
}

const DEFAULT_STATE: CommandLedgerState = {
  canRedo: false,
  canUndo: false,
  isRunning: false,
  redoDepth: 0,
  undoDepth: 0,
};

const EMPTY_OPTIONS: UseCommandLedgerOptions<ReplayableLedgerCommand> = {};
const DEFAULT_ERROR_MESSAGE = "Aktion konnte nicht ausgeführt werden.";
const DEFAULT_MAX_DEPTH = 100;
const clearQueueResult = () => null;
const HISTORY_CONFLICT_CODE_REGEX = regex.as<string, { captures: [string] }>(
  String.raw`\[([A-Z0-9:_-]+)\]`,
);
const LEDGER_CONFLICT_CODES: readonly LedgerConflictCode[] = [
  "nameConflict",
  "occupancyConflict",
  "referenceMissing",
  "staleState",
  "targetMissing",
];

export function toLedgerConflict(params: {
  code?: LedgerConflictCode;
  message: string;
  name?: string;
  reference?: string;
  target?: string;
}): LedgerConflict {
  const code = params.code ?? extractConflictCode(params.message);
  if (code === "nameConflict") {
    return {
      code: "nameConflict",
      message: params.message,
      name: params.name ?? "unknown",
    };
  }
  if (code === "occupancyConflict") {
    return {
      code: "occupancyConflict",
      message: params.message,
    };
  }
  if (code === "referenceMissing") {
    return {
      code: "referenceMissing",
      message: params.message,
      reference: params.reference ?? "unknown",
    };
  }
  if (code === "targetMissing") {
    return {
      code: "targetMissing",
      message: params.message,
      target: params.target ?? "unknown",
    };
  }
  return {
    code: "staleState",
    message: params.message,
  };
}

export function useCommandLedger<TCommand extends ReplayableLedgerCommand>(
  options?: UseCommandLedgerOptions<TCommand>,
) {
  const resolvedOptions = options ?? EMPTY_OPTIONS;
  const optionsRef = useRef(resolvedOptions);
  const undoRef = useRef<TCommand[]>([]);
  const redoRef = useRef<TCommand[]>([]);
  const queuedOperationCountRef = useRef(0);
  const operationQueueRef = useRef(Promise.resolve(null));
  const [state, setState] = useState(DEFAULT_STATE);

  useEffect(() => {
    optionsRef.current = resolvedOptions;
  }, [resolvedOptions]);

  const syncState = useCallback(() => {
    setState({
      canRedo: redoRef.current.length > 0,
      canUndo: undoRef.current.length > 0,
      isRunning: queuedOperationCountRef.current > 0,
      redoDepth: redoRef.current.length,
      undoDepth: undoRef.current.length,
    });
  }, []);

  const record = useCallback(
    (command: TCommand) => {
      const maxDepthRaw = optionsRef.current.maxDepth ?? DEFAULT_MAX_DEPTH;
      const maxDepth =
        Number.isFinite(maxDepthRaw) && maxDepthRaw > 0
          ? Math.floor(maxDepthRaw)
          : DEFAULT_MAX_DEPTH;
      const baseUndo = command.clearHistoryBefore ? [] : undoRef.current;
      const nextUndo = [...baseUndo, command];
      undoRef.current = nextUndo.slice(-maxDepth);
      redoRef.current = [];
      syncState();
    },
    [syncState],
  );

  const clear = useCallback(
    (scope?: string) => {
      if (!scope) {
        undoRef.current = [];
        redoRef.current = [];
        syncState();
        return;
      }

      undoRef.current = undoRef.current.filter(
        (command) => command.scope !== scope,
      );
      redoRef.current = redoRef.current.filter(
        (command) => command.scope !== scope,
      );
      syncState();
    },
    [syncState],
  );

  const execute = useCallback(
    (
      operation: LedgerOperation,
      from: RefObject<TCommand[]>,
      to: RefObject<TCommand[]>,
    ): Promise<LedgerResult> => {
      queuedOperationCountRef.current += 1;
      syncState();

      const executeOperation = async (): Promise<LedgerResult> => {
        const command = from.current.at(-1);
        if (!command) {
          return withLedgerState({ status: "noop" }, undoRef, redoRef);
        }

        try {
          const rawResult = await command[operation]();
          const result = withCommandContext(
            command,
            operation,
            toLedgerResult(rawResult),
          );

          if (result.status === "applied") {
            from.current = from.current.slice(0, -1);
            to.current = [...to.current, command];
            optionsRef.current.onSuccess?.(command, operation, result);
          } else if (result.status === "conflict") {
            optionsRef.current.onConflict?.(command, result);
          } else {
            optionsRef.current.onSuccess?.(command, operation, result);
          }

          return withLedgerState(result, undoRef, redoRef);
        } catch (error) {
          optionsRef.current.onError?.(command, operation, error);
          return withLedgerState(
            withCommandContext(command, operation, {
              conflict: toLedgerConflict({
                message:
                  error instanceof Error
                    ? error.message
                    : DEFAULT_ERROR_MESSAGE,
              }),
              message:
                error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE,
              status: "conflict",
            }),
            undoRef,
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
    async () => execute("undo", undoRef, redoRef),
    [execute],
  );

  const redo = useCallback(
    async () => execute("redo", redoRef, undoRef),
    [execute],
  );

  return {
    canRedo: state.canRedo,
    canUndo: state.canUndo,
    clear,
    isRunning: state.isRunning,
    record,
    redo,
    redoDepth: state.redoDepth,
    undo,
    undoDepth: state.undoDepth,
  };
}

function extractConflictCode(message: string): LedgerConflictCode | undefined {
  const rawCode = HISTORY_CONFLICT_CODE_REGEX.exec(message)?.[1];
  if (!rawCode) {
    return undefined;
  }
  const directMatch = LEDGER_CONFLICT_CODES.find((code) => code === rawCode);
  if (directMatch) {
    return directMatch;
  }
  if (rawCode.includes("NAME_CONFLICT")) {
    return "nameConflict";
  }
  if (rawCode.includes("OCCUPANCY")) {
    return "occupancyConflict";
  }
  if (
    rawCode.includes("REFERENCE_MISSING") ||
    rawCode.includes("LINEAGE_MISSING") ||
    rawCode.includes("PRACTITIONER_LINEAGE_MISSING")
  ) {
    return "referenceMissing";
  }
  if (rawCode.includes("MISSING") || rawCode.includes("NOT_FOUND")) {
    return "targetMissing";
  }
  if (rawCode.includes("CONFLICT") || rawCode.includes("STALE")) {
    return "staleState";
  }
  return undefined;
}

function toLedgerResult(result: LedgerExecutionResult): LedgerResult {
  if (result.status === "applied" || result.status === "noop") {
    return result;
  }

  if (!("conflict" in result)) {
    const conflictCode = extractConflictCode(result.message);
    return {
      conflict: toLedgerConflict({
        ...(conflictCode && { code: conflictCode }),
        message: result.message,
      }),
      ...(conflictCode && { conflictCode }),
      message: result.message,
      status: "conflict",
    };
  }

  const conflictCode =
    result.conflictCode ?? extractConflictCode(result.message);
  return {
    conflict: result.conflict,
    ...(conflictCode && { conflictCode }),
    message: result.message,
    status: "conflict",
  };
}

function withCommandContext(
  command: LedgerCommand,
  operation: LedgerOperation,
  result: LedgerResult,
): LedgerResult {
  if (result.status !== "conflict") {
    return result;
  }

  const operationLabel = operation === "undo" ? "Rückgängig" : "Wiederholen";
  const conflictCode =
    result.conflictCode ?? extractConflictCode(result.message);
  const message =
    `[HISTORY:${operation.toUpperCase()}] ${operationLabel} für Aktion "${command.label}" fehlgeschlagen.\n` +
    `Grund: ${result.message}`;
  return {
    conflict: {
      ...result.conflict,
      message,
    },
    ...(conflictCode && { conflictCode }),
    message,
    status: "conflict",
  };
}

function withLedgerState<TCommand>(
  result: LedgerResult,
  undoRef: RefObject<TCommand[]>,
  redoRef: RefObject<TCommand[]>,
): LedgerResult {
  return {
    ...result,
    canRedoAfter: redoRef.current.length > 0,
    canUndoAfter: undoRef.current.length > 0,
  };
}
