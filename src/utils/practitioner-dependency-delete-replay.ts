import type {
  RecordRuleSetCommand,
  RuleSetCommandDescription,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

export function createPractitionerDependencyDeleteReplayAdapter<
  TPractitionerId extends string,
  TPractitionerLineageKey extends string,
  TSnapshot extends {
    practitioner: {
      id: TPractitionerId;
      lineageKey: TPractitionerLineageKey;
    };
  },
>(params: {
  deleteWithDependencies: (args: {
    practitionerId: TPractitionerId;
    practitionerLineageKey: TPractitionerLineageKey;
  }) => Promise<{ snapshot: TSnapshot }>;
  findByLineage: (
    lineageKey: TPractitionerLineageKey,
  ) => undefined | { _id: TPractitionerId };
  initialEntityId: TPractitionerId;
  initialSnapshot: TSnapshot;
  isMissingEntityError: (error: unknown) => boolean;
  restoreWithDependencies: (
    snapshot: TSnapshot,
  ) => Promise<{ restoredPractitionerId: TPractitionerId }>;
}): RuleSetReplayAdapter {
  let currentSnapshot = params.initialSnapshot;
  let currentPractitionerId = params.initialEntityId;

  return {
    redo: async () => {
      const existingByLineage = params.findByLineage(
        currentSnapshot.practitioner.lineageKey,
      );
      if (!existingByLineage) {
        return { status: "applied" };
      }
      currentPractitionerId = existingByLineage._id;

      try {
        const result = await params.deleteWithDependencies({
          practitionerId: currentPractitionerId,
          practitionerLineageKey: currentSnapshot.practitioner.lineageKey,
        });
        currentSnapshot = result.snapshot;
        currentPractitionerId = currentSnapshot.practitioner.id;
        return { status: "applied" };
      } catch (error: unknown) {
        if (params.isMissingEntityError(error)) {
          const currentByLineage = params.findByLineage(
            currentSnapshot.practitioner.lineageKey,
          );
          if (!currentByLineage) {
            return { status: "applied" };
          }
          try {
            const result = await params.deleteWithDependencies({
              practitionerId: currentByLineage._id,
              practitionerLineageKey: currentSnapshot.practitioner.lineageKey,
            });
            currentSnapshot = result.snapshot;
            currentPractitionerId = currentSnapshot.practitioner.id;
            return { status: "applied" };
          } catch (retryError: unknown) {
            if (params.isMissingEntityError(retryError)) {
              return { status: "applied" };
            }
            return {
              message:
                retryError instanceof Error
                  ? retryError.message
                  : "Der Arzt konnte nicht gelöscht werden.",
              status: "conflict" as const,
            };
          }
        }
        return {
          message:
            error instanceof Error
              ? error.message
              : "Der Arzt konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
    undo: async () => {
      try {
        const result = await params.restoreWithDependencies(currentSnapshot);
        currentPractitionerId = result.restoredPractitionerId;
        return { status: "applied" };
      } catch (error: unknown) {
        return {
          message:
            error instanceof Error
              ? error.message
              : "Der Arzt konnte nicht wiederhergestellt werden.",
          status: "conflict" as const,
        };
      }
    },
  };
}

export function recordPractitionerDependencyDeleteReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, { ...command, replay });
}
