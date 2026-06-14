import type { LedgerExecutionResult, LedgerOperation } from "./command-ledger";
import type {
  RecordRuleSetCommand,
  RuleSetCommand,
  RuleSetCommandDescription,
  RuleSetCommandKind,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { conflictLedgerResult } from "./rule-set-replay";

type RuleSetReplayRegistry = Partial<
  Record<RuleSetCommandKind, WeakMap<RuleSetCommand, RuleSetReplayAdapter>>
>;

const replayAdaptersByKind: RuleSetReplayRegistry = {};

export function executeRuleSetCommand(
  command: RuleSetCommand,
  operation: LedgerOperation,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  switch (command.kind) {
    case "absence.create":
    case "absence.delete":
    case "absence.update":
    case "appointmentType.create":
    case "appointmentType.delete":
    case "appointmentType.move":
    case "appointmentType.restoreSubtree":
    case "appointmentType.update":
    case "baseSchedule.replaceSet":
    case "location.create":
    case "location.deleteWithDependencies":
    case "location.update":
    case "mfa.create":
    case "mfa.delete":
    case "practitioner.create":
    case "practitioner.deleteWithDependencies":
    case "practitioner.update":
    case "schedulingRule.create":
    case "schedulingRule.delete":
    case "schedulingRule.update": {
      return executeRegisteredRuleSetReplay(command, operation);
    }
  }
}

export function recordRuleSetCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  record?.(attachRuleSetReplay(command, replay));
}

function attachRuleSetReplay(
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): RuleSetCommand {
  const replayAdapters =
    replayAdaptersByKind[command.kind] ??
    new WeakMap<RuleSetCommand, RuleSetReplayAdapter>();
  replayAdapters.set(command, replay);
  replayAdaptersByKind[command.kind] = replayAdapters;
  return command;
}

function executeRegisteredRuleSetReplay(
  command: RuleSetCommand,
  operation: LedgerOperation,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  const replay = replayAdaptersByKind[command.kind]?.get(command);
  if (!replay) {
    return conflictLedgerResult(
      "Für diese Regelwerk-Aktion ist kein Wiedergabe-Adapter registriert.",
    );
  }
  return replay[operation]();
}
