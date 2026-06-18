import type { LedgerExecutionResult, LedgerOperation } from "./command-ledger";
import type {
  RecordedRuleSetCommand,
  RecordRuleSetCommand,
  RuleSetCommand,
  RuleSetCommandRuntimeAdapter,
} from "./rule-set-replay";

export interface RuleSetCommandExecutorContext {
  getRuntimeAdapter: (
    command: RecordedRuleSetCommand,
  ) => RuleSetCommandRuntimeAdapter | undefined;
}

export function executeRuleSetCommand(
  command: RecordedRuleSetCommand,
  operation: LedgerOperation,
  context: RuleSetCommandExecutorContext,
): LedgerExecutionResult | Promise<LedgerExecutionResult> {
  const runtime = context.getRuntimeAdapter(command);
  if (!runtime) {
    return {
      message: "Die Regelset-Aktion kann nicht erneut ausgeführt werden.",
      status: "conflict",
    };
  }

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
    case "practice.appointmentLeadTimes.update":
    case "practice.appointmentSmileyOptions.update":
    case "practitioner.create":
    case "practitioner.deleteWithDependencies":
    case "practitioner.update":
    case "schedulingRule.create":
    case "schedulingRule.delete":
    case "schedulingRule.update": {
      return runtime[operation]();
    }
  }
}

export function recordRuleSetCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommand,
  runtime: RuleSetCommandRuntimeAdapter,
): void {
  record?.(command, runtime);
}
