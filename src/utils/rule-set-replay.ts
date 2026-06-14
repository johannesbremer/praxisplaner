import type {
  LedgerCommand,
  LedgerConflictCode,
  LedgerExecutionResult,
  LedgerResult,
} from "./command-ledger";
import type { EncodedRuleSetSnapshot } from "./rule-set-snapshot-codecs";

import { toLedgerConflict } from "./command-ledger";

export type RecordRuleSetCommand = (command: RuleSetCommand) => void;

export interface RuleSetAbsenceCommand extends LedgerCommand {
  kind: Extract<
    RuleSetCommandKind,
    "absence.create" | "absence.delete" | "absence.update"
  >;
  payload: RuleSetAbsencePayload;
  snapshots: Required<RuleSetCommandSnapshot>;
  target: Required<Pick<RuleSetCommandTarget, "lineageKey">>;
}

export interface RuleSetAbsencePayload {
  afterPortionCount: number;
  beforePortionCount: number;
  date: string;
  kind: Extract<
    RuleSetCommandKind,
    "absence.create" | "absence.delete" | "absence.update"
  >;
  staffLineageKey: string;
}

export type RuleSetCommand =
  | RuleSetAbsenceCommand
  | RuleSetLegacyCommand
  | RuleSetSchedulingRuleCommand;

export type RuleSetCommandDescription = RuleSetCommand;

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

export type RuleSetCommandPayload =
  | RuleSetAbsencePayload
  | RuleSetNamedLineageCreatePayload
  | RuleSetNamedLineageDeletePayload
  | RuleSetNamedLineageUpdatePayload
  | RuleSetSchedulingRulePayload
  | RuleSetSnapshotCommandPayload;

export interface RuleSetCommandSnapshot {
  after?: EncodedRuleSetSnapshot<unknown>;
  before?: EncodedRuleSetSnapshot<unknown>;
}

export interface RuleSetCommandTarget {
  entityId?: string;
  lineageKey?: string;
  ruleSetId?: string;
}

export interface RuleSetLegacyCommand extends LedgerCommand {
  kind: Exclude<
    RuleSetCommandKind,
    | "absence.create"
    | "absence.delete"
    | "absence.update"
    | "schedulingRule.create"
    | "schedulingRule.delete"
    | "schedulingRule.update"
  >;
  payload?: RuleSetCommandPayload;
  snapshots?: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}

export interface RuleSetNamedLineageCreatePayload {
  kind: Extract<
    RuleSetCommandKind,
    "location.create" | "mfa.create" | "practitioner.create"
  >;
  lineageKey: string;
  name: string;
}

export interface RuleSetNamedLineageDeletePayload {
  kind: Extract<RuleSetCommandKind, "mfa.delete">;
  lineageKey: string;
  name: string;
}

export interface RuleSetNamedLineageSnapshot {
  name: string;
}

export interface RuleSetNamedLineageUpdatePayload {
  after: RuleSetNamedLineageSnapshot;
  before: RuleSetNamedLineageSnapshot;
  kind: Extract<RuleSetCommandKind, "location.update" | "practitioner.update">;
  lineageKey: string;
}

export interface RuleSetReplayAdapter {
  redo: () => LedgerExecutionResult | Promise<LedgerExecutionResult>;
  undo: () => LedgerExecutionResult | Promise<LedgerExecutionResult>;
}

export interface RuleSetSchedulingRuleCommand extends LedgerCommand {
  kind: Extract<
    RuleSetCommandKind,
    "schedulingRule.create" | "schedulingRule.delete" | "schedulingRule.update"
  >;
  payload: RuleSetSchedulingRulePayload;
  snapshots: RuleSetCommandSnapshot;
  target: Required<Pick<RuleSetCommandTarget, "entityId">>;
}

export interface RuleSetSchedulingRulePayload {
  hasAfterSnapshot: boolean;
  hasBeforeSnapshot: boolean;
  kind: RuleSetSchedulingRuleCommand["kind"];
  ruleName: string;
}

export interface RuleSetSnapshotCommandPayload {
  kind: Exclude<
    RuleSetCommandKind,
    | "absence.create"
    | "absence.delete"
    | "absence.update"
    | "schedulingRule.create"
    | "schedulingRule.delete"
    | "schedulingRule.update"
  >;
  snapshots: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}

export function createRuleSetAbsenceCommand(params: {
  kind: RuleSetAbsenceCommand["kind"];
  label: string;
  payload: RuleSetAbsencePayload;
  scope?: string;
  snapshots: Required<RuleSetCommandSnapshot>;
  target: RuleSetAbsenceCommand["target"];
}): RuleSetAbsenceCommand {
  return {
    kind: params.kind,
    label: params.label,
    payload: params.payload,
    ...(params.scope && { scope: params.scope }),
    snapshots: params.snapshots,
    target: params.target,
  };
}

export function createRuleSetSchedulingRuleCommand(params: {
  kind: RuleSetSchedulingRuleCommand["kind"];
  label: string;
  payload: RuleSetSchedulingRulePayload;
  scope?: string;
  snapshots: RuleSetCommandSnapshot;
  target: RuleSetSchedulingRuleCommand["target"];
}): RuleSetSchedulingRuleCommand {
  return {
    kind: params.kind,
    label: params.label,
    payload: params.payload,
    ...(params.scope && { scope: params.scope }),
    snapshots: params.snapshots,
    target: params.target,
  };
}

const APPLIED_RESULT: LedgerResult = { status: "applied" };

export function appliedLedgerResult(): LedgerResult {
  return APPLIED_RESULT;
}

export function conflictLedgerResult(
  message: string,
  options?: {
    code?: LedgerConflictCode;
    name?: string;
    reference?: string;
    target?: string;
  },
): LedgerResult {
  return {
    conflict: toLedgerConflict({
      code:
        options?.code ??
        (message.includes("nicht gefunden") ? "targetMissing" : "staleState"),
      message,
      ...(options?.name && { name: options.name }),
      ...(options?.reference && { reference: options.reference }),
      ...(options?.target && { target: options.target }),
    }),
    message,
    status: "conflict",
  };
}

export function createRuleSetCommandDescription(params: {
  clearHistoryBefore?: boolean;
  kind: RuleSetLegacyCommand["kind"];
  label: string;
  payload?: RuleSetCommandPayload;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}): RuleSetLegacyCommand {
  return {
    ...(params.clearHistoryBefore && { clearHistoryBefore: true }),
    kind: params.kind,
    label: params.label,
    ...(params.payload && { payload: params.payload }),
    ...(params.scope && { scope: params.scope }),
    ...(params.snapshots && { snapshots: params.snapshots }),
    ...(params.target && { target: params.target }),
  };
}

export function withSerializableRuleSetPayload<TCommand extends RuleSetCommand>(
  command: TCommand,
): TCommand {
  if (command.payload || !command.snapshots) {
    return command;
  }
  return {
    ...command,
    payload: {
      kind: command.kind,
      snapshots: command.snapshots,
      ...(command.target && { target: command.target }),
    },
  };
}
