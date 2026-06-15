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
import type { LedgerOperation } from "../../utils/command-ledger";
import type { CalendarPlanningCommand } from "./calendar-planning-command";
import type { CalendarDayQueryArgs } from "./calendar-query-args";
import type { CalendarReferenceMaps } from "./calendar-reference-adapters";
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
  type AppointmentOwnerRefs,
  getAppointmentOwnerRefs,
} from "./appointment-owner-refs";
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
  type CalendarPlanningCommandExecutorContext,
  executeCalendarPlanningCommand,
} from "./calendar-planning-replay";
import {
  resolveAppointmentDisplayRefs,
  resolveAppointmentLineageRefs,
  resolveAppointmentPlacementDisplayRefs,
  resolveBlockedSlotDisplayRefs,
  resolveBlockedSlotLineageRefs,
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

export type CalendarAppointmentCreateCommandArgs =
  CalendarAppointmentCreateCommandBase &
    (
      | {
          end: string;
          isSimulation: true;
          replacesAppointmentId: Id<"appointments">;
        }
      | {
          end?: undefined;
          isSimulation?: boolean;
          replacesAppointmentId?: undefined;
        }
    );

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

type CalendarAppointmentCreateCommandBase = AppointmentOwnerRefs &
  Omit<
    CreateAppointmentMutationArgs,
    | "calendarResourceColumn"
    | "end"
    | "isSimulation"
    | "locationId"
    | "practitionerId"
    | "replacesAppointmentId"
  > & {
    placement: CalendarAppointmentPlacement;
  };

const appointmentHistoryMatchesQuery = (
  historyDoc: CalendarAppointmentRecord,
  queryDoc: CalendarAppointmentRecord,
) =>
  historyDoc.start === queryDoc.start &&
  historyDoc.end === queryDoc.end &&
  historyDoc.title === queryDoc.title &&
  historyDoc.appointmentTypeLineageKey === queryDoc.appointmentTypeLineageKey &&
  historyDoc.placement.locationLineageKey ===
    queryDoc.placement.locationLineageKey &&
  sameCalendarOccupancyScope(
    historyDoc.placement.occupancyScope,
    queryDoc.placement.occupancyScope,
  );

const blockedSlotHistoryMatchesQuery = (
  historyDoc: CalendarBlockedSlotRecord,
  queryDoc: CalendarBlockedSlotRecord,
) =>
  historyDoc.start === queryDoc.start &&
  historyDoc.end === queryDoc.end &&
  historyDoc.title === queryDoc.title &&
  historyDoc.placement.locationLineageKey ===
    queryDoc.placement.locationLineageKey &&
  sameCalendarOccupancyScope(
    historyDoc.placement.occupancyScope,
    queryDoc.placement.occupancyScope,
  );

const clearQueuedAppointmentUpdate = () => void 0;

interface CalendarRecordRef<T> {
  current: T;
}

type CreateAppointmentMutationArgs = FunctionArgs<
  typeof api.appointments.createAppointment
>;

interface CreatedAppointmentHistoryArgs extends AppointmentOwnerRefs {
  appointmentId: Id<"appointments">;
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  end: CalendarAppointmentRecord["end"];
  isSimulation: boolean;
  now: number;
  placement: CalendarAppointmentPlacement;
  practiceId: Id<"practices">;
  replacesAppointmentId?: Id<"appointments">;
  start: CalendarAppointmentRecord["start"];
  title: string;
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
  const recreatedAppointmentIdByOriginalIdRef = useRef(
    new Map<Id<"appointments">, Id<"appointments">>(),
  );
  const deletedAppointmentIdsRef = useRef(new Set<Id<"appointments">>());
  const appointmentUpdateQueueRef = useRef(Promise.resolve());
  const blockedSlotHistoryDocMapRef = useRef(
    new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>(),
  );
  const deletedBlockedSlotIdsRef = useRef(new Set<Id<"blockedSlots">>());

  useEffect(() => {
    if (!args.allPracticeAppointmentsLoaded) {
      return;
    }

    for (const [id, historyDoc] of appointmentHistoryDocMapRef.current) {
      const queryDoc = args.allPracticeAppointmentMap.get(id);
      if (
        isOptimisticId(id) ||
        (queryDoc !== undefined &&
          appointmentHistoryMatchesQuery(historyDoc, queryDoc))
      ) {
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

    for (const [id, historyDoc] of blockedSlotHistoryDocMapRef.current) {
      const queryDoc = args.allPracticeBlockedSlotMap.get(id);
      if (
        isOptimisticId(id) ||
        (queryDoc !== undefined &&
          blockedSlotHistoryMatchesQuery(historyDoc, queryDoc))
      ) {
        blockedSlotHistoryDocMapRef.current.delete(id);
      }
    }

    for (const blockedSlotId of args.allPracticeBlockedSlotMap.keys()) {
      deletedBlockedSlotIdsRef.current.delete(blockedSlotId);
    }
  }, [args.allPracticeBlockedSlotMap, args.allPracticeBlockedSlotsLoaded]);

  const resolveCurrentAppointmentId = useCallback((id: Id<"appointments">) => {
    return recreatedAppointmentIdByOriginalIdRef.current.get(id) ?? id;
  }, []);

  const getAppointmentHistoryDoc = useCallback(
    (id: Id<"appointments">) => {
      const currentId = resolveCurrentAppointmentId(id);
      if (deletedAppointmentIdsRef.current.has(currentId)) {
        return;
      }

      return (
        appointmentHistoryDocMapRef.current.get(currentId) ??
        args.activeDayAppointmentMapRef.current.get(currentId) ??
        args.allPracticeAppointmentMapRef.current.get(currentId)
      );
    },
    [
      args.activeDayAppointmentMapRef,
      args.allPracticeAppointmentMapRef,
      resolveCurrentAppointmentId,
    ],
  );

  const rememberRecreatedAppointmentId = useCallback(
    (args: {
      currentId: Id<"appointments">;
      originalId: Id<"appointments">;
    }) => {
      recreatedAppointmentIdByOriginalIdRef.current.set(
        args.originalId,
        args.currentId,
      );
    },
    [],
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
        ...getAppointmentOwnerRefs(args),
        createdAt: BigInt(args.now),
        end: args.end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(args.now),
        placement: args.placement,
        practiceId: args.practiceId,
        ...(args.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: args.replacesAppointmentId }),
        start: args.start,
        title: args.title,
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

  const enqueueAppointmentUpdate = useCallback(
    <TResult>(operation: () => Promise<TResult>) => {
      const queued = appointmentUpdateQueueRef.current.then(
        operation,
        operation,
      );
      appointmentUpdateQueueRef.current = queued.then(
        clearQueuedAppointmentUpdate,
        clearQueuedAppointmentUpdate,
      );
      return queued;
    },
    [],
  );

  const rememberCreatedAppointmentFromStrings = useCallback(
    (
      createdArgs: AppointmentOwnerRefs & {
        appointmentTypeLineageKey: AppointmentTypeLineageKey;
        appointmentTypeTitle: string;
        createdId: Id<"appointments">;
        createEnd: string;
        createStart: string;
        isSimulation: boolean;
        placement: CalendarAppointmentPlacement;
        practiceId: Id<"practices">;
        replacesAppointmentId?: Id<"appointments">;
        title: string;
      },
    ): boolean => {
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
        ...getAppointmentOwnerRefs(createdArgs),
        end,
        isSimulation: createdArgs.isSimulation,
        now: Date.now(),
        placement: createdArgs.placement,
        practiceId: createdArgs.practiceId,
        ...(createdArgs.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: createdArgs.replacesAppointmentId }),
        start,
        title: createdArgs.title,
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

  const calendarPlanningExecutorContextRef =
    useRef<CalendarPlanningCommandExecutorContext | null>(null);
  const executeRecordedCalendarCommand = useCallback(
    (command: CalendarPlanningCommand, operation: LedgerOperation) => {
      const context = calendarPlanningExecutorContextRef.current;
      if (!context) {
        return {
          message: "Die Kalender-Aktion konnte nicht ausgeführt werden.",
          status: "conflict" as const,
        };
      }
      return executeCalendarPlanningCommand(command, operation, context);
    },
    [],
  );
  const { recordCalendarCommand } = useCalendarPlanningHistory(
    executeRecordedCalendarCommand,
  );

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
      const { end, placement, replacesAppointmentId, ...rest } = commandArgs;
      const displayRefs = resolveAppointmentPlacementDisplayRefs(
        placement,
        referenceMaps,
      );
      if (displayRefs === null) {
        return null;
      }

      return {
        ...rest,
        ...(end === undefined ? {} : { end }),
        locationId: displayRefs.locationId,
        ...(replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId }),
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
          const optimisticEnd =
            optimisticArgs.end ??
            getAppointmentCreationEnd({
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
            ...getAppointmentOwnerRefs(optimisticArgs),
            createdAt: BigInt(now),
            end: typedEnd,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            placement: lineageRefs.placement,
            practiceId: optimisticArgs.practiceId,
            start: typedStart,
            title: optimisticArgs.title,
          };

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
          | null
          | { calendarResourceColumn: "ekg" | "labor"; kind: "resource" }
          | { kind: "practitioner"; practitionerId: Id<"practitioners"> } =
          optimisticArgs.calendarResourceColumn === undefined
            ? optimisticArgs.practitionerId === undefined
              ? appointment.practitionerId === undefined
                ? (() => {
                    const calendarResourceColumn =
                      getCalendarResourceColumnFromOccupancy(
                        currentRecord.placement.occupancyScope,
                      );
                    return calendarResourceColumn === undefined
                      ? null
                      : {
                          calendarResourceColumn,
                          kind: "resource" as const,
                        };
                  })()
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
                ? (() => {
                    const calendarResourceColumn =
                      getCalendarResourceColumnFromOccupancy(
                        currentRecord.placement.occupancyScope,
                      );
                    return calendarResourceColumn === undefined
                      ? null
                      : {
                          calendarResourceColumn,
                          kind: "resource" as const,
                        };
                  })()
                : {
                    kind: "practitioner",
                    practitionerId: appointment.practitionerId,
                  }
              : {
                  calendarResourceColumn: optimisticArgs.calendarResourceColumn,
                  kind: "resource" as const,
                };
        if (nextDisplayOccupancyScope === null) {
          return appointment;
        }
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

      const isSimulationReplacement =
        mutationArgs.isSimulation === true &&
        mutationArgs.replacesAppointmentId !== undefined;
      const createdId = isSimulationReplacement
        ? await createAppointmentMutation(mutationArgs)
        : await runCreateAppointmentInternal(mutationArgs);
      if (!createdId) {
        return createdId;
      }

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
        ...getAppointmentOwnerRefs(createArgs),
        createdId,
        createEnd,
        createStart: createArgs.start,
        isSimulation: createArgs.isSimulation,
        placement: createCommandArgs.placement,
        practiceId: createArgs.practiceId,
        ...(createArgs.replacesAppointmentId && {
          replacesAppointmentId: createArgs.replacesAppointmentId,
        }),
        title: createArgs.title,
      });

      recordCalendarCommand({
        kind: "appointment.create",
        label: "Termin erstellt",
        payload: {
          appointmentTypeLineageKey,
          appointmentTypeTitle: appointmentTypeInfo.name,
          createArgs,
          createEnd,
          currentAppointmentId: createdId,
          placement: createCommandArgs.placement,
        },
      });

      return createdId;
    },
    [
      createAppointmentMutation,
      createAppointmentMutationArgsFromCommand,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      recordCalendarCommand,
      rememberCreatedAppointmentFromStrings,
      referenceMaps.appointmentTypeLineageKeyById,
      runCreateAppointmentInternal,
    ],
  );

  const runUpdateAppointment = useCallback(
    async (args: CalendarAppointmentUpdateCommandArgs) => {
      await enqueueAppointmentUpdate(async () => {
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
          lastModified: BigInt(Date.now()),
          placement: afterState.placement,
          start: afterState.start,
        };
        rememberAppointmentHistoryDoc(afterSnapshot);

        recordCalendarCommand({
          kind: "appointment.update",
          label: "Termin aktualisiert",
          payload: {
            afterSnapshot,
            afterState,
            appointmentId: args.id,
            before,
            beforeState,
          },
        });
      });
    },
    [
      enqueueAppointmentUpdate,
      getAppointmentHistoryDoc,
      getAppointmentUpdateMutation,
      parseZonedDateTime,
      recordCalendarCommand,
      rememberAppointmentHistoryDoc,
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
        ...getAppointmentOwnerRefs(deleted),
        practiceId: deleted.practiceId,
        ...(deleted.replacesAppointmentId && {
          replacesAppointmentId: deleted.replacesAppointmentId,
        }),
        start: deleted.start,
        title: deleted.title,
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

      recordCalendarCommand({
        kind: "appointment.delete",
        label: "Termin gelöscht",
        payload: {
          createArgs,
          createEnd,
          currentAppointmentId: args.id,
          deleted,
        },
      });
    },
    [
      deleteAppointmentMutation,
      forgetAppointmentHistoryDoc,
      getAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      recordCalendarCommand,
      resolveAppointmentReferenceDisplayIds,
      runDeleteAppointmentInternal,
    ],
  );

  const runCreateBlockedSlot = useCallback(
    async (args: Parameters<typeof createBlockedSlotMutation>[0]) => {
      const createdId = await runCreateBlockedSlotInternal(args);
      if (!createdId) {
        return createdId;
      }

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

      recordCalendarCommand({
        kind: "blockedSlot.create",
        label: "Sperrung erstellt",
        payload: {
          blockedSlotReferences,
          createArgs,
          currentBlockedSlotId: createdId,
          now,
        },
      });

      return createdId;
    },
    [
      recordCalendarCommand,
      rememberCreatedBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceLineageKeys,
      runCreateBlockedSlotInternal,
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
        lastModified: BigInt(Date.now()),
        placement: afterState.placement,
        start: afterState.start,
        title: afterState.title,
      };
      rememberBlockedSlotHistoryDoc(afterSnapshot);

      recordCalendarCommand({
        kind: "blockedSlot.update",
        label: "Sperrung aktualisiert",
        payload: {
          afterSnapshot,
          afterState,
          before,
          beforeState,
          blockedSlotId: args.id,
        },
      });

      return mutationResult;
    },
    [
      getBlockedSlotHistoryDoc,
      getLocationLineageKeyForDisplayId,
      getPractitionerLineageKeyForDisplayId,
      recordCalendarCommand,
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

      recordCalendarCommand({
        kind: "blockedSlot.delete",
        label: "Sperrung gelöscht",
        payload: {
          createArgs,
          currentBlockedSlotId: args.id,
          deleted,
        },
      });

      return mutationResult;
    },
    [
      forgetBlockedSlotHistoryDoc,
      getBlockedSlotHistoryDoc,
      recordCalendarCommand,
      resolveBlockedSlotReferenceDisplayIds,
      runDeleteBlockedSlotInternal,
    ],
  );

  useEffect(() => {
    calendarPlanningExecutorContextRef.current = {
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      forgetBlockedSlotHistoryDoc,
      getCurrentAppointmentDoc,
      getCurrentBlockedSlotDoc,
      hasAppointmentConflict,
      hasBlockedSlotConflict,
      referenceMaps,
      rememberAppointmentHistoryDoc,
      rememberBlockedSlotHistoryDoc,
      rememberCreatedAppointmentFromStrings,
      rememberCreatedBlockedSlotHistoryDoc,
      rememberRecreatedAppointmentId,
      resolveAppointmentReferenceDisplayIds,
      resolveCurrentAppointmentId,
      runCreateAppointmentInternal,
      runCreateBlockedSlotInternal,
      runDeleteAppointmentInternal,
      runDeleteBlockedSlotInternal,
      runUpdateAppointmentInternal,
      runUpdateBlockedSlotInternal,
    };
  }, [
    ensureLatestConflictData,
    forgetAppointmentHistoryDoc,
    forgetBlockedSlotHistoryDoc,
    getCurrentAppointmentDoc,
    getCurrentBlockedSlotDoc,
    hasAppointmentConflict,
    hasBlockedSlotConflict,
    referenceMaps,
    rememberAppointmentHistoryDoc,
    rememberRecreatedAppointmentId,
    rememberBlockedSlotHistoryDoc,
    rememberCreatedAppointmentFromStrings,
    rememberCreatedBlockedSlotHistoryDoc,
    resolveAppointmentReferenceDisplayIds,
    resolveCurrentAppointmentId,
    runCreateAppointmentInternal,
    runCreateBlockedSlotInternal,
    runDeleteAppointmentInternal,
    runDeleteBlockedSlotInternal,
    runUpdateAppointmentInternal,
    runUpdateBlockedSlotInternal,
  ]);

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
