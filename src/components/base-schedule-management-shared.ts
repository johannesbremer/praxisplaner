import { err, ok, Result } from "neverthrow";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";

import { invalidStateError } from "../utils/frontend-errors";

export interface BaseScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
  schedule?: ExtendedSchedule | undefined;
}

export interface BaseScheduleManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

export interface BaseScheduleMutationAppliedSchedule {
  breakTimes?: { end: string; start: string }[];
  dayOfWeek: number;
  endTime: string;
  entityId: Id<"baseSchedules">;
  lineageKey: Id<"baseSchedules">;
  locationId: Id<"locations">;
  locationLineageKey: Id<"locations">;
  practitionerId: Id<"practitioners">;
  practitionerLineageKey: Id<"practitioners">;
  startTime: string;
}

export interface ExtendedSchedule extends Omit<
  Doc<"baseSchedules">,
  "_creationTime"
> {
  _creationTime?: number; // Optional for synthetic objects
  // Group editing metadata - computed fields not in schema
  _groupDaysOfWeek?: number[];
  _groupScheduleIds?: Id<"baseSchedules">[];
  _isGroup?: boolean;
}

export type LocationMatchEntity = Pick<Doc<"locations">, "_id" | "name"> & {
  lineageKey: Id<"locations">;
};

export type MaterializedSchedule = Doc<"baseSchedules"> & {
  _creationTime: number;
  lineageKey: Id<"baseSchedules">;
};

export type PractitionerMatchEntity = Pick<
  Doc<"practitioners">,
  "_id" | "name"
> & {
  lineageKey: Id<"practitioners">;
};
export interface SchedulePayload {
  breakTimes?: { end: string; start: string }[];
  dayOfWeek: number;
  endTime: string;
  lineageKey: Id<"baseSchedules">;
  locationLineageId: Id<"locations">;
  practitionerLineageId: Id<"practitioners">;
  startTime: string;
}

export interface SchedulesRef {
  current: MaterializedSchedule[];
}

export const requireLineageKey = <TId extends string>(
  lineageKey: TId | undefined,
  params: {
    entityId: string;
    entityType: "Arbeitszeit" | "Behandler" | "Standort";
  },
): Result<TId, ReturnType<typeof invalidStateError>> => {
  if (!lineageKey) {
    return err(
      invalidStateError(
        `[HISTORY:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entityId} hat keinen lineageKey.`,
        "requireLineageKey",
      ),
    );
  }
  return ok(lineageKey);
};

export const resolvePractitionerLineageId = (
  practitionerId: Id<"practitioners">,
  practitioners: PractitionerMatchEntity[] | undefined,
): Result<Id<"practitioners">, ReturnType<typeof invalidStateError>> => {
  const practitioner = practitioners?.find(
    (entry) => entry._id === practitionerId,
  );
  if (!practitioner) {
    return err(
      invalidStateError(
        `[HISTORY:PRACTITIONER_NOT_FOUND] Behandler ${practitionerId} konnte im aktuellen Regelset nicht aufgelöst werden.`,
        "resolvePractitionerLineageId",
      ),
    );
  }
  return requireLineageKey(practitioner.lineageKey, {
    entityId: practitioner._id,
    entityType: "Behandler",
  });
};

export const resolveLocationLineageId = (
  locationId: Id<"locations">,
  locations: LocationMatchEntity[] | undefined,
): Result<Id<"locations">, ReturnType<typeof invalidStateError>> => {
  const location = locations?.find((entry) => entry._id === locationId);
  if (!location) {
    return err(
      invalidStateError(
        `[HISTORY:LOCATION_NOT_FOUND] Standort ${locationId} konnte im aktuellen Regelset nicht aufgelöst werden.`,
        "resolveLocationLineageId",
      ),
    );
  }
  return requireLineageKey(location.lineageKey, {
    entityId: location._id,
    entityType: "Standort",
  });
};

export const resolvePractitionerIdByLineage = (
  practitionerLineageId: Id<"practitioners">,
  practitioners: PractitionerMatchEntity[] | undefined,
): Result<Id<"practitioners">, ReturnType<typeof invalidStateError>> => {
  const practitioner = practitioners?.find(
    (entry) => entry.lineageKey === practitionerLineageId,
  );
  if (!practitioner) {
    return err(
      invalidStateError(
        `[HISTORY:PRACTITIONER_LINEAGE_NOT_FOUND] Behandler mit lineageKey ${practitionerLineageId} konnte im aktuellen Regelset nicht aufgelöst werden.`,
        "resolvePractitionerIdByLineage",
      ),
    );
  }
  return ok(practitioner._id);
};

export const resolveLocationIdByLineage = (
  locationLineageId: Id<"locations">,
  locations: LocationMatchEntity[] | undefined,
): Result<Id<"locations">, ReturnType<typeof invalidStateError>> => {
  const location = locations?.find(
    (entry) => entry.lineageKey === locationLineageId,
  );
  if (!location) {
    return err(
      invalidStateError(
        `[HISTORY:LOCATION_LINEAGE_NOT_FOUND] Standort mit lineageKey ${locationLineageId} konnte im aktuellen Regelset nicht aufgelöst werden.`,
        "resolveLocationIdByLineage",
      ),
    );
  }
  return ok(location._id);
};

export const matchesSchedulePayload = (
  schedule: Doc<"baseSchedules">,
  payload: SchedulePayload,
): boolean =>
  requireLineageKey(schedule.lineageKey, {
    entityId: schedule._id,
    entityType: "Arbeitszeit",
  }).match(
    (lineageKey) => lineageKey === payload.lineageKey,
    () => false,
  );

export const toSchedulePayload = (
  schedule: Doc<"baseSchedules">,
  practitioners: PractitionerMatchEntity[] | undefined,
  locations: LocationMatchEntity[] | undefined,
): Result<SchedulePayload, ReturnType<typeof invalidStateError>> =>
  requireLineageKey(schedule.lineageKey, {
    entityId: schedule._id,
    entityType: "Arbeitszeit",
  }).andThen((lineageKey) =>
    resolveLocationLineageId(schedule.locationId, locations).andThen(
      (locationLineageId) =>
        resolvePractitionerLineageId(
          schedule.practitionerId,
          practitioners,
        ).map((practitionerLineageId) => ({
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          lineageKey,
          locationLineageId,
          practitionerLineageId,
          startTime: schedule.startTime,
        })),
    ),
  );

export const buildLocationLineageByIdMap = (
  locations: LocationMatchEntity[] | undefined,
): Result<
  ReadonlyMap<Id<"locations">, Id<"locations">>,
  ReturnType<typeof invalidStateError>
> =>
  Result.combine(
    (locations ?? []).map((location) =>
      requireLineageKey(location.lineageKey, {
        entityId: location._id,
        entityType: "Standort",
      }).map((lineageKey) => [location._id, lineageKey] as const),
    ),
  ).map((entries) => new Map(entries));

export const buildPractitionerLineageByIdMap = (
  practitioners: PractitionerMatchEntity[] | undefined,
): Result<
  ReadonlyMap<Id<"practitioners">, Id<"practitioners">>,
  ReturnType<typeof invalidStateError>
> =>
  Result.combine(
    (practitioners ?? []).map((practitioner) =>
      requireLineageKey(practitioner.lineageKey, {
        entityId: practitioner._id,
        entityType: "Behandler",
      }).map((lineageKey) => [practitioner._id, lineageKey] as const),
    ),
  ).map((entries) => new Map(entries));

export const resolveLocationLineageIdFromSnapshot = (
  locationId: Id<"locations">,
  locationLineageById: ReadonlyMap<Id<"locations">, Id<"locations">>,
): Result<Id<"locations">, ReturnType<typeof invalidStateError>> => {
  const locationLineageId = locationLineageById.get(locationId);
  if (!locationLineageId) {
    return err(
      invalidStateError(
        `[HISTORY:LOCATION_LINEAGE_SNAPSHOT_MISSING] Standort ${locationId} fehlt im Lineage-Snapshot für diese Aktion.`,
        "resolveLocationLineageIdFromSnapshot",
      ),
    );
  }
  return ok(locationLineageId);
};

export const resolvePractitionerLineageIdFromSnapshot = (
  practitionerId: Id<"practitioners">,
  practitionerLineageById: ReadonlyMap<
    Id<"practitioners">,
    Id<"practitioners">
  >,
): Result<Id<"practitioners">, ReturnType<typeof invalidStateError>> => {
  const practitionerLineageId = practitionerLineageById.get(practitionerId);
  if (!practitionerLineageId) {
    return err(
      invalidStateError(
        `[HISTORY:PRACTITIONER_LINEAGE_SNAPSHOT_MISSING] Behandler ${practitionerId} fehlt im Lineage-Snapshot für diese Aktion.`,
        "resolvePractitionerLineageIdFromSnapshot",
      ),
    );
  }
  return ok(practitionerLineageId);
};

export const toSchedulePayloadFromLineageSnapshot = (
  schedule: Doc<"baseSchedules">,
  practitionerLineageById: ReadonlyMap<
    Id<"practitioners">,
    Id<"practitioners">
  >,
  locationLineageById: ReadonlyMap<Id<"locations">, Id<"locations">>,
): Result<SchedulePayload, ReturnType<typeof invalidStateError>> =>
  requireLineageKey(schedule.lineageKey, {
    entityId: schedule._id,
    entityType: "Arbeitszeit",
  }).andThen((lineageKey) =>
    resolveLocationLineageIdFromSnapshot(
      schedule.locationId,
      locationLineageById,
    ).andThen((locationLineageId) =>
      resolvePractitionerLineageIdFromSnapshot(
        schedule.practitionerId,
        practitionerLineageById,
      ).map((practitionerLineageId) => ({
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        lineageKey,
        locationLineageId,
        practitionerLineageId,
        startTime: schedule.startTime,
      })),
    ),
  );

export const toMutationSchedulePayload = (
  payload: SchedulePayload,
  practitioners: PractitionerMatchEntity[] | undefined,
  locations: LocationMatchEntity[] | undefined,
): Result<
  {
    breakTimes?: { end: string; start: string }[];
    dayOfWeek: number;
    endTime: string;
    lineageKey: Id<"baseSchedules">;
    locationId: Id<"locations">;
    practitionerId: Id<"practitioners">;
    startTime: string;
  },
  ReturnType<typeof invalidStateError>
> =>
  resolveLocationIdByLineage(payload.locationLineageId, locations).andThen(
    (locationId) =>
      resolvePractitionerIdByLineage(
        payload.practitionerLineageId,
        practitioners,
      ).map((practitionerId) => ({
        ...(payload.breakTimes && { breakTimes: payload.breakTimes }),
        dayOfWeek: payload.dayOfWeek,
        endTime: payload.endTime,
        lineageKey: payload.lineageKey,
        locationId,
        practitionerId,
        startTime: payload.startTime,
      })),
  );

export interface BatchCreateScheduleInput {
  breakTimes?: { end: string; start: string }[];
  dayOfWeek: number;
  endTime: string;
  lineageKey?: Id<"baseSchedules">;
  locationId: Id<"locations">;
  practitionerId: Id<"practitioners">;
  startTime: string;
}

export const toBatchCreateScheduleInput = (
  payload: SchedulePayload,
  practitioners: PractitionerMatchEntity[] | undefined,
  locations: LocationMatchEntity[] | undefined,
): Result<BatchCreateScheduleInput, ReturnType<typeof invalidStateError>> =>
  toMutationSchedulePayload(payload, practitioners, locations).map((value) => ({
    ...value,
    lineageKey: payload.lineageKey,
  }));

export const scheduleDocFromInput = (params: {
  entityId: Id<"baseSchedules">;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  schedule: {
    breakTimes?: { end: string; start: string }[];
    dayOfWeek: number;
    endTime: string;
    lineageKey?: Id<"baseSchedules">;
    locationId: Id<"locations">;
    practitionerId: Id<"practitioners">;
    startTime: string;
  };
}): MaterializedSchedule => {
  const lineageKey = params.schedule.lineageKey ?? params.entityId;
  return {
    _creationTime: Date.now(),
    _id: params.entityId,
    ...(params.schedule.breakTimes
      ? { breakTimes: params.schedule.breakTimes }
      : {}),
    dayOfWeek: params.schedule.dayOfWeek,
    endTime: params.schedule.endTime,
    lineageKey,
    locationId: params.schedule.locationId,
    practiceId: params.practiceId,
    practitionerId: params.schedule.practitionerId,
    ruleSetId: params.ruleSetId,
    startTime: params.schedule.startTime,
  };
};

export const toSchedulePayloadFromAppliedSchedule = (
  schedule: BaseScheduleMutationAppliedSchedule,
): SchedulePayload => ({
  ...(schedule.breakTimes ? { breakTimes: schedule.breakTimes } : {}),
  dayOfWeek: schedule.dayOfWeek,
  endTime: schedule.endTime,
  lineageKey: schedule.lineageKey,
  locationLineageId: schedule.locationLineageKey,
  practitionerLineageId: schedule.practitionerLineageKey,
  startTime: schedule.startTime,
});

export const removeSchedulesFromRef = (
  schedulesRef: SchedulesRef,
  lineageKeys: Id<"baseSchedules">[],
) => {
  if (lineageKeys.length === 0) {
    return;
  }
  const lineageKeySet = new Set(lineageKeys);
  schedulesRef.current = schedulesRef.current.filter(
    (scheduleItem) => !lineageKeySet.has(scheduleItem.lineageKey),
  );
};

export const upsertSchedulesInRef = (
  schedulesRef: SchedulesRef,
  nextSchedules: MaterializedSchedule[],
) => {
  if (nextSchedules.length === 0) {
    return;
  }
  const next = [...schedulesRef.current];
  for (const scheduleItem of nextSchedules) {
    const matchIndex = next.findIndex(
      (existing) =>
        existing._id === scheduleItem._id ||
        existing.lineageKey === scheduleItem.lineageKey,
    );
    if (matchIndex === -1) {
      next.push(scheduleItem);
    } else {
      next[matchIndex] = scheduleItem;
    }
  }
  schedulesRef.current = next;
};

export const applyBatchCreateResultToRef = (params: {
  createdScheduleIds: Id<"baseSchedules">[];
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  schedules: BatchCreateScheduleInput[];
  schedulesRef: SchedulesRef;
}) => {
  upsertSchedulesInRef(
    params.schedulesRef,
    params.schedules.flatMap((scheduleItem, index) => {
      const createdId = params.createdScheduleIds[index];
      if (!createdId) {
        return [];
      }
      return [
        scheduleDocFromInput({
          entityId: createdId,
          practiceId: params.practiceId,
          ruleSetId: params.ruleSetId,
          schedule: scheduleItem,
        }),
      ];
    }),
  );
};

export const applyReplaceResultToRef = (params: {
  appliedSchedules: BaseScheduleMutationAppliedSchedule[];
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  schedulesRef: SchedulesRef;
}) => {
  upsertSchedulesInRef(
    params.schedulesRef,
    params.appliedSchedules.map((appliedSchedule) =>
      scheduleDocFromInput({
        entityId: appliedSchedule.entityId,
        practiceId: params.practiceId,
        ruleSetId: params.ruleSetId,
        schedule: appliedSchedule,
      }),
    ),
  );
};

export const toCreatedSchedulePayload = (
  createData: {
    breakTimes?: { end: string; start: string }[];
    dayOfWeek: number;
    endTime: string;
    locationId: Id<"locations">;
    practitionerId: Id<"practitioners">;
    startTime: string;
  },
  lineageKey: Id<"baseSchedules">,
  practitionerLineageById: ReadonlyMap<
    Id<"practitioners">,
    Id<"practitioners">
  >,
  locationLineageById: ReadonlyMap<Id<"locations">, Id<"locations">>,
): Result<SchedulePayload, ReturnType<typeof invalidStateError>> =>
  resolveLocationLineageIdFromSnapshot(
    createData.locationId,
    locationLineageById,
  ).andThen((locationLineageId) =>
    resolvePractitionerLineageIdFromSnapshot(
      createData.practitionerId,
      practitionerLineageById,
    ).map((practitionerLineageId) => ({
      ...(createData.breakTimes && { breakTimes: createData.breakTimes }),
      dayOfWeek: createData.dayOfWeek,
      endTime: createData.endTime,
      lineageKey,
      locationLineageId,
      practitionerLineageId,
      startTime: createData.startTime,
    })),
  );

export const isBaseScheduleMissingError = (error: unknown) =>
  error instanceof Error &&
  !/source rule set not found/i.test(error.message) &&
  /already deleted|bereits gelöscht|base schedule not found|arbeitszeit.*nicht gefunden/i.test(
    error.message,
  );

// Helper functions
