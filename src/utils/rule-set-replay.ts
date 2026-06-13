import type {
  LedgerCommand,
  LedgerResult,
  ReplayableLedgerCommand,
} from "./command-ledger";
import type { EncodedRuleSetSnapshot } from "./rule-set-snapshot-codecs";

import { toLedgerConflict } from "./command-ledger";

export type RecordRuleSetCommand = (command: RuleSetCommand) => void;

export interface RuleSetCommand extends LedgerCommand, ReplayableLedgerCommand {
  kind: RuleSetCommandKind;
  replay?: RuleSetReplayAdapter;
  snapshots?: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}

export type RuleSetCommandKind =
  | "absence.create"
  | "absence.delete"
  | "absence.update"
  | "appointmentType.create"
  | "appointmentType.delete"
  | "appointmentType.move"
  | "appointmentType.restoreSubtree"
  | "appointmentType.update"
  | "baseSchedule.replaceSet"
  | "location.create"
  | "location.deleteWithDependencies"
  | "location.update"
  | "mfa.create"
  | "mfa.delete"
  | "practitioner.create"
  | "practitioner.deleteWithDependencies"
  | "practitioner.update"
  | "schedulingRule.create"
  | "schedulingRule.delete"
  | "schedulingRule.update";

export interface RuleSetCommandSnapshot {
  after?: EncodedRuleSetSnapshot<unknown>;
  before?: EncodedRuleSetSnapshot<unknown>;
}

export interface RuleSetCommandTarget {
  entityId?: string;
  lineageKey?: string;
  ruleSetId?: string;
}

export interface RuleSetReplayAdapter {
  redo: () => LedgerResult | Promise<LedgerResult>;
  undo: () => LedgerResult | Promise<LedgerResult>;
}

const APPLIED_RESULT: LedgerResult = { status: "applied" };

export function appliedLedgerResult(): LedgerResult {
  return APPLIED_RESULT;
}

export function conflictLedgerResult(message: string): LedgerResult {
  return {
    conflict: toLedgerConflict({
      code: message.includes("nicht gefunden") ? "targetMissing" : "staleState",
      message,
    }),
    message,
    status: "conflict",
  };
}

export function createRuleSetCommand(params: {
  clearHistoryBefore?: boolean;
  kind: RuleSetCommandKind;
  label: string;
  replay: RuleSetReplayAdapter;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}): RuleSetCommand {
  return {
    ...(params.clearHistoryBefore && { clearHistoryBefore: true }),
    kind: params.kind,
    label: params.label,
    redo: params.replay.redo,
    replay: params.replay,
    ...(params.scope && { scope: params.scope }),
    ...(params.snapshots && { snapshots: params.snapshots }),
    ...(params.target && { target: params.target }),
    undo: params.replay.undo,
  };
}
