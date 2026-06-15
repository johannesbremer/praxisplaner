import type {
  LedgerCommand,
  LedgerExecutionResult,
  LedgerOperation,
} from "../../utils/command-ledger";

export interface CalendarPlanningCommand extends LedgerCommand {
  kind: CalendarPlanningCommandKind;
  replay: CalendarPlanningReplayAdapter;
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
    replay,
    ...(description.scope && { scope: description.scope }),
  };
  return command;
}

export function executeCalendarPlanningCommand(
  command: CalendarPlanningCommand,
  operation: LedgerOperation,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  return Promise.resolve(command.replay[operation]()).then(
    toLedgerExecutionResult,
  );
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
