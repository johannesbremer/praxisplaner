import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type { ZonedDateTimeString } from "../../../convex/typedDtos";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
} from "../../../convex/identity";
import {
  calendarColumnScopeKey,
  createCalendarPlacement,
  getCalendarResourceColumnFromColumn,
  getPractitionerLineageKeyFromColumn,
  sameCalendarColumnScope,
} from "../../../lib/calendar-occupancy";
import { createSimulatedContext } from "../../../lib/utils";
import { findIdInList } from "../../utils/convex-ids";
import { captureErrorGlobal } from "../../utils/error-tracking";
import { captureFrontendError } from "../../utils/frontend-errors";
import {
  formatTime,
  temporalDayToLegacy,
  zonedDateTimeStringResult,
} from "../../utils/time-calculations";
import { findFirstBlockedSlotInRange } from "./calendar-slot-blocking";
import {
  buildCalendarAppointmentLayouts,
  buildCalendarAppointmentViews,
  getCalendarAppointmentColumn,
} from "./calendar-view-models";
import {
  type CalendarAppointmentLayout,
  type CalendarAppointmentPlacement,
  type CalendarColumn,
  type CalendarColumnId,
  type NewCalendarProps,
  SLOT_DURATION,
} from "./types";
import { useCalendarBlockedSlotProjection } from "./use-calendar-blocked-slot-projection";
import { buildCalendarAppointmentRequest } from "./use-calendar-booking";
import { useCalendarData } from "./use-calendar-data";
import { useCalendarDevtools } from "./use-calendar-devtools";
import { useCalendarInteractions } from "./use-calendar-interactions";
import {
  handleEditBlockedSlot,
  resolveBlockedSlotDropOccupancyScope,
  resolveDragPreviewSlot,
  resolvePointerSlot,
  TIMEZONE,
} from "./use-calendar-logic-helpers";
import { useCalendarPlanningWorkbench } from "./use-calendar-planning-workbench";
import { useCalendarReferenceResolver } from "./use-calendar-reference-resolver";
import { useCalendarSimulationConversion } from "./use-calendar-simulation-conversion";
import { useCalendarVisibleDay } from "./use-calendar-visible-day";

interface CalendarPointerCoordinates {
  clientX: number;
  clientY: number;
}

interface CalendarPointerTarget {
  column: CalendarColumnId;
  element: HTMLElement;
}

const CALENDAR_DRAG_START_THRESHOLD_PX = 3;

interface ActiveCalendarDragPointer {
  hasMovedPastThreshold: boolean;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

function hasMovedPastCalendarDragThreshold(
  activePointer: ActiveCalendarDragPointer,
  pointer: CalendarPointerCoordinates,
): boolean {
  return (
    Math.hypot(
      pointer.clientX - activePointer.startClientX,
      pointer.clientY - activePointer.startClientY,
    ) >= CALENDAR_DRAG_START_THRESHOLD_PX
  );
}

/**
 * Deep comparison of appointment arrays.
 */
export function useCalendarLogic({
  canManageCalendarPlanning = false,
  locationName,
  onAppointmentCreated,
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
  const [dragExcludedAppointmentIds, setDragExcludedAppointmentIds] = useState<
    Id<"appointments">[]
  >([]);
  const [draggedBlockedSlotId, setDraggedBlockedSlotId] = useState<
    null | string
  >(null);
  const emptyDragPreview = useMemo(
    () =>
      ({
        column: null,
        slot: 0,
        visible: false,
      }) as const,
    [],
  );
  const [dragPreview, setDragPreview] = useState<{
    column: CalendarColumnId | null;
    slot: number;
    visible: boolean;
  }>(emptyDragPreview);
  const autoScrollAnimationRef = useRef<null | number>(null);
  const activeDragPointerRef = useRef<ActiveCalendarDragPointer | null>(null);
  const detachPointerDragListenersRef = useRef<(() => void) | null>(null);
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
  const draggedAppointmentTypeLineageKey =
    draggedAppointment?.record.appointmentTypeLineageKey;

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
    excludedAppointmentIdsForAvailability: dragExcludedAppointmentIds,
    patient,
    practiceId,
    ruleSetId,
    schedulingAppointmentTypeLineageKey: draggedAppointmentTypeLineageKey,
    selectedAppointmentTypeId,
    selectedDate,
    selectedLocationId,
    simulatedContext,
  });
  const excludedAppointmentIdsForAvailability = useMemo(
    () => new Set(dragExcludedAppointmentIds),
    [dragExcludedAppointmentIds],
  );
  const blockedSlotsQueryArgs = calendarDayQueryArgs;

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

  const {
    getAppointmentTypeIdForLineageKey,
    getLocationIdForLineageKey,
    getLocationLineageKeyForDisplayId,
    getPractitionerIdForLineageKey,
    getPractitionerLineageKeyForDisplayId,
    referenceMaps,
    resolveBlockedSlotReferenceDisplayIds,
  } = useCalendarReferenceResolver({
    appointmentTypeIdByLineageKey,
    appointmentTypeLineageKeyById,
    locationIdByLineageKey,
    locationLineageKeyById,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
  });

  const { commands: mutationCommands, getBlockedSlotEditorData } =
    useCalendarPlanningWorkbench({
      activeDayAppointmentMapRef: appointmentDocMapRef,
      activeDayBlockedSlotMapRef: blockedSlotDocMapRef,
      allPracticeAppointmentMap: allPracticeAppointmentDocMap,
      allPracticeAppointmentMapRef: allPracticeAppointmentDocMapRef,
      allPracticeAppointmentsLoaded,
      allPracticeBlockedSlotMap: allPracticeBlockedSlotDocMap,
      allPracticeBlockedSlotMapRef: allPracticeBlockedSlotDocMapRef,
      allPracticeBlockedSlotsLoaded,
      blockedSlotsQueryArgs,
      calendarDayQueryArgs,
      getRequiredAppointmentTypeInfo,
      parseZonedDateTime,
      referenceMaps,
      refreshAllPracticeConflictData,
    });

  const placementAppointmentTypeLineageKey =
    simulatedContext?.appointmentTypeLineageKey ??
    (selectedAppointmentTypeId === undefined
      ? undefined
      : appointmentTypeLineageKeyById.get(selectedAppointmentTypeId));
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

  const {
    createAppointment: runCreateAppointment,
    createBlockedSlot: runCreateBlockedSlot,
    deleteAppointment: runDeleteAppointment,
    deleteBlockedSlot: runDeleteBlockedSlot,
    updateAppointment: runUpdateAppointment,
    updateBlockedSlot: runUpdateBlockedSlot,
  } = mutationCommands;

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

  const {
    businessEndHour,
    businessStartHour,
    columns,
    totalSlots,
    workingPractitioners,
  } = useCalendarVisibleDay({
    appointmentsData,
    baseSchedulesData,
    blockedSlotsData,
    currentDayOfWeek,
    draggedAppointmentTypeLineageKey,
    getUnsupportedPractitionerIdsForAppointmentType,
    locationLineageKeyById,
    placementAppointmentTypeLineageKey,
    practitionerIdByLineageKey,
    practitionerLineageKeyById,
    practitionerNameByLineageKey,
    practitionersData,
    selectedDate,
    selectedLocationId,
    simulatedContext,
    timeToMinutes,
    vacationsData,
  });

  const getPractitionerIdForColumn = useCallback(
    (column: CalendarColumnId): Id<"practitioners"> | undefined =>
      (() => {
        const practitionerLineageKey =
          getPractitionerLineageKeyFromColumn(column);
        return practitionerLineageKey === undefined
          ? undefined
          : getPractitionerIdForLineageKey(practitionerLineageKey);
      })(),
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

  const {
    baseAppointmentSeriesRootBlockedSlots,
    baseAppointmentTypeUnavailableBlockedSlots,
    baseBlockedSlots,
    baseBreakSlots,
    baseDragDisabledPractitionerBlockedSlots,
    baseManualBlockedSlots,
    baseUnavailablePractitionerBlockedSlots,
    baseVacationBlockedSlots,
  } = useCalendarBlockedSlotProjection({
    appointmentsData,
    appointmentTypeInfoByLineageKey,
    baseSchedulesData,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeSlots:
      blockedSlotsWithoutAppointmentTypeResult?.slots,
    businessStartHour,
    columns,
    excludedAppointmentIdsForAvailability,
    getPractitionerIdForLineageKey,
    locationLineageKeyById,
    placementAppointmentTypeLineageKey,
    practitionerLineageKeyById,
    selectedDate,
    selectedLocationId,
    simulatedContext,
    slots: slotsResult?.slots,
    timeToSlot,
    totalSlots,
    vacationsData,
    workingPractitioners,
  });

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
      excludedIds: ReadonlySet<Id<"appointments">> = new Set(),
    ) => {
      const endSlot = startSlot + Math.ceil(duration / SLOT_DURATION);

      return baseAppointmentLayouts.some((apt) => {
        if (
          excludedIds.has(apt.record._id) ||
          !sameCalendarColumnScope(apt.column, column)
        ) {
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

  const getMaxAvailableDuration = useCallback(
    (column: CalendarColumnId, startSlot: number) => {
      const occupiedSlots = baseAppointmentLayouts
        .filter((apt) => sameCalendarColumnScope(apt.column, column))
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

  const patientDateOfBirth = patient?.dateOfBirth;
  const patientIsNewPatient = patient?.isNewPatient;
  const {
    convertRealAppointmentToSimulation,
    convertRealBlockedSlotToSimulation,
  } = useCalendarSimulationConversion({
    blockedSlotDocMapRef,
    getAppointmentTypeIdForLineageKey,
    getLocationIdForLineageKey,
    getLocationLineageKeyForDisplayId,
    getPractitionerIdForColumn,
    getPractitionerIdForLineageKey,
    getPractitionerLineageKeyForDisplayId,
    parseZonedDateTime,
    patientDateOfBirth,
    patientIsNewPatient,
    practiceId,
    runCreateAppointment,
    runCreateBlockedSlot,
    selectedDate,
    selectedLocationId,
    simulatedContext,
  });
  const planningCommands = useMemo(
    () => ({
      convertRealAppointmentToSimulation,
      convertRealBlockedSlotToSimulation,
      createAppointment: runCreateAppointment,
      createBlockedSlot: runCreateBlockedSlot,
      deleteAppointment: runDeleteAppointment,
      deleteBlockedSlot: runDeleteBlockedSlot,
      updateAppointment: runUpdateAppointment,
      updateBlockedSlot: runUpdateBlockedSlot,
    }),
    [
      convertRealAppointmentToSimulation,
      convertRealBlockedSlotToSimulation,
      runCreateAppointment,
      runCreateBlockedSlot,
      runDeleteAppointment,
      runDeleteBlockedSlot,
      runUpdateAppointment,
      runUpdateBlockedSlot,
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
    convertRealAppointmentToSimulation:
      planningCommands.convertRealAppointmentToSimulation,
    convertRealBlockedSlotToSimulation:
      planningCommands.convertRealBlockedSlotToSimulation,
    resolveBlockedSlotDisplayRefs: resolveBlockedSlotReferenceDisplayIds,
    runUpdateAppointment: planningCommands.updateAppointment,
    runUpdateBlockedSlot: planningCommands.updateBlockedSlot,
    selectedDate,
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
      ...baseAppointmentSeriesRootBlockedSlots,
      ...baseAppointmentTypeUnavailableBlockedSlots,
      ...baseDragDisabledPractitionerBlockedSlots,
      ...manualBlockedSlots,
      ...baseUnavailablePractitionerBlockedSlots,
      ...baseVacationBlockedSlots,
    ].filter((slot) => slot.slot >= 0 && slot.slot < totalSlots);

    const uniqueSlots = new Map<string, (typeof combined)[0]>();
    for (const slot of combined) {
      const key = `${calendarColumnScopeKey(slot.column)}-${slot.slot}`;
      const existing = uniqueSlots.get(key);
      const existingIsManual =
        existing && "isManual" in existing ? existing.isManual : false;
      const slotIsManual = "isManual" in slot ? slot.isManual : false;

      if (!existing || (!existingIsManual && slotIsManual)) {
        uniqueSlots.set(key, slot);
      }
    }

    return [...uniqueSlots.values()];
  }, [
    baseAppointmentTypeUnavailableBlockedSlots,
    baseAppointmentSeriesRootBlockedSlots,
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

  const columnByKey = useMemo(() => {
    const entries: [string, CalendarColumn][] = columns.map((column) => [
      calendarColumnScopeKey(column.id),
      column,
    ]);
    return new Map<string, CalendarColumn>(entries);
  }, [columns]);

  // Pointer-driven calendar move handlers
  const getPointerSlot = useCallback(
    (element: HTMLElement, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const slotRow = element.querySelector('[data-calendar-slot-row="true"]');
      const slotRowRect = slotRow?.getBoundingClientRect();

      return resolvePointerSlot({
        pointerOffsetPx: clientY - rect.top,
        renderedSlotHeightPx: slotRowRect?.height ?? 0,
        totalSlots,
      });
    },
    [totalSlots],
  );

  const resolvePointerTarget = useCallback(
    ({ clientX, clientY }: CalendarPointerCoordinates) => {
      const elements = document.elementsFromPoint(clientX, clientY);
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        const target = element.closest<HTMLElement>(
          "[data-calendar-column-key]",
        );
        const columnKey = target?.dataset["calendarColumnKey"];
        if (target === null || columnKey === undefined) {
          continue;
        }
        const column = columnByKey.get(columnKey);
        if (column === undefined) {
          continue;
        }
        if (
          column.isUnavailable === true ||
          column.isAppointmentTypeUnavailable === true ||
          (draggedAppointment !== null && column.isDragDisabled === true)
        ) {
          return null;
        }
        return {
          column: column.id,
          element: target,
        };
      }
      return null;
    },
    [columnByKey, draggedAppointment],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }
  }, []);

  const clearPointerDragListeners = useCallback(() => {
    detachPointerDragListenersRef.current?.();
    detachPointerDragListenersRef.current = null;
  }, []);

  const handleAutoScroll = useCallback(
    (pointer: CalendarPointerCoordinates) => {
      const scrollContainer = scrollContainerRef?.current;
      if (!scrollContainer) {
        return;
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const mouseY = pointer.clientY;
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
        autoScrollAnimationRef.current =
          requestAnimationFrame(animateScrollDown);
      }
    },
    [scrollContainerRef],
  );

  const handleDragStart = (e: React.PointerEvent, appointmentId: string) => {
    if (e.button !== 0) {
      return;
    }
    const appointment = appointmentLayouts.find(
      (entry) => entry.id === appointmentId,
    );
    if (!appointment) {
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    activeDragPointerRef.current = {
      hasMovedPastThreshold: false,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    const sameSeriesAppointments =
      appointment.record.seriesId === undefined
        ? []
        : [...allPracticeAppointmentDocMap.values()].filter(
            (entry) => entry.seriesId === appointment.record.seriesId,
          );
    const excludedIds =
      appointment.record.seriesId === undefined
        ? [appointment.record._id]
        : sameSeriesAppointments.length > 0
          ? sameSeriesAppointments.map((entry) => entry._id)
          : appointmentLayouts
              .filter(
                (entry) =>
                  entry.record.seriesId === appointment.record.seriesId,
              )
              .map((entry) => entry.record._id);
    setDragExcludedAppointmentIds(excludedIds);
    setDraggedAppointment(appointment);
  };

  const handleDragOver = useCallback(
    (pointer: CalendarPointerCoordinates) => {
      const target = resolvePointerTarget(pointer);
      if (target === null) {
        return;
      }
      const column = target.column;

      if (draggedAppointment) {
        const targetSlot = resolveDragPreviewSlot({
          durationMinutes: draggedAppointment.duration,
          pointerSlot: getPointerSlot(target.element, pointer.clientY),
          slotDurationMinutes: SLOT_DURATION,
          totalSlots,
        });

        setDragPreview((prev) => {
          if (
            prev.visible &&
            prev.column !== null &&
            sameCalendarColumnScope(prev.column, column) &&
            prev.slot === targetSlot
          ) {
            return prev;
          }
          return { column, slot: targetSlot, visible: true };
        });

        handleAutoScroll(pointer);
        return;
      }

      if (draggedBlockedSlotId) {
        const blockedSlot = manualBlockedSlots.find(
          (bs) => bs.id === draggedBlockedSlotId,
        );
        if (!blockedSlot) {
          return;
        }
        const targetSlot = resolveDragPreviewSlot({
          durationMinutes: blockedSlot.duration,
          pointerSlot: getPointerSlot(target.element, pointer.clientY),
          slotDurationMinutes: SLOT_DURATION,
          totalSlots,
        });

        setDragPreview((prev) => {
          if (
            prev.visible &&
            prev.column !== null &&
            sameCalendarColumnScope(prev.column, column) &&
            prev.slot === targetSlot
          ) {
            return prev;
          }
          return { column, slot: targetSlot, visible: true };
        });

        handleAutoScroll(pointer);
      }
    },
    [
      draggedAppointment,
      draggedBlockedSlotId,
      getPointerSlot,
      handleAutoScroll,
      manualBlockedSlots,
      resolvePointerTarget,
      totalSlots,
    ],
  );

  const resolveFinalDropSlot = useCallback(
    (target: CalendarPointerTarget, pointer: CalendarPointerCoordinates) => {
      if (draggedAppointment) {
        return resolveDragPreviewSlot({
          durationMinutes: draggedAppointment.duration,
          pointerSlot: getPointerSlot(target.element, pointer.clientY),
          slotDurationMinutes: SLOT_DURATION,
          totalSlots,
        });
      }

      if (draggedBlockedSlotId) {
        const blockedSlot = manualBlockedSlots.find(
          (bs) => bs.id === draggedBlockedSlotId,
        );
        if (!blockedSlot) {
          return null;
        }

        return resolveDragPreviewSlot({
          durationMinutes: blockedSlot.duration,
          pointerSlot: getPointerSlot(target.element, pointer.clientY),
          slotDurationMinutes: SLOT_DURATION,
          totalSlots,
        });
      }

      return null;
    },
    [
      draggedAppointment,
      draggedBlockedSlotId,
      getPointerSlot,
      manualBlockedSlots,
      totalSlots,
    ],
  );

  const handleDrop = useCallback(
    async (column: CalendarColumnId, finalSlot: number) => {
      stopAutoScroll();

      if (draggedBlockedSlotId) {
        // Handle blocked slot drop
        const blockedSlot = manualBlockedSlots.find(
          (bs) => bs.id === draggedBlockedSlotId,
        );
        if (!blockedSlot) {
          return;
        }

        const resolvedBlockedSlotId = findIdInList(
          [...blockedSlotDocMapRef.current.keys()],
          blockedSlot.id,
        );
        const blockedSlotDoc =
          resolvedBlockedSlotId === undefined
            ? undefined
            : blockedSlotDocMapRef.current.get(resolvedBlockedSlotId);

        if (!dragPreview.visible) {
          setDraggedBlockedSlotId(null);
          setDragPreview(emptyDragPreview);
          return;
        }
        const newTime = slotToTime(finalSlot);

        try {
          if (checkCollision(column, finalSlot, blockedSlot.duration)) {
            toast.error(
              "Gesperrter Zeitraum kann nicht auf einen belegten Zeitraum verschoben werden.",
            );
            return;
          }

          const plainTime = Temporal.PlainTime.from(newTime);
          const startZoned = selectedDate.toZonedDateTime({
            plainTime,
            timeZone: TIMEZONE,
          });

          const endZoned = startZoned.add({
            minutes: blockedSlot.duration,
          });

          const dropOccupancyScope = resolveBlockedSlotDropOccupancyScope({
            column,
            getPractitionerIdForColumn,
          });
          if (dropOccupancyScope.kind === "reject-resource-column") {
            toast.error(
              "Gesperrte Zeitraeume koennen nicht auf EKG- oder Labor-Spalten verschoben werden.",
            );
            return;
          }

          if (simulatedContext) {
            if (!blockedSlot.id || !blockedSlotDoc) {
              toast.error(
                "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
              );
            } else if (blockedSlotDoc.isSimulation) {
              await planningCommands.updateBlockedSlot({
                end: endZoned.toString(),
                id: blockedSlotDoc._id,
                occupancyScope: dropOccupancyScope,
                start: startZoned.toString(),
              });
            } else {
              const blockedSlotDisplayRefs =
                resolveBlockedSlotReferenceDisplayIds(blockedSlotDoc);
              if (!blockedSlotDisplayRefs) {
                toast.error(
                  "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
                );
                return;
              }

              await planningCommands.convertRealBlockedSlotToSimulation(
                blockedSlot.id,
                {
                  endISO: endZoned.toString(),
                  locationId: blockedSlotDisplayRefs.locationId,
                  startISO: startZoned.toString(),
                  title:
                    blockedSlotDoc.title ||
                    blockedSlot.title ||
                    "Gesperrter Zeitraum",
                  ...(dropOccupancyScope.kind === "practitioner" ||
                  blockedSlotDisplayRefs.practitionerId
                    ? {
                        practitionerId:
                          (dropOccupancyScope.kind === "practitioner"
                            ? dropOccupancyScope.practitionerId
                            : undefined) ||
                          blockedSlotDisplayRefs.practitionerId,
                      }
                    : {}),
                },
              );
            }
          } else if (blockedSlotDoc) {
            await planningCommands.updateBlockedSlot({
              end: endZoned.toString(),
              id: blockedSlotDoc._id,
              occupancyScope: dropOccupancyScope,
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

      if (!dragPreview.visible) {
        setDraggedAppointment(null);
        setDragPreview(emptyDragPreview);
        return;
      }

      if (isNonRootSeriesAppointment(draggedAppointment.record._id)) {
        showNonRootSeriesEditToast();
        setDraggedAppointment(null);
        setDragPreview(emptyDragPreview);
        return;
      }

      const newTime = slotToTime(finalSlot);

      try {
        if (
          checkCollision(
            column,
            finalSlot,
            draggedAppointment.duration,
            draggedAppointment.id,
          )
        ) {
          toast.error(
            "Termin kann nicht auf einen belegten Zeitraum verschoben werden.",
          );
          return;
        }

        const plainTime = Temporal.PlainTime.from(newTime);
        const startZoned = selectedDate.toZonedDateTime({
          plainTime,
          timeZone: TIMEZONE,
        });

        const endZoned = startZoned.add({
          minutes: draggedAppointment.duration,
        });

        const targetResourceColumn =
          getCalendarResourceColumnFromColumn(column);
        const targetPractitionerId =
          targetResourceColumn === undefined
            ? getPractitionerIdForColumn(column)
            : undefined;

        if (
          simulatedContext &&
          draggedAppointment.record.isSimulation !== true
        ) {
          await planningCommands.convertRealAppointmentToSimulation(
            draggedAppointment,
            {
              columnOverride: column,
              endISO: endZoned.toString(),
              ...(targetResourceColumn === undefined
                ? { calendarResourceColumn: null }
                : { calendarResourceColumn: targetResourceColumn }),
              ...(targetPractitionerId && {
                practitionerId: targetPractitionerId,
              }),
              startISO: startZoned.toString(),
            },
          );
          return;
        }

        if (simulatedContext) {
          if (!blockedSlot.id || !blockedSlotDoc) {
            toast.error(
              "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
            );
          } else if (blockedSlotDoc.isSimulation) {
            await planningCommands.updateBlockedSlot({
              end: endZoned.toString(),
              id: blockedSlotDoc._id,
              occupancyScope: dropOccupancyScope,
              start: startZoned.toString(),
            });
          } else {
            const blockedSlotDisplayRefs =
              resolveBlockedSlotReferenceDisplayIds(blockedSlotDoc);
            if (!blockedSlotDisplayRefs) {
              toast.error(
                "Gesperrter Zeitraum konnte in der Simulation nicht aktualisiert werden.",
              );
              return;
            }

            await planningCommands.convertRealBlockedSlotToSimulation(
              blockedSlot.id,
              {
                endISO: endZoned.toString(),
                locationId: blockedSlotDisplayRefs.locationId,
                startISO: startZoned.toString(),
                title:
                  blockedSlotDoc.title ||
                  blockedSlot.title ||
                  "Gesperrter Zeitraum",
                ...(dropOccupancyScope.kind === "practitioner" ||
                blockedSlotDisplayRefs.practitionerId
                  ? {
                      practitionerId:
                        (dropOccupancyScope.kind === "practitioner"
                          ? dropOccupancyScope.practitionerId
                          : undefined) || blockedSlotDisplayRefs.practitionerId,
                    }
                  : {}),
              },
            );
          }
        } else if (blockedSlotDoc) {
          await planningCommands.updateBlockedSlot({
            end: endZoned.toString(),
            id: blockedSlotDoc._id,
            occupancyScope: dropOccupancyScope,
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

    const finalSlot = resolveDropSlot(e, draggedAppointment.duration);
    const newTime = slotToTime(finalSlot);

    try {
      if (
        checkCollision(
          column,
          finalSlot,
          draggedAppointment.duration,
          excludedAppointmentIdsForAvailability,
        )
      ) {
        toast.error(
          "Termin kann nicht auf einen belegten Zeitraum verschoben werden.",
        );
        return;
      }

      const blockedSlotData = findFirstBlockedSlotInRange({
        blockedSlots: allBlockedSlots,
        column,
        durationMinutes: draggedAppointment.duration,
        slotDurationMinutes: SLOT_DURATION,
        startSlot: finalSlot,
      });
      if (blockedSlotData) {
        toast.error(
          blockedSlotData.reason
            ? `Termin kann nicht auf einen gesperrten Zeitraum verschoben werden: ${blockedSlotData.reason}`
            : "Termin kann nicht auf einen gesperrten Zeitraum verschoben werden.",
        );
        return;
      }

      const plainTime = Temporal.PlainTime.from(newTime);
      const startZoned = selectedDate.toZonedDateTime({
        plainTime,
        timeZone: TIMEZONE,
      });

      const endZoned = startZoned.add({ minutes: draggedAppointment.duration });

      const rootSeriesAppointment =
        draggedAppointment.record.seriesId === undefined
          ? undefined
          : [...allPracticeAppointmentDocMap.values()].find(
              (appointment) =>
                appointment.seriesId === draggedAppointment.record.seriesId &&
                appointment.seriesStepIndex === 0n,
            );
      const moveSeriesFromFollowUp =
        isNonRootSeriesAppointment(draggedAppointment.record._id) &&
        rootSeriesAppointment !== undefined;

      if (
        isNonRootSeriesAppointment(draggedAppointment.record._id) &&
        rootSeriesAppointment === undefined
      ) {
        toast.error(
          "Der Starttermin dieser Kette ist noch nicht geladen. Bitte erneut versuchen.",
        );
        return;
      }

      const appointmentToMove =
        rootSeriesAppointment ?? draggedAppointment.record;
      const appointmentToMoveStart = Temporal.ZonedDateTime.from(
        appointmentToMove.start,
      );
      const appointmentToMoveEnd = Temporal.ZonedDateTime.from(
        appointmentToMove.end,
      );
      const moveDeltaMilliseconds = moveSeriesFromFollowUp
        ? startZoned.epochMilliseconds -
          Temporal.ZonedDateTime.from(draggedAppointment.record.start)
            .epochMilliseconds
        : 0;
      const movedStartZoned = moveSeriesFromFollowUp
        ? appointmentToMoveStart.add({ milliseconds: moveDeltaMilliseconds })
        : startZoned;
      const movedEndZoned = moveSeriesFromFollowUp
        ? appointmentToMoveEnd.add({ milliseconds: moveDeltaMilliseconds })
        : endZoned;
      const moveColumn = moveSeriesFromFollowUp
        ? getCalendarAppointmentColumn(appointmentToMove)
        : column;

      const targetResourceColumn =
        getCalendarResourceColumnFromColumn(moveColumn);
      const targetPractitionerId =
        targetResourceColumn === undefined
          ? getPractitionerIdForColumn(moveColumn)
          : undefined;

      if (simulatedContext && draggedAppointment.record.isSimulation !== true) {
        const appointmentLayoutToMove =
          appointmentLayouts.find(
            (appointment) => appointment.record._id === appointmentToMove._id,
          ) ??
          ({
            column: moveColumn,
            duration:
              (appointmentToMoveEnd.epochMilliseconds -
                appointmentToMoveStart.epochMilliseconds) /
              60_000,
            id: appointmentToMove._id,
            record: appointmentToMove,
            startTime: formatTime(appointmentToMoveStart.toPlainTime()),
          } satisfies CalendarAppointmentLayout);
        await planningCommands.convertRealAppointmentToSimulation(
          appointmentLayoutToMove,
          {
            columnOverride: moveColumn,
            endISO: movedEndZoned.toString(),
            ...(targetResourceColumn === undefined
              ? { calendarResourceColumn: null }
              : { calendarResourceColumn: targetResourceColumn }),
            ...(targetPractitionerId && {
              practitionerId: targetPractitionerId,
            }),
            startISO: movedStartZoned.toString(),
          },
        );
      } else {
        try {
          const targetPractitionerLineageKey =
            getPractitionerLineageKeyFromColumn(moveColumn);
          const targetPlacement =
            targetResourceColumn === undefined
              ? targetPractitionerLineageKey === undefined
                ? null
                : createCalendarPlacement({
                    locationLineageKey:
                      appointmentToMove.placement.locationLineageKey,
                    occupancyScope: {
                      kind: "practitioner",
                      practitionerLineageKey: targetPractitionerLineageKey,
                    },
                  })
              : createCalendarPlacement({
                  locationLineageKey:
                    appointmentToMove.placement.locationLineageKey,
                  occupancyScope: {
                    calendarResourceColumn: targetResourceColumn,
                    kind: "resource",
                  },
                });
            if (targetPlacement === null) {
              toast.error("Ungültige Ressource");
              return;
            }
          await planningCommands.updateAppointment({
            end: movedEndZoned.toString(),
            id: appointmentToMove._id,
            placement: targetPlacement,
            start: movedStartZoned.toString(),
          });
        } catch (error) {
          captureErrorGlobal(error, {
            appointmentId: appointmentToMove._id,
            context: "NewCalendar - Failed to update appointment (drag)",
          });
          toast.error("Termin konnte nicht verschoben werden");
        }
      } catch (error) {
        captureErrorGlobal(error, {
          context: "Failed to parse time during drag",
          newTime,
        });
        toast.error("Termin konnte nicht verschoben werden");
      } finally {
        // Convex optimistic updates will handle successful UI updates.
        setDraggedAppointment(null);
        setDragExcludedAppointmentIds([]);
        setDragPreview(emptyDragPreview);
      }
    },
    [
      allBlockedSlots,
      blockedSlotDocMapRef,
      checkCollision,
      dragPreview.visible,
      draggedAppointment,
      draggedBlockedSlotId,
      emptyDragPreview,
      excludedAppointmentIdsForAvailability,
      getCalendarResourceColumnFromColumn,
      getPractitionerIdForColumn,
      getPractitionerLineageKeyFromColumn,
      isNonRootSeriesAppointment,
      manualBlockedSlots,
      planningCommands,
      resolveBlockedSlotReferenceDisplayIds,
      resolveDropSlot,
      selectedDate,
      showNonRootSeriesEditToast,
      simulatedContext,
      slotToTime,
      stopAutoScroll,
    ],
  );

  const handleDragEnd = useCallback(() => {
    stopAutoScroll();
    clearPointerDragListeners();

    activeDragPointerRef.current = null;
    setDraggedAppointment(null);
    setDraggedBlockedSlotId(null);
    setDragExcludedAppointmentIds([]);
    setDragPreview(emptyDragPreview);
  }, [clearPointerDragListeners, emptyDragPreview, stopAutoScroll]);

  const handlePointerUp = useCallback(
    (pointer: CalendarPointerCoordinates) => {
      const target = resolvePointerTarget(pointer);
      if (target === null) {
        handleDragEnd();
        return;
      }
      const finalSlot = resolveFinalDropSlot(target, pointer);
      if (finalSlot === null) {
        handleDragEnd();
        return;
      }
      clearPointerDragListeners();
      void handleDrop(target.column, finalSlot);
    },
    [
      clearPointerDragListeners,
      handleDragEnd,
      handleDrop,
      resolveFinalDropSlot,
      resolvePointerTarget,
    ],
  );

  useEffect(() => {
    if (draggedAppointment === null && draggedBlockedSlotId === null) {
      clearPointerDragListeners();
      activeDragPointerRef.current = null;
      return;
    }

    const handleDocumentPointerMove = (event: PointerEvent) => {
      const activePointer = activeDragPointerRef.current;
      if (activePointer?.pointerId !== event.pointerId) {
        return;
      }
      if (!activePointer.hasMovedPastThreshold) {
        if (!hasMovedPastCalendarDragThreshold(activePointer, event)) {
          return;
        }
        activePointer.hasMovedPastThreshold = true;
      }
      handleDragOver(event);
    };
    const handleDocumentPointerUp = (event: PointerEvent) => {
      const activePointer = activeDragPointerRef.current;
      if (activePointer?.pointerId !== event.pointerId) {
        return;
      }
      if (
        !activePointer.hasMovedPastThreshold &&
        !hasMovedPastCalendarDragThreshold(activePointer, event)
      ) {
        handleDragEnd();
        return;
      }
      activeDragPointerRef.current = null;
      handlePointerUp(event);
    };
    const handleDocumentPointerCancel = (event: PointerEvent) => {
      if (activeDragPointerRef.current?.pointerId !== event.pointerId) {
        return;
      }
      handleDragEnd();
    };

    document.addEventListener("pointermove", handleDocumentPointerMove);
    document.addEventListener("pointerup", handleDocumentPointerUp);
    document.addEventListener("pointercancel", handleDocumentPointerCancel);
    detachPointerDragListenersRef.current = () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
      document.removeEventListener(
        "pointercancel",
        handleDocumentPointerCancel,
      );
    };

    return () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
      document.removeEventListener(
        "pointercancel",
        handleDocumentPointerCancel,
      );
    };
  }, [
    clearPointerDragListeners,
    draggedAppointment,
    draggedBlockedSlotId,
    handleDragOver,
    handleDragEnd,
    handlePointerUp,
  ]);

  const addAppointment = (column: CalendarColumnId, slot: number) => {
    const appointmentTypeInfo =
      placementAppointmentTypeLineageKey === undefined
        ? null
        : (appointmentTypeInfoByLineageKey.get(
            placementAppointmentTypeLineageKey,
          ) ?? null);
    const placementDuration = appointmentTypeInfo?.duration ?? SLOT_DURATION;
    const blockedSlotData = findFirstBlockedSlotInRange({
      blockedSlots: allBlockedSlots,
      column,
      durationMinutes: placementDuration,
      slotDurationMinutes: SLOT_DURATION,
      startSlot: slot,
    });

    if (blockedSlotData) {
      if (!canManageCalendarPlanning) {
        return;
      }
      // Show blocked slot warning dialog
      const slotTime = slotToTime(slot);
      // Check if this is a manual block (from blockedSlots memo, has isManual flag)
      const isManualBlock =
        "isManual" in blockedSlotData && blockedSlotData.isManual === true;
      const canBook = placementAppointmentTypeLineageKey !== undefined;
      setBlockedSlotWarning({
        canBook,
        column,
        isManualBlock,
        onConfirm: () => {
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

    const practitionerLineageKey = getPractitionerLineageKeyFromColumn(column);
    const practitioner =
      practitionerLineageKey === undefined
        ? undefined
        : workingPractitioners.find(
            (workingPractitioner) =>
              workingPractitioner.lineageKey === practitionerLineageKey,
          );
    if (
      !practitioner &&
      getCalendarResourceColumnFromColumn(column) === undefined
    ) {
      toast.error("Ungültige Ressource");
      return;
    }

    const locationLineageKey =
      simulatedContext?.locationLineageKey ??
      (selectedLocationId
        ? getLocationLineageKeyForDisplayId(selectedLocationId)
        : undefined);
    const resourceColumn = getCalendarResourceColumnFromColumn(column);
    const requestPlacement: CalendarAppointmentPlacement | undefined =
      locationLineageKey === undefined
        ? undefined
        : practitioner === undefined
          ? resourceColumn === undefined
            ? undefined
            : createCalendarPlacement({
                locationLineageKey,
                occupancyScope: {
                  calendarResourceColumn: resourceColumn,
                  kind: "resource",
                },
              })
          : createCalendarPlacement({
              locationLineageKey,
              occupancyScope: {
                kind: "practitioner",
                practitionerLineageKey: practitioner.lineageKey,
              },
            });
    if (requestPlacement === undefined && locationLineageKey !== undefined) {
      toast.error("Termin-Referenzen konnten nicht aufgelöst werden.");
      return;
    }

    const requestArgs: Parameters<typeof buildCalendarAppointmentRequest>[0] = {
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
      mode,
      patient,
      pendingAppointmentTitle,
      placement: requestPlacement,
      practiceId,
      selectedDate,
      slot,
      slotDurationMinutes: SLOT_DURATION,
    };

    const requestResult = buildCalendarAppointmentRequest(requestArgs);

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
          placement: requestResult.requestContext.placement,
          practiceId: requestResult.requestContext.practiceId,
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

    void planningCommands
      .createAppointment(requestResult.request)
      .then((createdAppointmentId) => {
        if (createdAppointmentId) {
          onAppointmentCreated?.(createdAppointmentId);
          onClearAppointmentTypeSelection?.();
        }
      });
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
      void planningCommands.deleteAppointment({
        id: resolvedAppointmentId,
      });
    }
  };

  // Blocked slot handlers
  const handleBlockedSlotDragStart = (
    e: React.PointerEvent,
    blockedSlotId: string,
  ) => {
    if (e.button !== 0) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    activeDragPointerRef.current = {
      hasMovedPastThreshold: false,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    setDraggedBlockedSlotId(blockedSlotId);
  };

  const handleBlockedSlotDragEnd = () => {
    stopAutoScroll();
    clearPointerDragListeners();
    activeDragPointerRef.current = null;
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
      clearPointerDragListeners();
    };
  }, [clearPointerDragListeners]);

  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      const patientDateOfBirth = simulatedContext.patient.dateOfBirth;
      const newContext = createSimulatedContext({
        ...(simulatedContext.appointmentTypeLineageKey && {
          appointmentTypeLineageKey: simulatedContext.appointmentTypeLineageKey,
        }),
        ...(simulatedContext.clientType !== undefined && {
          clientType: simulatedContext.clientType,
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
    runCreateAppointment: planningCommands.createAppointment,
    runCreateBlockedSlot: planningCommands.createBlockedSlot,
    runDeleteBlockedSlot: planningCommands.deleteBlockedSlot,
    runUpdateAppointment: planningCommands.updateAppointment,
    runUpdateBlockedSlot: planningCommands.updateBlockedSlot,
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
