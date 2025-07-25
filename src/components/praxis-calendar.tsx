import type { SlotInfo } from "react-big-calendar";
import type { EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";

import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import moment from "moment";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  MiniCalendar,
  MiniCalendarDay,
  MiniCalendarDays,
  MiniCalendarNavigation,
} from "@/components/ui/mini-calendar";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { CalendarEvent } from "../types";

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
  currentDate,
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
  currentDate: Date;
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
  // State to track if drag and drop is loaded
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasDragDrop, setHasDragDrop] = useState(false);

  // Ref to store the enhanced calendar component
  // Using any here because the drag-and-drop addon returns complex generic types
  // that are difficult to constrain properly with our CalendarEvent type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DnDCalendarRef = useRef<null | React.ComponentType<any>>(null);

  useEffect(() => {
    let mounted = true;

    import("react-big-calendar/lib/addons/dragAndDrop")
      .then((module) => {
        if (!mounted) {
          return;
        }

        const withDragAndDrop = module.default;
        const EnhancedCalendar = withDragAndDrop(Calendar);
        DnDCalendarRef.current = EnhancedCalendar;
        setHasDragDrop(true);
        setIsLoaded(true);
      })
      .catch((error: unknown) => {
        console.warn(
          "Failed to load drag and drop calendar, falling back to regular calendar:",
          error,
        );
        if (!mounted) {
          return;
        }

        // Fallback to regular calendar if drag and drop fails to load
        DnDCalendarRef.current = Calendar;
        setHasDragDrop(false);
        setIsLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!isLoaded || !DnDCalendarRef.current) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Kalender wird geladen...</p>
      </div>
    );
  }

  const CalendarComponent = DnDCalendarRef.current;

  // Create props object with proper typing where possible
  const calendarProps = {
    culture: "de",
    date: currentDate,
    dayLayoutAlgorithm: "no-overlap",
    defaultView: "day" as const,
    endAccessor: (event: CalendarEvent) => event.end,
    events,
    formats: {
      dayHeaderFormat: "dddd, DD.MM.YYYY",
      eventTimeRangeFormat: ({ end, start }: { end: Date; start: Date }) => {
        const startTime = moment(start).format("HH:mm");
        const endTime = moment(end).format("HH:mm");
        return `${startTime} - ${endTime}`;
      },
      timeGutterFormat: "HH:mm",
    },
    localizer,
    max: maxEndTime,
    messages: {
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
    },
    min: minStartTime,
    // Only add drag and drop handlers if drag and drop is available
    ...(hasDragDrop && {
      onEventDrop: handleEventDrop,
      onEventResize: handleEventResize,
      resizable: true,
    }),
    onNavigate: () => {
      // Disable navigation - we'll handle it with mini calendar
    },
    onSelectEvent: handleSelectEvent,
    onSelectSlot: handleSelectSlot,
    selectable: true,
    startAccessor: (event: CalendarEvent) => event.start,
    step,
    timeslots,
    titleAccessor: (event: CalendarEvent) => event.title,
    toolbar: false,
    views: ["day" as const],
  };

  // Use JSX with spread props - type assertion needed due to dynamic component loading
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <CalendarComponent {...(calendarProps as any)} />;
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
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentDayOfWeek = currentDate.getDay(); // 0 = Sunday

  // Calculate working practitioners for current date and work hours
  const { maxEndTime, minStartTime, workingPractitioners } = useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    // Find practitioners working on the current selected day
    const daySchedules = baseSchedulesData.filter(
      (schedule: Doc<"baseSchedules"> & { practitionerName: string }) =>
        schedule.dayOfWeek === currentDayOfWeek,
    );

    if (daySchedules.length === 0) {
      return {
        maxEndTime: new Date(0, 0, 0, 18, 0, 0),
        minStartTime: new Date(0, 0, 0, 8, 0, 0),
        workingPractitioners: [],
      };
    }

    const working = daySchedules.map((schedule) => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: schedule.practitionerName,
      startTime: schedule.startTime,
    }));

    // Calculate business hours: round to full hours
    const startTimes = daySchedules.map((s) => timeToMinutes(s.startTime));
    const endTimes = daySchedules.map((s) => timeToMinutes(s.endTime));

    const earliestStartMinutes = Math.min(...startTimes);
    const latestEndMinutes = Math.max(...endTimes);

    // Round start time down to full hour (e.g., 7:40 -> 7:00, 8:00 -> 8:00)
    const businessStartHour = Math.floor(earliestStartMinutes / 60);

    // Round end time up to full hour (e.g., 18:05 -> 19:00, 19:00 -> 19:00)
    const businessEndHour = Math.ceil(latestEndMinutes / 60);

    return {
      maxEndTime: new Date(0, 0, 0, businessEndHour, 0, 0),
      minStartTime: new Date(0, 0, 0, businessStartHour, 0, 0),
      workingPractitioners: working,
    };
  }, [practitionersData, baseSchedulesData, currentDayOfWeek]);

  // Convert convex appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    if (!appointmentsData) {
      return [];
    }

    return appointmentsData.map(
      (appointment: Doc<"appointments">): CalendarEvent => ({
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

      {/* Mini Calendar Navigation */}
      <div className="flex justify-center">
        <Card className="w-auto">
          <CardContent className="p-4">
            <MiniCalendar
              days={7}
              onStartDateChange={(date) => {
                // Set to the first day of the week containing the selected date
                const startOfWeek = new Date(date);
                startOfWeek.setDate(date.getDate() - date.getDay());
                setCurrentDate(date);
              }}
              onValueChange={setCurrentDate}
              startDate={currentDate}
              value={currentDate}
            >
              <MiniCalendarNavigation direction="prev" />
              <MiniCalendarDays className="flex-1 min-w-0">
                {(date) => (
                  <MiniCalendarDay date={date} key={date.toISOString()} />
                )}
              </MiniCalendarDays>
              <MiniCalendarNavigation direction="next" />
            </MiniCalendar>
          </CardContent>
        </Card>
      </div>

      <Card>
        {workingPractitioners.length === 0 ? (
          <CardContent className="flex items-center justify-center h-96 pt-6">
            <Alert className="w-auto max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keine Ärzte heute verfügbar</AlertTitle>
              <AlertDescription>
                Es sind keine Ärzte für{" "}
                {moment(currentDate).format("dddd, DD.MM.YYYY")} eingeplant.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <CardContent className="p-6">
            <div style={{ height: "2400px" }}>
              <ClientOnly>
                <DragDropCalendar
                  currentDate={currentDate}
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
        )}
      </Card>
    </div>
  );
}
