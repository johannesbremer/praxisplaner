import type { RuleSetReplayAdapter } from "./rule-set-replay";

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
