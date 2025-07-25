import type { SlotInfo } from "react-big-calendar";
import type { EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";

import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import moment from "moment";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  AppointmentData,
  BaseScheduleData,
  CalendarEvent,
} from "../types";

import { api } from "../../convex/_generated/api";

// Import CSS for drag and drop
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

const localizer = momentLocalizer(moment);

interface PraxisCalendarProps {
  showGdtAlert?: boolean;
}

// Client-only drag and drop calendar component
function DragDropCalendar({
  events,
  handleEventDrop,
  handleEventResize,
  handleSelectEvent,
  handleSelectSlot,
  maxEndTime,
  minStartTime,
  step,
  timeslots,
}: {
  events: CalendarEvent[];
  handleEventDrop: (args: EventInteractionArgs<CalendarEvent>) => void;
  handleEventResize: (args: EventInteractionArgs<CalendarEvent>) => void;
  handleSelectEvent: (
    event: CalendarEvent,
    e: React.SyntheticEvent<HTMLElement>,
  ) => void;
  handleSelectSlot: (slotInfo: SlotInfo) => void;
  maxEndTime: Date;
  minStartTime: Date;
  step: number;
  timeslots: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [DnDCalendar, setDnDCalendar] =
    useState<null | React.ComponentType<any>>(null);

  useEffect(() => {
    import("react-big-calendar/lib/addons/dragAndDrop")
      .then((module) => {
        const withDragAndDrop = module.default;
        setDnDCalendar(() => withDragAndDrop(Calendar));
      })
      .catch(() => {
        // Fallback to regular calendar if drag and drop fails to load
        setDnDCalendar(() => Calendar);
      });
  }, []);

  if (!DnDCalendar) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Kalender wird geladen...</p>
      </div>
    );
  }

  return (
    <DnDCalendar
      culture="de"
      defaultView="day"
      endAccessor={(event: CalendarEvent) => event.end}
      events={events}
      formats={{
        dayHeaderFormat: "dddd, DD.MM.YYYY",
        eventTimeRangeFormat: ({ end, start }: { end: Date; start: Date }) => {
          const startTime = moment(start).format("HH:mm");
          const endTime = moment(end).format("HH:mm");
          return `${startTime} - ${endTime}`;
        },
        timeGutterFormat: "HH:mm",
      }}
      localizer={localizer}
      max={maxEndTime}
      messages={{
        agenda: "Agenda",
        date: "Datum",
        day: "Tag",
        event: "Termin",
        month: "Monat",
        next: "Weiter",
        noEventsInRange: "Keine Termine in diesem Bereich.",
        previous: "Zurück",
        showMore: (total: number) => `+ ${total} weitere`,
        time: "Zeit",
        today: "Heute",
        week: "Woche",
      }}
      min={minStartTime}
      onEventDrop={handleEventDrop}
      onEventResize={handleEventResize}
      onSelectEvent={handleSelectEvent}
      onSelectSlot={handleSelectSlot}
      resizable
      selectable
      startAccessor={(event: CalendarEvent) => event.start}
      step={step}
      timeslots={timeslots}
      titleAccessor={(event: CalendarEvent) => event.title}
      views={["day"]} // Only show day view as requested
    />
  );
}

// Helper function to parse time string to minutes from midnight
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

// Helper function to parse time string to minutes from midnight
export function PraxisCalendar({ showGdtAlert = false }: PraxisCalendarProps) {
  const [practiceId, setPracticeId] = useState<Id<"practices"> | null>(null);

  // Initialize practice
  const initializePracticeMutation = useConvexMutation(
    api.practices.initializeDefaultPractice,
  );

  // Initialize practice on mount
  useEffect(() => {
    const initPractice = async () => {
      try {
        const id = await initializePracticeMutation({});
        setPracticeId(id);
      } catch (error) {
        console.error("Failed to initialize practice:", error);
      }
    };

    void initPractice();
  }, [initializePracticeMutation]);

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

  // Mutations
  const createAppointmentMutation = useConvexMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useConvexMutation(
    api.appointments.updateAppointment,
  );

  // Get current date info
  const currentDate = new Date();
  const currentDayOfWeek = currentDate.getDay(); // 0 = Sunday

  // Calculate working practitioners for today and work hours
  const { maxEndTime, minStartTime, workingPractitioners } = useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    // Find practitioners working today
    const todaySchedules = baseSchedulesData.filter(
      (schedule: BaseScheduleData & { practitionerName: string }) =>
        schedule.dayOfWeek === currentDayOfWeek,
    );

    if (todaySchedules.length === 0) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    const working = todaySchedules.map((schedule) => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: schedule.practitionerName,
      startTime: schedule.startTime,
    }));

    // Calculate earliest start and latest end times
    const startTimes = todaySchedules.map((s) => timeToMinutes(s.startTime));
    const endTimes = todaySchedules.map((s) => timeToMinutes(s.endTime));

    const earliestStart = Math.min(...startTimes) - 15; // 15 minutes before
    const latestEnd = Math.max(...endTimes) + 15; // 15 minutes after

    return {
      maxEndTime: new Date(
        0,
        0,
        0,
        Math.floor(latestEnd / 60),
        latestEnd % 60,
        0,
      ),
      minStartTime: new Date(
        0,
        0,
        0,
        Math.floor(earliestStart / 60),
        earliestStart % 60,
        0,
      ),
      workingPractitioners: working,
    };
  }, [practitionersData, baseSchedulesData, currentDayOfWeek]);

  // Convert convex appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    if (!appointmentsData) {
      return [];
    }

    return appointmentsData.map(
      (appointment: AppointmentData): CalendarEvent => ({
        end: new Date(appointment.end),
        id: appointment._id,
        resource: {
          appointmentType: appointment.appointmentType,
          locationId: appointment.locationId,
          notes: appointment.notes,
          patientId: appointment.patientId,
          practitionerId: appointment.practitionerId,
        },
        start: new Date(appointment.start),
        title: appointment.title,
      }),
    );
  }, [appointmentsData]);

  const handleSelectSlot = useCallback(
    (slotInfo: SlotInfo) => {
      const title = globalThis.prompt("Neuer Termin:");
      if (title) {
        void createAppointmentMutation({
          end: slotInfo.end.toISOString(),
          start: slotInfo.start.toISOString(),
          title,
        });
      }
    },
    [createAppointmentMutation],
  );

  const handleSelectEvent = useCallback(
    (event: CalendarEvent, e: React.SyntheticEvent<HTMLElement>) => {
      e.preventDefault();
      const newTitle = globalThis.prompt("Termin bearbeiten:", event.title);
      if (newTitle !== null && newTitle !== event.title) {
        void updateAppointmentMutation({
          id: event.id,
          title: newTitle,
        });
      }
    },
    [updateAppointmentMutation],
  );

  // Handle appointment move (drag & drop)
  const handleEventDrop = useCallback(
    (args: EventInteractionArgs<CalendarEvent>) => {
      const { end, event, start } = args;
      // Handle the fact that start/end might be string or Date
      const startDate = typeof start === "string" ? new Date(start) : start;
      const endDate = typeof end === "string" ? new Date(end) : end;

      void updateAppointmentMutation({
        end: endDate.toISOString(),
        id: event.id,
        start: startDate.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // Handle appointment resize
  const handleEventResize = useCallback(
    (args: EventInteractionArgs<CalendarEvent>) => {
      const { end, event, start } = args;
      // Handle the fact that start/end might be string or Date
      const startDate = typeof start === "string" ? new Date(start) : start;
      const endDate = typeof end === "string" ? new Date(end) : end;

      void updateAppointmentMutation({
        end: endDate.toISOString(),
        id: event.id,
        start: startDate.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // 5-minute time steps
  const step = 5;
  const timeslots = 12; // 12 slots per hour (5-minute intervals)

  // Early return if we don't have a practice ID yet or data is loading
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

  // Show alert if no practitioners work today
  if (workingPractitioners.length === 0) {
    return (
      <div className="flex flex-col items-center space-y-4">
        {showGdtAlert && (
          <div className="flex justify-center">
            <Alert className="w-auto max-w-md" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keine Verbindung mit dem PVS möglich!</AlertTitle>
            </Alert>
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Terminkalender</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center h-96">
            <Alert className="w-auto max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keine Ärzte heute verfügbar</AlertTitle>
              <AlertDescription>
                Es sind keine Ärzte für heute (
                {moment().format("dddd, DD.MM.YYYY")}) eingeplant.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showGdtAlert && (
        <div className="flex justify-center">
          <Alert className="w-auto max-w-md" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Keine Verbindung mit dem PVS möglich!</AlertTitle>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Terminkalender</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ height: "600px" }}>
            <ClientOnly>
              <DragDropCalendar
                events={events}
                handleEventDrop={handleEventDrop}
                handleEventResize={handleEventResize}
                handleSelectEvent={handleSelectEvent}
                handleSelectSlot={handleSelectSlot}
                maxEndTime={maxEndTime}
                minStartTime={minStartTime}
                step={step}
                timeslots={timeslots}
              />
            </ClientOnly>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
