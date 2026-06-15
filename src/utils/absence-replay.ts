import type {
  RecordRuleSetCommand,
  RuleSetAbsenceCommand,
  RuleSetReplayAdapter,
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
}): RuleSetReplayAdapter {
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
}): RuleSetReplayAdapter {
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

export function recordAbsenceReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetAbsenceCommand,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, command, replay);
}
