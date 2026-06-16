import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import type {
  LedgerExecutionResult,
  LedgerOperation,
} from "../../utils/command-ledger";
import type { CalendarPlanningCommand } from "./calendar-planning-command";

import { useRegisterGlobalUndoRedoControls } from "../../hooks/use-global-undo-redo-controls";
import { useCommandLedger } from "../../utils/command-ledger";

export type CalendarPlanningCommandExecutor = (
  command: CalendarPlanningCommand,
  operation: LedgerOperation,
) => LedgerExecutionResult | Promise<LedgerExecutionResult>;

export function useCalendarPlanningHistory(
  executeCommand: CalendarPlanningCommandExecutor,
) {
  const { canRedo, canUndo, record, redo, undo } = useCommandLedger({
    executeCommand,
  });

  const recordCalendarCommand = useCallback(
    (command: CalendarPlanningCommand) => {
      record(command);
    },
    [record],
  );

  const runUndo = useCallback(async () => {
    const result = await undo();
    if (result.status === "conflict") {
      toast.error("Änderung konnte nicht rückgängig gemacht werden", {
        description: result.message,
      });
    }
  }, [undo]);

  const runRedo = useCallback(async () => {
    const result = await redo();
    if (result.status === "conflict") {
      toast.error("Änderung konnte nicht wiederhergestellt werden", {
        description: result.message,
      });
    }
  }, [redo]);

  const calendarUndoRedoControls = useMemo(
    () =>
      canUndo || canRedo
        ? {
            canRedo,
            canUndo,
            onRedo: runRedo,
            onUndo: runUndo,
          }
        : null,
    [canRedo, canUndo, runRedo, runUndo],
  );

  useRegisterGlobalUndoRedoControls(calendarUndoRedoControls);

  return {
    recordCalendarCommand,
    redo: runRedo,
    undo: runUndo,
  };
}
