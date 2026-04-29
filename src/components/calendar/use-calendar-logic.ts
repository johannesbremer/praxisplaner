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
import { createSimulatedContext } from "../../../lib/utils";
import { findIdInList } from "../../utils/convex-ids";
import { captureErrorGlobal } from "../../utils/error-tracking";
import { captureFrontendError } from "../../utils/frontend-errors";
import {
  formatTime,
  temporalDayToLegacy,
  zonedDateTimeStringResult,
} from "../../utils/time-calculations";
import {
  buildCalendarAppointmentLayouts,
  buildCalendarAppointmentViews,
} from "./calendar-view-models";
import {
  type CalendarAppointmentLayout,
  type CalendarColumnId,
  type NewCalendarProps,
  SLOT_DURATION,
} from "./types";
import { useCalendarBlockedSlotProjection } from "./use-calendar-blocked-slot-projection";
import { buildCalendarAppointmentRequest } from "./use-calendar-booking";
import { useCalendarData } from "./use-calendar-data";
import { useCalendarDevtools } from "./use-calendar-devtools";
import { useCalendarInteractions } from "./use-calendar-interactions";
import { handleEditBlockedSlot, TIMEZONE } from "./use-calendar-logic-helpers";
import { useCalendarPlanningAdapters } from "./use-calendar-planning-adapters";
import { useCalendarReferenceResolver } from "./use-calendar-reference-resolver";
import { useCalendarVisibleDay } from "./use-calendar-visible-day";

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

  const getPractitionerIdForColumn = useCallback(
    (column: CalendarColumnId): Id<"practitioners"> | undefined =>
      typeof column === "string" && (column === "ekg" || column === "labor")
        ? undefined
        : getPractitionerIdForLineageKey(column),
    [getPractitionerIdForLineageKey],
  );

  const patientDateOfBirth = patient?.dateOfBirth;
  const patientIsNewPatient = patient?.isNewPatient;
  const { commands: planningCommands, getBlockedSlotEditorData } =
    useCalendarPlanningAdapters({
      simulation: {
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
        selectedDate,
        selectedLocationId,
        simulatedContext,
      },
      workbench: {
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
      },
    });

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
    baseAppointmentTypeUnavailableBlockedSlots,
    baseBlockedSlots,
    baseBreakSlots,
    baseDragDisabledPractitionerBlockedSlots,
    baseManualBlockedSlots,
    baseUnavailablePractitionerBlockedSlots,
    baseVacationBlockedSlots,
  } = useCalendarBlockedSlotProjection({
    appointmentsData,
    baseSchedulesData,
    blockedSlotsData,
    blockedSlotsWithoutAppointmentTypeSlots:
      blockedSlotsWithoutAppointmentTypeResult?.slots,
    businessStartHour,
    columns,
    getPractitionerIdForLineageKey,
    locationLineageKeyById,
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
    isNonRootSeriesAppointment,
    resolveBlockedSlotDisplayRefs: resolveBlockedSlotReferenceDisplayIds,
    runUpdateAppointment: planningCommands.updateAppointment,
    runUpdateBlockedSlot: planningCommands.updateBlockedSlot,
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
        existing && "isManual" in existing ? existing.isManual : false;
      const slotIsManual = "isManual" in slot ? slot.isManual : false;

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
            await planningCommands.updateBlockedSlot({
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
                ...(newPractitionerId || blockedSlotDisplayRefs.practitionerId
                  ? {
                      practitionerId:
                        newPractitionerId ||
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
        await planningCommands.convertRealAppointmentToSimulation(
          draggedAppointment,
          {
            columnOverride: column,
            durationMinutes: draggedAppointment.duration,
            endISO: endZoned.toString(),
            ...(newPractitionerId && { practitionerId: newPractitionerId }),
            startISO: startZoned.toString(),
          },
        );
      } else {
        try {
          await planningCommands.updateAppointment({
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
        "isManual" in blockedSlotData && blockedSlotData.isManual;
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

    void planningCommands
      .createAppointment(requestResult.request)
      .then((createdAppointmentId) => {
        if (createdAppointmentId) {
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
    runCreateAppointment: planningCommands.createAppointment,
    runCreateBlockedSlot: planningCommands.createBlockedSlot,
    runDeleteBlockedSlot: planningCommands.deleteBlockedSlot,
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
