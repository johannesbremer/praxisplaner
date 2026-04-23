import { useMutation } from "convex/react";
import { ResultAsync } from "neverthrow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { AppointmentResult } from "../../../convex/appointments";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";
import type { Appointment, CalendarColumn, NewCalendarProps } from "./types";

import { api } from "../../../convex/_generated/api";
import { createSimulatedContext } from "../../../lib/utils";
import {
  getPractitionerAvailabilityRangesForDate,
  getPractitionerVacationRangesForDate,
} from "../../../lib/vacation-utils";
import { useRegisterGlobalUndoRedoControls } from "../../hooks/use-global-undo-redo-controls";
import { useLocalHistory } from "../../hooks/use-local-history";
import { createOptimisticId } from "../../utils/convex-ids";
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
import { SLOT_DURATION } from "./types";
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
  handleEditBlockedSlot,
  hasAppointmentConflictInRecords,
  hasBlockedSlotConflictInRecords,
  mergeConflictRecordsById,
  parsePlainTimeResult,
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
    useState<Appointment | null>(null);
  const [draggedBlockedSlotId, setDraggedBlockedSlotId] = useState<
    null | string
  >(null);
  const [dragPreview, setDragPreview] = useState<{
    column: string;
    slot: number;
    visible: boolean;
  }>({
    column: "",
    slot: 0,
    visible: false,
  });
  const autoScrollAnimationRef = useRef<null | number>(null);
  const hasResolvedLocationRef = useRef(false);

  // Warning dialog state for blocked slots
  const [blockedSlotWarning, setBlockedSlotWarning] = useState<null | {
    canBook: boolean;
    column: string;
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
    allPracticeAppointmentDocMapRef,
    allPracticeAppointmentsLoaded,
    allPracticeBlockedSlotDocMapRef,
    allPracticeBlockedSlotsLoaded,
    appointmentDocMapRef,
    appointments: baseAppointments,
    appointmentsData,
    appointmentTypeMap,
    baseSchedulesData,
    blockedSlotDocMapRef,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeResult,
    calendarDayQueryArgs,
    getRequiredAppointmentTypeInfo,
    locationsData,
    practitionersData,
    slotsResult,
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
    new Map<Id<"appointments">, AppointmentResult>(),
  );
  const blockedSlotHistoryDocMapRef = useRef(
    new Map<Id<"blockedSlots">, Doc<"blockedSlots">>(),
  );

  useEffect(() => {
    for (const appointment of appointmentsData ?? []) {
      appointmentHistoryDocMapRef.current.set(appointment._id, appointment);
    }
  }, [appointmentsData]);

  useEffect(() => {
    for (const blockedSlot of blockedSlotsData ?? []) {
      blockedSlotHistoryDocMapRef.current.set(blockedSlot._id, blockedSlot);
    }
  }, [blockedSlotsData]);

  const getAppointmentHistoryDoc = useCallback(
    (id: Id<"appointments">) => {
      return (
        appointmentDocMapRef.current.get(id) ??
        appointmentHistoryDocMapRef.current.get(id)
      );
    },
    [appointmentDocMapRef],
  );

  const getBlockedSlotHistoryDoc = useCallback(
    (id: Id<"blockedSlots">) => {
      return (
        blockedSlotDocMapRef.current.get(id) ??
        blockedSlotHistoryDocMapRef.current.get(id)
      );
    },
    [blockedSlotDocMapRef],
  );

  const rememberAppointmentHistoryDoc = useCallback(
    (appointment: AppointmentResult) => {
      appointmentHistoryDocMapRef.current.set(appointment._id, appointment);
    },
    [],
  );

  const forgetAppointmentHistoryDoc = useCallback((id: Id<"appointments">) => {
    appointmentHistoryDocMapRef.current.delete(id);
  }, []);

  const rememberBlockedSlotHistoryDoc = useCallback(
    (blockedSlot: Doc<"blockedSlots">) => {
      blockedSlotHistoryDocMapRef.current.set(blockedSlot._id, blockedSlot);
    },
    [],
  );

  const forgetBlockedSlotHistoryDoc = useCallback((id: Id<"blockedSlots">) => {
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

  const placementAppointmentTypeId =
    simulatedContext?.appointmentTypeId ?? selectedAppointmentTypeId;
  const draggedAppointmentTypeId =
    draggedAppointment?.resource?.appointmentTypeId;

  const getUnsupportedPractitionerIdsForAppointmentType = useCallback(
    (
      appointmentTypeId: Id<"appointmentTypes"> | undefined,
      practitionerIds: Iterable<Id<"practitioners">>,
    ) => {
      if (!appointmentTypeId) {
        return new Set<Id<"practitioners">>();
      }

      const allowedPractitionerIds = new Set(
        appointmentTypeMap.get(appointmentTypeId)?.allowedPractitionerIds,
      );

      return new Set(
        [...practitionerIds].filter(
          (practitionerId) => !allowedPractitionerIds.has(practitionerId),
        ),
      );
    },
    [appointmentTypeMap],
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
        locationId: Id<"locations">;
        practitionerId?: Id<"practitioners">;
        replacesAppointmentId?: Id<"appointments">;
        start: string;
      },
      excludeId?: Id<"appointments">,
    ) => {
      return hasAppointmentConflictInRecords(
        candidate,
        mergeConflictRecordsById(
          allPracticeAppointmentDocMapRef.current,
          appointmentHistoryDocMapRef.current,
        ),
        excludeId,
        toEpochMilliseconds,
      );
    },
    [allPracticeAppointmentDocMapRef, toEpochMilliseconds],
  );

  const hasBlockedSlotConflict = useCallback(
    (
      candidate: {
        end: string;
        isSimulation: boolean;
        locationId: Id<"locations">;
        practitionerId?: Id<"practitioners">;
        start: string;
      },
      excludeId?: Id<"blockedSlots">,
    ) => {
      return hasBlockedSlotConflictInRecords({
        appointments: mergeConflictRecordsById(
          allPracticeAppointmentDocMapRef.current,
          appointmentHistoryDocMapRef.current,
        ),
        blockedSlots: mergeConflictRecordsById(
          allPracticeBlockedSlotDocMapRef.current,
          blockedSlotHistoryDocMapRef.current,
        ),
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

  const canValidateAppointmentHistoryConflict = allPracticeAppointmentsLoaded;
  const canValidateBlockedSlotHistoryConflict =
    allPracticeAppointmentsLoaded && allPracticeBlockedSlotsLoaded;

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

          const newAppointment: AppointmentResult = {
            _creationTime: now,
            _id: tempId,
            appointmentTypeId: optimisticArgs.appointmentTypeId,
            appointmentTypeTitle: appointmentTypeInfo.name,
            createdAt: BigInt(now),
            end: typedEnd,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            locationId: optimisticArgs.locationId,
            practiceId: optimisticArgs.practiceId,
            start: typedStart,
            title: optimisticArgs.title,
          };

          if (optimisticArgs.practitionerId !== undefined) {
            newAppointment.practitionerId = optimisticArgs.practitionerId;
          }

          if (optimisticArgs.patientId !== undefined) {
            newAppointment.patientId = optimisticArgs.patientId;
          }

          if (optimisticArgs.userId !== undefined) {
            newAppointment.userId = optimisticArgs.userId;
          }

          if (optimisticArgs.replacesAppointmentId !== undefined) {
            newAppointment.replacesAppointmentId =
              optimisticArgs.replacesAppointmentId;
          }

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

        const timeUpdates: Partial<Pick<AppointmentResult, "end" | "start">> =
          {};
        if (nextStart !== undefined && nextStart !== null) {
          timeUpdates.start = nextStart;
        }
        if (nextEnd !== undefined && nextEnd !== null) {
          timeUpdates.end = nextEnd;
        }

        return {
          ...appointment,
          ...timeUpdates,
          ...(optimisticArgs.practitionerId !== undefined && {
            practitionerId: optimisticArgs.practitionerId,
          }),
          ...(optimisticArgs.locationId !== undefined && {
            locationId: optimisticArgs.locationId,
          }),
          ...(optimisticArgs.title !== undefined && {
            title: optimisticArgs.title,
          }),
          lastModified: BigInt(now),
        };
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
      updateAppointmentMutation,
    ],
  );

  const getAppointmentUpdateMutation = useCallback(
    (appointment?: AppointmentResult) => {
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

          const newBlockedSlot: Doc<"blockedSlots"> = {
            _creationTime: now,
            _id: tempId,
            createdAt: BigInt(now),
            end: optimisticArgs.end,
            isSimulation: optimisticArgs.isSimulation ?? false,
            lastModified: BigInt(now),
            locationId: optimisticArgs.locationId,
            practiceId: optimisticArgs.practiceId,
            start: optimisticArgs.start,
            title: optimisticArgs.title,
          };

          if (optimisticArgs.practitionerId !== undefined) {
            newBlockedSlot.practitionerId = optimisticArgs.practitionerId;
          }

          if (optimisticArgs.replacesBlockedSlotId !== undefined) {
            newBlockedSlot.replacesBlockedSlotId =
              optimisticArgs.replacesBlockedSlotId;
          }

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
    [blockedSlotQueryRef, createBlockedSlotMutation, blockedSlotsQueryArgs],
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

            return {
              ...slot,
              ...(optimisticArgs.title !== undefined && {
                title: optimisticArgs.title,
              }),
              ...(optimisticArgs.start !== undefined && {
                start: optimisticArgs.start,
              }),
              ...(optimisticArgs.end !== undefined && {
                end: optimisticArgs.end,
              }),
              ...(optimisticArgs.locationId !== undefined && {
                locationId: optimisticArgs.locationId,
              }),
              ...(optimisticArgs.practitionerId !== undefined && {
                practitionerId: optimisticArgs.practitionerId,
              }),
              ...(optimisticArgs.replacesBlockedSlotId !== undefined && {
                replacesBlockedSlotId: optimisticArgs.replacesBlockedSlotId,
              }),
              ...(optimisticArgs.isSimulation !== undefined && {
                isSimulation: optimisticArgs.isSimulation,
              }),
              lastModified: BigInt(now),
            };
          });

          localStore.setQuery(
            blockedSlotQueryRef,
            blockedSlotsQueryArgs,
            updatedBlockedSlots,
          );
        },
      )(args);
    },
    [blockedSlotQueryRef, updateBlockedSlotMutation, blockedSlotsQueryArgs],
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

      pushHistoryAction({
        label: "Termin erstellt",
        redo: async () => {
          if (!canValidateAppointmentHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation,
              locationId: createArgs.locationId,
              ...(createArgs.practitionerId && {
                practitionerId: createArgs.practitionerId,
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
      canValidateAppointmentHistoryConflict,
      createAppointmentMutation,
      forgetAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
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

      await runUpdateAppointmentInternal(args);

      if (!before) {
        return;
      }

      const beforeState = {
        end: before.end,
        practitionerId: before.practitionerId,
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
        practitionerId: args.practitionerId ?? before.practitionerId,
        start: typedStart ?? before.start,
      };
      const afterSnapshot: AppointmentResult = {
        ...before,
        end: afterState.end,
        ...(afterState.practitionerId === undefined
          ? {}
          : { practitionerId: afterState.practitionerId }),
        start: afterState.start,
      };
      rememberAppointmentHistoryDoc(afterSnapshot);

      const matchesState = (
        appointment: AppointmentResult,
        expected: typeof beforeState,
      ) =>
        appointment.start === expected.start &&
        appointment.end === expected.end &&
        appointment.practitionerId === expected.practitionerId;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: AppointmentResult["end"];
        isSimulation: boolean;
        locationId: Id<"locations">;
        practitionerId?: Id<"practitioners">;
        start: AppointmentResult["start"];
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationId: before.locationId,
        ...(state.practitionerId && { practitionerId: state.practitionerId }),
        start: state.start,
      });

      pushHistoryAction({
        label: "Termin aktualisiert",
        redo: async () => {
          if (!canValidateAppointmentHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          const current = getAppointmentHistoryDoc(args.id);
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

          await runUpdateAppointmentInternal({
            end: afterState.end,
            id: args.id,
            ...(afterState.practitionerId && {
              practitionerId: afterState.practitionerId,
            }),
            start: afterState.start,
          });
          rememberAppointmentHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          if (!canValidateAppointmentHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          const current = getAppointmentHistoryDoc(args.id);
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

          await runUpdateAppointmentInternal({
            end: beforeState.end,
            id: args.id,
            ...(beforeState.practitionerId && {
              practitionerId: beforeState.practitionerId,
            }),
            start: beforeState.start,
          });
          rememberAppointmentHistoryDoc(before);
          return { status: "applied" };
        },
      });
    },
    [
      canValidateAppointmentHistoryConflict,
      getAppointmentHistoryDoc,
      getAppointmentUpdateMutation,
      hasAppointmentConflict,
      parseZonedDateTime,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
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

      const createArgs: Parameters<typeof createAppointmentMutation>[0] = {
        appointmentTypeId: deleted.appointmentTypeId,
        isSimulation: deleted.isSimulation ?? false,
        locationId: deleted.locationId,
        ...(deleted.patientId && { patientId: deleted.patientId }),
        practiceId: deleted.practiceId,
        ...(deleted.practitionerId && {
          practitionerId: deleted.practitionerId,
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
          if (!canValidateAppointmentHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          if (
            hasAppointmentConflict({
              end: createEnd,
              isSimulation: createArgs.isSimulation ?? false,
              locationId: createArgs.locationId,
              ...(createArgs.practitionerId && {
                practitionerId: createArgs.practitionerId,
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
      canValidateAppointmentHistoryConflict,
      deleteAppointmentMutation,
      forgetAppointmentHistoryDoc,
      getAppointmentHistoryDoc,
      getAppointmentCreationEnd,
      getRequiredAppointmentTypeInfo,
      hasAppointmentConflict,
      pushHistoryAction,
      rememberAppointmentHistoryDoc,
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

      pushHistoryAction({
        label: "Sperrung erstellt",
        redo: async () => {
          if (!canValidateBlockedSlotHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation,
              locationId: createArgs.locationId,
              ...(createArgs.practitionerId && {
                practitionerId: createArgs.practitionerId,
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
      canValidateBlockedSlotHistoryConflict,
      forgetBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      runCreateBlockedSlotInternal,
      runDeleteBlockedSlotInternal,
    ],
  );

  const runUpdateBlockedSlot = useCallback(
    async (args: Parameters<typeof updateBlockedSlotMutation>[0]) => {
      const before = getBlockedSlotHistoryDoc(args.id);
      const mutationResult = await runUpdateBlockedSlotInternal(args);

      if (!before) {
        return mutationResult;
      }

      const beforeState = {
        end: before.end,
        practitionerId: before.practitionerId,
        start: before.start,
        title: before.title,
      };

      const afterState = {
        end: args.end ?? before.end,
        practitionerId: args.practitionerId ?? before.practitionerId,
        start: args.start ?? before.start,
        title: args.title ?? before.title,
      };
      const afterSnapshot: Doc<"blockedSlots"> = {
        ...before,
        end: afterState.end,
        ...(afterState.practitionerId === undefined
          ? {}
          : { practitionerId: afterState.practitionerId }),
        start: afterState.start,
        title: afterState.title,
      };
      rememberBlockedSlotHistoryDoc(afterSnapshot);

      const matchesState = (
        slot: Doc<"blockedSlots">,
        expected: typeof beforeState,
      ) =>
        slot.start === expected.start &&
        slot.end === expected.end &&
        slot.practitionerId === expected.practitionerId &&
        slot.title === expected.title;

      const candidatePayload = (
        state: typeof beforeState,
      ): {
        end: string;
        isSimulation: boolean;
        locationId: Id<"locations">;
        practitionerId?: Id<"practitioners">;
        start: string;
      } => ({
        end: state.end,
        isSimulation: before.isSimulation ?? false,
        locationId: before.locationId,
        ...(state.practitionerId && { practitionerId: state.practitionerId }),
        start: state.start,
      });

      pushHistoryAction({
        label: "Sperrung aktualisiert",
        redo: async () => {
          if (!canValidateBlockedSlotHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          const current = getBlockedSlotHistoryDoc(args.id);
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

          await runUpdateBlockedSlotInternal({
            end: afterState.end,
            id: args.id,
            ...(afterState.practitionerId && {
              practitionerId: afterState.practitionerId,
            }),
            start: afterState.start,
            title: afterState.title,
          });
          rememberBlockedSlotHistoryDoc(afterSnapshot);
          return { status: "applied" };
        },
        undo: async () => {
          if (!canValidateBlockedSlotHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          const current = getBlockedSlotHistoryDoc(args.id);
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

          await runUpdateBlockedSlotInternal({
            end: beforeState.end,
            id: args.id,
            ...(beforeState.practitionerId && {
              practitionerId: beforeState.practitionerId,
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
      canValidateBlockedSlotHistoryConflict,
      getBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
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
      const createArgs: Parameters<typeof createBlockedSlotMutation>[0] = {
        end: deleted.end,
        isSimulation: deleted.isSimulation ?? false,
        locationId: deleted.locationId,
        practiceId: deleted.practiceId,
        ...(deleted.practitionerId && {
          practitionerId: deleted.practitionerId,
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
          if (!canValidateBlockedSlotHistoryConflict) {
            return {
              message:
                "Die Kalenderdaten werden noch geladen. Bitte erneut versuchen.",
              status: "conflict",
            };
          }
          if (
            hasBlockedSlotConflict({
              end: createArgs.end,
              isSimulation: createArgs.isSimulation ?? false,
              locationId: createArgs.locationId,
              ...(createArgs.practitionerId && {
                practitionerId: createArgs.practitionerId,
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
      canValidateBlockedSlotHistoryConflict,
      forgetBlockedSlotHistoryDoc,
      getBlockedSlotHistoryDoc,
      hasBlockedSlotConflict,
      pushHistoryAction,
      rememberBlockedSlotHistoryDoc,
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

    // Create practitioner lookup map
    const practitionerMap = new Map(
      practitionersData.map((p) => [p._id, p.name]),
    );

    let daySchedules = baseSchedulesData.filter(
      (schedule: Doc<"baseSchedules">) =>
        schedule.dayOfWeek === currentDayOfWeek,
    );
    const effectiveLocationId =
      simulatedContext?.locationId ?? selectedLocationId ?? undefined;

    if (simulatedContext?.locationId) {
      daySchedules = daySchedules.filter(
        (schedule: Doc<"baseSchedules">) =>
          schedule.locationId === simulatedContext.locationId,
      );
    } else if (selectedLocationId) {
      daySchedules = daySchedules.filter(
        (schedule: Doc<"baseSchedules">) =>
          schedule.locationId === selectedLocationId,
      );
    }

    const appointmentsForSelectedDate = (appointmentsData ?? []).filter(
      (appointment) => {
        if (!appointment.practitionerId) {
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
          effectiveLocationId !== undefined &&
          appointment.locationId !== effectiveLocationId
        ) {
          return false;
        }

        return true;
      },
    );
    const deletedPractitionerIds = new Set(
      practitionersData
        .filter((practitioner) => practitioner.deleted === true)
        .map((practitioner) => practitioner._id),
    );
    const deletedPractitionerCalendarRanges =
      collectDeletedPractitionerCalendarRanges({
        appointments: appointmentsData ?? [],
        blockedSlots: blockedSlotsData ?? [],
        deletedPractitionerIds,
        effectiveLocationId,
        selectedDate,
      });
    const deletedPractitionerIdsWithCalendarItems = new Set(
      deletedPractitionerCalendarRanges.map((range) => range.practitionerId),
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
          practitionerMap.get(schedule.practitionerId) ?? "Unbekannt";
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
          .map((appointment) => appointment.practitionerId)
          .filter(Boolean),
      );

      const hiddenPractitionerIds = new Set(
        vacationsData
          .filter(
            (vacation) =>
              vacation.staffType === "practitioner" &&
              vacation.date === selectedDate.toString() &&
              vacation.portion === "full" &&
              vacation.practitionerId &&
              !practitionersWithAppointments.has(vacation.practitionerId),
          )
          .flatMap((vacation) =>
            vacation.practitionerId ? [vacation.practitionerId] : [],
          ),
      );

      for (const vacation of vacationsData) {
        if (
          vacation.staffType === "practitioner" &&
          vacation.date === selectedDate.toString() &&
          vacation.portion === "full" &&
          vacation.practitionerId &&
          practitionersWithAppointments.has(vacation.practitionerId)
        ) {
          mutedPractitionerIds.add(vacation.practitionerId);
        }
      }

      if (hiddenPractitionerIds.size > 0) {
        validSchedules = validSchedules.filter(
          (schedule) => !hiddenPractitionerIds.has(schedule.practitionerId),
        );
      }
    }

    if (validSchedules.length < daySchedules.length) {
      const invalidCount = daySchedules.length - validSchedules.length;
      toast.warning(
        `${invalidCount} Zeitplan${invalidCount > 1 ? "e" : ""} mit ungültigen Zeiten wurde${invalidCount > 1 ? "n" : ""} übersprungen`,
      );
    }

    const working = validSchedules.map((schedule) => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: practitionerMap.get(schedule.practitionerId) ?? "Unbekannt",
      startTime: schedule.startTime,
    }));
    const workingPractitionerIds = new Set(
      working.map((practitioner) => practitioner.id),
    );

    const formatMinutesAsTime = (minutes: number) => {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    };

    for (const {
      endMinutes,
      practitionerId,
      startMinutes,
    } of deletedPractitionerCalendarRanges) {
      mutedPractitionerIds.add(practitionerId);
      if (workingPractitionerIds.has(practitionerId)) {
        continue;
      }

      working.push({
        endTime: formatMinutesAsTime(endMinutes),
        id: practitionerId,
        name: practitionerMap.get(practitionerId) ?? "Unbekannt",
        startTime: formatMinutesAsTime(startMinutes),
      });
      workingPractitionerIds.add(practitionerId);
    }

    const effectiveWorkingRanges = working.flatMap((practitioner) =>
      getPractitionerAvailabilityRangesForDate(
        selectedDate,
        practitioner.id,
        baseSchedulesData,
        vacationsData ?? [],
        effectiveLocationId,
      ),
    );
    const practitionerIds = new Set(
      working.map((practitioner) => practitioner.id),
    );
    const appointmentRanges = appointmentsForSelectedDate.flatMap(
      (appointment) => {
        if (
          appointment.practitionerId === undefined ||
          !practitionerIds.has(appointment.practitionerId)
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
      (practitioner) => practitioner.id,
    );
    const placementUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        placementAppointmentTypeId,
        workingPractitionerIdList,
      );
    const dragUnsupportedPractitionerIds =
      getUnsupportedPractitionerIdsForAppointmentType(
        draggedAppointmentTypeId,
        workingPractitionerIdList,
      );

    const practitionerColumns: CalendarColumn[] = working.map(
      (practitioner) => ({
        id: practitioner.id,
        isAppointmentTypeUnavailable: placementUnsupportedPractitionerIds.has(
          practitioner.id,
        ),
        isDragDisabled: dragUnsupportedPractitionerIds.has(practitioner.id),
        isMuted:
          mutedPractitionerIds.has(practitioner.id) ||
          placementUnsupportedPractitionerIds.has(practitioner.id) ||
          dragUnsupportedPractitionerIds.has(practitioner.id),
        isUnavailable: deletedPractitionerIdsWithCalendarItems.has(
          practitioner.id,
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
    draggedAppointmentTypeId,
    getUnsupportedPractitionerIdsForAppointmentType,
    placementAppointmentTypeId,
    simulatedContext,
    selectedLocationId,
    selectedDate,
    timeToMinutes,
    blockedSlotsData,
    vacationsData,
  ]);

  const getPractitionerIdForColumn = useCallback(
    (column: string): Id<"practitioners"> | undefined =>
      workingPractitioners.find((practitioner) => practitioner.id === column)
        ?.id,
    [workingPractitioners],
  );

  const baseRenderedAppointments = baseAppointments;

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
      column: string;
      id?: string; // ID of the manual blocked slot, if applicable
      isManual?: boolean; // True if blocked by a manual block (not a rule)
      reason?: string;
      slot: number;
    }[] = [];

    // Add blocked slots from main query (appointment-type-dependent rules)
    if (slotsResult?.slots) {
      for (const slotData of slotsResult.slots) {
        if (slotData.status === "BLOCKED" && slotData.practitionerId) {
          // Find if this practitioner has a column
          const practitionerColumn = workingPractitioners.find(
            (p) => p.id === slotData.practitionerId,
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
              column: practitionerColumn.id,
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
          (p) => p.id === slotData.practitionerId,
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
            (b) => b.column === practitionerColumn.id && b.slot === slot,
          );

          if (!alreadyBlocked) {
            // Check if this is a manual block (has blockedByBlockedSlotId)
            const isManualBlock = !!slotData.blockedByBlockedSlotId;

            blocked.push({
              column: practitionerColumn.id,
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
      column: string;
      reason?: string;
      slot: number;
    }[] = [];

    for (const schedule of baseSchedulesData) {
      if (!schedule.breakTimes || schedule.breakTimes.length === 0) {
        continue;
      }

      // Find if this practitioner has a column
      const practitionerColumn = workingPractitioners.find(
        (p) => p.id === schedule.practitionerId,
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
            column: practitionerColumn.id,
            reason: "Pause",
            slot,
          });
        }
      }
    }

    return breaks;
  }, [baseSchedulesData, workingPractitioners, timeToSlot]);

  // Map manually created blocked slots from database
  const baseManualBlockedSlots = useMemo<CalendarManualBlockedSlot[]>(() => {
    if (!blockedSlotsData || workingPractitioners.length === 0) {
      return [];
    }

    const manual: {
      column: string;
      duration?: number;
      id?: string;
      isManual?: boolean;
      reason?: string;
      slot: number;
      startSlot?: number;
      title?: string;
    }[] = [];

    const effectiveLocationId =
      simulatedContext?.locationId ?? selectedLocationId;
    const dateFilteredBlocks = filterBlockedSlotsForDateAndLocation(
      blockedSlotsData,
      selectedDate,
      effectiveLocationId,
    );

    for (const blockedSlot of dateFilteredBlocks) {
      // Find if this practitioner has a column
      const practitionerColumn = blockedSlot.practitionerId
        ? workingPractitioners.find((p) => p.id === blockedSlot.practitionerId)
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
            column: practitionerColumn.id,
            duration: durationMinutes,
            id: blockedSlot._id,
            isManual: true,
            reason: blockedSlot.title,
            slot,
            startSlot,
            title: blockedSlot.title,
          });
        }
      } else if (blockedSlot.practitionerId) {
        captureFrontendError(
          invalidStateError(
            "Manual blocked slot practitioner not in visible columns.",
            "useCalendarLogic.manualBlockedSlots",
          ),
          {
            blockedSlotId: blockedSlot._id,
            locationId: blockedSlot.locationId,
            practitionerId: blockedSlot.practitionerId,
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
    simulatedContext?.locationId,
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
      column: string;
      reason?: string;
      slot: number;
    }[] = [];

    const effectiveLocationId =
      simulatedContext?.locationId ?? selectedLocationId;

    for (const practitioner of workingPractitioners) {
      const hasOnlyConflictFreeFullDayVacation =
        !(
          appointmentsData?.some(
            (appointment) =>
              appointment.practitionerId === practitioner.id &&
              Temporal.PlainDate.compare(
                Temporal.ZonedDateTime.from(appointment.start).toPlainDate(),
                selectedDate,
              ) === 0,
          ) ?? false
        ) &&
        vacationsData.some(
          (vacation) =>
            vacation.staffType === "practitioner" &&
            vacation.practitionerId === practitioner.id &&
            vacation.date === selectedDate.toString() &&
            vacation.portion === "full",
        );

      if (hasOnlyConflictFreeFullDayVacation) {
        continue;
      }

      const ranges = getPractitionerVacationRangesForDate(
        selectedDate,
        practitioner.id,
        baseSchedulesData,
        vacationsData,
        effectiveLocationId,
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
            column: practitioner.id,
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
    selectedDate,
    selectedLocationId,
    simulatedContext,
    vacationsData,
    workingPractitioners,
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
      column: string,
      startSlot: number,
      duration: number,
      excludeId?: string,
    ) => {
      const endSlot = startSlot + Math.ceil(duration / SLOT_DURATION);

      return baseRenderedAppointments.some((apt) => {
        if (apt.id === excludeId || apt.column !== column) {
          return false;
        }

        const aptStartSlot = timeToSlot(apt.startTime);
        const aptEndSlot =
          aptStartSlot + Math.ceil(apt.duration / SLOT_DURATION);

        return !(endSlot <= aptStartSlot || startSlot >= aptEndSlot);
      });
    },
    [baseRenderedAppointments, timeToSlot],
  );

  const findNearestAvailableSlot = useCallback(
    (
      column: string,
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
    (column: string, startSlot: number) => {
      const occupiedSlots = baseRenderedAppointments
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
    [baseRenderedAppointments, timeToSlot, totalSlots],
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
      appointment: Appointment,
      options: SimulationConversionOptions,
    ): Promise<Appointment | null> => {
      // Early validation checks with specific error messages
      if (appointment.isSimulation) {
        return appointment;
      }

      if (!appointment.convexId) {
        toast.error("Termin hat keine gültige ID");
        return null;
      }
      const originalAppointmentId = appointment.convexId;

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
        appointment.resource?.practitionerId;

      // Use validated simulatedContext with proper typing
      const contextLocationId: Id<"locations"> | undefined =
        simulatedContext.locationId;

      // Determine location with explicit precedence
      const locationId: Id<"locations"> | undefined =
        options.locationId ??
        contextLocationId ??
        appointment.resource?.locationId ??
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

      const resource = resultFromNullable(
        appointment.resource,
        invalidStateError(
          "Terminressource fehlt",
          "convertRealAppointmentToSimulation.resource",
        ),
      ).match(
        (resourceValue) => resourceValue,
        (error) => {
          toast.error(error.message);
          return null;
        },
      );
      if (!resource) {
        return null;
      }

      const appointmentTypeId = resultFromNullable(
        resource.appointmentTypeId,
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
        title: resource.title ?? appointment.title,
      };

      if (resource.patientId !== undefined) {
        appointmentData.patientId = resource.patientId;
      }

      if (resource.userId !== undefined) {
        appointmentData.userId = resource.userId;
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

            return {
              ...appointment,
              column: options.columnOverride ?? appointment.column,
              convexId: newId,
              duration: durationMinutes,
              id: newId,
              isSimulation: true,
              replacesAppointmentId: originalAppointmentId,
              resource: {
                ...resource,
                isSimulation: true,
                locationId,
                practitionerId: practitionerId ?? resource.practitionerId,
              },
              startTime: formatTime(startZoned.toPlainTime()),
            };
          },
          (error) => {
            captureFrontendError(error, {
              appointmentId: appointment.convexId,
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
      getPractitionerIdForColumn,
      patientDateOfBirth,
      patientIsNewPatient,
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
    ): Promise<Id<"blockedSlots"> | null> => {
      if (!simulatedContext) {
        return null;
      }

      const original = resultFromNullable(
        blockedSlotDocMapRef.current.get(blockedSlotId),
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
        return original._id;
      }

      const locationId = resultFromNullable(
        options.locationId ?? original.locationId,
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

      const practitionerId = options.practitionerId ?? original.practitionerId;
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
        (newId) => newId,
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
    [blockedSlotDocMapRef, runCreateBlockedSlot, simulatedContext],
  );

  const {
    appointments,
    handleBlockedSlotResizeStart,
    handleResizeStart,
    justFinishedResizingRef,
    manualBlockedSlots,
  } = useCalendarInteractions({
    baseAppointments: baseRenderedAppointments,
    baseManualBlockedSlots,
    blockedSlotDocMapRef,
    checkCollision,
    convertRealAppointmentToSimulation,
    convertRealBlockedSlotToSimulation,
    isNonRootSeriesAppointment,
    runUpdateAppointment,
    runUpdateBlockedSlot,
    selectedDate,
    showNonRootSeriesEditToast,
    simulatedContext,
    slotToTime,
    timeToSlot,
  });

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
    appointments,
    draggedAppointment,
    dragPreview,
  });

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, appointment: Appointment) => {
    setDraggedAppointment(appointment);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, column: string) => {
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

  const handleDrop = async (e: React.DragEvent, column: string) => {
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

      const blockedSlotDoc =
        blockedSlot.id === undefined
          ? undefined
          : blockedSlotDocMapRef.current.get(blockedSlot.id);

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
            await convertRealBlockedSlotToSimulation(blockedSlot.id, {
              endISO: endZoned.toString(),
              locationId: blockedSlotDoc.locationId,
              startISO: startZoned.toString(),
              title:
                blockedSlotDoc.title ||
                blockedSlot.title ||
                "Gesperrter Zeitraum",
              ...(newPractitionerId || blockedSlotDoc.practitionerId
                ? {
                    practitionerId:
                      newPractitionerId || blockedSlotDoc.practitionerId,
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
        setDragPreview({ column: "", slot: 0, visible: false });
      }
      return;
    }

    if (!draggedAppointment) {
      return;
    }

    if (isNonRootSeriesAppointment(draggedAppointment.convexId)) {
      showNonRootSeriesEditToast();
      setDraggedAppointment(null);
      setDragPreview({ column: "", slot: 0, visible: false });
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

      if (draggedAppointment.convexId) {
        const newPractitionerId =
          getPractitionerIdForColumn(column) ??
          draggedAppointment.resource?.practitionerId;

        if (simulatedContext && !draggedAppointment.isSimulation) {
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
              id: draggedAppointment.convexId,
              start: startZoned.toString(),
              ...(newPractitionerId && { practitionerId: newPractitionerId }),
            });
          } catch (error) {
            captureErrorGlobal(error, {
              appointmentId: draggedAppointment.convexId,
              context: "NewCalendar - Failed to update appointment (drag)",
            });
            toast.error("Termin konnte nicht verschoben werden");
          }
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
    setDragPreview({ column: "", slot: 0, visible: false });
  };

  const handleDragEnd = () => {
    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    setDraggedAppointment(null);
    setDragPreview({ column: "", slot: 0, visible: false });
  };

  const addAppointment = (column: string, slot: number) => {
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
      const canBook = placementAppointmentTypeId !== undefined;
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

  const createAppointmentInSlot = (column: string, slot: number) => {
    const mode = simulatedContext ? "simulation" : "real";
    const appointmentTypeId =
      simulatedContext?.appointmentTypeId ?? selectedAppointmentTypeId;
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

    const practitioner = workingPractitioners.find((p) => p.id === column);
    if (!practitioner && column !== "ekg" && column !== "labor") {
      toast.error("Ungültige Ressource");
      return;
    }

    const requestResult = buildCalendarAppointmentRequest({
      appointmentTypeId,
      appointmentTypeName: appointmentTypeInfo.name,
      businessStartHour,
      isNewPatient: simulatedContext
        ? simulatedContext.patient.isNew
        : (patient?.isNewPatient ?? false),
      locationId: simulatedContext?.locationId ?? selectedLocationId,
      mode,
      patient,
      pendingAppointmentTitle,
      practiceId,
      practitionerId: practitioner?.id,
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
        onPatientRequired(requestResult.requestContext);
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

  const handleEditAppointment = (appointment: Appointment) => {
    // Prevent opening edit dialog if we just finished resizing this appointment
    if (justFinishedResizingRef.current === appointment.id) {
      return;
    }

    if (isNonRootSeriesAppointment(appointment.convexId)) {
      showNonRootSeriesEditToast();
      return;
    }

    // Editing appointments is now done via the new appointment flow dialog
    toast.info("Bearbeiten von Terminen ist über den neuen Dialog möglich.");
  };

  const handleDeleteAppointment = (appointment: Appointment) => {
    const confirmMessage =
      appointment.convexId &&
      appointmentDocMapRef.current.get(appointment.convexId)?.seriesId
        ? "Dieser Termin gehört zu einer Kette. Beim Löschen wird die gesamte Terminserie entfernt. Fortfahren?"
        : "Termin löschen?";

    if (appointment.convexId && confirm(confirmMessage)) {
      void runDeleteAppointment({
        id: appointment.convexId,
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
    setDragPreview({ column: "", slot: 0, visible: false });
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
        ...(simulatedContext.appointmentTypeId && {
          appointmentTypeId: simulatedContext.appointmentTypeId,
        }),
        isNewPatient: simulatedContext.patient.isNew,
        ...(patientDateOfBirth !== undefined && {
          patientDateOfBirth,
        }),
        ...(locationId && {
          locationId,
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
    blockedSlotsData,
    blockedSlotWarning,
    businessEndHour,
    businessStartHour,
    columns,
    currentTime,
    currentTimeSlot: getCurrentTimeSlot(),
    draggedAppointment,
    draggedBlockedSlotId,
    dragPreview,
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
    selectedLocationId: simulatedContext?.locationId || selectedLocationId,
    setBlockedSlotWarning,
    slotToTime,
    timeToSlot,
    totalSlots,
    workingPractitioners,
  };
}
