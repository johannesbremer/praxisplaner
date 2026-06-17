import type { Id } from "@/convex/_generated/dataModel";

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

interface AppointmentSmileyOption {
  emoji: string;
  id?: string;
  name: string;
}

interface RecordAppointmentSmileyOptionsCommandParams {
  afterOptions: AppointmentSmileyOption[];
  beforeOptions: AppointmentSmileyOption[];
  formatOption: (option: AppointmentSmileyOption) => string;
  getCowMutationArgs: () => {
    expectedDraftRevision: null | number;
    selectedRuleSetId: Id<"ruleSets">;
  };
  handleDraftMutationResult: (result: DraftMutationResult) => void;
  label: string;
  onRecordCommand: RecordRuleSetCommand | undefined;
  practiceId: Id<"practices">;
  updateOptions: (args: {
    expectedDraftRevision: null | number;
    options: AppointmentSmileyOption[];
    practiceId: Id<"practices">;
    selectedRuleSetId: Id<"ruleSets">;
  }) => Promise<DraftMutationResult & { options: AppointmentSmileyOption[] }>;
}

export function recordAppointmentSmileyOptionsCommand(
  params: RecordAppointmentSmileyOptionsCommandParams,
): void {
  const command = createRuleSetPracticeSettingsCommand({
    kind: "practice.appointmentSmileyOptions.update",
    label: params.label,
    payload: {
      after: params.afterOptions.map((option) => params.formatOption(option)),
      before: params.beforeOptions.map((option) => params.formatOption(option)),
      kind: "practice.appointmentSmileyOptions.update",
    },
    target: { entityId: params.practiceId },
  });

  const applyOptions = async (options: AppointmentSmileyOption[]) => {
    const result = await params.updateOptions({
      ...params.getCowMutationArgs(),
      options,
      practiceId: params.practiceId,
    });
    params.handleDraftMutationResult(result);
    return appliedLedgerResult();
  };

  const runtime: RuleSetCommandRuntimeAdapter = {
    redo: async () => await applyOptions(params.afterOptions),
    undo: async () => await applyOptions(params.beforeOptions),
  };

  recordRuleSetCommand(params.onRecordCommand, command, runtime);
}
