import type { Infer } from "convex/values";

import { useMutation, useQuery } from "convex/react";
import {
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";
import { de } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { Appointment, NewCalendarProps } from "./types";

import { api } from "../../../convex/_generated/api";
import { simulatedContextValidator } from "../../../convex/validators";
import { emitCalendarEvent } from "../../devtools/event-client";
import { captureErrorGlobal } from "../../utils/error-tracking";
import { slugify } from "../../utils/slug";
import { useAppointmentDialog } from "../appointment-dialog";
import { APPOINTMENT_COLORS, SLOT_DURATION } from "./types";

/**
 * Deep comparison of appointment arrays.
 */
export function useCalendarLogic({
  locationSlug,
  onDateChange,
  onLocationResolved,
  onUpdateSimulatedContext,
  practiceId: propPracticeId,
  selectedLocationId: externalSelectedLocationId,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(
    simulationDate ?? new Date(),
  );
  const [currentTime, setCurrentTime] = useState(new Date());
  const [practiceId, setPracticeId] = useState<Id<"practices"> | null>(
    propPracticeId ?? null,
  );

  const [draggedAppointment, setDraggedAppointment] =
    useState<Appointment | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    column: string;
    slot: number;
    visible: boolean;
  }>({
    column: "",
    slot: 0,
    visible: false,
  });
  const [resizing, setResizing] = useState<null | {
    appointmentId: string;
    originalDuration: number;
    startY: number;
  }>(null);
  const autoScrollAnimationRef = useRef<null | number>(null);
  const hasResolvedLocationRef = useRef(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const justFinishedResizingRef = useRef<null | string>(null);
  const { Dialog, openDialog: openAppointmentDialog } = useAppointmentDialog();

  // Devtools instrumentation
  const [mountTime] = useState(() => Date.now());
  const mountTimeRef = useRef<number>(mountTime);
  const lastRenderRef = useRef<number>(mountTime);
  const renderCountRef = useRef(0);
  const effectCountersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    renderCountRef.current += 1;
  });

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const now = Date.now();
    emitCalendarEvent("custom-devtools:calendar-render", {
      lastRenderAt: now,
      renders: renderCountRef.current,
    });
    emitCalendarEvent("custom-devtools:calendar-performance", {
      lastCommitAt: now,
      renderDeltaMs: now - lastRenderRef.current,
      sinceMountMs: now - mountTimeRef.current,
    });
    lastRenderRef.current = now;
  });

  // Local state for selected location - sync with external prop changes during render
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(externalSelectedLocationId);
  const [prevExternalLocationId, setPrevExternalLocationId] = useState(
    externalSelectedLocationId,
  );

  // Sync with external location ID changes during render (safe pattern)
  if (
    externalSelectedLocationId !== prevExternalLocationId &&
    externalSelectedLocationId
  ) {
    setPrevExternalLocationId(externalSelectedLocationId);
    setSelectedLocationId(externalSelectedLocationId);
  }

  // Initialize practice
  const initializePracticeMutation = useMutation(
    api.practices.initializeDefaultPractice,
  );

  // Track if we've initialized to avoid re-running
  const [hasInitialized, setHasInitialized] = useState(false);
  const [prevPropPracticeId, setPrevPropPracticeId] = useState(propPracticeId);

  // Sync practice ID from prop during render
  if (propPracticeId && propPracticeId !== prevPropPracticeId) {
    setPrevPropPracticeId(propPracticeId);
    setHasInitialized(true);
    if (practiceId !== propPracticeId) {
      setPracticeId(propPracticeId);
    }
  }

  // Initialize practice via mutation only once if no prop provided
  useEffect(() => {
    if (hasInitialized || propPracticeId) {
      return;
    }

    const initPractice = async () => {
      try {
        const id = await initializePracticeMutation({});
        setHasInitialized(true);
        setPracticeId(id);
      } catch (error) {
        captureErrorGlobal(error, {
          context: "NewCalendar - Failed to initialize practice",
          propPracticeId,
        });
      }
    };

    void initPractice();
  }, [hasInitialized, initializePracticeMutation, propPracticeId]);

  const appointmentScope = simulatedContext ? "simulation" : "real";
  const appointmentsQueryArgs = useMemo(
    () => ({ scope: appointmentScope as "all" | "real" | "simulation" }),
    [appointmentScope],
  );

  // Query data
  const appointmentsData = useQuery(
    api.appointments.getAppointments,
    appointmentsQueryArgs,
  );
  const practitionersData = useQuery(
    api.entities.getPractitionersFromActive,
    practiceId ? { practiceId } : "skip",
  );
  const baseSchedulesData = useQuery(
    api.entities.getBaseSchedulesFromActive,
    practiceId ? { practiceId } : "skip",
  );
  const locationsData = useQuery(
    api.entities.getLocationsFromActive,
    practiceId ? { practiceId } : "skip",
  );

  // Mutations
  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useMutation(
    api.appointments.updateAppointment,
  );
  const deleteAppointmentMutation = useMutation(
    api.appointments.deleteAppointment,
  );

  const runCreateAppointment = useCallback(
    async (args: Parameters<typeof createAppointmentMutation>[0]) => {
      return await createAppointmentMutation.withOptimisticUpdate(
        (localStore, optimisticArgs) => {
          const existingAppointments = localStore.getQuery(
            api.appointments.getAppointments,
            appointmentsQueryArgs,
          );

          if (!existingAppointments) {
            return;
          }

          const now = Date.now();
          const tempId = globalThis.crypto.randomUUID() as Id<"appointments">;

          const newAppointment: Doc<"appointments"> = {
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
            newAppointment.practitionerId = optimisticArgs.practitionerId;
          }

          if (optimisticArgs.patientId !== undefined) {
            newAppointment.patientId = optimisticArgs.patientId;
          }

          if (optimisticArgs.appointmentType !== undefined) {
            newAppointment.appointmentType = optimisticArgs.appointmentType;
          }

          if (optimisticArgs.replacesAppointmentId !== undefined) {
            newAppointment.replacesAppointmentId =
              optimisticArgs.replacesAppointmentId;
          }

          const baseList =
            optimisticArgs.replacesAppointmentId === undefined
              ? existingAppointments
              : existingAppointments.filter(
                  (apt) => apt._id !== optimisticArgs.replacesAppointmentId,
                );

          localStore.setQuery(
            api.appointments.getAppointments,
            appointmentsQueryArgs,
            [...baseList, newAppointment],
          );
        },
      )(args);
    },
    [createAppointmentMutation, appointmentsQueryArgs],
  );

  // Resolve location slug from URL
  useEffect(() => {
    if (
      !locationSlug ||
      !locationsData ||
      selectedLocationId ||
      hasResolvedLocationRef.current
    ) {
      return;
    }
    const match = locationsData.find(
      (l: { name: string }) => slugify(l.name) === locationSlug,
    );
    if (match) {
      hasResolvedLocationRef.current = true;
      // Use a microtask to avoid setState during render
      queueMicrotask(() => {
        setSelectedLocationId(match._id);
        if (onLocationResolved) {
          onLocationResolved(match._id, match.name);
        }
      });
    }
  }, [locationSlug, locationsData, onLocationResolved, selectedLocationId]);

  // Sync selected date with simulation date during render
  const [prevSimulationDate, setPrevSimulationDate] = useState(simulationDate);
  if (simulationDate && simulationDate !== prevSimulationDate) {
    setPrevSimulationDate(simulationDate);
    setSelectedDate(simulationDate);
  }

  // Notify parent when date changes
  const handleDateChange = useCallback(
    (nextDate: Date) => {
      if (
        selectedDate.getFullYear() === nextDate.getFullYear() &&
        selectedDate.getMonth() === nextDate.getMonth() &&
        selectedDate.getDate() === nextDate.getDate()
      ) {
        return;
      }

      setSelectedDate(nextDate);
      onDateChange?.(nextDate);
    },
    [selectedDate, onDateChange],
  );

  const currentDayOfWeek = selectedDate.getDay();

  // Helper function to convert time string to minutes
  const timeToMinutes = useCallback((timeStr: string): null | number => {
    const parsed = parse(timeStr, "HH:mm", new Date(0));
    if (Number.isNaN(parsed.getTime())) {
      captureErrorGlobal(new Error(`Invalid time format: "${timeStr}"`), {
        context: "NewCalendar - Invalid time format in timeToMinutes",
        expectedFormat: "HH:mm",
        timeStr,
      });
      return null;
    }
    return differenceInMinutes(parsed, startOfDay(parsed));
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

    if (daySchedules.length === 0) {
      return {
        businessEndHour: 0,
        businessStartHour: 0,
        columns: [],
        totalSlots: 0,
        workingPractitioners: [],
      };
    }

    // Validate and filter schedules with invalid times
    const validSchedules = daySchedules.filter((schedule) => {
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

    const startTimes = validSchedules
      .map((s) => timeToMinutes(s.startTime))
      .filter((t): t is number => t !== null);
    const endTimes = validSchedules
      .map((s) => timeToMinutes(s.endTime))
      .filter((t): t is number => t !== null);

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

    const practitionerColumns = working.map((practitioner) => ({
      id: practitioner.id,
      title: practitioner.name,
    }));

    const specialColumns =
      working.length > 0
        ? [
            { id: "ekg", title: "EKG" },
            { id: "labor", title: "Labor" },
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
    simulatedContext,
    selectedLocationId,
    timeToMinutes,
  ]);

  // Filter appointments by date
  const dateFilteredAppointments = useMemo(() => {
    if (!appointmentsData) {
      return [];
    }
    return appointmentsData.filter((appointment: Doc<"appointments">) => {
      const appointmentDate = parseISO(appointment.start);
      return isSameDay(appointmentDate, selectedDate);
    });
  }, [appointmentsData, selectedDate]);

  // Filter by location
  const locationFilteredAppointments = useMemo(() => {
    const locationId = simulatedContext?.locationId ?? selectedLocationId;
    if (!locationId) {
      return dateFilteredAppointments;
    }

    return dateFilteredAppointments.filter(
      (appointment) => appointment.locationId === locationId,
    );
  }, [
    dateFilteredAppointments,
    simulatedContext?.locationId,
    selectedLocationId,
  ]);

  // Map to Appointment type
  const combinedDerivedAppointments = useMemo(() => {
    return locationFilteredAppointments
      .map((appointment: Doc<"appointments">, index): Appointment | null => {
        const start = parseISO(appointment.start);
        const end = parseISO(appointment.end);
        const duration = Math.round(
          (end.getTime() - start.getTime()) / (1000 * 60),
        );

        return {
          color:
            APPOINTMENT_COLORS[index % APPOINTMENT_COLORS.length] ??
            "bg-gray-500",
          column: appointment.practitionerId || "ekg",
          convexId: appointment._id,
          duration,
          id: appointment._id,
          isSimulation: appointment.isSimulation === true,
          replacesAppointmentId: appointment.replacesAppointmentId ?? null,
          resource: {
            appointmentType: appointment.appointmentType,
            isSimulation: appointment.isSimulation === true,
            locationId: appointment.locationId,
            patientId: appointment.patientId,
            practitionerId: appointment.practitionerId,
          },
          startTime: format(start, "HH:mm"),
          title: appointment.title,
        };
      })
      .filter((apt): apt is Appointment => apt !== null);
  }, [locationFilteredAppointments]);

  // Derive appointments directly from combinedDerivedAppointments
  // Convex handles optimistic updates, so we don't need manual state management
  const appointments = useMemo(() => {
    return combinedDerivedAppointments;
  }, [combinedDerivedAppointments]);

  // Track appointments in devtools
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const map = effectCountersRef.current;
    const name = "appointmentsSync";
    map[name] = (map[name] ?? 0) + 1;
    emitCalendarEvent("custom-devtools:calendar-effect", {
      count: map[name],
      name,
    });
  }, [combinedDerivedAppointments]);

  // Track appointment changes for devtools
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const prevIds = new Set(appointments.map((a) => a.id));
    const nextIds = new Set(combinedDerivedAppointments.map((a) => a.id));
    const added: string[] = [];
    const removed: string[] = [];

    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        removed.push(id);
      }
    }
    for (const id of nextIds) {
      if (!prevIds.has(id)) {
        added.push(id);
      }
    }

    const updated: string[] = [];
    for (const next of combinedDerivedAppointments) {
      const prevMatch = appointments.find((p) => p.id === next.id);
      if (
        prevMatch &&
        (prevMatch.startTime !== next.startTime ||
          prevMatch.duration !== next.duration ||
          prevMatch.column !== next.column)
      ) {
        updated.push(next.id);
      }
    }

    if (added.length > 0 || removed.length > 0 || updated.length > 0) {
      emitCalendarEvent("custom-devtools:calendar-appointments", {
        count: combinedDerivedAppointments.length,
        diff: { added, removed, updated },
        lastChangeAt: Date.now(),
      });
    }
  }, [appointments, combinedDerivedAppointments]);

  // Emit drag events
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    if (draggedAppointment) {
      emitCalendarEvent("custom-devtools:calendar-drag", {
        column: dragPreview.column,
        dragging: true,
        slotIndex: dragPreview.slot,
      });
    } else {
      emitCalendarEvent("custom-devtools:calendar-drag", { dragging: false });
    }
  }, [draggedAppointment, dragPreview.column, dragPreview.slot]);

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
      const dateForSlot = addMinutes(
        startOfDay(selectedDate),
        minutesFromStart,
      );
      return format(dateForSlot, "HH:mm");
    },
    [businessStartHour, selectedDate],
  );

  const getCurrentTimeSlot = useCallback(() => {
    if (!isSameDay(currentTime, selectedDate) || totalSlots === 0) {
      return -1;
    }

    const minutesFromMidnight = differenceInMinutes(
      currentTime,
      startOfDay(currentTime),
    );
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

      return appointments.some((apt) => {
        if (apt.id === excludeId || apt.column !== column) {
          return false;
        }

        const aptStartSlot = timeToSlot(apt.startTime);
        const aptEndSlot =
          aptStartSlot + Math.ceil(apt.duration / SLOT_DURATION);

        return !(endSlot <= aptStartSlot || startSlot >= aptEndSlot);
      });
    },
    [appointments, timeToSlot],
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
      const occupiedSlots = appointments
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
    [appointments, timeToSlot, totalSlots],
  );

  // Use Convex-inferred type for simulatedContext
  type ValidatedSimulatedContext = Infer<typeof simulatedContextValidator>;

  interface SimulationConversionOptions {
    columnOverride?: string;
    durationMinutes?: number;
    endISO?: string;
    locationId?: Id<"locations">;
    practitionerId?: Id<"practitioners">;
    startISO?: string;
    title?: string;
  }

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
  const convertRealAppointmentToSimulation = useCallback(
    async (
      appointment: Appointment,
      options: SimulationConversionOptions = {},
    ): Promise<Appointment | null> => {
      /**
       * Type guard for validating simulatedContext structure.
       * Ensures the context matches the expected structure from Convex validators.
       * @param context The context to validate
       * @returns true if context matches ValidatedSimulatedContext structure
       */
      const isValidSimulatedContext = (
        context: unknown,
      ): context is ValidatedSimulatedContext => {
        if (!context || typeof context !== "object") {
          return false;
        }
        const ctx = context as Record<string, unknown>;
        return (
          typeof ctx["appointmentType"] === "string" &&
          typeof ctx["patient"] === "object" &&
          ctx["patient"] !== null &&
          typeof (ctx["patient"] as Record<string, unknown>)["isNew"] ===
            "boolean"
        );
      };

      // Early validation checks with specific error messages
      if (appointment.isSimulation) {
        return appointment;
      }

      if (!appointment.convexId) {
        toast.error("Termin hat keine gültige ID");
        return null;
      }

      if (!isValidSimulatedContext(simulatedContext)) {
        // No simulated context - return original appointment
        return appointment;
      }

      const baseStartDate =
        options.startISO === undefined
          ? parse(appointment.startTime, "HH:mm", selectedDate)
          : new Date(options.startISO);

      if (Number.isNaN(baseStartDate.getTime())) {
        toast.error("Startzeit konnte nicht ermittelt werden");
        return null;
      }

      const startISO = options.startISO ?? baseStartDate.toISOString();

      const baseEndDate =
        options.endISO === undefined
          ? addMinutes(baseStartDate, appointment.duration)
          : new Date(options.endISO);

      if (Number.isNaN(baseEndDate.getTime())) {
        toast.error("Endzeit konnte nicht ermittelt werden");
        return null;
      }

      const endISO = options.endISO ?? baseEndDate.toISOString();

      // Extract practitioner ID with proper type safety
      const practitionerId: Id<"practitioners"> | undefined =
        options.practitionerId ??
        (appointment.column !== "ekg" && appointment.column !== "labor"
          ? (appointment.column as Id<"practitioners">)
          : appointment.resource?.practitionerId);

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

      const title = options.title ?? appointment.title;

      if (!practiceId) {
        toast.error("Praxis-ID fehlt");
        return null;
      }

      try {
        // Build appointment data with proper typing
        const appointmentData: Parameters<typeof runCreateAppointment>[0] = {
          end: endISO,
          isSimulation: true,
          locationId,
          practiceId,
          replacesAppointmentId: appointment.convexId,
          start: startISO,
          title,
        };

        // Add optional fields only if they exist
        if (appointment.resource?.appointmentType !== undefined) {
          appointmentData.appointmentType =
            appointment.resource.appointmentType;
        }

        if (appointment.resource?.patientId !== undefined) {
          appointmentData.patientId = appointment.resource.patientId;
        }

        if (practitionerId !== undefined) {
          appointmentData.practitionerId = practitionerId;
        }

        const newId = await runCreateAppointment(appointmentData);

        const durationMinutes =
          options.durationMinutes ??
          Math.max(
            SLOT_DURATION,
            Math.round(
              (new Date(endISO).getTime() - new Date(startISO).getTime()) /
                60000,
            ),
          );

        const updatedAppointment: Appointment = {
          ...appointment,
          column: options.columnOverride ?? appointment.column,
          convexId: newId,
          duration: durationMinutes,
          id: newId,
          isSimulation: true,
          replacesAppointmentId: appointment.convexId,
          resource: {
            ...appointment.resource,
            isSimulation: true,
            locationId,
            practitionerId:
              practitionerId ?? appointment.resource?.practitionerId,
          },
          startTime: format(new Date(startISO), "HH:mm"),
          title,
        };

        // Convex optimistic updates will handle the UI update
        return updatedAppointment;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unbekannter Fehler";

        captureErrorGlobal(error, {
          appointmentId: appointment.convexId,
          context: "NewCalendar - Failed to create simulated replacement",
          errorMessage,
          locationId,
          options,
          practitionerId,
          simulatedContextValid: isValidSimulatedContext(simulatedContext),
        });

        toast.error(
          `Simulierter Termin konnte nicht erstellt werden: ${errorMessage}`,
        );
        return null;
      }
    },
    [
      simulatedContext,
      runCreateAppointment,
      selectedDate,
      selectedLocationId,
      practiceId,
    ],
  );

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
    }
  };

  const handleAutoScroll = (e: React.DragEvent) => {
    const scrollContainer = calendarRef.current?.parentElement;
    if (!scrollContainer) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const mouseY = e.clientY;
    const scrollThreshold = 50;
    const scrollSpeed = 10;

    if (autoScrollAnimationRef.current) {
      cancelAnimationFrame(autoScrollAnimationRef.current);
      autoScrollAnimationRef.current = null;
    }

    if (
      mouseY - containerRect.top < scrollThreshold &&
      scrollContainer.scrollTop > 0
    ) {
      const animateScrollUp = () => {
        const newScrollTop = Math.max(
          0,
          scrollContainer.scrollTop - scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop > 0) {
          autoScrollAnimationRef.current =
            requestAnimationFrame(animateScrollUp);
        } else {
          autoScrollAnimationRef.current = null;
        }
      };
      autoScrollAnimationRef.current = requestAnimationFrame(animateScrollUp);
    } else if (
      containerRect.bottom - mouseY < scrollThreshold &&
      scrollContainer.scrollTop <
        scrollContainer.scrollHeight - scrollContainer.clientHeight
    ) {
      const maxScroll =
        scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const animateScrollDown = () => {
        const newScrollTop = Math.min(
          maxScroll,
          scrollContainer.scrollTop + scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop < maxScroll) {
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

    if (!draggedAppointment) {
      return;
    }

    const finalSlot = dragPreview.slot;
    const newTime = slotToTime(finalSlot);

    const startDate = parse(newTime, "HH:mm", selectedDate);
    if (Number.isNaN(startDate.getTime())) {
      setDraggedAppointment(null);
      setDragPreview({ column: "", slot: 0, visible: false });
      return;
    }

    const endDate = addMinutes(startDate, draggedAppointment.duration);

    if (draggedAppointment.convexId) {
      const newPractitionerId =
        column !== "ekg" && column !== "labor"
          ? (column as Id<"practitioners">)
          : draggedAppointment.resource?.practitionerId;

      if (simulatedContext && !draggedAppointment.isSimulation) {
        await convertRealAppointmentToSimulation(draggedAppointment, {
          columnOverride: column,
          durationMinutes: draggedAppointment.duration,
          endISO: endDate.toISOString(),
          ...(newPractitionerId && { practitionerId: newPractitionerId }),
          startISO: startDate.toISOString(),
        });
      } else {
        try {
          await updateAppointmentMutation.withOptimisticUpdate(
            (localStore, args) => {
              const existingAppointments = localStore.getQuery(
                api.appointments.getAppointments,
                appointmentsQueryArgs,
              );
              if (existingAppointments) {
                const updatedAppointments = existingAppointments.map((apt) =>
                  apt._id === args.id
                    ? {
                        ...apt,
                        ...(args.end && { end: args.end }),
                        ...(args.start && { start: args.start }),
                        ...(args.practitionerId && {
                          practitionerId: args.practitionerId,
                        }),
                      }
                    : apt,
                );
                localStore.setQuery(
                  api.appointments.getAppointments,
                  appointmentsQueryArgs,
                  updatedAppointments,
                );
              }
            },
          )({
            end: endDate.toISOString(),
            id: draggedAppointment.convexId,
            start: startDate.toISOString(),
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

  const handleResizeStart = (
    e: React.MouseEvent,
    appointmentId: string,
    currentDuration: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const targetAppointment = appointments.find(
      (apt) => apt.id === appointmentId,
    );

    if (
      simulatedContext &&
      targetAppointment &&
      !targetAppointment.isSimulation &&
      targetAppointment.convexId
    ) {
      void (async () => {
        const startDate = parse(
          targetAppointment.startTime,
          "HH:mm",
          selectedDate,
        );
        if (Number.isNaN(startDate.getTime())) {
          toast.error("Startzeit konnte nicht ermittelt werden");
          return;
        }
        const endDate = addMinutes(startDate, targetAppointment.duration);
        const converted = await convertRealAppointmentToSimulation(
          targetAppointment,
          {
            durationMinutes: targetAppointment.duration,
            endISO: endDate.toISOString(),
            startISO: startDate.toISOString(),
          },
        );
        if (converted) {
          setResizing({
            appointmentId: converted.id,
            originalDuration: currentDuration,
            startY: e.clientY,
          });
        }
      })();
      return;
    }

    setResizing({
      appointmentId,
      originalDuration: currentDuration,
      startY: e.clientY,
    });
  };

  const addAppointment = (column: string, slot: number) => {
    const defaultDuration = 30;
    const maxAvailableDuration = getMaxAvailableDuration(column, slot);
    const duration = Math.min(defaultDuration, maxAvailableDuration);

    if (duration >= SLOT_DURATION) {
      const startTime = slotToTime(slot);
      const startDate = parse(startTime, "HH:mm", selectedDate);
      if (Number.isNaN(startDate.getTime())) {
        return;
      }

      const endDate = addMinutes(startDate, duration);

      if (simulatedContext) {
        if (!simulatedContext.locationId) {
          alert("Bitte wählen Sie zuerst einen Standort aus.");
          return;
        }

        openAppointmentDialog({
          description: `Erstellen Sie einen neuen Simulationstermin für ${format(startDate, "HH:mm", { locale: de })}.`,
          onSubmit: async (title) => {
            let practitionerId: Id<"practitioners"> | undefined;

            if (column !== "ekg" && column !== "labor") {
              practitionerId = column as Id<"practitioners">;
            } else {
              const practitioner = workingPractitioners[0];
              practitionerId = practitioner?.id;
            }

            if (practitionerId && simulatedContext.locationId && practiceId) {
              try {
                await createAppointmentMutation.withOptimisticUpdate(
                  (localStore, args) => {
                    const existingAppointments = localStore.getQuery(
                      api.appointments.getAppointments,
                      appointmentsQueryArgs,
                    );
                    if (existingAppointments) {
                      const now = Date.now();
                      const tempId =
                        globalThis.crypto.randomUUID() as Id<"appointments">;
                      const newAppointment: Doc<"appointments"> = {
                        _creationTime: now,
                        _id: tempId,
                        createdAt: BigInt(now),
                        end: args.end,
                        isSimulation: true,
                        lastModified: BigInt(now),
                        locationId: args.locationId,
                        practiceId: args.practiceId,
                        start: args.start,
                        title: args.title,
                        ...(args.practitionerId !== undefined && {
                          practitionerId: args.practitionerId,
                        }),
                        ...(args.patientId !== undefined && {
                          patientId: args.patientId,
                        }),
                        ...(args.appointmentType !== undefined && {
                          appointmentType: args.appointmentType,
                        }),
                      };
                      localStore.setQuery(
                        api.appointments.getAppointments,
                        appointmentsQueryArgs,
                        [...existingAppointments, newAppointment],
                      );
                    }
                  },
                )({
                  appointmentType: simulatedContext.appointmentType,
                  end: endDate.toISOString(),
                  isSimulation: true,
                  locationId: simulatedContext.locationId,
                  practiceId,
                  practitionerId,
                  start: startDate.toISOString(),
                  title,
                });
                toast.success("Simulationstermin erstellt");
              } catch (error) {
                captureErrorGlobal(error, {
                  context:
                    "NewCalendar - Failed to create simulation appointment",
                  title,
                });
                toast.error("Simulationstermin konnte nicht erstellt werden");
              }
            }
          },
          title: "Neuer Simulationstermin",
          type: "create",
        });
      } else {
        openAppointmentDialog({
          description: `Erstellen Sie einen neuen Termin für ${format(startDate, "HH:mm", { locale: de })}.`,
          onSubmit: async (title) => {
            let practitionerId: Id<"practitioners"> | undefined;

            if (column !== "ekg" && column !== "labor") {
              practitionerId = column as Id<"practitioners">;
            } else {
              const practitioner = workingPractitioners[0];
              practitionerId = practitioner?.id;
            }

            try {
              const targetLocationId =
                (
                  simulatedContext as
                    | undefined
                    | { locationId?: Id<"locations"> }
                )?.locationId ?? selectedLocationId;

              if (!targetLocationId) {
                toast.error("Bitte wählen Sie zuerst einen Standort aus.");
                return;
              }
              if (!practiceId) {
                toast.error("Praxis-ID fehlt");
                return;
              }
              await runCreateAppointment({
                end: endDate.toISOString(),
                isSimulation: false,
                locationId: targetLocationId,
                practiceId,
                start: startDate.toISOString(),
                title,
                ...(practitionerId && { practitionerId }),
              });
              toast.success("Termin erstellt");
            } catch (error) {
              captureErrorGlobal(error, {
                context: "NewCalendar - Failed to create appointment",
                title,
              });
              toast.error("Termin konnte nicht erstellt werden");
            }
          },
          title: "Neuer Termin",
          type: "create",
        });
      }
    }
  };

  const handleEditAppointment = (appointment: Appointment) => {
    // Prevent opening edit dialog if we just finished resizing this appointment
    if (justFinishedResizingRef.current === appointment.id) {
      return;
    }

    const openEditDialog = (target: Appointment) => {
      openAppointmentDialog({
        defaultTitle: target.title,
        description: `Bearbeiten Sie den Termin "${target.title}".`,
        onSubmit: async (newTitle) => {
          if (newTitle === target.title) {
            return;
          }

          const convexId = target.convexId;
          if (convexId === undefined) {
            return;
          }

          try {
            await updateAppointmentMutation.withOptimisticUpdate(
              (localStore, args) => {
                const existingAppointments = localStore.getQuery(
                  api.appointments.getAppointments,
                  appointmentsQueryArgs,
                );
                if (existingAppointments) {
                  const updatedAppointments = existingAppointments.map((apt) =>
                    apt._id === args.id && args.title
                      ? { ...apt, title: args.title }
                      : apt,
                  );
                  localStore.setQuery(
                    api.appointments.getAppointments,
                    appointmentsQueryArgs,
                    updatedAppointments,
                  );
                }
              },
            )({
              id: convexId,
              title: newTitle,
            });
            toast.success("Termin aktualisiert");
          } catch (error) {
            captureErrorGlobal(error, {
              appointmentId: convexId,
              context: "NewCalendar - Failed to update appointment title",
            });
            toast.error("Termin konnte nicht aktualisiert werden");
          }
        },
        title: "Termin bearbeiten",
        type: "edit",
      });
    };

    if (simulatedContext && !appointment.isSimulation) {
      if (appointment.convexId === undefined) {
        openEditDialog(appointment);
        return;
      }

      void (async () => {
        const startDate = parse(appointment.startTime, "HH:mm", selectedDate);
        if (Number.isNaN(startDate.getTime())) {
          toast.error("Startzeit konnte nicht ermittelt werden");
          return;
        }

        const endDate = addMinutes(startDate, appointment.duration);
        const converted = await convertRealAppointmentToSimulation(
          appointment,
          {
            endISO: endDate.toISOString(),
            startISO: startDate.toISOString(),
            title: appointment.title,
          },
        );

        if (converted) {
          openEditDialog(converted);
        }
      })();
      return;
    }

    openEditDialog(appointment);
  };

  const handleDeleteAppointment = (appointment: Appointment) => {
    if (appointment.convexId && confirm("Termin löschen?")) {
      void deleteAppointmentMutation.withOptimisticUpdate(
        (localStore, args) => {
          const existingAppointments = localStore.getQuery(
            api.appointments.getAppointments,
            appointmentsQueryArgs,
          );
          if (existingAppointments) {
            const updatedAppointments = existingAppointments.filter(
              (apt) => apt._id !== args.id,
            );
            localStore.setQuery(
              api.appointments.getAppointments,
              appointmentsQueryArgs,
              updatedAppointments,
            );
          }
        },
      )({
        id: appointment.convexId,
      });
    }
  };

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Handle mouse move for resizing
  useEffect(() => {
    let mounted = true;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing || !mounted) {
        return;
      }

      const deltaY = e.clientY - resizing.startY;
      const deltaSlots = Math.round(deltaY / 16);
      const newDuration = Math.max(
        SLOT_DURATION,
        resizing.originalDuration + deltaSlots * SLOT_DURATION,
      );

      const appointment = appointments.find(
        (apt) => apt.id === resizing.appointmentId,
      );
      if (appointment) {
        const startSlot = timeToSlot(appointment.startTime);
        if (
          !checkCollision(
            appointment.column,
            startSlot,
            newDuration,
            appointment.id,
          )
        ) {
          // Convex optimistic updates will handle the UI update
          const convexId = appointment.convexId;
          if (convexId !== undefined) {
            if (simulatedContext && !appointment.isSimulation) {
              return;
            }
            const startDate = parse(
              appointment.startTime,
              "HH:mm",
              selectedDate,
            );
            if (Number.isNaN(startDate.getTime())) {
              return;
            }
            const endDate = addMinutes(startDate, newDuration);

            void (async () => {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (!mounted) {
                return;
              }

              try {
                await updateAppointmentMutation.withOptimisticUpdate(
                  (localStore, args) => {
                    const existingAppointments = localStore.getQuery(
                      api.appointments.getAppointments,
                      appointmentsQueryArgs,
                    );
                    if (existingAppointments) {
                      const updatedAppointments = existingAppointments.map(
                        (apt) =>
                          apt._id === args.id && args.end
                            ? { ...apt, end: args.end }
                            : apt,
                      );
                      localStore.setQuery(
                        api.appointments.getAppointments,
                        appointmentsQueryArgs,
                        updatedAppointments,
                      );
                    }
                  },
                )({
                  end: endDate.toISOString(),
                  id: convexId,
                });
              } catch (error) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (!mounted) {
                  return;
                }

                captureErrorGlobal(error, {
                  appointmentId: convexId,
                  context:
                    "NewCalendar - Failed to update appointment duration",
                });
                toast.error("Termin-Dauer konnte nicht aktualisiert werden");
                // Convex will revert the optimistic update on error
              }
            })();
          }
        }
      }
    };

    const handleMouseUp = () => {
      if (resizing) {
        // Mark this appointment as just resized to prevent immediate edit dialog
        justFinishedResizingRef.current = resizing.appointmentId;
        // Clear the flag after a short delay (enough time for click event to be processed)
        setTimeout(() => {
          justFinishedResizingRef.current = null;
        }, 100);
      }
      setResizing(null);
    };

    if (resizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      mounted = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    resizing,
    appointments,
    timeToSlot,
    checkCollision,
    appointmentsQueryArgs,
    updateAppointmentMutation,
    selectedDate,
    simulatedContext,
  ]);

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
      const newContext = {
        appointmentType: simulatedContext.appointmentType,
        ...(locationId && { locationId }),
        patient: simulatedContext.patient,
      };
      onUpdateSimulatedContext(newContext);
    } else {
      setSelectedLocationId(locationId);
    }
  };

  return {
    addAppointment,
    appointments,
    businessEndHour,
    businessStartHour,
    calendarRef,
    columns,
    currentTime,
    currentTimeSlot: getCurrentTimeSlot(),
    Dialog,
    draggedAppointment,
    dragPreview,
    handleDateChange,
    handleDeleteAppointment,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleEditAppointment,
    handleLocationSelect,
    handleResizeStart,
    locationsData,
    practiceId,
    selectedDate,
    selectedLocationId: simulatedContext?.locationId || selectedLocationId,
    slotToTime,
    timeToSlot,
    totalSlots,
    workingPractitioners,
  };
}
