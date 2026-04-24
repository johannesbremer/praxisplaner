import { useEffect, useRef } from "react";

import type { CalendarAppointmentView, CalendarColumnId } from "./types";

import { emitCalendarEvent } from "../../devtools/event-client";

export interface CalendarAppointmentSnapshot {
  column: CalendarColumnId;
  duration: number;
  id: string;
  startTime: string;
}

export function diffCalendarAppointments(
  previousAppointments: readonly CalendarAppointmentSnapshot[],
  nextAppointments: readonly CalendarAppointmentSnapshot[],
): {
  added: string[];
  removed: string[];
  updated: string[];
} {
  const previousById = new Map(
    previousAppointments.map((appointment) => [appointment.id, appointment]),
  );
  const nextById = new Map(
    nextAppointments.map((appointment) => [appointment.id, appointment]),
  );

  const added = nextAppointments
    .filter((appointment) => !previousById.has(appointment.id))
    .map((appointment) => appointment.id);
  const removed = previousAppointments
    .filter((appointment) => !nextById.has(appointment.id))
    .map((appointment) => appointment.id);
  const updated = nextAppointments
    .filter((appointment) => {
      const previous = previousById.get(appointment.id);
      return (
        previous !== undefined &&
        (previous.startTime !== appointment.startTime ||
          previous.duration !== appointment.duration ||
          previous.column !== appointment.column)
      );
    })
    .map((appointment) => appointment.id);

  return { added, removed, updated };
}

export function useCalendarDevtools(args: {
  appointments: readonly CalendarAppointmentView[];
  draggedAppointment: CalendarAppointmentView | null;
  dragPreview: {
    column: CalendarColumnId | null;
    slot: number;
    visible: boolean;
  };
}) {
  const mountTimeRef = useRef<null | number>(null);
  const lastRenderRef = useRef<null | number>(null);
  const previousAppointmentsRef = useRef<CalendarAppointmentSnapshot[]>([]);
  const renderCountRef = useRef(0);

  useEffect(() => {
    renderCountRef.current += 1;
  });

  useEffect(() => {
    if (!__ENABLE_DEVTOOLS__) {
      return;
    }

    const now = Date.now();
    mountTimeRef.current ??= now;
    const mountTime = mountTimeRef.current;
    const lastRenderAt = lastRenderRef.current ?? now;
    emitCalendarEvent("custom-devtools:calendar-render", {
      lastRenderAt: now,
      renders: renderCountRef.current,
    });
    emitCalendarEvent("custom-devtools:calendar-performance", {
      lastCommitAt: now,
      renderDeltaMs: now - lastRenderAt,
      sinceMountMs: now - mountTime,
    });
    lastRenderRef.current = now;
  });

  useEffect(() => {
    if (!__ENABLE_DEVTOOLS__) {
      return;
    }

    const nextAppointments = args.appointments.map((appointment) =>
      toAppointmentSnapshot(appointment),
    );
    const diff = diffCalendarAppointments(
      previousAppointmentsRef.current,
      nextAppointments,
    );

    if (
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      diff.updated.length > 0
    ) {
      emitCalendarEvent("custom-devtools:calendar-appointments", {
        count: nextAppointments.length,
        diff,
        lastChangeAt: Date.now(),
      });
    }

    previousAppointmentsRef.current = nextAppointments;
  }, [args.appointments]);

  useEffect(() => {
    if (!__ENABLE_DEVTOOLS__) {
      return;
    }

    if (args.draggedAppointment) {
      emitCalendarEvent("custom-devtools:calendar-drag", {
        column: args.dragPreview.column ?? "",
        dragging: true,
        slotIndex: args.dragPreview.slot,
      });
      return;
    }

    emitCalendarEvent("custom-devtools:calendar-drag", { dragging: false });
  }, [args.dragPreview.column, args.dragPreview.slot, args.draggedAppointment]);
}

function toAppointmentSnapshot(
  appointment: CalendarAppointmentView,
): CalendarAppointmentSnapshot {
  return {
    column: appointment.column,
    duration: appointment.duration,
    id: appointment.id,
    startTime: appointment.startTime,
  };
}
