import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { useRegisterGlobalUndoRedoControls } from "../../hooks/use-global-undo-redo-controls";
import { useCommandLedger } from "../../utils/command-ledger";
import {
  type CalendarPlanningHistoryAction,
  createCalendarPlanningCommand,
  executeCalendarPlanningCommand,
} from "./calendar-planning-command";

export function useCalendarPlanningHistory() {
  const {
    canRedo: canRedoHistoryAction,
    canUndo: canUndoHistoryAction,
    record,
    redo,
    undo,
  } = useCommandLedger({
    executeCommand: executeCalendarPlanningCommand,
  });

  const pushHistoryAction = useCallback(
    (action: CalendarPlanningHistoryAction) => {
      record(createCalendarPlanningCommand(action));
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
      canUndoHistoryAction || canRedoHistoryAction
        ? {
            canRedo: canRedoHistoryAction,
            canUndo: canUndoHistoryAction,
            onRedo: runRedo,
            onUndo: runUndo,
          }
        : null,
    [canRedoHistoryAction, canUndoHistoryAction, runRedo, runUndo],
  );

  useRegisterGlobalUndoRedoControls(calendarUndoRedoControls);

  return {
    pushHistoryAction,
    redo: runRedo,
    undo: runUndo,
  };
}
