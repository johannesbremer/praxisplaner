import type { Id } from "@/convex/_generated/dataModel";
import type { AppointmentLeadTimes } from "@/convex/appointmentLeadTimes";

import type { DraftMutationResult } from "./cow-history";
import type {
  RecordRuleSetCommand,
  RuleSetCommandRuntimeAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";
import {
  appliedLedgerResult,
  createRuleSetPracticeSettingsCommand,
} from "./rule-set-replay";

interface RecordAppointmentLeadTimesCommandParams {
  afterLeadTimes: AppointmentLeadTimes;
  beforeLeadTimes: AppointmentLeadTimes;
  getCowMutationArgs: () => {
    expectedDraftRevision: null | number;
    selectedRuleSetId: Id<"ruleSets">;
  };
  handleDraftMutationResult: (result: DraftMutationResult) => void;
  label: string;
  onRecordCommand: RecordRuleSetCommand | undefined;
  practiceId: Id<"practices">;
  updateLeadTimes: (args: {
    expectedDraftRevision: null | number;
    leadTimes: AppointmentLeadTimes;
    practiceId: Id<"practices">;
    selectedRuleSetId: Id<"ruleSets">;
  }) => Promise<DraftMutationResult & { leadTimes: AppointmentLeadTimes }>;
}

export function recordAppointmentLeadTimesCommand(
  params: RecordAppointmentLeadTimesCommandParams,
): void {
  const command = createRuleSetPracticeSettingsCommand({
    kind: "practice.appointmentLeadTimes.update",
    label: params.label,
    payload: {
      after: formatLeadTimes(params.afterLeadTimes),
      before: formatLeadTimes(params.beforeLeadTimes),
      kind: "practice.appointmentLeadTimes.update",
    },
    target: { entityId: params.practiceId },
  });

  const applyLeadTimes = async (leadTimes: AppointmentLeadTimes) => {
    const result = await params.updateLeadTimes({
      ...params.getCowMutationArgs(),
      leadTimes,
      practiceId: params.practiceId,
    });
    params.handleDraftMutationResult(result);
    return appliedLedgerResult();
  };

  const runtime: RuleSetCommandRuntimeAdapter = {
    redo: async () => await applyLeadTimes(params.afterLeadTimes),
    undo: async () => await applyLeadTimes(params.beforeLeadTimes),
  };

  recordRuleSetCommand(params.onRecordCommand, command, runtime);
}

function formatLeadTimes(leadTimes: AppointmentLeadTimes): string[] {
  return [
    `Mitarbeiter: ${formatMinutes(leadTimes.staffMinutes)}`,
    `Online: ${formatMinutes(leadTimes.onlineMinutes)}`,
    `TelefonKI: ${formatMinutes(leadTimes.telefonkiMinutes)}`,
  ];
}

function formatMinutes(minutes: number): string {
  if (minutes === 1) {
    return "1 Minute";
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 Stunde" : `${hours} Stunden`;
  }
  return `${minutes} Minuten`;
}
