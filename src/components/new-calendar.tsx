"use client";

import type React from "react";

import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  isToday,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";
import { de } from "date-fns/locale";
import { AlertCircle, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { SchedulingSimulatedContext } from "../types";
import type { LocalAppointment } from "../utils/local-appointments";

import { api } from "../../convex/_generated/api";
import { emitCalendarEvent } from "../devtools/event-client";
import { captureErrorGlobal } from "../utils/error-tracking";
import { slugify } from "../utils/slug";
import { useAppointmentDialog } from "./appointment-dialog";
import { CalendarProvider } from "./calendar-context";
import { CalendarSidebar } from "./calendar-sidebar";

// Types for the new calendar - using Convex types for e2e type safety
interface Appointment {
  color: string;
  column: string; // Resource ID (practitioner ID or "ekg" / "labor")
  convexId?: Id<"appointments">; // Original Convex ID for real appointments
  duration: number; // in minutes
  id: string;
  resource?: {
    appointmentType?: Doc<"appointments">["appointmentType"];
    isLocal?: boolean;
    locationId?: Doc<"appointments">["locationId"];
    notes?: Doc<"appointments">["notes"];
    patientId?: Doc<"appointments">["patientId"];
    practitionerId?: Doc<"appointments">["practitionerId"];
  };
  startTime: string;
  title: string;
}

const SLOT_DURATION = 5; // minutes

const APPOINTMENT_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-red-500",
  "bg-yellow-500",
  "bg-indigo-500",
  "bg-gray-500",
];

// Compare two appointment arrays for structural equality (only the fields
// that affect rendering & interactions are considered). This prevents
// needless state updates that can cascade into re-renders and effects.
interface NewCalendarProps {
  localAppointments?: LocalAppointment[];
  locationSlug?: string | undefined;
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  onDateChange?: (date: Date) => void;
  onLocationResolved?: (
    locationId: Id<"locations">,
    locationName: string,
  ) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId?: Id<"practices">;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean;
  simulatedContext?: SchedulingSimulatedContext;
  simulationDate?: Date;
}

export function NewCalendar({
  localAppointments = [],
  locationSlug,
  onCreateLocalAppointment,
  onDateChange,
  onLocationResolved,
  onUpdateSimulatedContext,
  practiceId: propPracticeId,
  selectedLocationId: externalSelectedLocationId,
  showGdtAlert = false,
  simulatedContext,
  simulationDate,
}: NewCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(
    simulationDate ?? new Date(),
  );
  const [appointments, setAppointments] = useState<Appointment[]>([]);
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
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasResolvedLocationRef = useRef(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const { Dialog, openDialog: openAppointmentDialog } = useAppointmentDialog();
  // --- Devtools Instrumentation ---
  const mountTimeRef = useRef<number>(Date.now());
  const lastRenderRef = useRef<number>(mountTimeRef.current);
  const renderCountRef = useRef(0);
  const effectCountersRef = useRef<Record<string, number>>({});
  renderCountRef.current += 1;

  // Emit devtools events after render (in useEffect)
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

  // Local state for selected location
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(externalSelectedLocationId);

  useEffect(() => {
    if (
      externalSelectedLocationId &&
      externalSelectedLocationId !== selectedLocationId
    ) {
      setSelectedLocationId(externalSelectedLocationId);
      if (import.meta.env.DEV) {
        const map = effectCountersRef.current;
        const name = "externalLocationSync";
        map[name] = (map[name] ?? 0) + 1;
        emitCalendarEvent("custom-devtools:calendar-effect", {
          count: map[name],
          name,
        });
      }
    }
  }, [externalSelectedLocationId, selectedLocationId]);

  // Initialize practice
  const initializePracticeMutation = useConvexMutation(
    api.practices.initializeDefaultPractice,
  );

  useEffect(() => {
    if (propPracticeId) {
      setPracticeId(propPracticeId);
      return;
    }

    const initPractice = async () => {
      try {
        const id = await initializePracticeMutation({});
        setPracticeId(id);
      } catch (error) {
        captureErrorGlobal(error, {
          context: "NewCalendar - Failed to initialize practice",
          propPracticeId,
        });
        console.error("Failed to initialize practice:", error);
      }
    };

    void initPractice();
  }, [initializePracticeMutation, propPracticeId]);

  // Query data - only run if we have a practice ID
  const appointmentsData = useConvexQuery(api.appointments.getAppointments);
  const practitionersData = useConvexQuery(
    api.practitioners.getPractitioners,
    practiceId ? { practiceId } : "skip",
  );
  const baseSchedulesData = useConvexQuery(
    api.baseSchedules.getAllBaseSchedules,
    practiceId ? { practiceId } : "skip",
  );
  const locationsData = useConvexQuery(
    api.locations.getLocations,
    practiceId ? { practiceId } : "skip",
  );

  // Mutations
  const createAppointmentMutation = useConvexMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useConvexMutation(
    api.appointments.updateAppointment,
  );
  const deleteAppointmentMutation = useConvexMutation(
    api.appointments.deleteAppointment,
  );

  // Resolve location slug from URL once locations data is available
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
      setSelectedLocationId(match._id);
      if (onLocationResolved) {
        onLocationResolved(match._id, match.name);
      }
    }
  }, [locationSlug, locationsData, selectedLocationId, onLocationResolved]);

  // Update selected date when simulation date changes
  useEffect(() => {
    if (simulationDate) {
      setSelectedDate(simulationDate);
    }
  }, [simulationDate]);

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

  const currentDayOfWeek = selectedDate.getDay(); // 0 = Sunday

  // Helper function to convert time string to minutes
  const timeToMinutes = useCallback((timeStr: string): number => {
    const parsed = parse(timeStr, "HH:mm", new Date(0));
    if (Number.isNaN(parsed.getTime())) {
      return 0;
    }
    return differenceInMinutes(parsed, startOfDay(parsed));
  }, []);

  // Calculate working practitioners for current date and dynamic business hours
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

    // Find practitioners working on the current selected day
    let daySchedules = baseSchedulesData.filter(
      (schedule: Doc<"baseSchedules"> & { practitionerName: string }) =>
        schedule.dayOfWeek === currentDayOfWeek,
    );

    // Filter by location in simulation mode
    if (simulatedContext?.locationId) {
      daySchedules = daySchedules.filter(
        (schedule: Doc<"baseSchedules">) =>
          schedule.locationId === simulatedContext.locationId,
      );
    } else if (selectedLocationId) {
      // Filter by location in real mode
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

    const working = daySchedules.map((schedule) => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: schedule.practitionerName,
      startTime: schedule.startTime,
    }));

    // Calculate dynamic business hours based on practitioner schedules
    const startTimes = daySchedules.map((s) => timeToMinutes(s.startTime));
    const endTimes = daySchedules.map((s) => timeToMinutes(s.endTime));
    const earliestStartMinutes = Math.min(...startTimes);
    const latestEndMinutes = Math.max(...endTimes);
    const businessStartHour = Math.floor(earliestStartMinutes / 60);
    const businessEndHour = Math.ceil(latestEndMinutes / 60);
    const totalSlots =
      ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

    // Create columns: practitioners + EKG + Labor
    const practitionerColumns = working.map((practitioner) => ({
      id: practitioner.id,
      title: practitioner.name,
    }));

    // Always add EKG and Labor columns when there's at least one doctor working
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

  // Build latest combined appointments snapshot (remote + local) in a memo.
  const combinedDerivedAppointments = useMemo(() => {
    const convexAppointments: Appointment[] = appointmentsData
      ? appointmentsData
          .filter((appointment: Doc<"appointments">) => {
            const appointmentDate = parseISO(appointment.start);
            return isSameDay(appointmentDate, selectedDate);
          })
          .map(
            (appointment: Doc<"appointments">, index): Appointment | null => {
              const start = parseISO(appointment.start);
              const end = parseISO(appointment.end);
              const duration = Math.round(
                (end.getTime() - start.getTime()) / (1000 * 60),
              );

              if (
                simulatedContext?.locationId &&
                appointment.locationId !== simulatedContext.locationId
              ) {
                return null;
              }
              if (
                !simulatedContext?.locationId &&
                selectedLocationId &&
                appointment.locationId !== selectedLocationId
              ) {
                return null;
              }

              return {
                color:
                  APPOINTMENT_COLORS[index % APPOINTMENT_COLORS.length] ??
                  "bg-gray-500",
                column: appointment.practitionerId || "ekg",
                convexId: appointment._id,
                duration,
                id: appointment._id,
                resource: {
                  appointmentType: appointment.appointmentType,
                  locationId: appointment.locationId,
                  notes: appointment.notes,
                  patientId: appointment.patientId,
                  practitionerId: appointment.practitionerId,
                },
                startTime: format(start, "HH:mm"),
                title: appointment.title,
              };
            },
          )
          .filter((apt): apt is Appointment => apt !== null)
      : [];

    const localAppointmentsList: Appointment[] = localAppointments
      .filter((appointment) => isSameDay(appointment.start, selectedDate))
      .map((appointment, index): Appointment | null => {
        const duration = Math.round(
          (appointment.end.getTime() - appointment.start.getTime()) /
            (1000 * 60),
        );

        if (
          simulatedContext?.locationId &&
          appointment.locationId !== simulatedContext.locationId
        ) {
          return null;
        }
        if (
          !simulatedContext?.locationId &&
          selectedLocationId &&
          appointment.locationId !== selectedLocationId
        ) {
          return null;
        }

        return {
          color:
            APPOINTMENT_COLORS[
              (convexAppointments.length + index) % APPOINTMENT_COLORS.length
            ] ?? "bg-gray-500",
          column: appointment.practitionerId || "ekg",
          duration,
          id: appointment.id,
          resource: {
            appointmentType: appointment.appointmentType,
            isLocal: true,
            locationId: appointment.locationId,
            notes: appointment.notes,
            patientId: appointment.patientId,
            practitionerId: appointment.practitionerId,
          },
          startTime: format(appointment.start, "HH:mm"),
          title: appointment.title,
        };
      })
      .filter((apt): apt is Appointment => apt !== null);

    return [...convexAppointments, ...localAppointmentsList];
  }, [
    appointmentsData,
    localAppointments,
    selectedDate,
    simulatedContext?.locationId,
    selectedLocationId,
  ]);

  // Memoize a hash of the appointments to enable quick equality checks
  // This avoids O(n) deep comparison on every render
  const appointmentsHash = useMemo(() => {
    return combinedDerivedAppointments
      .map(
        (a) =>
          `${a.id}:${a.startTime}:${a.duration}:${a.column}:${a.title}:${a.color}:${a.resource?.practitionerId ?? ""}:${a.resource?.patientId ?? ""}:${a.resource?.locationId ?? ""}:${a.resource?.appointmentType ?? ""}`,
      )
      .join("|");
  }, [combinedDerivedAppointments]);

  // Track the previous hash to detect changes
  const prevHashRef = useRef<string>("");

  // Only update state if something *actually* changed. This breaks the
  // potential feedback loop where upstream query hooks emit new array
  // references each render even when the logical data is unchanged.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const map = effectCountersRef.current;
      const name = "appointmentsSync";
      map[name] = (map[name] ?? 0) + 1;
      emitCalendarEvent("custom-devtools:calendar-effect", {
        count: map[name],
        name,
      });
    }

    // Quick hash comparison first - O(1) instead of O(n)
    if (prevHashRef.current === appointmentsHash) {
      return;
    }

    prevHashRef.current = appointmentsHash;

    setAppointments((prev) => {
      // Double-check with deep comparison to handle hash collisions
      if (areAppointmentsEqual(prev, combinedDerivedAppointments)) {
        return prev;
      }
      return combinedDerivedAppointments;
    });
  }, [appointmentsHash, combinedDerivedAppointments]);

  // Track appointment changes for devtools (after state update)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    // Calculate diff for devtools
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

  // Emit drag events when drag state changes
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

    return minutesFromStart / SLOT_DURATION;
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
          return prev; // no change
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

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    if (
      mouseY - containerRect.top < scrollThreshold &&
      scrollContainer.scrollTop > 0
    ) {
      const interval = setInterval(() => {
        const newScrollTop = Math.max(
          0,
          scrollContainer.scrollTop - scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop === 0) {
          clearInterval(interval);
          autoScrollIntervalRef.current = null;
        }
      }, 16);
      autoScrollIntervalRef.current = interval;
    } else if (
      containerRect.bottom - mouseY < scrollThreshold &&
      scrollContainer.scrollTop <
        scrollContainer.scrollHeight - scrollContainer.clientHeight
    ) {
      const interval = setInterval(() => {
        const maxScroll =
          scrollContainer.scrollHeight - scrollContainer.clientHeight;
        const newScrollTop = Math.min(
          maxScroll,
          scrollContainer.scrollTop + scrollSpeed,
        );
        scrollContainer.scrollTop = newScrollTop;

        if (newScrollTop === maxScroll) {
          clearInterval(interval);
          autoScrollIntervalRef.current = null;
        }
      }, 16);
      autoScrollIntervalRef.current = interval;
    }
  };

  const handleDrop = async (e: React.DragEvent, column: string) => {
    e.preventDefault();

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    if (!draggedAppointment) {
      return;
    }

    const finalSlot = dragPreview.slot;
    const newTime = slotToTime(finalSlot);

    // Calculate new end time based on duration
    const startDate = parse(newTime, "HH:mm", selectedDate);
    if (Number.isNaN(startDate.getTime())) {
      setDraggedAppointment(null);
      setDragPreview({ column: "", slot: 0, visible: false });
      return;
    }

    const endDate = addMinutes(startDate, draggedAppointment.duration);

    // Update appointment
    if (draggedAppointment.convexId) {
      // Real appointment - update in Convex
      const newPractitionerId =
        column !== "ekg" && column !== "labor"
          ? (column as Id<"practitioners">)
          : draggedAppointment.resource?.practitionerId;

      try {
        await updateAppointmentMutation({
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
        console.error("Failed to update appointment:", error);
      }
    } else {
      // Local appointment - just update local state
      setAppointments((prev) =>
        prev.map((apt) =>
          apt.id === draggedAppointment.id
            ? { ...apt, column, startTime: newTime }
            : apt,
        ),
      );
    }

    setDraggedAppointment(null);
    setDragPreview({ column: "", slot: 0, visible: false });
  };

  const handleDragEnd = () => {
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
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

      if (onCreateLocalAppointment && simulatedContext) {
        // For simulation mode, create local appointments
        if (!simulatedContext.locationId) {
          alert("Bitte wählen Sie zuerst einen Standort aus.");
          return;
        }

        openAppointmentDialog({
          description: `Erstellen Sie einen neuen Simulationstermin für ${format(startDate, "HH:mm", { locale: de })}.`,
          onSubmit: (title) => {
            let practitionerId: Id<"practitioners"> | undefined;

            if (column !== "ekg" && column !== "labor") {
              practitionerId = column as Id<"practitioners">;
            } else {
              const practitioner = workingPractitioners[0];
              practitionerId = practitioner?.id;
            }

            if (practitionerId && simulatedContext.locationId) {
              onCreateLocalAppointment({
                appointmentType: simulatedContext.appointmentType,
                end: endDate,
                locationId: simulatedContext.locationId,
                notes: `Lokaler Simulationstermin${column === "ekg" ? " (EKG)" : column === "labor" ? " (Labor)" : ""}`,
                practitionerId,
                start: startDate,
                title,
              });
            }
          },
          title: "Neuer lokaler Termin",
          type: "create",
        });
      } else {
        // For regular mode, create real appointments
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
              await createAppointmentMutation({
                end: endDate.toISOString(),
                start: startDate.toISOString(),
                title,
                ...(selectedLocationId && { locationId: selectedLocationId }),
                ...(practitionerId && { practitionerId }),
              });
              toast.success("Termin erstellt");
            } catch (error) {
              captureErrorGlobal(error, {
                context: "NewCalendar - Failed to create appointment",
                title,
              });
              toast.error("Termin konnte nicht erstellt werden");
              console.error("Failed to create appointment:", error);
            }
          },
          title: "Neuer Termin",
          type: "create",
        });
      }
    }
  };

  // Edit appointment
  const handleEditAppointment = (appointment: Appointment) => {
    if (appointment.resource?.isLocal) {
      return; // Skip local appointments for now
    }

    openAppointmentDialog({
      defaultTitle: appointment.title,
      description: `Bearbeiten Sie den Termin "${appointment.title}".`,
      onSubmit: async (newTitle) => {
        if (newTitle !== appointment.title && appointment.convexId) {
          try {
            await updateAppointmentMutation({
              id: appointment.convexId,
              title: newTitle,
            });
            toast.success("Termin aktualisiert");
          } catch (error) {
            captureErrorGlobal(error, {
              appointmentId: appointment.convexId,
              context: "NewCalendar - Failed to update appointment title",
            });
            toast.error("Termin konnte nicht aktualisiert werden");
            console.error("Failed to update appointment:", error);
          }
        }
      },
      title: "Termin bearbeiten",
      type: "edit",
    });
  };

  // Delete appointment
  const handleDeleteAppointment = (appointment: Appointment) => {
    if (appointment.resource?.isLocal) {
      return; // Skip local appointments for now
    }

    if (appointment.convexId && confirm("Termin löschen?")) {
      void deleteAppointmentMutation({
        id: appointment.convexId,
      });
    }
  };

  // Render functions
  const renderTimeSlots = () => {
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const time = slotToTime(i);
      const isHour = i % 12 === 0;

      slots.push(
        <div
          className={`border-b border-border/30 ${isHour ? "border-border" : ""}`}
          key={i}
        >
          <div className="h-4 flex items-center">
            {isHour && (
              <span className="text-xs text-muted-foreground w-16 pr-2 text-right">
                {time}
              </span>
            )}
          </div>
        </div>,
      );
    }
    return slots;
  };

  const renderAppointments = (column: string) => {
    return appointments
      .filter((apt) => apt.column === column)
      .map((appointment) => {
        const startSlot = timeToSlot(appointment.startTime);
        const height = (appointment.duration / SLOT_DURATION) * 16;
        const top = startSlot * 16;
        const isDragging = draggedAppointment?.id === appointment.id;

        return (
          <div
            className={`absolute left-1 right-1 ${appointment.color} text-white text-xs rounded shadow-sm hover:shadow-md transition-all z-10 cursor-move ${
              isDragging ? "opacity-50" : "opacity-100"
            } h-[var(--calendar-appointment-height)] min-h-4 top-[var(--calendar-appointment-top)]`}
            draggable
            key={appointment.id}
            onClick={() => {
              handleEditAppointment(appointment);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              handleDeleteAppointment(appointment);
            }}
            onDragEnd={handleDragEnd}
            onDragStart={(e) => {
              handleDragStart(e, appointment);
            }}
            style={
              {
                "--calendar-appointment-height": `${height}px`,
                "--calendar-appointment-top": `${top}px`,
              } as React.CSSProperties
            }
          >
            <div className="p-1 h-full flex flex-col justify-between pb-2">
              <div>
                <div className="font-medium truncate">{appointment.title}</div>
                <div className="text-xs opacity-90">
                  {appointment.startTime}
                </div>
              </div>
            </div>

            <div
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
              onMouseDown={(e) => {
                handleResizeStart(e, appointment.id, appointment.duration);
              }}
            >
              <div className="w-8 h-0.5 bg-white/60 rounded" />
            </div>
          </div>
        );
      });
  };

  const renderDragPreview = (column: string) => {
    if (
      !dragPreview.visible ||
      dragPreview.column !== column ||
      !draggedAppointment
    ) {
      return null;
    }

    const height = (draggedAppointment.duration / SLOT_DURATION) * 16;
    const top = dragPreview.slot * 16;

    return (
      <div
        className={`absolute left-1 right-1 ${draggedAppointment.color} opacity-50 border-2 border-white border-dashed rounded z-20 h-[var(--calendar-appointment-height)] min-h-4 top-[var(--calendar-appointment-top)]`}
        style={
          {
            "--calendar-appointment-height": `${height}px`,
            "--calendar-appointment-top": `${top}px`,
          } as React.CSSProperties
        }
      >
        <div className="p-1 text-white text-xs">
          <div className="font-medium truncate">{draggedAppointment.title}</div>
          <div className="text-xs opacity-90">
            {slotToTime(dragPreview.slot)}
          </div>
        </div>
      </div>
    );
  };

  const currentTimeSlot = getCurrentTimeSlot();

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
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing) {
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
          // Always optimistically update local state first
          setAppointments((prev) =>
            prev.map((apt) =>
              apt.id === resizing.appointmentId
                ? { ...apt, duration: newDuration }
                : apt,
            ),
          );

          if (appointment.convexId) {
            // Real appointment - also update in Convex
            const startDate = parse(
              appointment.startTime,
              "HH:mm",
              selectedDate,
            );
            if (Number.isNaN(startDate.getTime())) {
              return;
            }
            const endDate = addMinutes(startDate, newDuration);
            const convexId = appointment.convexId; // Capture for closure

            void (async () => {
              try {
                await updateAppointmentMutation({
                  end: endDate.toISOString(),
                  id: convexId,
                });
              } catch (error) {
                captureErrorGlobal(error, {
                  appointmentId: convexId,
                  context:
                    "NewCalendar - Failed to update appointment duration",
                });
                toast.error("Termin-Dauer konnte nicht aktualisiert werden");
                console.error("Failed to update appointment duration:", error);
                // Revert optimistic update on error by forcing a refresh
                setAppointments((prev) => [...prev]);
              }
            })();
          }
        }
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    if (resizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    resizing,
    appointments,
    timeToSlot,
    checkCollision,
    updateAppointmentMutation,
    selectedDate,
  ]);

  // Cleanup auto scroll interval on unmount
  useEffect(() => {
    return () => {
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }
    };
  }, []);

  // Early return if data is loading
  if (
    !practiceId ||
    !appointmentsData ||
    !practitionersData ||
    !baseSchedulesData
  ) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96 pt-6">
          <p>Termine werden geladen...</p>
        </CardContent>
      </Card>
    );
  }

  // Handler for location selection that works in both simulation and real modes
  const handleLocationSelect = (locationId: Id<"locations"> | undefined) => {
    if (simulatedContext && onUpdateSimulatedContext) {
      // Simulation mode: update simulated context
      const newContext = {
        appointmentType: simulatedContext.appointmentType,
        ...(locationId && { locationId }),
        patient: simulatedContext.patient,
      };
      onUpdateSimulatedContext(newContext);
    } else {
      // Real mode: update local state
      setSelectedLocationId(locationId);
    }
  };

  return (
    <CalendarProvider
      value={{
        currentTime,
        locationsData,
        onDateChange: handleDateChange,
        onLocationResolved,
        onLocationSelect: handleLocationSelect,
        onUpdateSimulatedContext,
        selectedDate,
        selectedLocationId: simulatedContext?.locationId || selectedLocationId,
        showGdtAlert,
        simulatedContext,
      }}
    >
      <div className="flex h-full w-full flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <h2 className="text-xl font-semibold">
                {format(selectedDate, "EEEE, dd. MMMM yyyy", { locale: de })}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  handleDateChange(addDays(selectedDate, -1));
                }}
                size="sm"
                variant="outline"
              >
                Zurück
              </Button>
              <Button
                disabled={isToday(selectedDate)}
                onClick={() => {
                  handleDateChange(new Date());
                }}
                size="sm"
                variant="outline"
              >
                Heute
              </Button>
              <Button
                onClick={() => {
                  handleDateChange(addDays(selectedDate, 1));
                }}
                size="sm"
                variant="outline"
              >
                Vor
              </Button>
            </div>
          </div>
        </div>

        {/* Content area with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          <CalendarSidebar />
          <div className="flex-1 overflow-auto">
            {simulatedContext && !simulatedContext.locationId ? (
              <div className="flex items-center justify-center h-full">
                <Alert className="w-auto max-w-md">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Standort auswählen</AlertTitle>
                  <AlertDescription>
                    Bitte wählen Sie einen Standort aus, um Termine anzuzeigen.
                  </AlertDescription>
                </Alert>
              </div>
            ) : workingPractitioners.length === 0 ||
              columns.length === 0 ||
              totalSlots === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Alert className="w-auto max-w-md">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Keine Termine verfügbar</AlertTitle>
                  <AlertDescription>
                    Am {format(selectedDate, "dd.MM.yyyy")} arbeitet niemand
                    {selectedLocationId || simulatedContext?.locationId
                      ? " an diesem Standort"
                      : " (alle Standorte)"}
                    .
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div
                className="grid min-h-full [grid-template-columns:var(--calendar-grid-template-columns)]"
                ref={calendarRef}
                style={
                  {
                    "--calendar-grid-template-columns": `80px repeat(${columns.length}, 1fr)`,
                  } as React.CSSProperties
                }
              >
                <div className="border-r border-border bg-muted/30 sticky left-0 z-10">
                  <div className="h-12 border-b border-border bg-card flex items-center px-3 sticky top-0 z-30">
                    <span className="text-sm font-medium text-muted-foreground">
                      Zeit
                    </span>
                  </div>
                  <div className="relative">{renderTimeSlots()}</div>
                </div>

                {columns.map((column) => (
                  <div
                    className="border-r border-border last:border-r-0"
                    key={column.id}
                  >
                    <div className="h-12 border-b border-border bg-card flex items-center justify-center sticky top-0 z-30">
                      <span className="font-medium">{column.title}</span>
                    </div>
                    <div
                      className="relative min-h-full"
                      onDragLeave={() => {
                        if (dragPreview.column === column.id) {
                          setDragPreview((prev) => ({
                            ...prev,
                            visible: false,
                          }));
                        }
                      }}
                      onDragOver={(e) => {
                        handleDragOver(e, column.id);
                      }}
                      onDrop={(e) => {
                        void handleDrop(e, column.id);
                      }}
                    >
                      {Array.from({ length: totalSlots }, (_, i) => (
                        <div
                          className="h-4 border-b border-border/30 hover:bg-muted/50 cursor-pointer group"
                          key={i}
                          onClick={() => {
                            addAppointment(column.id, i);
                          }}
                        >
                          <div className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-full">
                            <Plus className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </div>
                      ))}

                      {currentTimeSlot >= 0 && (
                        <div
                          className="absolute left-0 right-0 h-0.5 bg-red-500 z-20 top-[var(--calendar-current-time-top)]"
                          style={
                            {
                              "--calendar-current-time-top": `${currentTimeSlot * 16}px`,
                            } as React.CSSProperties
                          }
                        >
                          <div className="absolute -left-1 -top-1 w-2 h-2 bg-red-500 rounded-full" />
                        </div>
                      )}

                      {renderDragPreview(column.id)}
                      {renderAppointments(column.id)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {Dialog}
    </CalendarProvider>
  );
}

/**
 * Deep comparison of appointment arrays.
 * This is only called as a fallback when hash comparison detects a potential change,
 * protecting against hash collisions while keeping the common case (no changes) fast.
 */
function areAppointmentsEqual(a: Appointment[], b: Appointment[]): boolean {
  if (a === b) {
    return true;
  }
  const len = a.length;
  if (len !== b.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    const A = a[i];
    const B = b[i];
    if (!A || !B) {
      return false;
    }
    // Early exit on first mismatch for better performance
    if (
      A.id !== B.id ||
      A.startTime !== B.startTime ||
      A.duration !== B.duration ||
      A.column !== B.column ||
      A.title !== B.title ||
      A.color !== B.color ||
      A.resource?.practitionerId !== B.resource?.practitionerId ||
      A.resource?.patientId !== B.resource?.patientId ||
      A.resource?.locationId !== B.resource?.locationId ||
      A.resource?.appointmentType !== B.resource?.appointmentType
    ) {
      return false;
    }
  }
  return true;
}
