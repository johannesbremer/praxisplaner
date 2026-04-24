import { useMutation } from "convex/react";
import { ResultAsync } from "neverthrow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";

import { api } from "../../../convex/_generated/api";
import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
} from "../../../convex/identity";
import { createSimulatedContext } from "../../../lib/utils";
import {
  getPractitionerAvailabilityRangesForDate,
  getPractitionerVacationRangesForDate,
} from "../../../lib/vacation-utils";
import { useRegisterGlobalUndoRedoControls } from "../../hooks/use-global-undo-redo-controls";
import { useLocalHistory } from "../../hooks/use-local-history";
import {
  createOptimisticId,
  findIdInList,
  isOptimisticId,
} from "../../utils/convex-ids";
import { captureErrorGlobal } from "../../utils/error-tracking";
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  resultFromNullable,
} from "../../utils/frontend-errors";
import {
  formatTime,
  safeParseISOToZoned,
  temporalDayToLegacy,
  zonedDateTimeStringResult,
} from "../../utils/time-calculations";
import {
  matchesCalendarDayQueryEntity,
  shouldCollapseOptimisticReplacementInDayQuery,
} from "./calendar-day-query-membership";
import {
  resolveAppointmentDisplayRefs,
  resolveAppointmentLineageRefs,
  resolveBlockedSlotDisplayRefs,
  resolveBlockedSlotLineageRefs,
  toBlockedSlotEditorRecord,
} from "./calendar-reference-adapters";
import {
  buildCalendarAppointmentLayouts,
  buildCalendarAppointmentViews,
  toCalendarAppointmentRecord,
  toCalendarAppointmentResult,
  toCalendarBlockedSlotRecord,
  toCalendarBlockedSlotResult,
} from "./calendar-view-models";
import {
  type CalendarAppointmentLayout,
  type CalendarAppointmentRecord,
  type CalendarBlockedSlotEditorRecord,
  type CalendarBlockedSlotRecord,
  type CalendarColumn,
  type CalendarColumnId,
  type NewCalendarProps,
  SLOT_DURATION,
  type WorkingPractitioner,
} from "./types";
import { buildCalendarAppointmentRequest } from "./use-calendar-booking";
import { useCalendarData } from "./use-calendar-data";
import { useCalendarDevtools } from "./use-calendar-devtools";
import {
  type CalendarManualBlockedSlot,
  useCalendarInteractions,
} from "./use-calendar-interactions";
import {
  type BlockedSlotConversionOptions,
  collectDeletedPractitionerCalendarRanges,
  filterBlockedSlotsForDateAndLocation,
  getCurrentCalendarRecordById,
  handleEditBlockedSlot,
  hasCalendarOccupancyConflictInRecords,
  mergeCurrentConflictRecordsByIdExcluding,
  parsePlainTimeResult,
  type SimulatedBlockedSlotConversionResult,
  type SimulationConversionOptions,
  TIMEZONE,
} from "./use-calendar-logic-helpers";

/**
 * Deep comparison of appointment arrays.
 */
export function useCalendarLogic({
  locationName,
  onClearAppointmentTypeSelection,
  onDateChange,
  onLocationResolved,
  onPatientRequired,
  onUpdateSimulatedContext,
  patient,
  pendingAppointmentTitle,
  practiceId: propPracticeId,
  ruleSetId,
  scrollContainerRef,
  selectedAppointmentTypeId,
  selectedLocationId: externalSelectedLocationId,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Temporal.PlainDate>(
    () => simulationDate ?? Temporal.Now.plainDateISO(TIMEZONE),
  );
  const [currentTime, setCurrentTime] = useState<Temporal.ZonedDateTime>(() =>
    Temporal.Now.zonedDateTimeISO(TIMEZONE),
  );
  const practiceId = propPracticeId;

  const [draggedAppointment, setDraggedAppointment] =
    useState<CalendarAppointmentLayout | null>(null);
  const [draggedBlockedSlotId, setDraggedBlockedSlotId] = useState<
    null | string
  >(null);
  const emptyDragPreview = {
    column: null,
    slot: 0,
    visible: false,
  } as const;
  const [dragPreview, setDragPreview] = useState<{
    column: CalendarColumnId | null;
    slot: number;
    visible: boolean;
  }>(emptyDragPreview);
  const autoScrollAnimationRef = useRef<null | number>(null);
  const hasResolvedLocationRef = useRef(false);

  // Warning dialog state for blocked slots
  const [blockedSlotWarning, setBlockedSlotWarning] = useState<null | {
    canBook: boolean;
    column: CalendarColumnId;
    isManualBlock?: boolean;
    onConfirm: () => void;
    reason?: string;
    slot: number;
    slotTime: string;
  }>(null);

  const [internalSelectedLocationId, setInternalSelectedLocationId] = useState(
    externalSelectedLocationId,
  );
  const selectedLocationId =
    externalSelectedLocationId ?? internalSelectedLocationId;

  const {
    allPracticeAppointmentDocMap,
    allPracticeAppointmentDocMapRef,
    allPracticeAppointmentsLoaded,
    allPracticeBlockedSlotDocMap,
    allPracticeBlockedSlotDocMapRef,
    allPracticeBlockedSlotsLoaded,
    appointmentDocMapRef,
    appointmentsData,
    appointmentTypeIdByLineageKey,
    appointmentTypeInfoByLineageKey,
    appointmentTypeLineageKeyById,
    baseSchedulesData,
    blockedSlotDocMapRef,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeResult,
    calendarDayQueryArgs,
    getRequiredAppointmentTypeInfo,
    locationIdByLineageKey,
    locationLineageKeyById,
    locationsData,
    patientData,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    practitionersData,
    refreshAllPracticeConflictData,
    slotsResult,
    userData,
    vacationsData,
  } = useCalendarData({
    patient,
    practiceId,
    ruleSetId,
    selectedAppointmentTypeId,
    selectedDate,
    selectedLocationId,
    simulatedContext,
  });
  const blockedSlotsQueryArgs = calendarDayQueryArgs;
  const appointmentHistoryDocMapRef = useRef(
    new Map<Id<"appointments">, CalendarAppointmentRecord>(),
  );
  const deletedAppointmentIdsRef = useRef(new Set<Id<"appointments">>());
  const blockedSlotHistoryDocMapRef = useRef(
    new Map<Id<"blockedSlots">, CalendarBlockedSlotRecord>(),
  );
  const deletedBlockedSlotIdsRef = useRef(new Set<Id<"blockedSlots">>());

  useEffect(() => {
    if (!allPracticeAppointmentsLoaded) {
      return;
    }

    for (const id of appointmentHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || allPracticeAppointmentDocMap.has(id)) {
        appointmentHistoryDocMapRef.current.delete(id);
      }
    }

    for (const appointmentId of allPracticeAppointmentDocMap.keys()) {
      deletedAppointmentIdsRef.current.delete(appointmentId);
    }
  }, [allPracticeAppointmentDocMap, allPracticeAppointmentsLoaded]);

  useEffect(() => {
    if (!allPracticeBlockedSlotsLoaded) {
      return;
    }

    for (const id of blockedSlotHistoryDocMapRef.current.keys()) {
      if (isOptimisticId(id) || allPracticeBlockedSlotDocMap.has(id)) {
        blockedSlotHistoryDocMapRef.current.delete(id);
      }
    }

    for (const blockedSlotId of allPracticeBlockedSlotDocMap.keys()) {
      deletedBlockedSlotIdsRef.current.delete(blockedSlotId);
    }
  }, [allPracticeBlockedSlotDocMap, allPracticeBlockedSlotsLoaded]);

  const getAppointmentHistoryDoc = useCallback(
    (id: Id<"appointments">) => {
      if (deletedAppointmentIdsRef.current.has(id)) {
        return;
      }

      return (
        appointmentHistoryDocMapRef.current.get(id) ??
        appointmentDocMapRef.current.get(id) ??
        allPracticeAppointmentDocMapRef.current.get(id)
      );
    },
    [allPracticeAppointmentDocMapRef, appointmentDocMapRef],
  );

  const getCurrentAppointmentDoc = useCallback(
    (id: Id<"appointments">) =>
      getCurrentCalendarRecordById({
        activeDayMap: appointmentDocMapRef.current,
        allPracticeMap: allPracticeAppointmentDocMapRef.current,
        deletedIds: deletedAppointmentIdsRef.current,
        historyMap: appointmentHistoryDocMapRef.current,
        id,
      }),
    [allPracticeAppointmentDocMapRef, appointmentDocMapRef],
  );

  const getBlockedSlotHistoryDoc = useCallback(
    (id: Id<"blockedSlots">) => {
      if (deletedBlockedSlotIdsRef.current.has(id)) {
        return;
      }

      return (
        blockedSlotHistoryDocMapRef.current.get(id) ??
        blockedSlotDocMapRef.current.get(id) ??
        allPracticeBlockedSlotDocMapRef.current.get(id)
      );
    },
    [allPracticeBlockedSlotDocMapRef, blockedSlotDocMapRef],
  );

  const getCurrentBlockedSlotDoc = useCallback(
    (id: Id<"blockedSlots">) =>
      getCurrentCalendarRecordById({
        activeDayMap: blockedSlotDocMapRef.current,
        allPracticeMap: allPracticeBlockedSlotDocMapRef.current,
        deletedIds: deletedBlockedSlotIdsRef.current,
        historyMap: blockedSlotHistoryDocMapRef.current,
        id,
      }),
    [allPracticeBlockedSlotDocMapRef, blockedSlotDocMapRef],
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

  const forgetBlockedSlotHistoryDoc = useCallback((id: Id<"blockedSlots">) => {
    deletedBlockedSlotIdsRef.current.add(id);
    blockedSlotHistoryDocMapRef.current.delete(id);
  }, []);

  const isNonRootSeriesAppointment = useCallback(
    (appointmentId?: string) => {
      if (!appointmentId) {
        return false;
      }

      const appointmentDoc = [...appointmentDocMapRef.current.values()].find(
        (appointment) => appointment._id === appointmentId,
      );
      return (
        appointmentDoc?.seriesId !== undefined &&
        appointmentDoc.seriesStepIndex !== undefined &&
        appointmentDoc.seriesStepIndex !== 0n
      );
    },
    [appointmentDocMapRef],
  );

  const showNonRootSeriesEditToast = useCallback(() => {
    toast.info(
      "Folgetermine können nicht einzeln bearbeitet werden. Bitte den Starttermin bearbeiten.",
    );
  }, []);

  const parseZonedDateTime = useCallback(
    (value: string, source: string): null | ZonedDateTimeString =>
      zonedDateTimeStringResult(value, source).match(
        (typedValue) => typedValue,
        (error) => {
          captureFrontendError(error, { source, value });
          return null;
        },
      ),
    [],
  );

  const referenceMaps = useMemo(
    () => ({
      appointmentTypeIdByLineageKey,
      appointmentTypeLineageKeyById,
      locationIdByLineageKey,
      locationLineageKeyById,
      practitionerIdByLineageKey,
      practitionerLineageKeyById,
    }),
    [
      appointmentTypeIdByLineageKey,
      appointmentTypeLineageKeyById,
      locationIdByLineageKey,
      locationLineageKeyById,
      practitionerIdByLineageKey,
      practitionerLineageKeyById,
    ],
  );

  const getAppointmentTypeIdForLineageKey = useCallback(
    (appointmentTypeLineageKey: AppointmentTypeLineageKey) =>
      appointmentTypeIdByLineageKey.get(appointmentTypeLineageKey),
    [appointmentTypeIdByLineageKey],
  );

  const getLocationLineageKeyForDisplayId = useCallback(
    (locationId: Id<"locations">) => locationLineageKeyById.get(locationId),
    [locationLineageKeyById],
  );

  const getLocationIdForLineageKey = useCallback(
    (locationLineageKey: LocationLineageKey) =>
      locationIdByLineageKey.get(locationLineageKey),
    [locationIdByLineageKey],
  );

  const getPractitionerLineageKeyForDisplayId = useCallback(
    (practitionerId: Id<"practitioners">) =>
      practitionerLineageKeyById.get(practitionerId),
    [practitionerLineageKeyById],
  );

  const getPractitionerIdForLineageKey = useCallback(
    (practitionerLineageKey: PractitionerLineageKey) =>
      practitionerIdByLineageKey.get(practitionerLineageKey),
    [practitionerIdByLineageKey],
  );

  const resolveAppointmentReferenceLineageKeys = useCallback(
    (args: {
      appointmentTypeId: Id<"appointmentTypes">;
      locationId: Id<"locations">;
      practitionerId?: Id<"practitioners">;
    }) => resolveAppointmentLineageRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveAppointmentReferenceDisplayIds = useCallback(
    (args: {
      appointmentTypeLineageKey: AppointmentTypeLineageKey;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
    }) => resolveAppointmentDisplayRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceLineageKeys = useCallback(
    (args: {
      locationId: Id<"locations">;
      practitionerId?: Id<"practitioners">;
    }) => resolveBlockedSlotLineageRefs(args, referenceMaps),
    [referenceMaps],
  );

  const resolveBlockedSlotReferenceDisplayIds = useCallback(
    (args: {
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey?: PractitionerLineageKey;
    }) => resolveBlockedSlotDisplayRefs(args, referenceMaps),
    [referenceMaps],
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
      const resolvedBlockedSlotId = findIdInList(
        [
          ...blockedSlotHistoryDocMapRef.current.keys(),
          ...blockedSlotDocMapRef.current.keys(),
          ...allPracticeBlockedSlotDocMapRef.current.keys(),
        ],
        blockedSlotId,
      );
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
    [
      allPracticeBlockedSlotDocMapRef,
      blockedSlotDocMapRef,
      getBlockedSlotHistoryDoc,
      referenceMaps,
    ],
  );

  const placementAppointmentTypeLineageKey =
    simulatedContext?.appointmentTypeLineageKey ??
    (selectedAppointmentTypeId === undefined
      ? undefined
      : appointmentTypeLineageKeyById.get(selectedAppointmentTypeId));
  const draggedAppointmentTypeLineageKey =
    draggedAppointment?.record.appointmentTypeLineageKey;

  const getUnsupportedPractitionerIdsForAppointmentType = useCallback(
    (
      appointmentTypeLineageKey: AppointmentTypeLineageKey | undefined,
      practitionerLineageKeys: Iterable<PractitionerLineageKey>,
    ) => {
      if (!appointmentTypeLineageKey) {
        return new Set<PractitionerLineageKey>();
      }

      const allowedPractitionerLineageKeys = new Set(
        appointmentTypeInfoByLineageKey.get(appointmentTypeLineageKey)
          ?.allowedPractitionerLineageKeys,
      );

      return new Set(
        [...practitionerLineageKeys].filter(
          (practitionerId) =>
            !allowedPractitionerLineageKeys.has(
              asPractitionerLineageKey(practitionerId),
            ),
        ),
      );
    },
    [appointmentTypeInfoByLineageKey],
  );

  const createBlockedSlotsForColumns = useCallback(
    (
      columns: CalendarColumn[],
      reason: string,
      predicate: (column: CalendarColumn) => boolean,
      totalSlots: number,
    ) => {
      return columns.flatMap((column) =>
        predicate(column)
          ? Array.from({ length: totalSlots }, (_, slot) => ({
              column: column.id,
              reason,
              slot,
            }))
          : [],
      );
    },
    [],
  );

  const getAppointmentCreationEnd = useCallback(
    (args: { durationMinutes: number; start: string }): string => {
      return Temporal.ZonedDateTime.from(args.start)
        .add({ minutes: args.durationMinutes })
        .toString();
    },
    [],
  );

  const buildCreatedAppointmentHistoryDoc = useCallback(
    (args: {
      appointmentTypeLineageKey: AppointmentTypeLineageKey;
      appointmentTypeTitle: string;
      createdId: Id<"appointments">;
      createEnd: string;
      createStart: string;
      isSimulation: boolean;
      locationLineageKey: LocationLineageKey;
      patientId?: Id<"patients">;
      practiceId: Id<"practices">;
      practitionerLineageKey?: PractitionerLineageKey;
      replacesAppointmentId?: Id<"appointments">;
      title: string;
      userId?: Id<"users">;
    }): CalendarAppointmentRecord | null => {
      const start = parseZonedDateTime(
        args.createStart,
        "useCalendarLogic.buildCreatedAppointmentHistoryDoc.start",
      );
      const end = parseZonedDateTime(
        args.createEnd,
        "useCalendarLogic.buildCreatedAppointmentHistoryDoc.end",
      );
      if (!start || !end) {
        return null;
      }

      const now = Date.now();
      return {
        _creationTime: now,
        _id: args.createdId,
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        appointmentTypeTitle: args.appointmentTypeTitle,
        createdAt: BigInt(now),
        end,
        isSimulation: args.isSimulation,
        lastModified: BigInt(now),
        locationLineageKey: args.locationLineageKey,
        ...(args.patientId && { patientId: args.patientId }),
        practiceId: args.practiceId,
        ...(args.practitionerLineageKey && {
          practitionerLineageKey: args.practitionerLineageKey,
        }),
        ...(args.replacesAppointmentId && {
          replacesAppointmentId: args.replacesAppointmentId,
        }),
        start,
        title: args.title,
        ...(args.userId && { userId: args.userId }),
      };
    },
    [parseZonedDateTime],
  );

  const {
    canRedo: canRedoHistoryAction,
    canUndo: canUndoHistoryAction,
    pushAction: pushHistoryAction,
    redo: redoHistoryAction,
    undo: undoHistoryAction,
  } = useLocalHistory();
  const appointmentQueryRef = api.appointments.getCalendarDayAppointments;
  const blockedSlotQueryRef = api.appointments.getCalendarDayBlockedSlots;

  const toEpochMilliseconds = useCallback((iso: string) => {
    return Temporal.ZonedDateTime.from(iso).epochMilliseconds;
  }, []);

  const hasAppointmentConflict = useCallback(
    (
      candidate: {
        end: string;
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        replacesAppointmentId?: Id<"appointments">;
        start: string;
      },
      excludeId?: Id<"appointments">,
    ) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: allPracticeAppointmentDocMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: allPracticeBlockedSlotDocMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      allPracticeAppointmentDocMapRef,
      allPracticeBlockedSlotDocMapRef,
      toEpochMilliseconds,
    ],
  );

  const hasBlockedSlotConflict = useCallback(
    (
      candidate: {
        end: string;
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        start: string;
      },
      excludeId?: Id<"blockedSlots">,
    ) => {
      return hasCalendarOccupancyConflictInRecords({
        appointments: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: allPracticeAppointmentDocMapRef.current,
          excludedIds: deletedAppointmentIdsRef.current,
          historyMap: appointmentHistoryDocMapRef.current,
        }),
        blockedSlots: mergeCurrentConflictRecordsByIdExcluding({
          allPracticeMap: allPracticeBlockedSlotDocMapRef.current,
          excludedIds: deletedBlockedSlotIdsRef.current,
          historyMap: blockedSlotHistoryDocMapRef.current,
        }),
        candidate,
        ...(excludeId === undefined ? {} : { excludeId }),
        toEpochMilliseconds,
      });
    },
    [
      allPracticeAppointmentDocMapRef,
      allPracticeBlockedSlotDocMapRef,
      toEpochMilliseconds,
    ],
  );

  const ensureLatestConflictData = useCallback(async () => {
    await refreshAllPracticeConflictData();
  }, [refreshAllPracticeConflictData]);

  const runUndo = useCallback(async () => {
    const result = await undoHistoryAction();
    if (result.status === "conflict") {
      toast.error("Änderung konnte nicht rückgängig gemacht werden", {
        description: result.message,
      });
    }
  }, [undoHistoryAction]);

  const runRedo = useCallback(async () => {
    const result = await redoHistoryAction();
    if (result.status === "conflict") {
      toast.error("Änderung konnte nicht wiederhergestellt werden", {
        description: result.message,
      });
    }
  }, [redoHistoryAction]);

  const calendarUndoRedoControls = useMemo(
    () =>
      canUndoHistoryAction || canRedoHistoryAction
        ? {
            canRedo: canRedoHistoryAction,
            canUndo: canUndoHistoryAction,
            onRedo: runRedo,
            onUndo: runUndo,
          }
        : null,
    [canRedoHistoryAction, canUndoHistoryAction, runRedo, runUndo],
  );

  useRegisterGlobalUndoRedoControls(calendarUndoRedoControls);

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
            "useCalendarLogic.optimisticCreate",
          );
          if (!appointmentTypeInfo) {
            return;
          }
          const lineageRefs = resolveAppointmentReferenceLineageKeys({
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
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
            "useCalendarLogic.optimisticCreate.start",
          );
          const typedEnd = parseZonedDateTime(
            optimisticEnd,
            "useCalendarLogic.optimisticCreate.end",
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
            locationLineageKey: lineageRefs.locationLineageKey,
            practiceId: optimisticArgs.practiceId,
            start: typedStart,
            title: optimisticArgs.title,
          };

          if (
            optimisticArgs.practitionerId !== undefined &&
            lineageRefs.practitionerLineageKey !== undefined
          ) {
            newAppointmentRecord.practitionerLineageKey =
              lineageRefs.practitionerLineageKey;
          }

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
      appointmentQueryRef,
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
                "useCalendarLogic.optimisticUpdate.start",
              );
        const nextEnd =
          optimisticArgs.end === undefined
            ? undefined
            : parseZonedDateTime(
                optimisticArgs.end,
                "useCalendarLogic.optimisticUpdate.end",
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

        const lineageRefs =
          optimisticArgs.locationId === undefined &&
          optimisticArgs.practitionerId === undefined
            ? null
            : resolveBlockedSlotReferenceLineageKeys({
                locationId: optimisticArgs.locationId ?? appointment.locationId,
                ...(optimisticArgs.practitionerId === undefined
                  ? appointment.practitionerId === undefined
                    ? {}
                    : { practitionerId: appointment.practitionerId }
                  : { practitionerId: optimisticArgs.practitionerId }),
              });

        const nextRecord: CalendarAppointmentRecord = {
          ...currentRecord,
          ...timeUpdates,
          ...(lineageRefs === null
            ? {}
            : {
                locationLineageKey: lineageRefs.locationLineageKey,
                ...(lineageRefs.practitionerLineageKey === undefined
                  ? {}
                  : {
                      practitionerLineageKey:
                        lineageRefs.practitionerLineageKey,
                    }),
              }),
          ...(optimisticArgs.title !== undefined && {
            title: optimisticArgs.title,
          }),
          lastModified: BigInt(now),
        };

        return toCalendarAppointmentResult({
          appointmentTypeId: appointment.appointmentTypeId,
          locationId: optimisticArgs.locationId ?? appointment.locationId,
          ...(optimisticArgs.practitionerId === undefined
            ? appointment.practitionerId === undefined
              ? {}
              : { practitionerId: appointment.practitionerId }
            : { practitionerId: optimisticArgs.practitionerId }),
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
      appointmentQueryRef,
      calendarDayQueryArgs,
      parseZonedDateTime,
      resolveBlockedSlotReferenceLineageKeys,
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
    [appointmentQueryRef, calendarDayQueryArgs, deleteAppointmentMutation],
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
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
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
            locationLineageKey: lineageRefs.locationLineageKey,
            practiceId: optimisticArgs.practiceId,
            start: optimisticArgs.start,
            title: optimisticArgs.title,
          };

          if (
            optimisticArgs.practitionerId !== undefined &&
            lineageRefs.practitionerLineageKey !== undefined
          ) {
            newBlockedSlotRecord.practitionerLineageKey =
              lineageRefs.practitionerLineageKey;
          }

          if (optimisticArgs.replacesBlockedSlotId !== undefined) {
            newBlockedSlotRecord.replacesBlockedSlotId =
              optimisticArgs.replacesBlockedSlotId;
          }
          const newBlockedSlot = toCalendarBlockedSlotResult({
            locationId: optimisticArgs.locationId,
            ...(optimisticArgs.practitionerId === undefined
              ? {}
              : { practitionerId: optimisticArgs.practitionerId }),
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
      blockedSlotQueryRef,
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
            const lineageRefs =
              optimisticArgs.locationId === undefined &&
              optimisticArgs.practitionerId === undefined
                ? null
                : resolveBlockedSlotReferenceLineageKeys({
                    locationId: optimisticArgs.locationId ?? slot.locationId,
                    ...(optimisticArgs.practitionerId === undefined
                      ? slot.practitionerId === undefined
                        ? {}
                        : { practitionerId: slot.practitionerId }
                      : { practitionerId: optimisticArgs.practitionerId }),
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
              ...(lineageRefs === null
                ? {}
                : {
                    locationLineageKey: lineageRefs.locationLineageKey,
                    ...(lineageRefs.practitionerLineageKey === undefined
                      ? {}
                      : {
                          practitionerLineageKey:
                            lineageRefs.practitionerLineageKey,
                        }),
                  }),
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
              ...(optimisticArgs.practitionerId === undefined
                ? slot.practitionerId === undefined
                  ? {}
                  : { practitionerId: slot.practitionerId }
                : { practitionerId: optimisticArgs.practitionerId }),
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
      blockedSlotQueryRef,
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
    [blockedSlotQueryRef, blockedSlotsQueryArgs, deleteBlockedSlotMutation],
  );

  const runCreateAppointment = useCallback(
    async (args: Parameters<typeof createAppointmentMutation>[0]) => {
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        args.appointmentTypeId,
        "useCalendarLogic.runCreateAppointment",
      );
      if (!appointmentTypeInfo) {
        toast.error("Die Terminart konnte nicht geladen werden.");
        return;
      }
      if (appointmentTypeInfo.hasFollowUpPlan) {
        return await createAppointmentMutation(args);
      }

      const createdId = await runCreateAppointmentInternal(args);
      if (!createdId) {
        return createdId;
      }

      let currentAppointmentId: Id<"appointments"> = createdId;
      const createArgs = { ...args, isSimulation: args.isSimulation ?? false };
      const createEnd = getAppointmentCreationEnd({
        durationMinutes: appointmentTypeInfo.duration,
        start: createArgs.start,
      });
      const appointmentReferences = resolveAppointmentReferenceLineageKeys({
        appointmentTypeId: createArgs.appointmentTypeId,
        locationId: createArgs.locationId,
        ...(createArgs.practitionerId && {
          practitionerId: createArgs.practitionerId,
        }),
      });
      if (!appointmentReferences) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      const createdAppointmentHistoryDoc = buildCreatedAppointmentHistoryDoc({
        appointmentTypeLineageKey:
          appointmentReferences.appointmentTypeLineageKey,
        appointmentTypeTitle: appointmentTypeInfo.name,
        createdId,
        createEnd,
        createStart: createArgs.start,
        isSimulation: createArgs.isSimulation,
        locationLineageKey: appointmentReferences.locationLineageKey,
        ...(createArgs.patientId && { patientId: createArgs.patientId }),
        practiceId: createArgs.practiceId,
        ...(appointmentReferences.practitionerLineageKey && {
          practitionerLineageKey: appointmentReferences.practitionerLineageKey,
        }),
        ...(createArgs.replacesAppointmentId && {
          replacesAppointmentId: createArgs.replacesAppointmentId,
        }),
        title: createArgs.title,
        ...(createArgs.userId && { userId: createArgs.userId }),
      });
      if (createdAppointmentHistoryDoc) {
        rememberAppointmentHistoryDoc(createdAppointmentHistoryDoc);
      }

      pushHistoryAction({
        label: "Termin erstellt",
        redo: async () => {
          await ensureLatestConflictData();
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation,
              locationLineageKey: appointmentReferences.locationLineageKey,
              ...(appointmentReferences.practitionerLineageKey && {
                practitionerLineageKey:
                  appointmentReferences.practitionerLineageKey,
              }),
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
          const recreatedAppointmentHistoryDoc =
            buildCreatedAppointmentHistoryDoc({
              appointmentTypeLineageKey:
                appointmentReferences.appointmentTypeLineageKey,
              appointmentTypeTitle: appointmentTypeInfo.name,
              createdId: recreatedId,
              createEnd,
              createStart: createArgs.start,
              isSimulation: createArgs.isSimulation,
              locationLineageKey: appointmentReferences.locationLineageKey,
              ...(createArgs.patientId && { patientId: createArgs.patientId }),
              practiceId: createArgs.practiceId,
              ...(appointmentReferences.practitionerLineageKey && {
                practitionerLineageKey:
                  appointmentReferences.practitionerLineageKey,
              }),
              ...(createArgs.replacesAppointmentId && {
                replacesAppointmentId: createArgs.replacesAppointmentId,
              }),
              title: createArgs.title,
              ...(createArgs.userId && { userId: createArgs.userId }),
            });
          if (recreatedAppointmentHistoryDoc) {
            rememberAppointmentHistoryDoc(recreatedAppointmentHistoryDoc);
          }
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
      buildCreatedAppointmentHistoryDoc,
      createAppointmentMutation,
      ensureLatestConflictData,
      forgetAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveAppointmentReferenceLineageKeys,
      runCreateAppointmentInternal,
      runDeleteAppointmentInternal,
    ],
  );

  const runUpdateAppointment = useCallback(
    async (args: Parameters<typeof updateAppointmentMutation>[0]) => {
      const before = getAppointmentHistoryDoc(args.id);
      if (before?.seriesId) {
        await getAppointmentUpdateMutation(before)(args);
        return;
      }

      const nextLocationLineageKey =
        args.locationId === undefined
          ? before?.locationLineageKey
          : getLocationLineageKeyForDisplayId(args.locationId);
      if (
        args.locationId !== undefined &&
        nextLocationLineageKey === undefined
      ) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return;
      }
      const nextPractitionerLineageKey =
        args.practitionerId === undefined
          ? before?.practitionerLineageKey
          : getPractitionerLineageKeyForDisplayId(args.practitionerId);
      if (
        args.practitionerId !== undefined &&
        nextPractitionerLineageKey === undefined
      ) {
        toast.error("Behandler konnte nicht aufgelöst werden.");
        return;
      }

      await runUpdateAppointmentInternal(args);

      if (!before) {
        return;
      }

      const beforeState = {
        end: before.end,
        locationLineageKey: before.locationLineageKey,
        practitionerLineageKey: before.practitionerLineageKey,
        start: before.start,
      };
      const typedEnd =
        args.end === undefined
          ? undefined
          : parseZonedDateTime(args.end, "useCalendarLogic.afterState.end");
      const typedStart =
        args.start === undefined
          ? undefined
          : parseZonedDateTime(args.start, "useCalendarLogic.afterState.start");
      if (
        (args.end !== undefined && typedEnd === null) ||
        (args.start !== undefined && typedStart === null)
      ) {
        return;
      }
      const afterState = {
        end: typedEnd ?? before.end,
        locationLineageKey: nextLocationLineageKey ?? before.locationLineageKey,
        practitionerLineageKey:
          nextPractitionerLineageKey ?? before.practitionerLineageKey,
        start: typedStart ?? before.start,
      };
      const afterSnapshot: CalendarAppointmentRecord = {
        ...before,
        end: afterState.end,
        locationLineageKey: afterState.locationLineageKey,
        ...(afterState.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: afterState.practitionerLineageKey }),
        start: afterState.start,
      };
      rememberAppointmentHistoryDoc(afterSnapshot);

      const matchesState = (
        appointment: CalendarAppointmentRecord,
        expected: typeof beforeState,
      ) =>
        appointment.start === expected.start &&
        appointment.end === expected.end &&
        appointment.locationLineageKey === expected.locationLineageKey &&
        appointment.practitionerLineageKey === expected.practitionerLineageKey;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: CalendarAppointmentRecord["end"];
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        start: CalendarAppointmentRecord["start"];
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationLineageKey: state.locationLineageKey,
        ...(state.practitionerLineageKey && {
          practitionerLineageKey: state.practitionerLineageKey,
        }),
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

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: afterState.locationLineageKey,
            ...(afterState.practitionerLineageKey && {
              practitionerLineageKey: afterState.practitionerLineageKey,
            }),
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
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
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

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: beforeState.locationLineageKey,
            ...(beforeState.practitionerLineageKey && {
              practitionerLineageKey: beforeState.practitionerLineageKey,
            }),
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
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
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
      getLocationLineageKeyForDisplayId,
      getPractitionerLineageKeyForDisplayId,
      hasAppointmentConflict,
      parseZonedDateTime,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
      runUpdateAppointmentInternal,
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
        locationLineageKey: deleted.locationLineageKey,
        ...(deleted.practitionerLineageKey && {
          practitionerLineageKey: deleted.practitionerLineageKey,
        }),
      });
      if (!recreatedDisplayRefs) {
        toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
        return;
      }

      const createArgs: Parameters<typeof createAppointmentMutation>[0] = {
        appointmentTypeId: recreatedDisplayRefs.appointmentTypeId,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        ...(deleted.patientId && { patientId: deleted.patientId }),
        practiceId: deleted.practiceId,
        ...(recreatedDisplayRefs.practitionerId && {
          practitionerId: recreatedDisplayRefs.practitionerId,
        }),
        ...(deleted.replacesAppointmentId && {
          replacesAppointmentId: deleted.replacesAppointmentId,
        }),
        start: deleted.start,
        title: deleted.title,
        ...(deleted.userId && { userId: deleted.userId }),
      };
      const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
        createArgs.appointmentTypeId,
        "useCalendarLogic.runDeleteAppointment",
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
              locationLineageKey: deleted.locationLineageKey,
              ...(deleted.practitionerLineageKey && {
                practitionerLineageKey: deleted.practitionerLineageKey,
              }),
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
        ...(createArgs.practitionerId && {
          practitionerId: createArgs.practitionerId,
        }),
      });
      if (!blockedSlotReferences) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return createdId;
      }
      rememberBlockedSlotHistoryDoc({
        _creationTime: now,
        _id: createdId,
        createdAt: BigInt(now),
        end: createArgs.end,
        isSimulation: createArgs.isSimulation,
        lastModified: BigInt(now),
        locationLineageKey: blockedSlotReferences.locationLineageKey,
        practiceId: createArgs.practiceId,
        ...(blockedSlotReferences.practitionerLineageKey && {
          practitionerLineageKey: blockedSlotReferences.practitionerLineageKey,
        }),
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
              locationLineageKey: blockedSlotReferences.locationLineageKey,
              ...(blockedSlotReferences.practitionerLineageKey && {
                practitionerLineageKey:
                  blockedSlotReferences.practitionerLineageKey,
              }),
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
          rememberBlockedSlotHistoryDoc({
            _creationTime: now,
            _id: recreatedId,
            createdAt: BigInt(now),
            end: createArgs.end,
            isSimulation: createArgs.isSimulation,
            lastModified: BigInt(now),
            locationLineageKey: blockedSlotReferences.locationLineageKey,
            practiceId: createArgs.practiceId,
            ...(blockedSlotReferences.practitionerLineageKey && {
              practitionerLineageKey:
                blockedSlotReferences.practitionerLineageKey,
            }),
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
      rememberBlockedSlotHistoryDoc,
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
          ? before?.locationLineageKey
          : getLocationLineageKeyForDisplayId(args.locationId);
      if (
        args.locationId !== undefined &&
        nextLocationLineageKey === undefined
      ) {
        toast.error("Standort konnte nicht aufgelöst werden.");
        return;
      }
      const nextPractitionerLineageKey =
        args.practitionerId === undefined
          ? before?.practitionerLineageKey
          : getPractitionerLineageKeyForDisplayId(args.practitionerId);
      if (
        args.practitionerId !== undefined &&
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
        locationLineageKey: before.locationLineageKey,
        practitionerLineageKey: before.practitionerLineageKey,
        start: before.start,
        title: before.title,
      };

      const afterState = {
        end: args.end ?? before.end,
        locationLineageKey: nextLocationLineageKey ?? before.locationLineageKey,
        practitionerLineageKey:
          nextPractitionerLineageKey ?? before.practitionerLineageKey,
        start: args.start ?? before.start,
        title: args.title ?? before.title,
      };
      const afterSnapshot: CalendarBlockedSlotRecord = {
        ...before,
        end: afterState.end,
        locationLineageKey: afterState.locationLineageKey,
        ...(afterState.practitionerLineageKey === undefined
          ? {}
          : { practitionerLineageKey: afterState.practitionerLineageKey }),
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
        slot.locationLineageKey === expected.locationLineageKey &&
        slot.practitionerLineageKey === expected.practitionerLineageKey &&
        slot.title === expected.title;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: string;
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey?: PractitionerLineageKey;
        start: string;
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationLineageKey: state.locationLineageKey,
        ...(state.practitionerLineageKey && {
          practitionerLineageKey: state.practitionerLineageKey,
        }),
        start: state.start,
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

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: afterState.locationLineageKey,
            ...(afterState.practitionerLineageKey && {
              practitionerLineageKey: afterState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Die Sperrung kann nicht erneut angewendet werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal({
            end: afterState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: afterState.start,
            title: afterState.title,
          });
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

          const displayRefs = resolveBlockedSlotReferenceDisplayIds({
            locationLineageKey: beforeState.locationLineageKey,
            ...(beforeState.practitionerLineageKey && {
              practitionerLineageKey: beforeState.practitionerLineageKey,
            }),
          });
          if (!displayRefs) {
            return {
              message:
                "Die ursprüngliche Sperrung kann nicht wiederhergestellt werden, weil die Referenzen nicht mehr aufgelöst werden konnten.",
              status: "conflict",
            };
          }

          await runUpdateBlockedSlotInternal({
            end: beforeState.end,
            id: args.id,
            locationId: displayRefs.locationId,
            ...(displayRefs.practitionerId && {
              practitionerId: displayRefs.practitionerId,
            }),
            start: beforeState.start,
            title: beforeState.title,
          });
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
      rememberBlockedSlotHistoryDoc,
      resolveBlockedSlotReferenceDisplayIds,
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
      const recreatedDisplayRefs = resolveBlockedSlotReferenceDisplayIds({
        locationLineageKey: deleted.locationLineageKey,
        ...(deleted.practitionerLineageKey && {
          practitionerLineageKey: deleted.practitionerLineageKey,
        }),
      });
      if (!recreatedDisplayRefs) {
        toast.error("Sperrungs-Referenzen konnten nicht aufgelöst werden.");
        return mutationResult;
      }
      const createArgs: Parameters<typeof createBlockedSlotMutation>[0] = {
        end: deleted.end,
        isSimulation: deleted.isSimulation ?? false,
        locationId: recreatedDisplayRefs.locationId,
        practiceId: deleted.practiceId,
        ...(recreatedDisplayRefs.practitionerId && {
          practitionerId: recreatedDisplayRefs.practitionerId,
        }),
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
              locationLineageKey: deleted.locationLineageKey,
              ...(deleted.practitionerLineageKey && {
                practitionerLineageKey: deleted.practitionerLineageKey,
              }),
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

  // Resolve location name from URL
  useEffect(() => {
    if (
      !locationName ||
      !locationsData ||
      selectedLocationId ||
      hasResolvedLocationRef.current
    ) {
      return;
    }
    const match = locationsData.find(
      (l: { name: string }) => l.name === locationName,
    );
    if (match) {
      hasResolvedLocationRef.current = true;
      // Use a microtask to avoid setState during render
      queueMicrotask(() => {
        setInternalSelectedLocationId(match._id);
        if (onLocationResolved) {
          onLocationResolved(match._id, match.name);
        }
      });
    }
  }, [locationName, locationsData, onLocationResolved, selectedLocationId]);

  // Sync selected date with simulation date during render
  const [prevSimulationDate, setPrevSimulationDate] = useState(simulationDate);
  if (simulationDate && simulationDate !== prevSimulationDate) {
    setPrevSimulationDate(simulationDate);
    setSelectedDate(simulationDate);
  }

  // Notify parent when date changes
  const handleDateChange = useCallback(
    (nextDate: Temporal.PlainDate) => {
      if (Temporal.PlainDate.compare(selectedDate, nextDate) === 0) {
        return;
      }

      setSelectedDate(nextDate);
      onDateChange?.(nextDate);
    },
    [selectedDate, onDateChange],
  );

  // Temporal uses 1-7 (Monday=1), convert to 0-6 (Sunday=0) for database compatibility
  const currentDayOfWeek = temporalDayToLegacy(selectedDate);

  // Helper function to convert time string to minutes
  const timeToMinutes = useCallback((timeStr: string): null | number => {
    try {
      const time = Temporal.PlainTime.from(timeStr);
      return time.hour * 60 + time.minute;
    } catch {
      captureErrorGlobal(new Error(`Invalid time format: "${timeStr}"`), {
        context: "NewCalendar - Invalid time format in timeToMinutes",
        expectedFormat: "HH:mm",
        timeStr,
      });
      return null;
    }
  }, []);

  // Calculate working practitioners and business hours
  const {
    businessEndHour,
    businessStartHour,
    columns,
    totalSlots,
    workingPractitioners,
  } = useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return {
        businessEndHour: 0,
        businessStartHour: 0,
        columns: [],
        totalSlots: 0,
        workingPractitioners: [],
      };
    }

    const practitionerNameByDisplayId = new Map(
      practitionersData.map((practitioner) => [
        practitioner._id,
        practitioner.name,
      ]),
    );

    let daySchedules = baseSchedulesData.filter(
      (schedule) => schedule.dayOfWeek === currentDayOfWeek,
    );
    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));

    if (simulatedContext?.locationLineageKey && effectiveLocationLineageKey) {
      daySchedules = daySchedules.filter(
        (schedule) =>
          schedule.locationLineageKey === effectiveLocationLineageKey,
      );
    } else if (selectedLocationId && effectiveLocationLineageKey) {
      daySchedules = daySchedules.filter(
        (schedule) =>
          schedule.locationLineageKey === effectiveLocationLineageKey,
      );
    }

    const appointmentsForSelectedDate = appointmentsData.filter(
      (appointment) => {
        if (!appointment.practitionerLineageKey) {
          return false;
        }

        if (
          Temporal.PlainDate.compare(
            Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
            selectedDate,
          ) !== 0
        ) {
          return false;
        }

        if (
          effectiveLocationLineageKey !== undefined &&
          appointment.locationLineageKey !== effectiveLocationLineageKey
        ) {
          return false;
        }

        return true;
      },
    );
    const deletedPractitionerIds = new Set(
      practitionersData
        .filter((practitioner) => practitioner.deleted === true)
        .flatMap((practitioner) =>
          practitioner.lineageKey === undefined
            ? []
            : [practitioner.lineageKey],
        ),
    );
    const deletedPractitionerCalendarRanges =
      collectDeletedPractitionerCalendarRanges({
        appointments: appointmentsData,
        blockedSlots: blockedSlotsData,
        deletedPractitionerLineageKeys: deletedPractitionerIds,
        effectiveLocationLineageKey,
        selectedDate,
      });
    const deletedPractitionerIdsWithCalendarItems = new Set(
      deletedPractitionerCalendarRanges.map(
        (range) => range.practitionerLineageKey,
      ),
    );

    if (
      daySchedules.length === 0 &&
      deletedPractitionerIdsWithCalendarItems.size === 0
    ) {
      return {
        businessEndHour: 0,
        businessStartHour: 0,
        columns: [],
        totalSlots: 0,
        workingPractitioners: [],
      };
    }

    // Validate and filter schedules with invalid times
    let validSchedules = daySchedules.filter((schedule) => {
      const startMinutes = timeToMinutes(schedule.startTime);
      const endMinutes = timeToMinutes(schedule.endTime);

      if (startMinutes === null || endMinutes === null) {
        const practitionerName =
          practitionerNameByDisplayId.get(schedule.practitionerId) ??
          "Unbekannt";
        toast.error(
          `Ungültige Zeitangabe für ${practitionerName}: ${schedule.startTime}-${schedule.endTime}`,
        );
        return false;
      }
      return true;
    });

    const mutedPractitionerIds = new Set<Id<"practitioners">>();

    if (vacationsData) {
      const practitionersWithAppointments = new Set(
        appointmentsForSelectedDate
          .map((appointment) => appointment.practitionerLineageKey)
          .filter(Boolean),
      );

      const hiddenPractitionerIds = new Set(
        vacationsData
          .filter(
            (vacation) =>
              vacation.staffType === "practitioner" &&
              vacation.date === selectedDate.toString() &&
              vacation.portion === "full" &&
              vacation.practitionerLineageKey &&
              !practitionersWithAppointments.has(
                asPractitionerLineageKey(vacation.practitionerLineageKey),
              ),
          )
          .flatMap((vacation) => {
            if (!vacation.practitionerLineageKey) {
              return [];
            }
            return [asPractitionerLineageKey(vacation.practitionerLineageKey)];
          }),
      );

      for (const vacation of vacationsData) {
        if (
          vacation.staffType === "practitioner" &&
          vacation.date === selectedDate.toString() &&
          vacation.portion === "full" &&
          vacation.practitionerLineageKey &&
          practitionersWithAppointments.has(
            asPractitionerLineageKey(vacation.practitionerLineageKey),
          )
        ) {
          mutedPractitionerIds.add(
            asPractitionerLineageKey(vacation.practitionerLineageKey),
          );
        }
      }

      if (hiddenPractitionerIds.size > 0) {
        validSchedules = validSchedules.filter((schedule) => {
          const lineageKey = practitionerLineageKeyById.get(
            schedule.practitionerId,
          );
          return (
            lineageKey === undefined || !hiddenPractitionerIds.has(lineageKey)
          );
        });
      }
    }

    if (validSchedules.length < daySchedules.length) {
      const invalidCount = daySchedules.length - validSchedules.length;
      toast.warning(
        `${invalidCount} Zeitplan${invalidCount > 1 ? "e" : ""} mit ungültigen Zeiten wurde${invalidCount > 1 ? "n" : ""} übersprungen`,
      );
    }

    const working: WorkingPractitioner[] = validSchedules.flatMap(
      (schedule) => {
        const lineageKey = practitionerLineageKeyById.get(
          schedule.practitionerId,
        );
        if (!lineageKey) {
          return [];
        }

        return [
          {
            endTime: schedule.endTime,
            lineageKey,
            name:
              practitionerNameByLineageKey.get(lineageKey) ??
              practitionerNameByDisplayId.get(schedule.practitionerId) ??
              "Unbekannt",
            startTime: schedule.startTime,
          },
        ];
      },
    );
    const workingPractitionerIds = new Set(
      working.map((practitioner) => practitioner.lineageKey),
    );

    const formatMinutesAsTime = (minutes: number) => {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    };

    for (const {
      endMinutes,
      practitionerLineageKey,
      startMinutes,
    } of deletedPractitionerCalendarRanges) {
      const brandedPractitionerLineageKey = asPractitionerLineageKey(
        practitionerLineageKey,
      );
      mutedPractitionerIds.add(brandedPractitionerLineageKey);
      if (workingPractitionerIds.has(brandedPractitionerLineageKey)) {
        continue;
      }

      if (!practitionerIdByLineageKey.get(brandedPractitionerLineageKey)) {
        continue;
      }

      working.push({
        endTime: formatMinutesAsTime(endMinutes),
        lineageKey: brandedPractitionerLineageKey,
        name:
          practitionerNameByLineageKey.get(brandedPractitionerLineageKey) ??
          "Unbekannt",
        startTime: formatMinutesAsTime(startMinutes),
      });
      workingPractitionerIds.add(brandedPractitionerLineageKey);
    }

    const effectiveWorkingRanges = working.flatMap((practitioner) => {
      return getPractitionerAvailabilityRangesForDate(
        selectedDate,
        practitioner.lineageKey,
        baseSchedulesData,
        vacationsData ?? [],
        effectiveLocationLineageKey,
      );
    });
    const practitionerIds = new Set(
      working.map((practitioner) => practitioner.lineageKey),
    );
    const appointmentRanges = appointmentsForSelectedDate.flatMap(
      (appointment) => {
        if (
          appointment.practitionerLineageKey === undefined ||
          !practitionerIds.has(appointment.practitionerLineageKey)
        ) {
          return [];
        }

        const start = Temporal.ZonedDateTime.from(appointment.start);
        const end = Temporal.ZonedDateTime.from(appointment.end);

        return [
          {
            endMinutes: end.hour * 60 + end.minute,
            startMinutes: start.hour * 60 + start.minute,
          },
        ];
      },
    );
    const deletedPractitionerCalendarItemRanges =
      deletedPractitionerCalendarRanges.map(({ endMinutes, startMinutes }) => ({
        endMinutes,
        startMinutes,
      }));
    const visibleRanges = [
      ...effectiveWorkingRanges,
      ...appointmentRanges,
      ...deletedPractitionerCalendarItemRanges,
    ];

    const startTimes = visibleRanges.map((range) => range.startMinutes);
    const endTimes = visibleRanges.map((range) => range.endMinutes);

    if (startTimes.length === 0 || endTimes.length === 0) {
      return {
        businessEndHour: 0,
        businessStartHour: 0,
        columns: [],
        totalSlots: 0,
        workingPractitioners: [],
      };
    }

    const earliestStartMinutes = Math.min(...startTimes);
    const latestEndMinutes = Math.max(...endTimes);
    const businessStartHour = Math.floor(earliestStartMinutes / 60);
    const businessEndHour = Math.ceil(latestEndMinutes / 60);
    const totalSlots =
      ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

    const workingPractitionerIdList = working.map(
      (practitioner) => practitioner.lineageKey,
    );
    const placementUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        placementAppointmentTypeLineageKey,
        workingPractitionerIdList,
      );
    const dragUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        draggedAppointmentTypeLineageKey,
        workingPractitionerIdList,
      );

    const practitionerColumns: CalendarColumn[] = working.map(
      (practitioner) => ({
        id: practitioner.lineageKey,
        isAppointmentTypeUnavailable: placementUnsupportedPractitionerIds.has(
          practitioner.lineageKey,
        ),
        isDragDisabled: dragUnsupportedPractitionerIds.has(
          practitioner.lineageKey,
        ),
        isMuted:
          mutedPractitionerIds.has(practitioner.lineageKey) ||
          placementUnsupportedPractitionerIds.has(practitioner.lineageKey) ||
          dragUnsupportedPractitionerIds.has(practitioner.lineageKey),
        isUnavailable: deletedPractitionerIdsWithCalendarItems.has(
          practitioner.lineageKey,
        ),
        title: practitioner.name,
      }),
    );

    const specialColumns: CalendarColumn[] =
      working.length > 0
        ? [
            {
              id: "ekg",
              isMuted: false,
              isUnavailable: false,
              title: "EKG",
            },
            {
              id: "labor",
              isMuted: false,
              isUnavailable: false,
              title: "Labor",
            },
          ]
        : [];

    const allColumns = [...practitionerColumns, ...specialColumns];

    return {
      businessEndHour,
      businessStartHour,
      columns: allColumns,
      totalSlots,
      workingPractitioners: working,
    };
  }, [
    practitionersData,
    baseSchedulesData,
    currentDayOfWeek,
    appointmentsData,
    draggedAppointmentTypeLineageKey,
    locationLineageKeyById,
    getUnsupportedPractitionerIdsForAppointmentType,
    placementAppointmentTypeLineageKey,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    simulatedContext,
    selectedLocationId,
    selectedDate,
    timeToMinutes,
    blockedSlotsData,
    vacationsData,
  ]);

  const getPractitionerIdForColumn = useCallback(
    (column: CalendarColumnId): Id<"practitioners"> | undefined =>
      typeof column === "string" && (column === "ekg" || column === "labor")
        ? undefined
        : getPractitionerIdForLineageKey(column),
    [getPractitionerIdForLineageKey],
  );

  const baseAppointmentLayouts = useMemo(
    () => buildCalendarAppointmentLayouts({ appointments: appointmentsData }),
    [appointmentsData],
  );

  // Helper functions
  const timeToSlot = useCallback(
    (time: string) => {
      const minutesFromMidnight = timeToMinutes(time);
      if (minutesFromMidnight === null) {
        return 0; // Fallback to first slot if time is invalid
      }
      const minutesFromStart = minutesFromMidnight - businessStartHour * 60;
      return Math.floor(minutesFromStart / SLOT_DURATION);
    },
    [businessStartHour, timeToMinutes],
  );

  const slotToTime = useCallback(
    (slot: number) => {
      const minutesFromStart = businessStartHour * 60 + slot * SLOT_DURATION;
      const hours = Math.floor(minutesFromStart / 60);
      const minutes = minutesFromStart % 60;

      const time = new Temporal.PlainTime(hours, minutes);
      return formatTime(time);
    },
    [businessStartHour],
  );

  // Map blocked slots from query to calendar grid positions
  const baseBlockedSlots = useMemo(() => {
    if (workingPractitioners.length === 0) {
      return [];
    }

    const blocked: {
      blockedByRuleId?: Id<"ruleConditions">;
      column: CalendarColumnId;
      id?: string; // ID of the manual blocked slot, if applicable
      isManual?: boolean; // True if blocked by a manual block (not a rule)
      reason?: string;
      slot: number;
    }[] = [];

    // Add blocked slots from main query (appointment-type-dependent rules)
    if (slotsResult?.slots) {
      for (const slotData of slotsResult.slots) {
        if (slotData.status === "BLOCKED" && slotData.practitionerLineageKey) {
          // Find if this practitioner has a column
          const practitionerColumn = workingPractitioners.find(
            (p) => p.lineageKey === slotData.practitionerLineageKey,
          );

          if (practitionerColumn) {
            // Parse ZonedDateTime string from scheduling query
            const startTime = Temporal.ZonedDateTime.from(
              slotData.startTime,
            ).toPlainTime();
            const slot = timeToSlot(startTime.toString().slice(0, 5)); // "HH:MM" format

            // Check if this is a manual block (has blockedByBlockedSlotId)
            const isManualBlock = !!slotData.blockedByBlockedSlotId;

            blocked.push({
              column: practitionerColumn.lineageKey,
              slot,
              ...(slotData.reason && { reason: slotData.reason }),
              ...(slotData.blockedByRuleId && {
                blockedByRuleId: slotData.blockedByRuleId,
              }),
              ...(isManualBlock && {
                id: slotData.blockedByBlockedSlotId,
                isManual: true,
              }),
            });
          }
        }
      }
    }

    // Add blocked slots from appointment-type-independent rules query
    if (blockedSlotsWithoutAppointmentTypeResult?.slots) {
      for (const slotData of blockedSlotsWithoutAppointmentTypeResult.slots) {
        // Find if this practitioner has a column
        const practitionerColumn = workingPractitioners.find(
          (p) => p.lineageKey === slotData.practitionerLineageKey,
        );

        if (practitionerColumn) {
          // Parse ZonedDateTime string from scheduling query
          const startTime = Temporal.ZonedDateTime.from(
            slotData.startTime,
          ).toPlainTime();
          const slot = timeToSlot(startTime.toString().slice(0, 5)); // "HH:MM" format

          // Check if this slot is already blocked by the main query
          // to avoid duplicates
          const alreadyBlocked = blocked.some(
            (b) =>
              b.column === practitionerColumn.lineageKey && b.slot === slot,
          );

          if (!alreadyBlocked) {
            // Check if this is a manual block (has blockedByBlockedSlotId)
            const isManualBlock = !!slotData.blockedByBlockedSlotId;

            blocked.push({
              column: practitionerColumn.lineageKey,
              slot,
              ...(slotData.reason && { reason: slotData.reason }),
              ...(slotData.blockedByRuleId && {
                blockedByRuleId: slotData.blockedByRuleId,
              }),
              ...(isManualBlock && {
                id: slotData.blockedByBlockedSlotId,
                isManual: true,
              }),
            });
          }
        }
      }
    }

    return blocked;
  }, [
    slotsResult,
    blockedSlotsWithoutAppointmentTypeResult,
    workingPractitioners,
    timeToSlot,
  ]);

  // Map break times from base schedules and merge them into blocked slots
  const baseBreakSlots = useMemo(() => {
    if (!baseSchedulesData || workingPractitioners.length === 0) {
      return [];
    }

    const breaks: {
      column: CalendarColumnId;
      reason?: string;
      slot: number;
    }[] = [];

    for (const schedule of baseSchedulesData) {
      if (!schedule.breakTimes || schedule.breakTimes.length === 0) {
        continue;
      }

      // Find if this practitioner has a column
      const practitionerColumn = workingPractitioners.find(
        (p) =>
          p.lineageKey ===
          practitionerLineageKeyById.get(schedule.practitionerId),
      );

      if (!practitionerColumn) {
        continue;
      }

      for (const breakTime of schedule.breakTimes) {
        const startSlot = timeToSlot(breakTime.start);
        const endSlot = timeToSlot(breakTime.end);

        // Add each individual slot from the break as a blocked slot
        for (let slot = startSlot; slot < endSlot; slot++) {
          breaks.push({
            column: practitionerColumn.lineageKey,
            reason: "Pause",
            slot,
          });
        }
      }
    }

    return breaks;
  }, [
    baseSchedulesData,
    practitionerLineageKeyById,
    timeToSlot,
    workingPractitioners,
  ]);

  // Map manually created blocked slots from database
  const baseManualBlockedSlots = useMemo<CalendarManualBlockedSlot[]>(() => {
    if (workingPractitioners.length === 0) {
      return [];
    }

    const manual: {
      column: CalendarColumnId;
      duration?: number;
      id?: string;
      isManual?: boolean;
      reason?: string;
      slot: number;
      startSlot?: number;
      title?: string;
    }[] = [];

    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));
    const dateFilteredBlocks = filterBlockedSlotsForDateAndLocation(
      blockedSlotsData,
      selectedDate,
      effectiveLocationLineageKey,
    );

    for (const blockedSlot of dateFilteredBlocks) {
      // Find if this practitioner has a column
      const practitionerColumn = blockedSlot.practitionerLineageKey
        ? workingPractitioners.find(
            (p) => p.lineageKey === blockedSlot.practitionerLineageKey,
          )
        : undefined;

      if (practitionerColumn) {
        const startTime = Temporal.ZonedDateTime.from(
          blockedSlot.start,
        ).toPlainTime();
        const endTime = Temporal.ZonedDateTime.from(
          blockedSlot.end,
        ).toPlainTime();

        const startSlot = timeToSlot(startTime.toString().slice(0, 5));
        const endSlot = timeToSlot(endTime.toString().slice(0, 5));

        // Calculate duration in minutes
        const durationMinutes =
          Temporal.PlainTime.compare(endTime, startTime) >= 0
            ? endTime.since(startTime).total("minutes")
            : 0;

        // Add each individual slot from the blocked time range
        // All slots from the same blocked slot share the same id so they can be grouped
        for (let slot = startSlot; slot < endSlot; slot++) {
          manual.push({
            column: practitionerColumn.lineageKey,
            duration: durationMinutes,
            id: blockedSlot._id,
            isManual: true,
            reason: blockedSlot.title,
            slot,
            startSlot,
            title: blockedSlot.title,
          });
        }
      } else if (blockedSlot.practitionerLineageKey) {
        captureFrontendError(
          invalidStateError(
            "Manual blocked slot practitioner not in visible columns.",
            "useCalendarLogic.manualBlockedSlots",
          ),
          {
            blockedSlotId: blockedSlot._id,
            locationLineageKey: blockedSlot.locationLineageKey,
            practitionerLineageKey: blockedSlot.practitionerLineageKey,
            selectedDate: selectedDate.toString(),
          },
          `manualBlockedSlotMissingColumn:${blockedSlot._id}`,
        );
      }
    }

    return manual;
  }, [
    blockedSlotsData,
    workingPractitioners,
    timeToSlot,
    selectedDate,
    selectedLocationId,
    locationLineageKeyById,
    simulatedContext?.locationLineageKey,
  ]);

  const baseVacationBlockedSlots = useMemo(() => {
    if (
      !baseSchedulesData ||
      !vacationsData ||
      workingPractitioners.length === 0
    ) {
      return [];
    }

    const blocked: {
      column: CalendarColumnId;
      reason?: string;
      slot: number;
    }[] = [];

    const effectiveLocationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId === undefined
        ? undefined
        : locationLineageKeyById.get(selectedLocationId));

    for (const practitioner of workingPractitioners) {
      const practitionerId = getPractitionerIdForLineageKey(
        practitioner.lineageKey,
      );
      if (!practitionerId) {
        continue;
      }

      const hasOnlyConflictFreeFullDayVacation =
        !appointmentsData.some(
          (appointment) =>
            appointment.practitionerLineageKey === practitioner.lineageKey &&
            Temporal.PlainDate.compare(
              Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
              selectedDate,
            ) === 0,
        ) &&
        vacationsData.some(
          (vacation) =>
            vacation.staffType === "practitioner" &&
            vacation.practitionerLineageKey === practitioner.lineageKey &&
            vacation.date === selectedDate.toString() &&
            vacation.portion === "full",
        );

      if (hasOnlyConflictFreeFullDayVacation) {
        continue;
      }

      const ranges = getPractitionerVacationRangesForDate(
        selectedDate,
        practitioner.lineageKey,
        baseSchedulesData,
        vacationsData,
        effectiveLocationLineageKey,
      );

      for (const range of ranges) {
        const startSlot = Math.floor(
          (range.startMinutes - businessStartHour * 60) / SLOT_DURATION,
        );
        const endSlot = Math.ceil(
          (range.endMinutes - businessStartHour * 60) / SLOT_DURATION,
        );

        for (let slot = Math.max(0, startSlot); slot < endSlot; slot++) {
          blocked.push({
            column: practitioner.lineageKey,
            reason: "Urlaub",
            slot,
          });
        }
      }
    }

    return blocked;
  }, [
    baseSchedulesData,
    businessStartHour,
    appointmentsData,
    locationLineageKeyById,
    selectedDate,
    selectedLocationId,
    simulatedContext,
    vacationsData,
    workingPractitioners,
    getPractitionerIdForLineageKey,
  ]);

  const baseUnavailablePractitionerBlockedSlots = useMemo(() => {
    return createBlockedSlotsForColumns(
      columns,
      "Behandler gelöscht",
      (column) => column.isUnavailable === true,
      totalSlots,
    );
  }, [columns, createBlockedSlotsForColumns, totalSlots]);

  const baseAppointmentTypeUnavailableBlockedSlots = useMemo(() => {
    return createBlockedSlotsForColumns(
      columns,
      "Behandler nicht für Terminart freigegeben",
      (column) => column.isAppointmentTypeUnavailable === true,
      totalSlots,
    );
  }, [columns, createBlockedSlotsForColumns, totalSlots]);

  const baseDragDisabledPractitionerBlockedSlots = useMemo(() => {
    return createBlockedSlotsForColumns(
      columns,
      "Behandler nicht für Terminart freigegeben",
      (column) => column.isDragDisabled === true,
      totalSlots,
    );
  }, [columns, createBlockedSlotsForColumns, totalSlots]);

  const getCurrentTimeSlot = useCallback(() => {
    if (totalSlots === 0) {
      return -1;
    }

    const currentDate = currentTime.toPlainDate();
    if (Temporal.PlainDate.compare(currentDate, selectedDate) !== 0) {
      return -1;
    }

    const { hour, minute } = currentTime;
    const minutesFromMidnight = hour * 60 + minute;
    const minutesFromStart = minutesFromMidnight - businessStartHour * 60;
    const totalBusinessMinutes = (businessEndHour - businessStartHour) * 60;

    if (
      minutesFromStart < 0 ||
      minutesFromStart >= totalBusinessMinutes ||
      Number.isNaN(minutesFromStart)
    ) {
      return -1;
    }

    return Math.floor(minutesFromStart / SLOT_DURATION);
  }, [
    businessEndHour,
    businessStartHour,
    currentTime,
    selectedDate,
    totalSlots,
  ]);

  const checkCollision = useCallback(
    (
      column: CalendarColumnId,
      startSlot: number,
      duration: number,
      excludeId?: string,
    ) => {
      const endSlot = startSlot + Math.ceil(duration / SLOT_DURATION);

      return baseAppointmentLayouts.some((apt) => {
        if (apt.id === excludeId || apt.column !== column) {
          return false;
        }

        const aptStartSlot = timeToSlot(apt.startTime);
        const aptEndSlot =
          aptStartSlot + Math.ceil(apt.duration / SLOT_DURATION);

        return !(endSlot <= aptStartSlot || startSlot >= aptEndSlot);
      });
    },
    [baseAppointmentLayouts, timeToSlot],
  );

  const findNearestAvailableSlot = useCallback(
    (
      column: CalendarColumnId,
      targetSlot: number,
      duration: number,
      excludeId?: string,
    ) => {
      const durationSlots = Math.ceil(duration / SLOT_DURATION);

      if (!checkCollision(column, targetSlot, duration, excludeId)) {
        return Math.max(0, Math.min(totalSlots - durationSlots, targetSlot));
      }

      let bestSlot = targetSlot;
      let minDistance = Number.POSITIVE_INFINITY;

      for (let distance = 0; distance <= totalSlots; distance++) {
        const slotAbove = targetSlot - distance;
        if (
          slotAbove >= 0 &&
          slotAbove + durationSlots <= totalSlots &&
          !checkCollision(column, slotAbove, duration, excludeId) &&
          distance < minDistance
        ) {
          minDistance = distance;
          bestSlot = slotAbove;
        }

        if (distance > 0) {
          const slotBelow = targetSlot + distance;
          if (
            slotBelow >= 0 &&
            slotBelow + durationSlots <= totalSlots &&
            !checkCollision(column, slotBelow, duration, excludeId) &&
            distance < minDistance
          ) {
            minDistance = distance;
            bestSlot = slotBelow;
          }
        }

        if (minDistance < Number.POSITIVE_INFINITY) {
          break;
        }
      }

      return Math.max(0, Math.min(totalSlots - durationSlots, bestSlot));
    },
    [checkCollision, totalSlots],
  );

  const getMaxAvailableDuration = useCallback(
    (column: CalendarColumnId, startSlot: number) => {
      const occupiedSlots = baseAppointmentLayouts
        .filter((apt) => apt.column === column)
        .map((apt) => ({
          end:
            timeToSlot(apt.startTime) + Math.ceil(apt.duration / SLOT_DURATION),
          start: timeToSlot(apt.startTime),
        }))
        .toSorted((a, b) => a.start - b.start);

      const nextOccupiedSlot = occupiedSlots.find(
        (range) => range.start > startSlot,
      );

      const maxSlots = nextOccupiedSlot
        ? nextOccupiedSlot.start - startSlot
        : totalSlots - startSlot;

      return Math.max(SLOT_DURATION, maxSlots * SLOT_DURATION);
    },
    [baseAppointmentLayouts, timeToSlot, totalSlots],
  );

  /**
   * Converts a real appointment into a simulated appointment for testing scheduling scenarios.
   *
   * This function creates a simulated version of a real appointment, which allows testing
   * "what-if" scenarios without affecting actual appointments. It validates all inputs,
   * handles type conversions, and ensures end-to-end type safety using Convex types.
   *
   * Type Safety Features:
   * - Uses Convex-inferred types for end-to-end type safety
   * - Validates simulatedContext structure at runtime with type narrowing
   * - Explicitly builds appointment data without unsafe spread operators
   * - Provides specific error messages for each failure scenario
   * @param appointment The real appointment to convert into a simulation
   * @param options Optional overrides for the simulated appointment properties
   * @returns The newly created simulated appointment, or null if conversion fails
   * @example
   * ```typescript
   * const simulated = await convertRealAppointmentToSimulation(
   *   realAppointment,
   *   { startISO: "2024-01-15T10:00:00Z", durationMinutes: 45 }
   * );
   * ```
   */
  const patientDateOfBirth = patient?.dateOfBirth;
  const patientIsNewPatient = patient?.isNewPatient;
  const convertRealAppointmentToSimulation = useCallback(
    async (
      appointment: CalendarAppointmentLayout,
      options: SimulationConversionOptions,
    ): Promise<CalendarAppointmentLayout | null> => {
      const appointmentRecord = appointment.record;

      // Early validation checks with specific error messages
      if (appointmentRecord.isSimulation === true) {
        return appointment;
      }

      const originalAppointmentId = appointmentRecord._id;

      if (!simulatedContext) {
        toast.error(
          "Simulation ist nicht aktiv. Termin kann nicht kopiert werden.",
        );
        return appointment;
      }

      const startZoned =
        options.startISO === undefined
          ? parsePlainTimeResult(
              appointment.startTime,
              "convertRealAppointmentToSimulation.startTime",
            ).match(
              (plainTime) =>
                selectedDate.toZonedDateTime({
                  plainTime,
                  timeZone: TIMEZONE,
                }),
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse start time",
                  startISO: options.startISO,
                  startTime: appointment.startTime,
                });
                toast.error("Startzeit konnte nicht ermittelt werden");
                return null;
              },
            )
          : resultFromNullable(
              safeParseISOToZoned(options.startISO),
              invalidStateError(
                `Invalid start ISO string: ${options.startISO}`,
                "convertRealAppointmentToSimulation.startISO",
              ),
            ).match(
              (parsedStart) => parsedStart,
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse start time",
                  startISO: options.startISO,
                  startTime: appointment.startTime,
                });
                toast.error("Startzeit konnte nicht ermittelt werden");
                return null;
              },
            );
      if (!startZoned) {
        return null;
      }

      const startISO = options.startISO ?? startZoned.toString();

      const endZoned =
        options.endISO === undefined
          ? startZoned.add({ minutes: appointment.duration })
          : resultFromNullable(
              safeParseISOToZoned(options.endISO),
              invalidStateError(
                `Invalid end ISO string: ${options.endISO}`,
                "convertRealAppointmentToSimulation.endISO",
              ),
            ).match(
              (parsedEnd) => parsedEnd,
              (error) => {
                captureFrontendError(error, {
                  context: "Failed to parse end time",
                  duration: appointment.duration,
                  endISO: options.endISO,
                });
                toast.error("Endzeit konnte nicht ermittelt werden");
                return null;
              },
            );
      if (!endZoned) {
        return null;
      }

      // Extract practitioner ID with proper type safety
      const practitionerId: Id<"practitioners"> | undefined =
        options.practitionerId ??
        getPractitionerIdForColumn(appointment.column) ??
        (appointmentRecord.practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(
              appointmentRecord.practitionerLineageKey,
            ));

      // Use validated simulatedContext with proper typing
      const contextLocationId: Id<"locations"> | undefined =
        simulatedContext.locationLineageKey === undefined
          ? undefined
          : getLocationIdForLineageKey(simulatedContext.locationLineageKey);

      // Determine location with explicit precedence
      const locationId: Id<"locations"> | undefined =
        options.locationId ??
        contextLocationId ??
        getLocationIdForLineageKey(appointmentRecord.locationLineageKey) ??
        selectedLocationId;

      if (!locationId) {
        toast.error(
          "Standort fehlt. Bitte wählen Sie einen Standort aus oder stellen Sie sicher, dass der Termin einen Standort hat.",
        );
        return null;
      }

      if (!practiceId) {
        toast.error("Praxis-ID fehlt");
        return null;
      }

      const appointmentTypeId = resultFromNullable(
        getAppointmentTypeIdForLineageKey(
          appointmentRecord.appointmentTypeLineageKey,
        ),
        invalidStateError(
          "Terminart fehlt",
          "convertRealAppointmentToSimulation.appointmentTypeId",
        ),
      ).match(
        (appointmentTypeIdValue) => appointmentTypeIdValue,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!appointmentTypeId) {
        return null;
      }

      const appointmentData: Parameters<typeof runCreateAppointment>[0] = {
        appointmentTypeId,
        isNewPatient: patientIsNewPatient ?? simulatedContext.patient.isNew,
        isSimulation: true,
        locationId,
        ...(patientDateOfBirth && {
          patientDateOfBirth,
        }),
        practiceId,
        replacesAppointmentId: originalAppointmentId,
        start: startISO,
        title: appointmentRecord.title,
      };

      if (appointmentRecord.patientId !== undefined) {
        appointmentData.patientId = appointmentRecord.patientId;
      }

      if (appointmentRecord.userId !== undefined) {
        appointmentData.userId = appointmentRecord.userId;
      }

      if (practitionerId !== undefined) {
        appointmentData.practitionerId = practitionerId;
      }

      return await ResultAsync.fromPromise(
        runCreateAppointment(appointmentData),
        (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message: "Simulierter Termin konnte nicht erstellt werden.",
            source: "convertRealAppointmentToSimulation.createAppointment",
          }),
      )
        .andThen((newId) =>
          resultFromNullable(
            newId,
            invalidStateError(
              "Simulierter Termin konnte nicht erstellt werden.",
              "convertRealAppointmentToSimulation.createAppointmentResult",
            ),
          ),
        )
        .match(
          (newId) => {
            const durationMinutes =
              options.durationMinutes ??
              Math.max(
                SLOT_DURATION,
                Math.round(
                  startZoned.until(endZoned, { largestUnit: "minutes" })
                    .minutes,
                ),
              );
            const resolvedLocationLineageKey =
              getLocationLineageKeyForDisplayId(locationId) ??
              appointmentRecord.locationLineageKey;
            const resolvedPractitionerLineageKey =
              practitionerId === undefined
                ? appointmentRecord.practitionerLineageKey
                : (getPractitionerLineageKeyForDisplayId(practitionerId) ??
                  appointmentRecord.practitionerLineageKey);
            const parsedStart = parseZonedDateTime(
              startISO,
              "convertRealAppointmentToSimulation.updatedRecord.start",
            );
            const parsedEnd = parseZonedDateTime(
              endZoned.toString(),
              "convertRealAppointmentToSimulation.updatedRecord.end",
            );
            if (!parsedStart || !parsedEnd) {
              return null;
            }
            const updatedRecord: CalendarAppointmentRecord = {
              ...appointmentRecord,
              _id: newId,
              end: parsedEnd,
              isSimulation: true,
              locationLineageKey: resolvedLocationLineageKey,
              ...(appointmentRecord.patientId === undefined
                ? {}
                : { patientId: appointmentRecord.patientId }),
              ...(resolvedPractitionerLineageKey === undefined
                ? {}
                : {
                    practitionerLineageKey: resolvedPractitionerLineageKey,
                  }),
              ...(appointmentRecord.replacesAppointmentId === undefined
                ? { replacesAppointmentId: originalAppointmentId }
                : { replacesAppointmentId: originalAppointmentId }),
              start: parsedStart,
              title: appointmentRecord.title,
              ...(appointmentRecord.userId === undefined
                ? {}
                : { userId: appointmentRecord.userId }),
            };

            return {
              column: options.columnOverride ?? appointment.column,
              duration: durationMinutes,
              id: newId,
              record: updatedRecord,
              startTime: formatTime(startZoned.toPlainTime()),
            };
          },
          (error) => {
            captureFrontendError(error, {
              appointmentId: appointmentRecord._id,
              context: "NewCalendar - Failed to create simulated replacement",
              hasSimulatedContext: Boolean(simulatedContext),
              locationId,
              options,
              practitionerId,
            });
            toast.error(
              `Simulierter Termin konnte nicht erstellt werden: ${error.message}`,
            );
            return null;
          },
        );
    },
    [
      getAppointmentTypeIdForLineageKey,
      getLocationIdForLineageKey,
      getLocationLineageKeyForDisplayId,
      getPractitionerIdForColumn,
      getPractitionerIdForLineageKey,
      getPractitionerLineageKeyForDisplayId,
      patientDateOfBirth,
      patientIsNewPatient,
      parseZonedDateTime,
      practiceId,
      simulatedContext,
      runCreateAppointment,
      selectedDate,
      selectedLocationId,
    ],
  );

  const convertRealBlockedSlotToSimulation = useCallback(
    async (
      blockedSlotId: string,
      options: BlockedSlotConversionOptions,
    ): Promise<null | SimulatedBlockedSlotConversionResult> => {
      if (!simulatedContext) {
        return null;
      }

      const resolvedBlockedSlotId = findIdInList(
        [...blockedSlotDocMapRef.current.keys()],
        blockedSlotId,
      );
      const original = resultFromNullable(
        resolvedBlockedSlotId === undefined
          ? undefined
          : blockedSlotDocMapRef.current.get(resolvedBlockedSlotId),
        invalidStateError(
          "Gesperrter Zeitraum wurde nicht gefunden.",
          "convertRealBlockedSlotToSimulation.original",
        ),
      ).match(
        (originalBlockedSlot) => originalBlockedSlot,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!original) {
        return null;
      }

      if (original.isSimulation) {
        return {
          id: original._id,
          startISO: original.start,
        };
      }

      const locationId = resultFromNullable(
        options.locationId ??
          getLocationIdForLineageKey(original.locationLineageKey),
        invalidStateError(
          "Standort für den gesperrten Zeitraum fehlt.",
          "convertRealBlockedSlotToSimulation.locationId",
        ),
      ).match(
        (resolvedLocationId) => resolvedLocationId,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!locationId) {
        return null;
      }

      const practitionerId =
        options.practitionerId ??
        (original.practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(original.practitionerLineageKey));
      const startISO = options.startISO ?? original.start;
      const endISO = options.endISO ?? original.end;
      const title = options.title || original.title || "Gesperrter Zeitraum";

      return await ResultAsync.fromPromise(
        runCreateBlockedSlot({
          end: endISO,
          isSimulation: true,
          locationId,
          practiceId: original.practiceId,
          replacesBlockedSlotId: original._id,
          start: startISO,
          title,
          ...(practitionerId ? { practitionerId } : {}),
        }),
        (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message:
              "Simulierter gesperrter Zeitraum konnte nicht erstellt werden.",
            source: "convertRealBlockedSlotToSimulation.createBlockedSlot",
          }),
      ).match(
        (newId) => ({
          id: newId,
          startISO,
        }),
        (error) => {
          captureFrontendError(error, {
            blockedSlotId,
            context: "NewCalendar - Failed to convert blocked slot",
          });
          toast.error(error.message);
          return null;
        },
      );
    },
    [
      blockedSlotDocMapRef,
      getLocationIdForLineageKey,
      getPractitionerIdForLineageKey,
      runCreateBlockedSlot,
      simulatedContext,
    ],
  );

  const {
    appointments: appointmentLayouts,
    handleBlockedSlotResizeStart,
    handleResizeStart,
    justFinishedResizingRef,
    manualBlockedSlots,
  } = useCalendarInteractions({
    baseAppointments: baseAppointmentLayouts,
    baseManualBlockedSlots,
    blockedSlotDocMapRef,
    checkCollision,
    convertRealAppointmentToSimulation,
    convertRealBlockedSlotToSimulation,
    isNonRootSeriesAppointment,
    resolveBlockedSlotDisplayRefs: resolveBlockedSlotReferenceDisplayIds,
    runUpdateAppointment,
    runUpdateBlockedSlot,
    selectedDate,
    showNonRootSeriesEditToast,
    simulatedContext,
    slotToTime,
    timeToSlot,
  });

  const appointments = useMemo(
    () =>
      buildCalendarAppointmentViews({
        appointments: appointmentLayouts,
        patientData,
        userData,
      }),
    [appointmentLayouts, patientData, userData],
  );

  const draggedRenderedAppointment = useMemo(
    () =>
      draggedAppointment === null
        ? null
        : (appointments.find(
            (appointment) => appointment.layout.id === draggedAppointment.id,
          ) ?? null),
    [appointments, draggedAppointment],
  );

  const allBlockedSlots = useMemo(() => {
    const combined = [
      ...baseBlockedSlots,
      ...baseBreakSlots,
      ...baseAppointmentTypeUnavailableBlockedSlots,
      ...baseDragDisabledPractitionerBlockedSlots,
      ...manualBlockedSlots,
      ...baseUnavailablePractitionerBlockedSlots,
      ...baseVacationBlockedSlots,
    ].filter((slot) => slot.slot >= 0 && slot.slot < totalSlots);

    const uniqueSlots = new Map<string, (typeof combined)[0]>();
    for (const slot of combined) {
      const key = `${slot.column}-${slot.slot}`;
      const existing = uniqueSlots.get(key);
      const existingIsManual =
        existing && "isManual" in existing ? existing.isManual === true : false;
      const slotIsManual = "isManual" in slot ? slot.isManual === true : false;

      if (!existing || (!existingIsManual && slotIsManual)) {
        uniqueSlots.set(key, slot);
      }
    }

    return [...uniqueSlots.values()];
  }, [
    baseAppointmentTypeUnavailableBlockedSlots,
    baseBlockedSlots,
    baseBreakSlots,
    baseDragDisabledPractitionerBlockedSlots,
    baseUnavailablePractitionerBlockedSlots,
    baseVacationBlockedSlots,
    manualBlockedSlots,
    totalSlots,
  ]);

  useCalendarDevtools({
    appointments: appointmentLayouts,
    draggedAppointment,
    dragPreview,
  });

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, appointmentId: string) => {
    const appointment = appointmentLayouts.find(
      (entry) => entry.id === appointmentId,
    );
    if (!appointment) {
      return;
    }

    setDraggedAppointment(appointment);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, column: CalendarColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedAppointment) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const targetSlot = Math.max(
        0,
        Math.min(totalSlots - 1, Math.floor(y / 16)),
      );

      const availableSlot = findNearestAvailableSlot(
        column,
        targetSlot,
        draggedAppointment.duration,
        draggedAppointment.id,
      );

      setDragPreview((prev) => {
        if (
          prev.visible &&
          prev.column === column &&
          prev.slot === availableSlot
        ) {
          return prev;
        }
        return { column, slot: availableSlot, visible: true };
      });

      handleAutoScroll(e);
    } else if (draggedBlockedSlotId) {
      // Handle blocked slot dragging
      const blockedSlot = manualBlockedSlots.find(
        (bs) => bs.id === draggedBlockedSlotId,
      );
      if (blockedSlot) {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const targetSlot = Math.max(
          0,
          Math.min(totalSlots - 1, Math.floor(y / 16)),
        );

        const availableSlot = findNearestAvailableSlot(
          column,
          targetSlot,
          blockedSlot.duration ?? 30,
          draggedBlockedSlotId,
        );

        setDragPreview((prev) => {
          if (
            prev.visible &&
            prev.column === column &&
            prev.slot === availableSlot
          ) {
            return prev;
          }
          return { column, slot: availableSlot, visible: true };
        });

        handleAutoScroll(e);
      }
    }
  };

  const handleAutoScroll = (e: React.DragEvent) => {
    const scrollContainer = scrollContainerRef?.current;
    if (!scrollContainer) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const mouseY = e.clientY;
    const scrollThreshold = 80; // Increased from 50 for easier triggering
    const scrollSpeed = 15; // Increased from 10 for more visible scrolling

    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    const distanceFromTop = mouseY - containerRect.top;
    const distanceFromBottom = containerRect.bottom - mouseY;
    const currentScrollTop = scrollContainer.scrollTop;
    const maxScroll =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;

    // Scroll up when near the top
    if (distanceFromTop < scrollThreshold && currentScrollTop > 0) {
      const animateScrollUp = () => {
        const newScrollTop = Math.max(
          0,
          scrollContainer.scrollTop - scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop > 0 && autoScrollAnimationRef.current) {
          autoScrollAnimationRef.current =
            requestAnimationFrame(animateScrollUp);
        } else {
          autoScrollAnimationRef.current = null;
        }
      };
      autoScrollAnimationRef.current = requestAnimationFrame(animateScrollUp);
    }
    // Scroll down when near the bottom
    else if (
      distanceFromBottom < scrollThreshold &&
      currentScrollTop < maxScroll
    ) {
      const animateScrollDown = () => {
        const currentMax =
          scrollContainer.scrollHeight - scrollContainer.clientHeight;
        const newScrollTop = Math.min(
          currentMax,
          scrollContainer.scrollTop + scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop < currentMax && autoScrollAnimationRef.current) {
          autoScrollAnimationRef.current =
            requestAnimationFrame(animateScrollDown);
        } else {
          autoScrollAnimationRef.current = null;
        }
      };
      autoScrollAnimationRef.current = requestAnimationFrame(animateScrollDown);
    }
  };

  const handleDrop = async (e: React.DragEvent, column: CalendarColumnId) => {
    e.preventDefault();

    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    if (draggedBlockedSlotId) {
      // Handle blocked slot drop
      const blockedSlot = manualBlockedSlots.find(
        (bs) => bs.id === draggedBlockedSlotId,
      );
      if (!blockedSlot) {
        return;
      }

      const resolvedBlockedSlotId =
        blockedSlot.id === undefined
          ? undefined
          : findIdInList(
              [...blockedSlotDocMapRef.current.keys()],
              blockedSlot.id,
            );
      const blockedSlotDoc =
        resolvedBlockedSlotId === undefined
          ? undefined
          : blockedSlotDocMapRef.current.get(resolvedBlockedSlotId);

      const finalSlot = dragPreview.slot;
      const newTime = slotToTime(finalSlot);

      try {
        const plainTime = Temporal.PlainTime.from(newTime);
        const startZoned = selectedDate.toZonedDateTime({
          plainTime,
          timeZone: TIMEZONE,
        });

        const endZoned = startZoned.add({
          minutes: blockedSlot.duration ?? 30,
        });

        const newPractitionerId = getPractitionerIdForColumn(column);

        if (simulatedContext) {
          if (!blockedSlot.id || !blockedSlotDoc) {
            toast.error(
              "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
            );
          } else if (blockedSlotDoc.isSimulation) {
            await runUpdateBlockedSlot({
              end: endZoned.toString(),
              id: blockedSlotDoc._id,
              ...(newPractitionerId && { practitionerId: newPractitionerId }),
              start: startZoned.toString(),
            });
          } else {
            const blockedSlotDisplayRefs =
              resolveBlockedSlotReferenceDisplayIds({
                locationLineageKey: blockedSlotDoc.locationLineageKey,
                ...(blockedSlotDoc.practitionerLineageKey && {
                  practitionerLineageKey: blockedSlotDoc.practitionerLineageKey,
                }),
              });
            if (!blockedSlotDisplayRefs) {
              toast.error(
                "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
              );
              return;
            }

            await convertRealBlockedSlotToSimulation(blockedSlot.id, {
              endISO: endZoned.toString(),
              locationId: blockedSlotDisplayRefs.locationId,
              startISO: startZoned.toString(),
              title:
                blockedSlotDoc.title ||
                blockedSlot.title ||
                "Gesperrter Zeitraum",
              ...(newPractitionerId || blockedSlotDisplayRefs.practitionerId
                ? {
                    practitionerId:
                      newPractitionerId ||
                      blockedSlotDisplayRefs.practitionerId,
                  }
                : {}),
            });
          }
        } else if (blockedSlotDoc) {
          await runUpdateBlockedSlot({
            end: endZoned.toString(),
            id: blockedSlotDoc._id,
            ...(newPractitionerId && { practitionerId: newPractitionerId }),
            start: startZoned.toString(),
          });
        }
      } catch (error) {
        captureErrorGlobal(error, {
          blockedSlotId: draggedBlockedSlotId,
          context: "Failed to update blocked slot position",
        });
        toast.error("Gesperrter Zeitraum konnte nicht verschoben werden");
      } finally {
        setDraggedBlockedSlotId(null);
        setDragPreview(emptyDragPreview);
      }
      return;
    }

    if (!draggedAppointment) {
      return;
    }

    if (isNonRootSeriesAppointment(draggedAppointment.record._id)) {
      showNonRootSeriesEditToast();
      setDraggedAppointment(null);
      setDragPreview(emptyDragPreview);
      return;
    }

    const finalSlot = dragPreview.slot;
    const newTime = slotToTime(finalSlot);

    try {
      const plainTime = Temporal.PlainTime.from(newTime);
      const startZoned = selectedDate.toZonedDateTime({
        plainTime,
        timeZone: TIMEZONE,
      });

      const endZoned = startZoned.add({ minutes: draggedAppointment.duration });

      const newPractitionerId =
        getPractitionerIdForColumn(column) ??
        (draggedAppointment.record.practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(
              draggedAppointment.record.practitionerLineageKey,
            ));

      if (simulatedContext && draggedAppointment.record.isSimulation !== true) {
        await convertRealAppointmentToSimulation(draggedAppointment, {
          columnOverride: column,
          durationMinutes: draggedAppointment.duration,
          endISO: endZoned.toString(),
          ...(newPractitionerId && { practitionerId: newPractitionerId }),
          startISO: startZoned.toString(),
        });
      } else {
        try {
          await runUpdateAppointment({
            end: endZoned.toString(),
            id: draggedAppointment.record._id,
            start: startZoned.toString(),
            ...(newPractitionerId && { practitionerId: newPractitionerId }),
          });
        } catch (error) {
          captureErrorGlobal(error, {
            appointmentId: draggedAppointment.record._id,
            context: "NewCalendar - Failed to update appointment (drag)",
          });
          toast.error("Termin konnte nicht verschoben werden");
        }
      }
    } catch (error) {
      captureErrorGlobal(error, {
        context: "Failed to parse time during drag",
        newTime,
      });
      toast.error("Termin konnte nicht verschoben werden");
    }
    // Convex optimistic updates will handle the UI update

    setDraggedAppointment(null);
    setDragPreview(emptyDragPreview);
  };

  const handleDragEnd = () => {
    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    setDraggedAppointment(null);
    setDragPreview(emptyDragPreview);
  };

  const addAppointment = (column: CalendarColumnId, slot: number) => {
    // Check if this slot is blocked (including breaks and rules)
    const blockedSlotData = allBlockedSlots.find(
      (blocked) => blocked.column === column && blocked.slot === slot,
    );

    if (blockedSlotData) {
      // Show blocked slot warning dialog
      const slotTime = slotToTime(slot);
      // Check if this is a manual block (from blockedSlots memo, has isManual flag)
      const isManualBlock =
        "isManual" in blockedSlotData && blockedSlotData.isManual === true;
      // Only allow booking if an appointment type is selected
      const canBook = placementAppointmentTypeLineageKey !== undefined;
      setBlockedSlotWarning({
        canBook,
        column,
        isManualBlock,
        onConfirm: () => {
          // User confirmed, proceed with appointment creation despite block
          createAppointmentInSlot(column, slot);
        },
        reason:
          blockedSlotData.reason ||
          "Dieser Zeitfenster ist blockiert. Möchten Sie trotzdem einen Termin erstellen?",
        slot,
        slotTime,
      });
      return;
    }

    // No blocked slot, proceed normally
    createAppointmentInSlot(column, slot);
  };

  const createAppointmentInSlot = (column: CalendarColumnId, slot: number) => {
    const mode = simulatedContext ? "simulation" : "real";
    const appointmentTypeId =
      simulatedContext?.appointmentTypeLineageKey === undefined
        ? selectedAppointmentTypeId
        : appointmentTypeIdByLineageKey.get(
            simulatedContext.appointmentTypeLineageKey,
          );
    if (!appointmentTypeId) {
      toast.info("Bitte wählen Sie zunächst eine Terminart aus.");
      return;
    }

    const appointmentTypeInfo = getRequiredAppointmentTypeInfo(
      appointmentTypeId,
      `useCalendarLogic.createAppointmentInSlot.${mode}`,
    );
    if (!appointmentTypeInfo) {
      toast.error("Die Terminart konnte nicht geladen werden.");
      return;
    }

    const maxAvailableDuration = getMaxAvailableDuration(column, slot);
    if (
      Math.min(appointmentTypeInfo.duration, maxAvailableDuration) <
      SLOT_DURATION
    ) {
      return;
    }

    const practitioner = workingPractitioners.find(
      (workingPractitioner) => workingPractitioner.lineageKey === column,
    );
    if (!practitioner && column !== "ekg" && column !== "labor") {
      toast.error("Ungültige Ressource");
      return;
    }

    const requestResult = buildCalendarAppointmentRequest({
      appointmentTypeId,
      appointmentTypeLineageKey: appointmentTypeInfo.lineageKey,
      appointmentTypeName: appointmentTypeInfo.name,
      businessStartHour,
      isNewPatient: simulatedContext
        ? simulatedContext.patient.isNew
        : (patient?.isNewPatient ?? false),
      locationId:
        simulatedContext?.locationLineageKey === undefined
          ? selectedLocationId
          : getLocationIdForLineageKey(simulatedContext.locationLineageKey),
      locationLineageKey:
        simulatedContext?.locationLineageKey ??
        (selectedLocationId
          ? getLocationLineageKeyForDisplayId(selectedLocationId)
          : undefined),
      mode,
      patient,
      pendingAppointmentTitle,
      practiceId,
      practitionerId:
        practitioner === undefined
          ? undefined
          : getPractitionerIdForLineageKey(practitioner.lineageKey),
      practitionerLineageKey: practitioner?.lineageKey,
      selectedDate,
      slot,
      slotDurationMinutes: SLOT_DURATION,
    });

    if (requestResult.kind === "error") {
      toast.error(requestResult.message);
      return;
    }

    if (requestResult.kind === "missing-patient") {
      if (mode === "real" && onPatientRequired) {
        onPatientRequired({
          appointmentTypeLineageKey: asAppointmentTypeLineageKey(
            requestResult.requestContext.appointmentTypeLineageKey,
          ),
          isSimulation: requestResult.requestContext.isSimulation,
          locationLineageKey: asLocationLineageKey(
            requestResult.requestContext.locationLineageKey,
          ),
          practiceId: requestResult.requestContext.practiceId,
          ...(requestResult.requestContext.practitionerLineageKey === undefined
            ? {}
            : {
                practitionerLineageKey: asPractitionerLineageKey(
                  requestResult.requestContext.practitionerLineageKey,
                ),
              }),
          start: requestResult.requestContext.start,
          title: requestResult.requestContext.title,
        });
        return;
      }

      toast.error(
        mode === "simulation"
          ? "Bitte legen Sie zuerst einen Patienten an, bevor Sie den Termin platzieren."
          : "Bitte wählen Sie zuerst einen Patienten aus der rechten Seitenleiste aus.",
      );
      return;
    }

    void runCreateAppointment(requestResult.request).then(
      (createdAppointmentId) => {
        if (createdAppointmentId) {
          onClearAppointmentTypeSelection?.();
        }
      },
    );
  };

  const handleEditAppointment = (appointmentId: string) => {
    // Prevent opening edit dialog if we just finished resizing this appointment
    if (justFinishedResizingRef.current === appointmentId) {
      return;
    }

    if (isNonRootSeriesAppointment(appointmentId)) {
      showNonRootSeriesEditToast();
      return;
    }

    // Editing appointments is now done via the new appointment flow dialog
    toast.info("Bearbeiten von Terminen ist über den neuen Dialog möglich.");
  };

  const handleDeleteAppointment = (appointmentId: string) => {
    const resolvedAppointmentId = findIdInList(
      [...appointmentDocMapRef.current.keys()],
      appointmentId,
    );
    const confirmMessage =
      resolvedAppointmentId &&
      appointmentDocMapRef.current.get(resolvedAppointmentId)?.seriesId
        ? "Dieser Termin gehört zu einer Kette. Beim Löschen wird die gesamte Terminserie entfernt. Fortfahren?"
        : "Termin löschen?";

    if (resolvedAppointmentId && confirm(confirmMessage)) {
      void runDeleteAppointment({
        id: resolvedAppointmentId,
      });
    }
  };

  // Blocked slot handlers
  const handleBlockedSlotDragStart = (
    e: React.DragEvent,
    blockedSlotId: string,
  ) => {
    setDraggedBlockedSlotId(blockedSlotId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  };

  const handleBlockedSlotDragEnd = () => {
    setDraggedBlockedSlotId(null);
    setDragPreview(emptyDragPreview);
  };

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Temporal.Now.zonedDateTimeISO(TIMEZONE));
    }, 60000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Cleanup auto scroll on unmount
  useEffect(() => {
    return () => {
      if (autoScrollAnimationRef.current) {
        cancelAnimationFrame(autoScrollAnimationRef.current);
        autoScrollAnimationRef.current = null;
      }
    };
  }, []);

  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      const patientDateOfBirth = simulatedContext.patient.dateOfBirth;
      const newContext = createSimulatedContext({
        ...(simulatedContext.appointmentTypeLineageKey && {
          appointmentTypeLineageKey: simulatedContext.appointmentTypeLineageKey,
        }),
        isNewPatient: simulatedContext.patient.isNew,
        ...(patientDateOfBirth !== undefined && {
          patientDateOfBirth,
        }),
        ...(locationId && {
          locationLineageKey: asLocationLineageKey(
            getLocationLineageKeyForDisplayId(locationId) ?? locationId,
          ),
        }),
      });

      onUpdateSimulatedContext(newContext);
    } else {
      setInternalSelectedLocationId(locationId);
    }
  };

  return {
    addAppointment,
    appointments,
    blockedSlots: allBlockedSlots,
    blockedSlotWarning,
    businessEndHour,
    businessStartHour,
    columns,
    currentTime,
    currentTimeSlot: getCurrentTimeSlot(),
    draggedAppointment: draggedRenderedAppointment,
    draggedBlockedSlotId,
    dragPreview,
    getBlockedSlotEditorData,
    getPractitionerIdForColumn,
    handleBlockedSlotDragEnd,
    handleBlockedSlotDragStart,
    handleBlockedSlotResizeStart,
    handleDateChange,
    handleDeleteAppointment,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleEditAppointment,
    handleEditBlockedSlot: (blockedSlotId: string) => {
      return handleEditBlockedSlot(blockedSlotId, justFinishedResizingRef);
    },
    handleLocationSelect,
    handleResizeStart,
    locationsData,
    practiceId,
    runCreateAppointment,
    runCreateBlockedSlot,
    runDeleteBlockedSlot,
    runUpdateBlockedSlot,
    selectedDate,
    selectedLocationId:
      (simulatedContext?.locationLineageKey &&
        getLocationIdForLineageKey(simulatedContext.locationLineageKey)) ||
      selectedLocationId,
    setBlockedSlotWarning,
    slotToTime,
    timeToSlot,
    totalSlots,
    workingPractitioners,
  };
}
