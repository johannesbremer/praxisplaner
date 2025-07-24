// src/components/calendar.tsx
import { useConvexMutation, useConvexQuery } from "@convex-dev/react-query";
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-react";
import { useEffect, useRef, useState } from "react";

import {
  MiniCalendar,
  MiniCalendarDay,
  MiniCalendarDays,
  MiniCalendarNavigation,
} from "@/components/ui/mini-calendar";

import type { Id } from "../../convex/_generated/dataModel";
import type { CalendarColumn, CalendarEvent, CalendarProps } from "../types";

import { api } from "../../convex/_generated/api";

export function Calendar({ practiceId }: CalendarProps) {
  const calendarRef = useRef<DayPilotCalendar>(null);
  const [startDate, setStartDate] = useState(DayPilot.Date.today());
  const [columns, setColumns] = useState<CalendarColumn[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Get practitioners and their schedules for the practice
  const practitioners = useConvexQuery(api.practitioners.getPractitioners, {
    practiceId,
  });
  const allSchedules = useConvexQuery(api.baseSchedules.getAllBaseSchedules, {
    practiceId,
  });

  // Get appointments for the current day
  const appointmentsQuery = useConvexQuery(api.appointments.getAppointments, {
    endDate: startDate.addDays(1).toString("yyyy-MM-dd") + "T00:00:00",
    practiceId,
    startDate: startDate.toString("yyyy-MM-dd") + "T00:00:00",
  });

  // Convex mutations for appointment management
  const createAppointmentMutation = useConvexMutation(
    api.appointments.createAppointment,
  );
  const updateAppointmentMutation = useConvexMutation(
    api.appointments.updateAppointment,
  );

  const [config, setConfig] = useState({
    cellDuration: 5, // 5-minute grid as requested
    columnMarginRight: 5,
    dayBeginsHour: 8, // Control visible start hour
    dayEndsHour: 18, // Control visible end hour
    eventMoveHandling: "Update" as const,
    eventResizeHandling: "Update" as const,
    headerHeight: 40,
    timeRangeSelectedHandling: "Enabled" as const,
    viewType: "Resources" as const,
  });

  // Update columns based on practitioners who have schedules for the current day
  useEffect(() => {
    if (!practitioners || !allSchedules) {
      return;
    }

    const currentDayOfWeek = startDate.getDayOfWeek(); // 0 = Sunday, 1 = Monday, etc.

    // Filter schedules for current day and create columns
    const todaysSchedules = allSchedules.filter(
      (schedule) => schedule.dayOfWeek === currentDayOfWeek,
    );

    const practitionerColumns: CalendarColumn[] = todaysSchedules.map(
      (schedule) => ({
        id: schedule.practitionerId,
        name: schedule.practitionerName,
      }),
    );

    setColumns(practitionerColumns);

    // Update business hours based on earliest start and latest end
    // Show only half an hour before and after the working hours
    if (todaysSchedules.length > 0) {
      const startTimes = todaysSchedules.map((s) => {
        const parts = s.startTime.split(":");
        return Number.parseInt(parts[0] || "8", 10);
      });
      const endTimes = todaysSchedules.map((s) => {
        const parts = s.endTime.split(":");
        return Number.parseInt(parts[0] || "18", 10) + 1; // Add 1 to show the full hour
      });

      const earliestStart = Math.min(...startTimes);
      const latestEnd = Math.max(...endTimes);

      // Show 0.5 hours before and after working hours
      const visibleStart = Math.max(0, earliestStart - 0.5);
      const visibleEnd = Math.min(24, latestEnd + 0.5);

      setConfig((prev) => ({
        ...prev,
        dayBeginsHour: visibleStart,
        dayEndsHour: visibleEnd,
      }));
    }
  }, [practitioners, allSchedules, startDate]);

  // Load real appointments from Convex instead of sample data
  useEffect(() => {
    if (columns.length === 0 || !appointmentsQuery) {
      setEvents([]);
      return;
    }

    // Convert Convex appointments to DayPilot events
    const calendarEvents: CalendarEvent[] = appointmentsQuery.map(
      (appointment) => ({
        barColor:
          appointment.status === "CONFIRMED"
            ? "#3c78d8"
            : appointment.status === "CANCELLED"
              ? "#e06666"
              : appointment.status === "COMPLETED"
                ? "#6aa84f"
                : "#fcb711",
        end: appointment.endTime,
        id: appointment._id,
        resource: appointment.practitionerId,
        start: appointment.startTime,
        text: appointment.title,
      }),
    );

    setEvents(calendarEvents);
  }, [columns, appointmentsQuery]);

  // Event handlers with appointment creation functionality
  const onTimeRangeSelected = async (args: {
    end: DayPilot.Date;
    resource: number | string;
    start: DayPilot.Date;
  }) => {
    const modal = DayPilot.Modal.prompt("Neuer Termin:", "Neuer Termin");
    const result = await modal;

    if (result.canceled) {
      return;
    }

    const title = String(result.result) || "Neuer Termin";
    const startTime = args.start.toString();
    const endTime = args.end.toString();
    const duration = Math.floor(
      (args.end.getTime() - args.start.getTime()) / (1000 * 60),
    ); // Duration in minutes

    try {
      // Create appointment in Convex
      await createAppointmentMutation({
        appointmentType: "Allgemein", // Default type
        duration,
        endTime,
        practiceId,
        practitionerId: String(args.resource) as Id<"practitioners">,
        startTime,
        title,
      });
    } catch (error) {
      console.error("Error creating appointment:", error);
      const errorModal = DayPilot.Modal.alert(
        "Fehler beim Erstellen des Termins",
      );
      void errorModal;
    }
  };

  const onEventClick = (args: {
    e: { data: { id: string }; text: () => string };
  }) => {
    const modal = DayPilot.Modal.alert(`Termin: ${args.e.text()}`);
    void modal.then(() => {
      // Could add edit/delete functionality here
    });
  };

  // Handle appointment drag/move operations
  const onEventMove = async (args: {
    e: { data: { id: string } };
    newEnd: DayPilot.Date;
    newResource: number | string;
    newStart: DayPilot.Date;
  }) => {
    try {
      const appointmentId = args.e.data.id as Id<"appointments">;
      const startTime = args.newStart.toString();
      const endTime = args.newEnd.toString();
      const duration = Math.floor(
        (args.newEnd.getTime() - args.newStart.getTime()) / (1000 * 60),
      );

      // Include practitionerId update when moving between doctors
      await updateAppointmentMutation({
        appointmentId,
        duration,
        endTime,
        practitionerId: String(args.newResource) as Id<"practitioners">,
        startTime,
      });
    } catch (error) {
      console.error("Error moving appointment:", error);
      const errorModal = DayPilot.Modal.alert(
        "Fehler beim Verschieben des Termins",
      );
      void errorModal;
    }
  };

  // Handle appointment resize operations
  const onEventResize = async (args: {
    e: { data: { id: string } };
    newEnd: DayPilot.Date;
    newStart: DayPilot.Date;
  }) => {
    try {
      const appointmentId = args.e.data.id as Id<"appointments">;
      const startTime = args.newStart.toString();
      const endTime = args.newEnd.toString();
      const duration = Math.floor(
        (args.newEnd.getTime() - args.newStart.getTime()) / (1000 * 60),
      );

      await updateAppointmentMutation({
        appointmentId,
        duration,
        endTime,
        startTime,
      });
    } catch (error) {
      console.error("Error resizing appointment:", error);
      const errorModal = DayPilot.Modal.alert(
        "Fehler beim Ändern der Termindauer",
      );
      void errorModal;
    }
  };

  // Handle mini-calendar date changes
  const handleCalendarDateChange = (date: Date) => {
    const dayPilotDate = new DayPilot.Date(date);
    setStartDate(dayPilotDate);
  };

  if (!practitioners || !allSchedules) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-lg">Kalender wird geladen...</p>
      </div>
    );
  }

  if (practitioners.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg">Keine Ärzte konfiguriert</p>
          <p className="text-sm text-muted-foreground">
            Bitte fügen Sie erst Ärzte und deren Arbeitszeiten hinzu.
          </p>
        </div>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <div>
            <p className="text-lg">Keine Arbeitszeiten für heute</p>
            <p className="text-sm text-muted-foreground">
              Für {startDate.toString("dd.MM.yyyy")} sind keine Arbeitszeiten
              konfiguriert.
            </p>
          </div>

          {/* Mini Calendar Navigation */}
          <div className="flex justify-center">
            <MiniCalendar
              days={7}
              onStartDateChange={handleCalendarDateChange}
              startDate={startDate.toDate()}
            >
              <MiniCalendarNavigation direction="prev" />
              <MiniCalendarDays className="flex-1 min-w-0">
                {(date) => (
                  <MiniCalendarDay date={date} key={date.toISOString()} />
                )}
              </MiniCalendarDays>
              <MiniCalendarNavigation direction="next" />
            </MiniCalendar>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Navigation Header with Centered Mini Calendar */}
      <div className="flex items-center justify-center p-4">
        <MiniCalendar
          days={7}
          onStartDateChange={handleCalendarDateChange}
          startDate={startDate.toDate()}
        >
          <MiniCalendarNavigation direction="prev" />
          <MiniCalendarDays className="flex-1 min-w-0">
            {(date) => <MiniCalendarDay date={date} key={date.toISOString()} />}
          </MiniCalendarDays>
          <MiniCalendarNavigation direction="next" />
        </MiniCalendar>
      </div>

      {/* Calendar */}
      <div className="flex-1 p-4">
        <DayPilotCalendar
          {...config}
          columns={columns}
          events={events}
          locale="de-de"
          onEventClick={onEventClick}
          onEventMove={(args) => {
            void onEventMove(args);
          }}
          onEventResize={(args) => {
            void onEventResize(args);
          }}
          onTimeRangeSelected={(args) => {
            void onTimeRangeSelected(args);
          }}
          ref={calendarRef}
          startDate={startDate}
        />
      </div>
    </div>
  );
}
