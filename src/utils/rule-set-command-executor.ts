import type { LedgerExecutionResult, LedgerOperation } from "./command-ledger";
import type {
  ExecutableRuleSetCommand,
  RecordRuleSetCommand,
  RuleSetCommand,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

export function executeRuleSetCommand(
  command: ExecutableRuleSetCommand,
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
      return command.replay[operation]();
    }
  }
}

export function recordRuleSetCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommand,
  replay: RuleSetReplayAdapter,
): void {
  record?.(command, replay);
}
