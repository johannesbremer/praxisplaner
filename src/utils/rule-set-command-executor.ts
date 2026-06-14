import type { LedgerExecutionResult, LedgerOperation } from "./command-ledger";
import type {
  RecordRuleSetCommand,
  RuleSetCommand,
  RuleSetCommandDescription,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { conflictLedgerResult } from "./rule-set-replay";

const replayAdaptersByCommand = new WeakMap<
  RuleSetCommand,
  RuleSetReplayAdapter
>();

export function attachRuleSetReplay(
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): RuleSetCommand {
  replayAdaptersByCommand.set(command, replay);
  return command;
}

export function executeRuleSetCommand(
  command: RuleSetCommand,
  operation: LedgerOperation,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  const replay = replayAdaptersByCommand.get(command);
  if (!replay) {
    return conflictLedgerResult(
      "Für diese Regelwerk-Aktion ist kein Wiedergabe-Adapter registriert.",
    );
  }
  return replay[operation]();
}

export function recordRuleSetCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  record?.(attachRuleSetReplay(command, replay));
}
