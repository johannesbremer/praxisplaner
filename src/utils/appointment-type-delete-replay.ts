import type {
  RecordRuleSetCommand,
  RuleSetCommandDescription,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

export function createAppointmentTypeDeleteReplayAdapter<
  TAppointmentTypeId extends string,
  TAppointmentTypeLineageKey extends string,
  TPractitionerId extends string,
  TFolderId extends string,
  TRuleSetId extends string,
  TSnapshot,
  TCreateArgs,
  TRestoredAppointmentType extends { _id: TAppointmentTypeId },
>(params: {
  createAppointmentType: (
    snapshot: TSnapshot,
    practitionerIds: TPractitionerId[],
    treeFolderId: null | TFolderId,
  ) => Promise<{ entityId: TAppointmentTypeId; ruleSetId: TRuleSetId }>;
  deleteAppointmentType: (args: {
    appointmentTypeId: TAppointmentTypeId;
    appointmentTypeLineageKey: TAppointmentTypeLineageKey;
  }) => Promise<void>;
  findExistingByLineage: (
    lineageKey: TAppointmentTypeLineageKey,
    ruleSetId: TRuleSetId,
  ) => TRestoredAppointmentType | undefined;
  hasFolder: (folderId: TFolderId) => boolean;
  initialEntityId: TAppointmentTypeId;
  isMissingEntityError: (error: unknown) => boolean;
  isSameDefinition: (
    existing: TRestoredAppointmentType,
    snapshot: TSnapshot,
  ) => boolean;
  lineageKey: TAppointmentTypeLineageKey;
  resolvePractitionerIds: (
    snapshot: TSnapshot,
  ) =>
    | { ids: TPractitionerId[]; status: "ok" }
    | { message: string; status: "conflict" };
  selectedRuleSetId: () => TRuleSetId;
  snapshot: TSnapshot;
  snapshotFolderId: (snapshot: TSnapshot) => TFolderId | undefined;
  toRestoredRef: (
    snapshot: TSnapshot,
    result: { entityId: TAppointmentTypeId; ruleSetId: TRuleSetId },
    treeFolderId: null | TFolderId,
  ) => TCreateArgs;
  upsertRestoredRef: (restored: TCreateArgs) => void;
}): RuleSetReplayAdapter {
  let currentAppointmentTypeId = params.initialEntityId;

  return {
    redo: async () => {
      try {
        await params.deleteAppointmentType({
          appointmentTypeId: currentAppointmentTypeId,
          appointmentTypeLineageKey: params.lineageKey,
        });
        return { status: "applied" };
      } catch (error: unknown) {
        if (params.isMissingEntityError(error)) {
          return { status: "applied" };
        }
        return {
          message:
            error instanceof Error
              ? error.message
              : "Die Terminart konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
    undo: async () => {
      const existingByLineage = params.findExistingByLineage(
        params.lineageKey,
        params.selectedRuleSetId(),
      );
      if (existingByLineage) {
        if (params.isSameDefinition(existingByLineage, params.snapshot)) {
          currentAppointmentTypeId = existingByLineage._id;
          return { status: "applied" };
        }

        return {
          message: `[HISTORY:APPOINTMENT_TYPE_LINEAGE_CONFLICT] Die Terminart mit lineageKey ${params.lineageKey} existiert bereits, hat aber abweichende Einstellungen.`,
          status: "conflict" as const,
        };
      }

      const resolvedPractitionerIds = params.resolvePractitionerIds(
        params.snapshot,
      );
      if (resolvedPractitionerIds.status === "conflict") {
        return resolvedPractitionerIds;
      }

      const snapshotFolderId = params.snapshotFolderId(params.snapshot);
      const treeFolderId =
        snapshotFolderId && params.hasFolder(snapshotFolderId)
          ? snapshotFolderId
          : null;
      const result = await params.createAppointmentType(
        params.snapshot,
        resolvedPractitionerIds.ids,
        treeFolderId,
      );
      params.upsertRestoredRef(
        params.toRestoredRef(params.snapshot, result, treeFolderId),
      );
      currentAppointmentTypeId = result.entityId;
      return { status: "applied" };
    },
  };
}

export function recordAppointmentTypeDeleteReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, command, replay);
}
