import type {
  LedgerCommand,
  LedgerExecutionResult,
  LedgerOperation,
} from "../../utils/command-ledger";

import { toLedgerConflict } from "../../utils/command-ledger";

export interface CalendarPlanningCommand extends LedgerCommand {
  kind: CalendarPlanningCommandKind;
}

export interface CalendarPlanningCommandDescription extends LedgerCommand {
  clearHistoryBefore?: boolean;
  kind: CalendarPlanningCommandKind;
}

export type CalendarPlanningCommandKind =
  | "appointment.create"
  | "appointment.delete"
  | "appointment.update"
  | "blockedSlot.create"
  | "blockedSlot.delete"
  | "blockedSlot.update";

export interface CalendarPlanningReplayAdapter {
  redo: () =>
    | CalendarPlanningReplayResult
    | Promise<CalendarPlanningReplayResult>;
  undo: () =>
    | CalendarPlanningReplayResult
    | Promise<CalendarPlanningReplayResult>;
}

const replayAdaptersByCommand = new WeakMap<
  CalendarPlanningCommand,
  CalendarPlanningReplayAdapter
>();

type CalendarPlanningReplayResult =
  | LedgerExecutionResult
  | {
      message?: string;
      status: "conflict";
    };

export function createCalendarPlanningCommand(
  description: CalendarPlanningCommandDescription,
  replay: CalendarPlanningReplayAdapter,
): CalendarPlanningCommand {
  const command: CalendarPlanningCommand = {
    ...(description.clearHistoryBefore && { clearHistoryBefore: true }),
    kind: description.kind,
    label: description.label,
    ...(description.scope && { scope: description.scope }),
  };
  replayAdaptersByCommand.set(command, replay);
  return command;
}

export function executeCalendarPlanningCommand(
  command: CalendarPlanningCommand,
  operation: LedgerOperation,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  const replay = replayAdaptersByCommand.get(command);
  if (!replay) {
    return {
      conflict: toLedgerConflict({
        message:
          "Für diese Kalender-Aktion ist kein Wiedergabe-Adapter registriert.",
      }),
      message:
        "Für diese Kalender-Aktion ist kein Wiedergabe-Adapter registriert.",
      status: "conflict",
    };
  }
  return Promise.resolve(replay[operation]()).then(toLedgerExecutionResult);
}

function toLedgerExecutionResult(
  result: CalendarPlanningReplayResult,
): LedgerExecutionResult {
  if (result.status !== "conflict") {
    return result;
  }
  if ("conflict" in result) {
    return result;
  }
  return {
    message:
      result.message ?? "Die Kalender-Aktion konnte nicht ausgeführt werden.",
    status: "conflict",
  };
}
