import type {
  RecordRuleSetCommand,
  RuleSetAbsenceCommand,
  RuleSetCommandRuntimeAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

export function createAbsenceDayReplayAdapter<
  TStaff,
  TDate,
  TPortion,
  TSnapshot extends { portion: TPortion },
>(params: {
  date: TDate;
  nextPortions: TPortion[];
  nextSnapshots: TSnapshot[];
  previousSnapshots: TSnapshot[];
  setAbsencesForDay: (
    staff: TStaff,
    date: TDate,
    portions: TPortion[],
    options?: {
      clearSnapshots?: TSnapshot[];
      createSnapshots?: TSnapshot[];
    },
  ) => Promise<TSnapshot[]>;
  staff: TStaff;
}): RuleSetCommandRuntimeAdapter {
  return createAbsenceReplayAdapter({
    redo: async () => {
      await params.setAbsencesForDay(
        params.staff,
        params.date,
        params.nextPortions,
        {
          clearSnapshots: params.previousSnapshots,
          createSnapshots: params.nextSnapshots,
        },
      );
    },
    undo: async () => {
      await params.setAbsencesForDay(
        params.staff,
        params.date,
        params.previousSnapshots.map((snapshot) => snapshot.portion),
        {
          clearSnapshots: params.nextSnapshots,
          createSnapshots: params.previousSnapshots,
        },
      );
    },
  });
}

export function createAbsenceReplayAdapter(params: {
  redo: () => Promise<void>;
  undo: () => Promise<void>;
}): RuleSetCommandRuntimeAdapter {
  return {
    redo: async () => {
      await params.redo();
      return { status: "applied" };
    },
    undo: async () => {
      await params.undo();
      return { status: "applied" };
    },
  };
}

export function recordAbsenceReplayCommand<
  TStaff,
  TDate,
  TPortion,
  TSnapshot extends { portion: TPortion },
>(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetAbsenceCommand,
  params: Parameters<
    typeof createAbsenceDayReplayAdapter<TStaff, TDate, TPortion, TSnapshot>
  >[0],
): void {
  const replay = createAbsenceDayReplayAdapter(params);
  recordRuleSetCommand(record, command, replay);
}
