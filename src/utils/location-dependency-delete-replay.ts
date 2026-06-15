import type {
  RecordRuleSetCommand,
  RuleSetCommandDescription,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

import { recordRuleSetCommand } from "./rule-set-command-executor";

export interface LocationDependencyDeleteSnapshot<
  TLocationId extends string,
  TLocationLineageKey extends string,
  TScheduleLineageKey extends string,
  TPractitionerLineageKey extends string,
> {
  baseSchedules: {
    breakTimes?: { end: string; start: string }[];
    dayOfWeek: number;
    endTime: string;
    lineageKey: TScheduleLineageKey;
    practitionerLineageKey: TPractitionerLineageKey;
    startTime: string;
  }[];
  location: {
    id?: TLocationId;
    lineageKey: TLocationLineageKey;
    name: string;
  };
}

export function createLocationDependencyDeleteReplayAdapter<
  TLocationId extends string,
  TLocationLineageKey extends string,
  TScheduleLineageKey extends string,
  TPractitionerId extends string,
  TPractitionerLineageKey extends string,
  TSchedulePayload,
>(params: {
  createBaseSchedules: (schedules: TSchedulePayload[]) => Promise<void>;
  createLocation: (snapshot: {
    lineageKey: TLocationLineageKey;
    name: string;
  }) => Promise<TLocationId>;
  deleteLocation: (args: {
    locationId: TLocationId;
    locationLineageKey: TLocationLineageKey;
  }) => Promise<void>;
  findLocationByLineage: (
    lineageKey: TLocationLineageKey,
  ) => undefined | { _id: TLocationId; name: string };
  findPractitionerByLineage: (
    lineageKey: TPractitionerLineageKey,
  ) => undefined | { _id: TPractitionerId };
  hasBaseScheduleLineage: (lineageKey: TScheduleLineageKey) => boolean;
  hasLocationName: (name: string) => boolean;
  initialEntityId: TLocationId;
  isMissingEntityError: (error: unknown) => boolean;
  snapshot: LocationDependencyDeleteSnapshot<
    TLocationId,
    TLocationLineageKey,
    TScheduleLineageKey,
    TPractitionerLineageKey
  >;
  toSchedulePayload: (params: {
    locationId: TLocationId;
    locationLineageKey: TLocationLineageKey;
    practitionerId: TPractitionerId;
    schedule: LocationDependencyDeleteSnapshot<
      TLocationId,
      TLocationLineageKey,
      TScheduleLineageKey,
      TPractitionerLineageKey
    >["baseSchedules"][number];
  }) => TSchedulePayload;
}): RuleSetReplayAdapter {
  let currentLocationId = params.initialEntityId;

  return {
    redo: async () => {
      try {
        await params.deleteLocation({
          locationId: currentLocationId,
          locationLineageKey: params.snapshot.location.lineageKey,
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
              : "Der Standort konnte nicht gelöscht werden.",
          status: "conflict" as const,
        };
      }
    },
    undo: async () => {
      const existingByLineage = params.findLocationByLineage(
        params.snapshot.location.lineageKey,
      );
      if (existingByLineage) {
        currentLocationId = existingByLineage._id;
        return { status: "applied" };
      }

      if (params.hasLocationName(params.snapshot.location.name)) {
        return {
          message: `[HISTORY:LOCATION_NAME_CONFLICT] Der Standort kann nicht wiederhergestellt werden, weil bereits ein anderer Standort mit dem Namen "${params.snapshot.location.name}" existiert.`,
          status: "conflict" as const,
        };
      }

      const restoredLocationId = await params.createLocation({
        lineageKey: params.snapshot.location.lineageKey,
        name: params.snapshot.location.name,
      });
      currentLocationId = restoredLocationId;

      const missingSchedules = params.snapshot.baseSchedules.filter(
        (schedule) => !params.hasBaseScheduleLineage(schedule.lineageKey),
      );
      if (missingSchedules.length === 0) {
        return { status: "applied" };
      }

      const schedules: TSchedulePayload[] = [];
      for (const schedule of missingSchedules) {
        const practitioner = params.findPractitionerByLineage(
          schedule.practitionerLineageKey,
        );
        if (!practitioner) {
          return {
            message: `[HISTORY:LOCATION_DELETE_PRACTITIONER_LINEAGE_MISSING] Behandler mit lineageKey ${schedule.practitionerLineageKey} konnte nicht geladen werden.`,
            status: "conflict" as const,
          };
        }
        schedules.push(
          params.toSchedulePayload({
            locationId: currentLocationId,
            locationLineageKey: params.snapshot.location.lineageKey,
            practitionerId: practitioner._id,
            schedule,
          }),
        );
      }

      await params.createBaseSchedules(schedules);
      return { status: "applied" };
    },
  };
}

export function recordLocationDependencyDeleteReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): void {
  recordRuleSetCommand(record, { ...command, replay });
}
