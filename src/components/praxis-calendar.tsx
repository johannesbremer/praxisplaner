import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { AlertCircle } from "lucide-react";
import moment from "moment";
import { useCallback, useMemo } from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { Id } from "../../convex/_generated/dataModel";

import { api } from "../../convex/_generated/api";

const localizer = momentLocalizer(moment);

interface CalendarEvent {
  end: Date;
  id: Id<"appointments">;
  resource?: {
    appointmentType?: string;
    locationId?: Id<"locations">;
    notes?: string;
    patientId?: Id<"patients">;
    practitionerId?: Id<"practitioners">;
  };
  start: Date;
  title: string;
}

interface PraxisCalendarProps {
  showGdtAlert?: boolean;
}

export function PraxisCalendar({ showGdtAlert = false }: PraxisCalendarProps) {
  const appointmentsData = useConvexQuery(api.appointments.getAppointments);
  const createAppointmentMutation = useConvexMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useConvexMutation(
    api.appointments.updateAppointment,
  );

  // Convert convex appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    if (!appointmentsData) {
      return [];
    }

    return appointmentsData.map((appointment: any) => ({
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
    async ({ end, start }: { end: Date; start: Date }) => {
      const title = globalThis.prompt("Neuer Termin:");
      if (title) {
        await createAppointmentMutation({
          end: end.toISOString(),
          start: start.toISOString(),
          title,
        });
      }
    },
    [createAppointmentMutation],
  );

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
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

  // 5-minute time steps
  const step = 5;
  const timeslots = 12; // 12 slots per hour (5-minute intervals)

  if (!appointmentsData) {
    return (
      <div className="flex items-center justify-center h-96">
        <p>Termine werden geladen...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showGdtAlert && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Keine Verbindung mit dem PVS möglich!</AlertTitle>
          <AlertDescription>
            Ihr Browser unterstützt die File System Access API nicht oder es
            wurde keine Berechtigung für den Windows-Ordner erteilt.
          </AlertDescription>
        </Alert>
      )}

      <div style={{ height: "600px" }}>
        <Calendar
          culture="de"
          defaultView="week"
          endAccessor="end"
          events={events}
          formats={{
            dayHeaderFormat: "dddd, DD.MM.YYYY",
            dayRangeHeaderFormat: ({
              end,
              start,
            }: {
              end: Date;
              start: Date;
            }) => {
              const startDate = moment(start).format("DD.MM.");
              const endDate = moment(end).format("DD.MM.YYYY");
              return `${startDate} - ${endDate}`;
            },
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
          max={new Date(0, 0, 0, 18, 0, 0)} // 6:00 PM
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
          min={new Date(0, 0, 0, 8, 0, 0)} // 8:00 AM
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          selectable
          startAccessor="start"
          step={step}
          timeslots={timeslots}
          titleAccessor="title"
          views={["month", "week", "day"]}
        />
      </div>
    </div>
  );
}
