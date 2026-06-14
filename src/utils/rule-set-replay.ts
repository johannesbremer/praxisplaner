import type {
  LedgerCommand,
  LedgerConflictCode,
  LedgerExecutionResult,
  LedgerOperation,
  LedgerResult,
} from "./command-ledger";
import type { EncodedRuleSetSnapshot } from "./rule-set-snapshot-codecs";

import { toLedgerConflict } from "./command-ledger";

export type RecordRuleSetCommand = (command: RuleSetCommand) => void;

export type RuleSetCommand = RuleSetCommandDescription;

export interface RuleSetCommandDescription extends LedgerCommand {
  kind: RuleSetCommandKind;
  payload?: RuleSetCommandPayload;
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

export type RuleSetCommandPayload =
  | RuleSetNamedLineageCreatePayload
  | RuleSetNamedLineageDeletePayload
  | RuleSetNamedLineageUpdatePayload
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

export interface RuleSetSnapshotCommandPayload {
  kind: RuleSetCommandKind;
  snapshots: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}

const APPLIED_RESULT: LedgerResult = { status: "applied" };
const replayAdaptersByCommand = new WeakMap<
  RuleSetCommand,
  RuleSetReplayAdapter
>();

export function appliedLedgerResult(): LedgerResult {
  return APPLIED_RESULT;
}

export function attachRuleSetReplay(
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): RuleSetCommand {
  replayAdaptersByCommand.set(command, replay);
  return command;
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
  kind: RuleSetCommandKind;
  label: string;
  payload?: RuleSetCommandPayload;
  scope?: string;
  snapshots?: RuleSetCommandSnapshot;
  target?: RuleSetCommandTarget;
}): RuleSetCommandDescription {
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
