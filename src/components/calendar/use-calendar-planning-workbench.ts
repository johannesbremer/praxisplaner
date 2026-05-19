import type { FunctionArgs } from "convex/server";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";
import type { CalendarDayQueryArgs } from "./calendar-query-args";
import type {
  BlockedSlotDisplayOccupancyScope,
  CalendarReferenceMaps,
} from "./calendar-reference-adapters";
import type {
  CalendarAppointmentPlacement,
  CalendarAppointmentRecord,
  CalendarBlockedSlotEditorRecord,
  CalendarBlockedSlotPlacement,
  CalendarBlockedSlotRecord,
} from "./types";

import { api } from "../../../convex/_generated/api";
import {
  createCalendarPlacement,
  getCalendarResourceColumnFromOccupancy,
  getPractitionerLineageKeyFromOccupancy,
  sameCalendarOccupancyScope,
} from "../../../lib/calendar-occupancy";
import {
  createOptimisticId,
  findIdInList,
  isOptimisticId,
} from "../../utils/convex-ids";
import {
  matchesCalendarDayQueryEntity,
  shouldCollapseOptimisticReplacementInDayQuery,
} from "./calendar-day-query-membership";
import {
  getCurrentCalendarRecordById,
  hasCalendarOccupancyConflictInRecords,
  mergeCurrentConflictRecordsByIdExcluding,
} from "./calendar-planning-records";
import {
  resolveAppointmentDisplayRefs,
  resolveAppointmentLineageRefs,
  resolveAppointmentPlacementDisplayRefs,
  resolveBlockedSlotDisplayRefs,
  resolveBlockedSlotLineageRefs,
  resolveBlockedSlotPlacementDisplayRefs,
  toBlockedSlotEditorRecord,
} from "./calendar-reference-adapters";
import {
  toCalendarAppointmentRecord,
  toCalendarAppointmentResult,
  toCalendarBlockedSlotRecord,
  toCalendarBlockedSlotResult,
} from "./calendar-view-models";
import { useCalendarPlanningHistory } from "./use-calendar-planning-history";

const appointmentQueryRef = api.appointments.getCalendarDayAppointments;
const blockedSlotQueryRef = api.appointments.getCalendarDayBlockedSlots;

export type CalendarAppointmentCreateCommandArgs = Omit<
  CreateAppointmentMutationArgs,
  "calendarResourceColumn" | "locationId" | "practitionerId"
> & {
  placement: CalendarAppointmentPlacement;
};

export type CalendarAppointmentUpdateCommandArgs = Omit<
  UpdateAppointmentMutationArgs,
  "calendarResourceColumn" | "locationId" | "practitionerId"
> & {
  placement?: CalendarAppointmentPlacement;
};

interface AppointmentCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarAppointmentPlacement;
  replacesAppointmentId?: Id<"appointments">;
  start: string;
}

interface AppointmentTypeInfo {
  duration: number;
  hasFollowUpPlan: boolean;
  name: string;
}

interface BlockedSlotCandidate {
  end: string;
  isSimulation: boolean;
  placement: CalendarBlockedSlotPlacement;
  start: string;
}

interface CalendarRecordRef<T> {
  current: T;
}

type CreateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.createAppointment
>;

interface CreatedAppointmentHistoryArgs {
  appointmentId: Id<"appointments">;
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  end: CalendarAppointmentRecord["end"];
  isSimulation: boolean;
  now: number;
  patientId?: Id<"patients">;
  placement: CalendarAppointmentPlacement;
  practiceId: Id<"practices">;
  replacesAppointmentId?: Id<"appointments">;
  start: CalendarAppointmentRecord["start"];
  title: string;
  userId?: Id<"users">;
}

interface CreatedBlockedSlotHistoryArgs {
  blockedSlotId: Id<"blockedSlots">;
  end: CalendarBlockedSlotRecord["end"];
  isSimulation: boolean;
  now: number;
  placement: CalendarBlockedSlotPlacement;
  practiceId: Id<"practices">;
  replacesBlockedSlotId?: Id<"blockedSlots">;
  start: CalendarBlockedSlotRecord["start"];
  title: string;
}

type UpdateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.updateAppointment
>;

export function useCalendarPlanningWorkbench(args: {
  activeDayAppointmentMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"appointments">, CalendarAppointmentRecord>
  >;
  activeDayBlockedSlotMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"blockedSlots">, CalendarBlockedSlotRecord>
  >;
  allPracticeAppointmentMap: ReadonlyMap<
    Id<"appointments">,
    CalendarAppointmentRecord
  >;
  allPracticeAppointmentMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"appointments">, CalendarAppointmentRecord>
  >;
  allPracticeAppointmentsLoaded: boolean;
  allPracticeBlockedSlotMap: ReadonlyMap<
    Id<"blockedSlots">,
    CalendarBlockedSlotRecord
  >;
  allPracticeBlockedSlotMapRef: CalendarRecordRef<
    ReadonlyMap<Id<"blockedSlots">, CalendarBlockedSlotRecord>
  >;
  allPracticeBlockedSlotsLoaded: boolean;
  blockedSlotsQueryArgs: CalendarDayQueryArgs | null;
  calendarDayQueryArgs: CalendarDayQueryArgs | null;
  getRequiredAppointmentTypeInfo: (
    appointmentTypeId: Id<"appointmentTypes">,
    source: string,
  ) => AppointmentTypeInfo | null;
  parseZonedDateTime: (
    value: string,
    source: string,
  ) => null | ZonedDateTimeString;
  referenceMaps: CalendarReferenceMaps;
  refreshAllPracticeConflictData: () => Promise<void>;
}) {
  const {
    blockedSlotsQueryArgs,
    calendarDayQueryArgs,
    getRequiredAppointmentTypeInfo,
    parseZonedDateTime,
    referenceMaps,
    refreshAllPracticeConflictData,
  } = args;
  const appointmentHistoryDocMapRef = useRef(
    new Map<Id<"appointments">, CalendarAppointmentRecord>(),
  );
  const deletedAppointmentIdsRef = useRef(new Set<Id<"appointments">>());
  const blockedSlotHistoryDocMapRef = useRef(
    new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>(),
  );
  const deletedBlockedSlotIdsRef = useRef(new Set<Id<"blockedSlots">>());

  useEffect(() => {
    if (!args.allPracticeAppointmentsLoaded) {
      return;
    }

    for (const id of appointmentHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || args.allPracticeAppointmentMap.has(id)) {
        appointmentHistoryDocMapRef.current.delete(id);
      }
    }

    for (const appointmentId of args.allPracticeAppointmentMap.keys()) {
      deletedAppointmentIdsRef.current.delete(appointmentId);
    }
  }, [args.allPracticeAppointmentMap, args.allPracticeAppointmentsLoaded]);

  useEffect(() => {
    if (!args.allPracticeBlockedSlotsLoaded) {
      return;
    }

    for (const id of blockedSlotHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || args.allPracticeBlockedSlotMap.has(id)) {
        blockedSlotHistoryDocMapRef.current.delete(id);
      }
    }

    for (const blockedSlotId of args.allPracticeBlockedSlotMap.keys()) {
      deletedBlockedSlotIdsRef.current.delete(blockedSlotId);
    }
  }, [args.allPracticeBlockedSlotMap, args.allPracticeBlockedSlotsLoaded]);

  const getAppointmentHistoryDoc = useCallback(
    (id: Id<"appointments">) => {
      if (deletedAppointmentIdsRef.current.has(id)) {
        return;
      }

      return (
        appointmentHistoryDocMapRef.current.get(id) ??
        args.activeDayAppointmentMapRef.current.get(id) ??
        args.allPracticeAppointmentMapRef.current.get(id)
      );
    },
    [args.activeDayAppointmentMapRef, args.allPracticeAppointmentMapRef],
  );

  const getCurrentAppointmentDoc = useCallback(
    (id: Id<"appointments">) =>
      getCurrentCalendarRecordById({
        activeDayMap: args.activeDayAppointmentMapRef.current,
        allPracticeMap: args.allPracticeAppointmentMapRef.current,
        deletedIds: deletedAppointmentIdsRef.current,
        historyMap: appointmentHistoryDocMapRef.current,
        id,
      }),
    [args.activeDayAppointmentMapRef, args.allPracticeAppointmentMapRef],
  );

  const getBlockedSlotHistoryDoc = useCallback(
    (id: Id<"blockedSlots">) => {
      if (deletedBlockedSlotIdsRef.current.has(id)) {
        return;
      }

      return (
        blockedSlotHistoryDocMapRef.current.get(id) ??
        args.activeDayBlockedSlotMapRef.current.get(id) ??
        args.allPracticeBlockedSlotMapRef.current.get(id)
      );
    },
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const getCurrentBlockedSlotDoc = useCallback(
    (id: Id<"blockedSlots">) =>
      getCurrentCalendarRecordById({
        activeDayMap: args.activeDayBlockedSlotMapRef.current,
        allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
        deletedIds: deletedBlockedSlotIdsRef.current,
        historyMap: blockedSlotHistoryDocMapRef.current,
        id,
      }),
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const resolveBlockedSlotId = useCallback(
    (blockedSlotId: string): Id<"blockedSlots"> | undefined => {
      return findIdInList(
        [
          ...blockedSlotHistoryDocMapRef.current.keys(),
          ...args.activeDayBlockedSlotMapRef.current.keys(),
          ...args.allPracticeBlockedSlotMapRef.current.keys(),
        ],
        blockedSlotId,
      );
    },
    [args.activeDayBlockedSlotMapRef, args.allPracticeBlockedSlotMapRef],
  );

  const rememberAppointmentHistoryDoc = useCallback(
    (appointment: CalendarAppointmentRecord) => {
      if (isOptimisticId(appointment._id)) {
        return;
      }
      deletedAppointmentIdsRef.current.delete(appointment._id);
      appointmentHistoryDocMapRef.current.set(appointment._id, appointment);
    },
    [],
  );

  const rememberCreatedAppointmentHistoryDoc = useCallback(
    (args: CreatedAppointmentHistoryArgs) => {
      rememberAppointmentHistoryDoc({
        _creationTime: args.now,
        _id: args.appointmentId,
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        appointmentTypeTitle: args.appointmentTypeTitle,
        createdAt: BigInt(args.now),
        end: args.end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(args.now),
        placement: args.placement,
        ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
        practiceId: args.practiceId,
        ...(args.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: args.replacesAppointmentId }),
        start: args.start,
        title: args.title,
        ...(args.userId === undefined ? {} : { userId: args.userId }),
      });
    },
    [rememberAppointmentHistoryDoc],
  );

  const forgetAppointmentHistoryDoc = useCallback((id: Id<"appointments">) => {
    deletedAppointmentIdsRef.current.add(id);
    appointmentHistoryDocMapRef.current.delete(id);
  }, []);

  const rememberBlockedSlotHistoryDoc = useCallback(
    (blockedSlot: CalendarBlockedSlotRecord) => {
      if (isOptimisticId(blockedSlot._id)) {
        return;
      }
      deletedBlockedSlotIdsRef.current.delete(blockedSlot._id);
      blockedSlotHistoryDocMapRef.current.set(blockedSlot._id, blockedSlot);
    },
    [],
  );

  const rememberCreatedBlockedSlotHistoryDoc = useCallback(
    (args: CreatedBlockedSlotHistoryArgs) => {
      rememberBlockedSlotHistoryDoc({
        _creationTime: args.now,
        _id: args.blockedSlotId,
        createdAt: BigInt(args.now),
        end: args.end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(args.now),
        placement: args.placement,
        practiceId: args.practiceId,
        ...(args.replacesBlockedSlotId === undefined
          ? {}
          : { replacesBlockedSlotId: args.replacesBlockedSlotId }),
        start: args.start,
        title: args.title,
      });
    },
    [rememberBlockedSlotHistoryDoc],
  );

  const forgetBlockedSlotHistoryDoc = useCallback((id: Id<"blockedSlots">) => {
    deletedBlockedSlotIdsRef.current.add(id);
    blockedSlotHistoryDocMapRef.current.delete(id);
  }, []);

  const toEpochMilliseconds = useCallback(
    (iso: string) => Temporal.ZonedDateTime.from(iso).epochMilliseconds,
    [],
  );

  const hasAppointmentConflict = useCallback(
    (candidate: AppointmentCandidate, excludeId?: Id<"appointments">) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeAppointmentMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      args.allPracticeAppointmentMapRef,
      args.allPracticeBlockedSlotMapRef,
      toEpochMilliseconds,
    ],
  );

  const hasBlockedSlotConflict = useCallback(
    (candidate: BlockedSlotCandidate, excludeId?: Id<"blockedSlots">) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeAppointmentMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: args.allPracticeBlockedSlotMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      args.allPracticeAppointmentMapRef,
      args.allPracticeBlockedSlotMapRef,
      toEpochMilliseconds,
    ],
  );

  const getAppointmentCreationEnd = useCallback(
    (args: { durationMinutes: number; start: string }): string => {
      return Temporal.ZonedDateTime.from(args.start)
        .add({ minutes: args.durationMinutes })
        .toString();
    },
    [],
  );

  const rememberCreatedAppointmentFromStrings = useCallback(
    (createdArgs: {
      appointmentTypeLineageKey: AppointmentTypeLineageKey;
      appointmentTypeTitle: string;
      createdId: Id<"appointments">;
      createEnd: string;
      createStart: string;
      isSimulation: boolean;
      patientId?: Id<"patients">;
      placement: CalendarAppointmentPlacement;
      practiceId: Id<"practices">;
      replacesAppointmentId?: Id<"appointments">;
      title: string;
      userId?: Id<"users">;
    }): boolean => {
      const start = parseZonedDateTime(
        createdArgs.createStart,
        "useCalendarPlanningWorkbench.rememberCreatedAppointmentFromStrings.start",
      );
      const end = parseZonedDateTime(
        createdArgs.createEnd,
        "useCalendarPlanningWorkbench.rememberCreatedAppointmentFromStrings.end",
      );
      if (!start || !end) {
        return false;
      }

      rememberCreatedAppointmentHistoryDoc({
        appointmentId: createdArgs.createdId,
        appointmentTypeLineageKey: createdArgs.appointmentTypeLineageKey,
        appointmentTypeTitle: createdArgs.appointmentTypeTitle,
        end,
        isSimulation: createdArgs.isSimulation,
        now: Date.now(),
        placement: createdArgs.placement,
        ...(createdArgs.patientId === undefined
          ? {}
          : { patientId: createdArgs.patientId }),
        practiceId: createdArgs.practiceId,
        ...(createdArgs.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: createdArgs.replacesAppointmentId }),
        start,
        title: createdArgs.title,
        ...(createdArgs.userId === undefined
          ? {}
          : { userId: createdArgs.userId }),
      });
      return true;
    },
    [parseZonedDateTime, rememberCreatedAppointmentHistoryDoc],
  );

  const getBlockedSlotEditorData = useCallback(
    (
      blockedSlotId: string,
    ): null | {
      blockedSlotId: Id<"blockedSlots">;
      currentTitle: string;
      slotData: CalendarBlockedSlotEditorRecord;
      slotIsSimulation: boolean;
    } => {
      const resolvedBlockedSlotId = resolveBlockedSlotId(blockedSlotId);
      if (!resolvedBlockedSlotId) {
        return null;
      }

      const blockedSlot = getBlockedSlotHistoryDoc(resolvedBlockedSlotId);
      if (!blockedSlot) {
        return null;
      }

      const slotData = toBlockedSlotEditorRecord(blockedSlot, referenceMaps);
      if (!slotData) {
        return null;
      }

      return {
        blockedSlotId: resolvedBlockedSlotId,
        currentTitle: blockedSlot.title,
        slotData,
        slotIsSimulation: blockedSlot.isSimulation ?? false,
      };
    },
    [referenceMaps, getBlockedSlotHistoryDoc, resolveBlockedSlotId],
  );

  const { pushHistoryAction } = useCalendarPlanningHistory();

  const getLocationLineageKeyForDisplayId = useCallback(
    (locationId: Id<"locations">) =>
      referenceMaps.locationLineageKeyById.get(locationId),
    [referenceMaps],
  );

  const getPractitionerLineageKeyForDisplayId = useCallback(
    (practitionerId: Id<"practitioners">) =>
      referenceMaps.practitionerLineageKeyById.get(practitionerId),
    [referenceMaps],
  );

  const resolveAppointmentReferenceDisplayIds = useCallback(
    (refs: {
      appointmentTypeLineageKey: AppointmentTypeLineageKey;
      placement: CalendarAppointmentPlacement;
    }) => resolveAppointmentDisplayRefs(refs, referenceMaps),
    [referenceMaps],
  );

  const resolveAppointmentReferenceLineageKeys = useCallback(
    (refs: {
      appointmentTypeId: Id<"appointmentTypes">;
      locationId: Id<"locations">;
      occupancyScope:
        | {
            calendarResourceColumn: "ekg" | "labor";
            kind: "resource";
          }
        | {
            kind: "practitioner";
            practitionerId: Id<"practitioners">;
          };
    }) => resolveAppointmentLineageRefs(refs, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceDisplayIds = useCallback(
    (refs: CalendarBlockedSlotPlacement) =>
      resolveBlockedSlotDisplayRefs(refs, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceLineageKeys = useCallback(
    (refs: {
      locationId: Id<"locations">;
      occupancyScope:
        | { kind: "location-wide" }
        | { kind: "practitioner"; practitionerId: Id<"practitioners"> };
    }) => resolveBlockedSlotLineageRefs(refs, referenceMaps),
    [referenceMaps],
  );

  const ensureLatestConflictData = useCallback(async () => {
    await refreshAllPracticeConflictData();
  }, [refreshAllPracticeConflictData]);

  // Mutations
  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useMutation(
    api.appointments.updateAppointment,
  );
  const updateSimulationAppointmentMutation = useMutation(
    api.appointments.updateSimulationAppointment,
  );
  const updateVacationReassignmentAppointmentMutation = useMutation(
    api.appointments.updateVacationReassignmentAppointment,
  );
  const deleteAppointmentMutation = useMutation(
    api.appointments.deleteAppointment,
  );
  const createBlockedSlotMutation = useMutation(
    api.appointments.createBlockedSlot,
  );
  const deleteBlockedSlotMutation = useMutation(
    api.appointments.deleteBlockedSlot,
  );
  const updateBlockedSlotMutation = useMutation(
    api.appointments.updateBlockedSlot,
  );

  const createAppointmentMutationArgsFromCommand = useCallback(
    (
      commandArgs: CalendarAppointmentCreateCommandArgs,
    ): CreateAppointmentMutationArgs | null => {
      const { placement, ...rest } = commandArgs;
      const displayRefs = resolveAppointmentPlacementDisplayRefs(
        placement,
        referenceMaps,
      );
      if (displayRefs === null) {
        return null;
      }

      return {
        ...rest,
        locationId: displayRefs.locationId,
        ...(displayRefs.occupancyScope.kind === "resource"
          ? {
              calendarResourceColumn:
                displayRefs.occupancyScope.calendarResourceColumn,
            }
          : { practitionerId: displayRefs.occupancyScope.practitionerId }),
      };
    },
    [referenceMaps],
  );

  const updateAppointmentMutationArgsFromCommand = useCallback(
    (
      commandArgs: CalendarAppointmentUpdateCommandArgs,
    ): null | UpdateAppointmentMutationArgs => {
      const { placement, ...rest } = commandArgs;
      if (placement === undefined) {
        return rest;
      }

      const displayRefs = resolveAppointmentPlacementDisplayRefs(
        placement,
        referenceMaps,
      );
      if (displayRefs === null) {
        return null;
      }

      return {
        ...rest,
        locationId: displayRefs.locationId,
        ...(displayRefs.occupancyScope.kind === "resource"
          ? {
              calendarResourceColumn:
                displayRefs.occupancyScope.calendarResourceColumn,
            }
          : {
              calendarResourceColumn: null,
              practitionerId: displayRefs.occupancyScope.practitionerId,
            }),
      };
    },
    [referenceMaps],
  );

  const runCreateAppointmentInternal = useCallback(
    async (args: Parameters<typeof createAppointmentMutation>[0]) => {
      return await createAppointmentMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!calendarDayQueryArgs) {
            return;
          }
          const existingAppointments = localStore.getQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
          );

          if (!existingAppointments) {
            return;
          }

          const now = Date.now();
          const tempId = createOptimisticId<"appointments">();

          const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
            optimisticArgs.appointmentTypeId,
            "useCalendarPlanningWorkbench.optimisticCreate",
          );
          if (!appointmentTypeInfo) {
            return;
          }
          if (
            optimisticArgs.calendarResourceColumn === undefined &&
            optimisticArgs.practitionerId === undefined
          ) {
            return;
          }
          let optimisticDisplayOccupancyScope:
            | { calendarResourceColumn: "ekg" | "labor"; kind: "resource" }
            | { kind: "practitioner"; practitionerId: Id<"practitioners"> };
          if (optimisticArgs.calendarResourceColumn === undefined) {
            const practitionerId = optimisticArgs.practitionerId;
            if (practitionerId === undefined) {
              return;
            }
            optimisticDisplayOccupancyScope = {
              kind: "practitioner",
              practitionerId,
            };
          } else {
            optimisticDisplayOccupancyScope = {
              calendarResourceColumn: optimisticArgs.calendarResourceColumn,
              kind: "resource",
            };
          }
          const lineageRefs = resolveAppointmentReferenceLineageKeys({
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            locationId: optimisticArgs.locationId,
            occupancyScope: optimisticDisplayOccupancyScope,
          });
          if (!lineageRefs) {
            return;
          }
          const optimisticEnd = getAppointmentCreationEnd({
            durationMinutes: appointmentTypeInfo.duration,
            start: optimisticArgs.start,
          });
          const typedStart = parseZonedDateTime(
            optimisticArgs.start,
            "useCalendarPlanningWorkbench.optimisticCreate.start",
          );
          const typedEnd = parseZonedDateTime(
            optimisticEnd,
            "useCalendarPlanningWorkbench.optimisticCreate.end",
          );
          if (!typedStart || !typedEnd) {
            return;
          }

          const newAppointmentRecord: CalendarAppointmentRecord = {
            _creationTime: now,
            _id: tempId,
            appointmentTypeLineageKey: lineageRefs.appointmentTypeLineageKey,
            appointmentTypeTitle: appointmentTypeInfo.name,
            createdAt: BigInt(now),
            end: typedEnd,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            placement: lineageRefs.placement,
            practiceId: optimisticArgs.practiceId,
            start: typedStart,
            title: optimisticArgs.title,
          };

          if (optimisticArgs.patientId !== undefined) {
            newAppointmentRecord.patientId = optimisticArgs.patientId;
          }

          if (optimisticArgs.userId !== undefined) {
            newAppointmentRecord.userId = optimisticArgs.userId;
          }

          if (optimisticArgs.replacesAppointmentId !== undefined) {
            newAppointmentRecord.replacesAppointmentId =
              optimisticArgs.replacesAppointmentId;
          }
          const newAppointment = toCalendarAppointmentResult({
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
            record: newAppointmentRecord,
          });

          const shouldCollapseReplacement =
            optimisticArgs.replacesAppointmentId !== undefined &&
            shouldCollapseOptimisticReplacementInDayQuery({
              isSimulation: newAppointment.isSimulation === true,
              scope: calendarDayQueryArgs.scope,
            });
          const baseList = shouldCollapseReplacement
            ? existingAppointments.filter(
                (apt) => apt._id !== optimisticArgs.replacesAppointmentId,
              )
            : existingAppointments;
          const shouldAppend = matchesCalendarDayQueryEntity(
            calendarDayQueryArgs,
            newAppointment,
          );
          if (baseList === existingAppointments && !shouldAppend) {
            return;
          }

          localStore.setQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
            shouldAppend ? [...baseList, newAppointment] : baseList,
          );
        },
      )(args);
    },
    [
      calendarDayQueryArgs,
      createAppointmentMutation,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      parseZonedDateTime,
      resolveAppointmentReferenceLineageKeys,
    ],
  );

  const applyOptimisticAppointmentUpdate = useCallback(
    (
      localStore: Parameters<
        Parameters<typeof updateAppointmentMutation.withOptimisticUpdate>[0]
      >[0],
      optimisticArgs: Parameters<typeof updateAppointmentMutation>[0],
    ) => {
      if (!calendarDayQueryArgs) {
        return;
      }
      const existingAppointments = localStore.getQuery(
        appointmentQueryRef,
        calendarDayQueryArgs,
      );
      if (!existingAppointments) {
        return;
      }

      const now = Date.now();
      const updatedAppointments = existingAppointments.map((appointment) => {
        if (appointment._id !== optimisticArgs.id) {
          return appointment;
        }

        const currentRecord = toCalendarAppointmentRecord(appointment);

        const nextStart =
          optimisticArgs.start === undefined
            ? undefined
            : parseZonedDateTime(
                optimisticArgs.start,
                "useCalendarPlanningWorkbench.optimisticUpdate.start",
              );
        const nextEnd =
          optimisticArgs.end === undefined
            ? undefined
            : parseZonedDateTime(
                optimisticArgs.end,
                "useCalendarPlanningWorkbench.optimisticUpdate.end",
              );
        if (
          (optimisticArgs.start !== undefined && nextStart === null) ||
          (optimisticArgs.end !== undefined && nextEnd === null)
        ) {
          return appointment;
        }

        const timeUpdates: Partial<
          Pick<CalendarAppointmentRecord, "end" | "start">
        > = {};
        if (nextStart !== undefined && nextStart !== null) {
          timeUpdates.start = nextStart;
        }
        if (nextEnd !== undefined && nextEnd !== null) {
          timeUpdates.end = nextEnd;
        }

        const nextDisplayOccupancyScope:
          | { calendarResourceColumn: "ekg" | "labor"; kind: "resource" }
          | { kind: "practitioner"; practitionerId: Id<"practitioners"> } =
          optimisticArgs.calendarResourceColumn === undefined
            ? optimisticArgs.practitionerId === undefined
              ? appointment.practitionerId === undefined
                ? {
                    calendarResourceColumn:
                      getCalendarResourceColumnFromOccupancy(
                        currentRecord.placement.occupancyScope,
                      ) ?? "ekg",
                    kind: "resource",
                  }
                : {
                    kind: "practitioner",
                    practitionerId: appointment.practitionerId,
                  }
              : {
                  kind: "practitioner" as const,
                  practitionerId: optimisticArgs.practitionerId,
                }
            : optimisticArgs.calendarResourceColumn === null
              ? appointment.practitionerId === undefined
                ? {
                    calendarResourceColumn:
                      getCalendarResourceColumnFromOccupancy(
                        currentRecord.placement.occupancyScope,
                      ) ?? "ekg",
                    kind: "resource",
                  }
                : {
                    kind: "practitioner",
                    practitionerId: appointment.practitionerId,
                  }
              : {
                  calendarResourceColumn: optimisticArgs.calendarResourceColumn,
                  kind: "resource" as const,
                };
        const lineageRefs =
          optimisticArgs.locationId === undefined &&
          optimisticArgs.practitionerId === undefined &&
          optimisticArgs.calendarResourceColumn === undefined
            ? null
            : resolveAppointmentReferenceLineageKeys({
                appointmentTypeId: appointment.appointmentTypeId,
                locationId: optimisticArgs.locationId ?? appointment.locationId,
                occupancyScope: nextDisplayOccupancyScope,
              });

        const nextRecord: CalendarAppointmentRecord = {
          ...currentRecord,
          ...timeUpdates,
          ...(lineageRefs === null ? {} : { placement: lineageRefs.placement }),
          ...(optimisticArgs.title !== undefined && {
            title: optimisticArgs.title,
          }),
          lastModified: BigInt(now),
        };

        return toCalendarAppointmentResult({
          appointmentTypeId: appointment.appointmentTypeId,
          locationId: optimisticArgs.locationId ?? appointment.locationId,
          ...(lineageRefs?.placement.occupancyScope.kind === "practitioner"
            ? {
                practitionerId:
                  optimisticArgs.practitionerId ?? appointment.practitionerId,
              }
            : optimisticArgs.calendarResourceColumn === undefined
              ? appointment.practitionerId === undefined
                ? {}
                : { practitionerId: appointment.practitionerId }
              : {}),
          record: nextRecord,
        });
      });

      localStore.setQuery(
        appointmentQueryRef,
        calendarDayQueryArgs,
        updatedAppointments,
      );
    },
    [
      calendarDayQueryArgs,
      parseZonedDateTime,
      resolveAppointmentReferenceLineageKeys,
      updateAppointmentMutation,
    ],
  );

  const getAppointmentUpdateMutation = useCallback(
    (appointment?: CalendarAppointmentRecord) => {
      if (
        appointment?.isSimulation === true &&
        (appointment.simulationKind === "activation-reassignment" ||
          appointment.reassignmentSourceVacationLineageKey !== undefined)
      ) {
        return updateVacationReassignmentAppointmentMutation;
      }

      if (appointment?.isSimulation === true) {
        return updateSimulationAppointmentMutation;
      }

      return updateAppointmentMutation;
    },
    [
      updateAppointmentMutation,
      updateSimulationAppointmentMutation,
      updateVacationReassignmentAppointmentMutation,
    ],
  );

  const runUpdateAppointmentInternal = useCallback(
    async (args: Parameters<typeof updateAppointmentMutation>[0]) => {
      const mutation = getAppointmentUpdateMutation(
        getAppointmentHistoryDoc(args.id),
      );

      return await mutation.withOptimisticUpdate(
        applyOptimisticAppointmentUpdate,
      )(args);
    },
    [
      applyOptimisticAppointmentUpdate,
      getAppointmentHistoryDoc,
      getAppointmentUpdateMutation,
    ],
  );

  const runDeleteAppointmentInternal = useCallback(
    async (args: Parameters<typeof deleteAppointmentMutation>[0]) => {
      return await deleteAppointmentMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!calendarDayQueryArgs) {
            return;
          }
          const existingAppointments = localStore.getQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
          );
          if (!existingAppointments) {
            return;
          }

          const updatedAppointments = existingAppointments.filter(
            (appointment) => appointment._id !== optimisticArgs.id,
          );

          localStore.setQuery(
            appointmentQueryRef,
            calendarDayQueryArgs,
            updatedAppointments,
          );
        },
      )(args);
    },
    [calendarDayQueryArgs, deleteAppointmentMutation],
  );

  const runCreateBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof createBlockedSlotMutation>[0]) => {
      return await createBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          const now = Date.now();
          const tempId = createOptimisticId<"blockedSlots">();
          const lineageRefs = resolveBlockedSlotReferenceLineageKeys({
            locationId: optimisticArgs.locationId,
            occupancyScope: optimisticArgs.occupancyScope,
          });
          if (!lineageRefs) {
            return;
          }

          const newBlockedSlotRecord: CalendarBlockedSlotRecord = {
            _creationTime: now,
            _id: tempId,
            createdAt: BigInt(now),
            end: optimisticArgs.end,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            placement: lineageRefs,
            practiceId: optimisticArgs.practiceId,
            start: optimisticArgs.start,
            title: optimisticArgs.title,
          };

          if (optimisticArgs.replacesBlockedSlotId !== undefined) {
            newBlockedSlotRecord.replacesBlockedSlotId =
              optimisticArgs.replacesBlockedSlotId;
          }
          const newBlockedSlot = toCalendarBlockedSlotResult({
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.occupancyScope.kind === "practitioner"
              ? {
                  practitionerId: optimisticArgs.occupancyScope.practitionerId,
                }
              : {}),
            record: newBlockedSlotRecord,
          });

          const shouldCollapseReplacement =
            optimisticArgs.replacesBlockedSlotId !== undefined &&
            shouldCollapseOptimisticReplacementInDayQuery({
              isSimulation: newBlockedSlot.isSimulation === true,
              scope: blockedSlotsQueryArgs.scope,
            });
          const baseList = shouldCollapseReplacement
            ? existingBlockedSlots.filter(
                (slot) => slot._id !== optimisticArgs.replacesBlockedSlotId,
              )
            : existingBlockedSlots;
          const shouldAppend = matchesCalendarDayQueryEntity(
            blockedSlotsQueryArgs,
            newBlockedSlot,
          );
          if (baseList === existingBlockedSlots && !shouldAppend) {
            return;
          }

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            shouldAppend ? [...baseList, newBlockedSlot] : baseList,
          );
        },
      )(args);
    },
    [
      createBlockedSlotMutation,
      blockedSlotsQueryArgs,
      resolveBlockedSlotReferenceLineageKeys,
    ],
  );

  const runUpdateBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof updateBlockedSlotMutation>[0]) => {
      return await updateBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          const now = Date.now();

          const updatedBlockedSlots = existingBlockedSlots.map((slot) => {
            if (slot._id !== optimisticArgs.id) {
              return slot;
            }

            const currentRecord = toCalendarBlockedSlotRecord(slot);
            const nextDisplayOccupancyScope =
              optimisticArgs.occupancyScope ??
              (slot.practitionerId === undefined
                ? { kind: "location-wide" as const }
                : {
                    kind: "practitioner" as const,
                    practitionerId: slot.practitionerId,
                  });
            const lineageRefs =
              optimisticArgs.locationId === undefined &&
              optimisticArgs.occupancyScope === undefined
                ? null
                : resolveBlockedSlotReferenceLineageKeys({
                    locationId: optimisticArgs.locationId ?? slot.locationId,
                    occupancyScope: nextDisplayOccupancyScope,
                  });

            const nextRecord: CalendarBlockedSlotRecord = {
              ...currentRecord,
              ...(optimisticArgs.title !== undefined && {
                title: optimisticArgs.title,
              }),
              ...(optimisticArgs.start !== undefined && {
                start: optimisticArgs.start,
              }),
              ...(optimisticArgs.end !== undefined && {
                end: optimisticArgs.end,
              }),
              ...(lineageRefs === null ? {} : { placement: lineageRefs }),
              ...(optimisticArgs.replacesBlockedSlotId !== undefined && {
                replacesBlockedSlotId: optimisticArgs.replacesBlockedSlotId,
              }),
              ...(optimisticArgs.isSimulation !== undefined && {
                isSimulation: optimisticArgs.isSimulation,
              }),
              lastModified: BigInt(now),
            };

            return toCalendarBlockedSlotResult({
              locationId: optimisticArgs.locationId ?? slot.locationId,
              ...(nextDisplayOccupancyScope.kind === "practitioner"
                ? {
                    practitionerId: nextDisplayOccupancyScope.practitionerId,
                  }
                : {}),
              record: nextRecord,
            });
          });

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            updatedBlockedSlots,
          );
        },
      )(args);
    },
    [
      updateBlockedSlotMutation,
      blockedSlotsQueryArgs,
      resolveBlockedSlotReferenceLineageKeys,
    ],
  );

  const runDeleteBlockedSlotInternal = useCallback(
    async (args: Parameters<typeof deleteBlockedSlotMutation>[0]) => {
      return await deleteBlockedSlotMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          if (!blockedSlotsQueryArgs) {
            return;
          }
          const existingBlockedSlots = localStore.getQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
          );

          if (!existingBlockedSlots) {
            return;
          }

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            existingBlockedSlots.filter(
              (slot) => slot._id !== optimisticArgs.id,
            ),
          );
        },
      )(args);
    },
    [blockedSlotsQueryArgs, deleteBlockedSlotMutation],
  );

  const runCreateAppointment = useCallback(
    async (args: CalendarAppointmentCreateCommandArgs) => {
      const mutationArgs = createAppointmentMutationArgsFromCommand(args);
      if (mutationArgs === null) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return;
      }
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        args.appointmentTypeId,
        "useCalendarPlanningWorkbench.runCreateAppointment",
      );
      if (!appointmentTypeInfo) {
        toast.error("Die Terminart konnte nicht geladen werden.");
        return;
      }
      if (appointmentTypeInfo.hasFollowUpPlan) {
        return await createAppointmentMutation(mutationArgs);
      }

      const createdId = await runCreateAppointmentInternal(mutationArgs);
      if (!createdId) {
        return createdId;
      }

      let currentAppointmentId: Id<"appointments"> = createdId;
      const createArgs = {
        ...mutationArgs,
        isSimulation: mutationArgs.isSimulation ?? false,
      };
      const createCommandArgs = {
        ...args,
        isSimulation: args.isSimulation ?? false,
      };
      const createEnd = getAppointmentCreationEnd({
        durationMinutes: appointmentTypeInfo.duration,
        start: createArgs.start,
      });
      const appointmentTypeLineageKey =
        referenceMaps.appointmentTypeLineageKeyById.get(
          createArgs.appointmentTypeId,
        );
      if (appointmentTypeLineageKey === undefined) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      rememberCreatedAppointmentFromStrings({
        appointmentTypeLineageKey,
        appointmentTypeTitle: appointmentTypeInfo.name,
        createdId,
        createEnd,
        createStart: createArgs.start,
        isSimulation: createArgs.isSimulation,
        placement: createCommandArgs.placement,
        ...(createArgs.patientId && { patientId: createArgs.patientId }),
        practiceId: createArgs.practiceId,
        ...(createArgs.replacesAppointmentId && {
          replacesAppointmentId: createArgs.replacesAppointmentId,
        }),
        title: createArgs.title,
        ...(createArgs.userId && { userId: createArgs.userId }),
      });

      pushHistoryAction({
        label: "Termin erstellt",
        redo: async () => {
          await ensureLatestConflictData();
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation,
              placement: createCommandArgs.placement,
              ...(createArgs.replacesAppointmentId && {
                replacesAppointmentId: createArgs.replacesAppointmentId,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Der Termin kann nicht wiederhergestellt werden, weil der Zeitraum bereits belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateAppointmentInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentAppointmentId = recreatedId;
          rememberCreatedAppointmentFromStrings({
            appointmentTypeLineageKey,
            appointmentTypeTitle: appointmentTypeInfo.name,
            createdId: recreatedId,
            createEnd,
            createStart: createArgs.start,
            isSimulation: createArgs.isSimulation,
            placement: createCommandArgs.placement,
            ...(createArgs.patientId && { patientId: createArgs.patientId }),
            practiceId: createArgs.practiceId,
            ...(createArgs.replacesAppointmentId && {
              replacesAppointmentId: createArgs.replacesAppointmentId,
            }),
            title: createArgs.title,
            ...(createArgs.userId && { userId: createArgs.userId }),
          });
          return { status: "applied" };
        },
        undo: async () => {
          try {
            await runDeleteAppointmentInternal({ id: currentAppointmentId });
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          } catch {
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return {
              message: "Der Termin wurde bereits entfernt.",
              status: "conflict",
            };
          }
        },
      });

      return createdId;
    },
    [
      createAppointmentMutation,
      createAppointmentMutationArgsFromCommand,
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberCreatedAppointmentFromStrings,
      referenceMaps.appointmentTypeLineageKeyById,
      runCreateAppointmentInternal,
      runDeleteAppointmentInternal,
    ],
  );

  const runUpdateAppointment = useCallback(
    async (args: CalendarAppointmentUpdateCommandArgs) => {
      const mutationArgs = updateAppointmentMutationArgsFromCommand(args);
      if (mutationArgs === null) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return;
      }
      const before = getAppointmentHistoryDoc(args.id);
      if (before?.seriesId) {
        await getAppointmentUpdateMutation(before)(mutationArgs);
        return;
      }

      await runUpdateAppointmentInternal(mutationArgs);

      if (!before) {
        return;
      }

      const beforeState = {
        end: before.end,
        placement: before.placement,
        start: before.start,
      };
      const typedEnd =
        args.end === undefined
          ? undefined
          : parseZonedDateTime(
              args.end,
              "useCalendarPlanningWorkbench.afterState.end",
            );
      const typedStart =
        args.start === undefined
          ? undefined
          : parseZonedDateTime(
              args.start,
              "useCalendarPlanningWorkbench.afterState.start",
            );
      if (
        (args.end !== undefined && typedEnd === null) ||
        (args.start !== undefined && typedStart === null)
      ) {
        return;
      }
      const afterState = {
        end: typedEnd ?? before.end,
        placement: args.placement ?? before.placement,
        start: typedStart ?? before.start,
      };
      const afterSnapshot: CalendarAppointmentRecord = {
        ...before,
        end: afterState.end,
        placement: afterState.placement,
        start: afterState.start,
      };
      rememberAppointmentHistoryDoc(afterSnapshot);

      const matchesState = (
        appointment: CalendarAppointmentRecord,
        expected: typeof beforeState,
      ) =>
        appointment.start === expected.start &&
        appointment.end === expected.end &&
        appointment.placement.locationLineageKey ===
          expected.placement.locationLineageKey &&
        sameCalendarOccupancyScope(
          appointment.placement.occupancyScope,
          expected.placement.occupancyScope,
        );

      const candidatePayload = (
        state: typeof beforeState,
      ): AppointmentCandidate => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        placement: state.placement,
        start: state.start,
      });

      pushHistoryAction({
        label: "Termin aktualisiert",
        redo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentAppointmentDoc(args.id);
          if (!current || !matchesState(current, beforeState)) {
            return {
              message:
                "Der Termin wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
              status: "conflict",
            };
          }

          if (hasAppointmentConflict(candidatePayload(afterState), args.id)) {
            return {
              message:
                "Die Terminänderung kollidiert mit einer neueren Terminplanung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveAppointmentReferenceDisplayIds({
            appointmentTypeLineageKey: before.appointmentTypeLineageKey,
            placement: afterState.placement,
          });
          if (!displayRefs) {
            return {
              message:
                "Die Terminänderung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateAppointmentInternal({
            end: afterState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.occupancyScope.kind === "resource"
              ? {
                  calendarResourceColumn:
                    displayRefs.occupancyScope.calendarResourceColumn,
                }
              : {
                  practitionerId: displayRefs.occupancyScope.practitionerId,
                }),
            start: afterState.start,
          });
          rememberAppointmentHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentAppointmentDoc(args.id);
          if (!current || !matchesState(current, afterState)) {
            return {
              message:
                "Der Termin wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
              status: "conflict",
            };
          }

          if (hasAppointmentConflict(candidatePayload(beforeState), args.id)) {
            return {
              message:
                "Der ursprüngliche Termin kollidiert mit einer neueren Terminplanung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveAppointmentReferenceDisplayIds({
            appointmentTypeLineageKey: before.appointmentTypeLineageKey,
            placement: beforeState.placement,
          });
          if (!displayRefs) {
            return {
              message:
                "Der ursprüngliche Termin kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateAppointmentInternal({
            end: beforeState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.occupancyScope.kind === "resource"
              ? {
                  calendarResourceColumn:
                    displayRefs.occupancyScope.calendarResourceColumn,
                }
              : {
                  practitionerId: displayRefs.occupancyScope.practitionerId,
                }),
            start: beforeState.start,
          });
          rememberAppointmentHistoryDoc(before);
          return { status: "applied" };
        },
      });
    },
    [
      ensureLatestConflictData,
      getAppointmentHistoryDoc,
      getCurrentAppointmentDoc,
      getAppointmentUpdateMutation,
      hasAppointmentConflict,
      parseZonedDateTime,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveAppointmentReferenceDisplayIds,
      runUpdateAppointmentInternal,
      updateAppointmentMutationArgsFromCommand,
    ],
  );

  const runDeleteAppointment = useCallback(
    async (args: Parameters<typeof deleteAppointmentMutation>[0]) => {
      const deleted = getAppointmentHistoryDoc(args.id);
      if (deleted?.seriesId) {
        await deleteAppointmentMutation(args);
        return;
      }

      await runDeleteAppointmentInternal(args);
      forgetAppointmentHistoryDoc(args.id);

      if (!deleted) {
        return;
      }

      let currentAppointmentId: Id<"appointments"> = args.id;
      const recreatedDisplayRefs = resolveAppointmentReferenceDisplayIds({
        appointmentTypeLineageKey: deleted.appointmentTypeLineageKey,
        placement: deleted.placement,
      });
      if (!recreatedDisplayRefs) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return;
      }

      const createArgs: Parameters<typeof createAppointmentMutation>[0] = {
        appointmentTypeId: recreatedDisplayRefs.appointmentTypeId,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        ...(recreatedDisplayRefs.occupancyScope.kind === "resource"
          ? {
              calendarResourceColumn:
                recreatedDisplayRefs.occupancyScope.calendarResourceColumn,
            }
          : {
              practitionerId:
                recreatedDisplayRefs.occupancyScope.practitionerId,
            }),
        ...(deleted.patientId && { patientId: deleted.patientId }),
        practiceId: deleted.practiceId,
        ...(deleted.replacesAppointmentId && {
          replacesAppointmentId: deleted.replacesAppointmentId,
        }),
        start: deleted.start,
        title: deleted.title,
        ...(deleted.userId && { userId: deleted.userId }),
      };
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        createArgs.appointmentTypeId,
        "useCalendarPlanningWorkbench.runDeleteAppointment",
      );
      if (!appointmentTypeInfo) {
        return;
      }
      const createEnd = getAppointmentCreationEnd({
        durationMinutes: appointmentTypeInfo.duration,
        start: createArgs.start,
      });

      pushHistoryAction({
        label: "Termin gelöscht",
        redo: async () => {
          try {
            await runDeleteAppointmentInternal({ id: currentAppointmentId });
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          } catch {
            forgetAppointmentHistoryDoc(currentAppointmentId);
            return { status: "applied" };
          }
        },
        undo: async () => {
          await ensureLatestConflictData();
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation ?? false,
              placement: deleted.placement,
              ...(createArgs.replacesAppointmentId && {
                replacesAppointmentId: createArgs.replacesAppointmentId,
              }),
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Der gelöschte Termin kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateAppointmentInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentAppointmentId = recreatedId;
          rememberAppointmentHistoryDoc({
            ...deleted,
            _id: recreatedId,
          });
          return { status: "applied" };
        },
      });
    },
    [
      deleteAppointmentMutation,
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      getAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveAppointmentReferenceDisplayIds,
      runCreateAppointmentInternal,
      runDeleteAppointmentInternal,
    ],
  );

  const runCreateBlockedSlot = useCallback(
    async (args: Parameters<typeof createBlockedSlotMutation>[0]) => {
      const createdId = await runCreateBlockedSlotInternal(args);
      if (!createdId) {
        return createdId;
      }

      let currentBlockedSlotId: Id<"blockedSlots"> = createdId;
      const createArgs = { ...args, isSimulation: args.isSimulation ?? false };
      const now = Date.now();
      const blockedSlotReferences = resolveBlockedSlotReferenceLineageKeys({
        locationId: createArgs.locationId,
        occupancyScope: createArgs.occupancyScope,
      });
      if (!blockedSlotReferences) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      rememberCreatedBlockedSlotHistoryDoc({
        blockedSlotId: createdId,
        end: createArgs.end,
        isSimulation: createArgs.isSimulation,
        now,
        placement: blockedSlotReferences,
        practiceId: createArgs.practiceId,
        ...(createArgs.replacesBlockedSlotId && {
          replacesBlockedSlotId: createArgs.replacesBlockedSlotId,
        }),
        start: createArgs.start,
        title: createArgs.title,
      });

      pushHistoryAction({
        label: "Sperrung erstellt",
        redo: async () => {
          await ensureLatestConflictData();
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation,
              placement: blockedSlotReferences,
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Die Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateBlockedSlotInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentBlockedSlotId = recreatedId;
          rememberCreatedBlockedSlotHistoryDoc({
            blockedSlotId: recreatedId,
            end: createArgs.end,
            isSimulation: createArgs.isSimulation,
            now,
            placement: blockedSlotReferences,
            practiceId: createArgs.practiceId,
            ...(createArgs.replacesBlockedSlotId && {
              replacesBlockedSlotId: createArgs.replacesBlockedSlotId,
            }),
            start: createArgs.start,
            title: createArgs.title,
          });
          return { status: "applied" };
        },
        undo: async () => {
          try {
            await runDeleteBlockedSlotInternal({ id: currentBlockedSlotId });
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          } catch {
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return {
              message: "Die Sperrung wurde bereits entfernt.",
              status: "conflict",
            };
          }
        },
      });

      return createdId;
    },
    [
      ensureLatestConflictData,
      forgetBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberCreatedBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceLineageKeys,
      runCreateBlockedSlotInternal,
      runDeleteBlockedSlotInternal,
    ],
  );

  const runUpdateBlockedSlot = useCallback(
    async (args: Parameters<typeof updateBlockedSlotMutation>[0]) => {
      const before = getBlockedSlotHistoryDoc(args.id);
      const nextLocationLineageKey =
        args.locationId === undefined
          ? before?.placement.locationLineageKey
          : getLocationLineageKeyForDisplayId(args.locationId);
      if (
        args.locationId !== undefined &&
        nextLocationLineageKey === undefined
      ) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return;
      }
      const beforePractitionerLineageKey =
        before === undefined
          ? undefined
          : getPractitionerLineageKeyFromOccupancy(
              before.placement.occupancyScope,
            );
      const nextPractitionerLineageKey =
        args.occupancyScope?.kind === "location-wide"
          ? undefined
          : args.occupancyScope?.kind === "practitioner"
            ? getPractitionerLineageKeyForDisplayId(
                args.occupancyScope.practitionerId,
              )
            : beforePractitionerLineageKey;
      if (
        args.occupancyScope?.kind === "practitioner" &&
        nextPractitionerLineageKey === undefined
      ) {
        toast.error("Behandler konnte nicht aufgelöst werden.");
        return;
      }
      const mutationResult = await runUpdateBlockedSlotInternal(args);

      if (!before) {
        return mutationResult;
      }

      const beforeState = {
        end: before.end,
        placement: before.placement,
        start: before.start,
        title: before.title,
      };

      const afterPlacement = createBlockedSlotPlacement({
        locationLineageKey:
          nextLocationLineageKey ?? before.placement.locationLineageKey,
        occupancyScope:
          args.occupancyScope === undefined
            ? before.placement.occupancyScope
            : args.occupancyScope.kind === "location-wide"
              ? { kind: "location-wide" }
              : nextPractitionerLineageKey === undefined
                ? before.placement.occupancyScope
                : {
                    kind: "practitioner",
                    practitionerLineageKey: nextPractitionerLineageKey,
                  },
      });
      const afterState = {
        end: args.end ?? before.end,
        placement: afterPlacement,
        start: args.start ?? before.start,
        title: args.title ?? before.title,
      };
      const afterSnapshot: CalendarBlockedSlotRecord = {
        ...before,
        end: afterState.end,
        placement: afterState.placement,
        start: afterState.start,
        title: afterState.title,
      };
      rememberBlockedSlotHistoryDoc(afterSnapshot);

      const matchesState = (
        slot: CalendarBlockedSlotRecord,
        expected: typeof beforeState,
      ) =>
        slot.start === expected.start &&
        slot.end === expected.end &&
        slot.placement.locationLineageKey ===
          expected.placement.locationLineageKey &&
        sameCalendarOccupancyScope(
          slot.placement.occupancyScope,
          expected.placement.occupancyScope,
        ) &&
        slot.title === expected.title;

      const candidatePayload = (
        state: typeof beforeState,
      ): BlockedSlotCandidate => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        placement: state.placement,
        start: state.start,
      });
      const updatePayloadForState = (
        state: typeof beforeState,
        displayRefs: {
          locationId: Id<"locations">;
          occupancyScope: BlockedSlotDisplayOccupancyScope;
        },
      ): Parameters<typeof updateBlockedSlotMutation>[0] => ({
        end: state.end,
        id: args.id,
        locationId: displayRefs.locationId,
        occupancyScope: displayRefs.occupancyScope,
        start: state.start,
        title: state.title,
      });

      pushHistoryAction({
        label: "Sperrung aktualisiert",
        redo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentBlockedSlotDoc(args.id);
          if (!current || !matchesState(current, beforeState)) {
            return {
              message:
                "Die Sperrung wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
              status: "conflict",
            };
          }

          if (hasBlockedSlotConflict(candidatePayload(afterState), args.id)) {
            return {
              message: "Die Sperrung kollidiert mit einer neueren Planung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotPlacementDisplayRefs(
            afterState.placement,
            referenceMaps,
          );
          if (!displayRefs) {
            return {
              message:
                "Die Sperrung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal(
            updatePayloadForState(afterState, displayRefs),
          );
          rememberBlockedSlotHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          await ensureLatestConflictData();
          const current = getCurrentBlockedSlotDoc(args.id);
          if (!current || !matchesState(current, afterState)) {
            return {
              message:
                "Die Sperrung wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
              status: "conflict",
            };
          }

          if (hasBlockedSlotConflict(candidatePayload(beforeState), args.id)) {
            return {
              message:
                "Die ursprüngliche Sperrung kollidiert mit einer neueren Planung.",
              status: "conflict",
            };
          }

          const displayRefs = resolveBlockedSlotPlacementDisplayRefs(
            beforeState.placement,
            referenceMaps,
          );
          if (!displayRefs) {
            return {
              message:
                "Die ursprüngliche Sperrung kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal(
            updatePayloadForState(beforeState, displayRefs),
          );
          rememberBlockedSlotHistoryDoc(before);
          return { status: "applied" };
        },
      });

      return mutationResult;
    },
    [
      ensureLatestConflictData,
      getBlockedSlotHistoryDoc,
      getCurrentBlockedSlotDoc,
      getLocationLineageKeyForDisplayId,
      getPractitionerLineageKeyForDisplayId,
      hasBlockedSlotConflict,
      pushHistoryAction,
      referenceMaps,
      rememberBlockedSlotHistoryDoc,
      runUpdateBlockedSlotInternal,
    ],
  );

  const runDeleteBlockedSlot = useCallback(
    async (args: Parameters<typeof deleteBlockedSlotMutation>[0]) => {
      const deleted = getBlockedSlotHistoryDoc(args.id);
      const mutationResult = await runDeleteBlockedSlotInternal(args);
      forgetBlockedSlotHistoryDoc(args.id);

      if (!deleted) {
        return mutationResult;
      }

      let currentBlockedSlotId: Id<"blockedSlots"> = args.id;
      const recreatedDisplayRefs = resolveBlockedSlotReferenceDisplayIds(
        deleted.placement,
      );
      if (!recreatedDisplayRefs) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return mutationResult;
      }
      const createArgs: Parameters<typeof createBlockedSlotMutation>[0] = {
        end: deleted.end,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        occupancyScope:
          recreatedDisplayRefs.practitionerId === undefined
            ? { kind: "location-wide" }
            : {
                kind: "practitioner",
                practitionerId: recreatedDisplayRefs.practitionerId,
              },
        practiceId: deleted.practiceId,
        ...(deleted.replacesBlockedSlotId && {
          replacesBlockedSlotId: deleted.replacesBlockedSlotId,
        }),
        start: deleted.start,
        title: deleted.title,
      };

      pushHistoryAction({
        label: "Sperrung gelöscht",
        redo: async () => {
          try {
            await runDeleteBlockedSlotInternal({ id: currentBlockedSlotId });
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          } catch {
            forgetBlockedSlotHistoryDoc(currentBlockedSlotId);
            return { status: "applied" };
          }
        },
        undo: async () => {
          await ensureLatestConflictData();
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation ?? false,
              placement: deleted.placement,
              start: createArgs.start,
            })
          ) {
            return {
              message:
                "Die gelöschte Sperrung kann nicht wiederhergestellt werden, weil der Zeitraum inzwischen belegt ist.",
              status: "conflict",
            };
          }

          const recreatedId = await runCreateBlockedSlotInternal(createArgs);
          if (!recreatedId) {
            return { status: "conflict" };
          }

          currentBlockedSlotId = recreatedId;
          rememberBlockedSlotHistoryDoc({
            ...deleted,
            _id: recreatedId,
          });
          return { status: "applied" };
        },
      });

      return mutationResult;
    },
    [
      ensureLatestConflictData,
      forgetBlockedSlotHistoryDoc,
      getBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
      runCreateBlockedSlotInternal,
      runDeleteBlockedSlotInternal,
    ],
  );

  const commands = {
    createAppointment: runCreateAppointment,
    createBlockedSlot: runCreateBlockedSlot,
    deleteAppointment: runDeleteAppointment,
    deleteBlockedSlot: runDeleteBlockedSlot,
    updateAppointment: runUpdateAppointment,
    updateBlockedSlot: runUpdateBlockedSlot,
  };

  return {
    commands,
    getBlockedSlotEditorData,
  };
}

function createBlockedSlotPlacement(args: {
  locationLineageKey: LocationLineageKey;
  occupancyScope:
    | { kind: "location-wide" }
    | { kind: "practitioner"; practitionerLineageKey: PractitionerLineageKey };
}): CalendarBlockedSlotPlacement {
  return createCalendarPlacement({
    locationLineageKey: args.locationLineageKey,
    occupancyScope: args.occupancyScope,
  });
}
