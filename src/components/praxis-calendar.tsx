import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { AlertCircle } from "lucide-react";
import moment from "moment";
import { useCallback, useMemo } from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { Id } from "../../convex/_generated/dataModel";
import type { AppointmentData, BaseScheduleData, CalendarEvent } from "../types";

import { api } from "../../convex/_generated/api";

// Import CSS for drag and drop
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar);

interface PraxisCalendarProps {
  showGdtAlert?: boolean;
}

// Helper function to parse time string to minutes from midnight
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

// Helper function to convert minutes to time string
export function PraxisCalendar({ showGdtAlert = false }: PraxisCalendarProps) {
  // For now, we'll use a hardcoded practice ID - in real app this would come from context/auth
  const practiceId: Id<"practices"> = "j574x8gw03kv5k2w3xbq7dh5r172kh" as Id<"practices">;
  
  // Query data
  const appointmentsData = useConvexQuery(api.appointments.getAppointments);
  const practitionersData = useConvexQuery(api.practitioners.getPractitioners, { practiceId });
  const baseSchedulesData = useConvexQuery(api.baseSchedules.getAllBaseSchedules, { practiceId });
  
  // Mutations
  const createAppointmentMutation = useConvexMutation(api.appointments.createAppointment);
  const updateAppointmentMutation = useConvexMutation(api.appointments.updateAppointment);

  // Get current date info
  const currentDate = new Date();
  const currentDayOfWeek = currentDate.getDay(); // 0 = Sunday

  // Calculate working practitioners for today and work hours
  const { maxEndTime, minStartTime, workingPractitioners } = useMemo(() => {
    if (!practitionersData || !baseSchedulesData) {
      return { 
        maxEndTime: new Date(0, 0, 0, 18, 0, 0), 
        minStartTime: new Date(0, 0, 0, 8, 0, 0), 
        workingPractitioners: [] 
      };
    }

    // Find practitioners working today
    const todaySchedules = baseSchedulesData.filter(
      (schedule: BaseScheduleData & { practitionerName: string }) => 
        schedule.dayOfWeek === currentDayOfWeek
    );

    if (todaySchedules.length === 0) {
      return { 
        maxEndTime: new Date(0, 0, 0, 18, 0, 0), 
        minStartTime: new Date(0, 0, 0, 8, 0, 0), 
        workingPractitioners: [] 
      };
    }

    const working = todaySchedules.map(schedule => ({
      endTime: schedule.endTime,
      id: schedule.practitionerId,
      name: schedule.practitionerName,
      startTime: schedule.startTime
    }));

    // Calculate earliest start and latest end times
    const startTimes = todaySchedules.map(s => timeToMinutes(s.startTime));
    const endTimes = todaySchedules.map(s => timeToMinutes(s.endTime));
    
    const earliestStart = Math.min(...startTimes) - 15; // 15 minutes before
    const latestEnd = Math.max(...endTimes) + 15; // 15 minutes after

    return {
      maxEndTime: new Date(0, 0, 0, Math.floor(latestEnd / 60), latestEnd % 60, 0),
      minStartTime: new Date(0, 0, 0, Math.floor(earliestStart / 60), earliestStart % 60, 0),
      workingPractitioners: working
    };
  }, [practitionersData, baseSchedulesData, currentDayOfWeek]);

  // Convert convex appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    if (!appointmentsData) {
      return [];
    }

    return appointmentsData.map((appointment: AppointmentData): CalendarEvent => ({
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
    }));
  }, [appointmentsData]);

  const handleSelectSlot = useCallback(
    ({ end, start }: { end: Date; start: Date }) => {
      const title = globalThis.prompt("Neuer Termin:");
      if (title) {
        void createAppointmentMutation({
          end: end.toISOString(),
          start: start.toISOString(),
          title,
        });
      }
    },
    [createAppointmentMutation],
  );

  const handleSelectEvent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
      const newTitle = globalThis.prompt("Termin bearbeiten:", event.title);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (newTitle !== null && newTitle !== event.title) {
        void updateAppointmentMutation({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          id: event.id,
          title: newTitle,
        });
      }
    },
    [updateAppointmentMutation],
  );

  // Handle appointment move (drag & drop)
  const handleEventDrop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { end, event, start } = args;
      void updateAppointmentMutation({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        end: typeof end === 'string' ? new Date(end).toISOString() : end.toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        id: event.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        start: typeof start === 'string' ? new Date(start).toISOString() : start.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // Handle appointment resize
  const handleEventResize = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { end, event, start } = args;
      void updateAppointmentMutation({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        end: typeof end === 'string' ? new Date(end).toISOString() : end.toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        id: event.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        start: typeof start === 'string' ? new Date(start).toISOString() : start.toISOString(),
      });
    },
    [updateAppointmentMutation],
  );

  // Custom day column wrapper to show only working practitioners
  const dayColumnWrapper = useCallback(
    ({ children }: { children: React.ReactNode; value: Date }) => {
      // For day view, we can show all columns as practitioners are handled differently
      return <div className="rbc-day-slot">{children}</div>;
    },
    []
  );

  // 5-minute time steps
  const step = 5;
  const timeslots = 12; // 12 slots per hour (5-minute intervals)

  if (!appointmentsData || !practitionersData || !baseSchedulesData) {
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
                Es sind keine Ärzte für heute ({moment().format('dddd, DD.MM.YYYY')}) eingeplant.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
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
              <DnDCalendar
                components={{
                  dateCellWrapper: dayColumnWrapper,
                }}
                culture="de"
                defaultView="day"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                endAccessor={(event: any) => event.end}
                events={events}
                formats={{
                  dayHeaderFormat: "dddd, DD.MM.YYYY",
                  eventTimeRangeFormat: ({
                    end,
                    start,
                  }: {
                    end: Date;
                    start: Date;
                  }) => {
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                startAccessor={(event: any) => event.start}
                step={step}
                timeslots={timeslots}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
                titleAccessor={(event: any) => event.title}
                views={["day"]} // Only show day view as requested
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </DndProvider>
  );
}
