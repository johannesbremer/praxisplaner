import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { useRegisterGlobalUndoRedoControls } from "../../hooks/use-global-undo-redo-controls";
import { useCommandLedger } from "../../utils/command-ledger";
import {
  type CalendarPlanningCommandDescription,
  type CalendarPlanningReplayAdapter,
  createCalendarPlanningCommand,
  executeCalendarPlanningCommand,
} from "./calendar-planning-command";

export function useCalendarPlanningHistory() {
  const { canRedo, canUndo, record, redo, undo } = useCommandLedger({
    executeCommand: executeCalendarPlanningCommand,
  });

  const recordCalendarCommand = useCallback(
    (
      command: CalendarPlanningCommandDescription,
      replay: CalendarPlanningReplayAdapter,
    ) => {
      record(createCalendarPlanningCommand(command, replay));
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
