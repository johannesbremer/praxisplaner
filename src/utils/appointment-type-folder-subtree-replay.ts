import type {
  RecordRuleSetCommand,
  RuleSetCommandDescription,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

export function createAppointmentTypeFolderSubtreeDeleteReplayAdapter<
  TFolderId extends string,
  TFolderLineageKey extends string,
  TAppointmentTypeLineageKey extends string,
>(params: {
  clearOptimisticRestore: () => void;
  deleteFolder: (folderId: TFolderId) => Promise<{ entityId: TFolderId }>;
  hideSubtreeOptimistically: (params: {
    appointmentTypeLineageKeys: TAppointmentTypeLineageKey[];
    folderLineageKeys: TFolderLineageKey[];
  }) => void;
  initialFolderId: TFolderId;
  isMissingEntityError: (error: unknown) => boolean;
  removeSubtreeRefs: () => void;
  restoreSubtree: () => Promise<
    | {
        message: string;
        status: "conflict";
      }
    | {
        restoredRootFolderId: TFolderId;
        status: "applied";
      }
  >;
  subtree: {
    appointmentTypeLineageKeys: TAppointmentTypeLineageKey[];
    folderLineageKeys: TFolderLineageKey[];
  };
}): RuleSetReplayAdapter {
  let currentFolderId = params.initialFolderId;

  return {
    redo: async () => {
      try {
        params.hideSubtreeOptimistically(params.subtree);
        const result = await params.deleteFolder(currentFolderId);
        params.removeSubtreeRefs();
        currentFolderId = result.entityId;
        return { status: "applied" };
      } catch (error: unknown) {
        params.clearOptimisticRestore();
        if (params.isMissingEntityError(error)) {
          return { status: "applied" };
        }
        return {
          message:
            error instanceof Error
              ? error.message
              : "Der Ordner konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
    undo: async () => {
      const result = await params.restoreSubtree();
      if (result.status === "conflict") {
        return result;
      }
      currentFolderId = result.restoredRootFolderId;
      return { status: "applied" };
    },
  };
}

export function recordAppointmentTypeFolderSubtreeReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, { ...command, replay });
}
