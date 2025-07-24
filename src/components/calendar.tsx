// src/components/calendar.tsx
import { useConvexQuery } from "@convex-dev/react-query";
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-react";
import { useEffect, useRef, useState } from "react";

import type { Id } from "../../convex/_generated/dataModel";

import { api } from "../../convex/_generated/api";

interface CalendarColumn {
  id: string;
  name: string;
}

interface CalendarEvent {
  barColor?: string;
  end: string;
  id: number | string;
  resource: string;
  start: string;
  text: string;
}

interface CalendarProps {
  practiceId: Id<"practices">;
}

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

  const [config, setConfig] = useState({
    businessBeginsHour: 8,
    businessEndsHour: 18,
    columnMarginRight: 5,
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

      setConfig((prev) => ({
        ...prev,
        businessBeginsHour: earliestStart,
        businessEndsHour: latestEnd,
      }));
    }
  }, [practitioners, allSchedules, startDate]);

  // Load sample events (this would be replaced with actual appointment data)
  useEffect(() => {
    if (columns.length === 0) {
      setEvents([]);
      return;
    }

    // Sample events for demonstration
    const sampleEvents: CalendarEvent[] = [
      {
        barColor: "#3c78d8",
        end: `${startDate.toString("yyyy-MM-dd")}T10:30:00`,
        id: 1,
        resource: columns[0]?.id || "unknown",
        start: `${startDate.toString("yyyy-MM-dd")}T09:00:00`,
        text: "Beispieltermin 1",
      },
      {
        barColor: "#6aa84f",
        end: `${startDate.toString("yyyy-MM-dd")}T15:00:00`,
        id: 2,
        resource: columns[1]?.id || columns[0]?.id || "unknown",
        start: `${startDate.toString("yyyy-MM-dd")}T14:00:00`,
        text: "Beispieltermin 2",
      },
    ];

    setEvents(sampleEvents);
  }, [columns, startDate]);

  // Event handlers with correct types
  const onTimeRangeSelected = (args: {
    end: DayPilot.Date;
    resource: number | string;
    start: DayPilot.Date;
  }) => {
    const modal = DayPilot.Modal.prompt(
      "Neuer Termin:",
      "Neuer Termin",
    );
    void modal.then((result) => {
      if (result.canceled) {
        return;
      }

      const newEvent: CalendarEvent = {
        barColor: "#fcb711",
        end: args.end.toString(),
        id: Date.now(),
        resource: String(args.resource),
        start: args.start.toString(),
        text: String(result.result) || "Neuer Termin",
      };

      setEvents((prev) => [...prev, newEvent]);
    });
  };

  const onEventClick = (args: { e: { text: () => string } }) => {
    const modal = DayPilot.Modal.alert(`Termin: ${args.e.text()}`);
    void modal.then(() => {
      // Handle event click if needed
    });
  };

  // Navigation functions
  const previous = () => {
    setStartDate(startDate.addDays(-1));
  };

  const next = () => {
    setStartDate(startDate.addDays(1));
  };

  const today = () => {
    setStartDate(DayPilot.Date.today());
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
        <div className="text-center">
          <p className="text-lg">Keine Arbeitszeiten für heute</p>
          <p className="text-sm text-muted-foreground">
            Für {startDate.toString("dd.MM.yyyy")} sind keine Arbeitszeiten
            konfiguriert.
          </p>
          <div className="mt-4 space-x-2">
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={previous}
            >
              Vorheriger Tag
            </button>
            <button
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              onClick={today}
            >
              Heute
            </button>
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={next}
            >
              Nächster Tag
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Navigation Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={previous}
          >
            Zurück
          </button>
          <button
            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            onClick={today}
          >
            Heute
          </button>
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={next}
          >
            Vor
          </button>
        </div>
        <h2 className="text-xl font-semibold">
          {startDate.toString("dddd, dd.MM.yyyy")}
        </h2>
        <div className="text-sm text-muted-foreground">
          {columns.length} Ärzte verfügbar
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 p-4">
        <DayPilotCalendar
          {...config}
          columns={columns}
          events={events}
          onEventClick={onEventClick}
          onTimeRangeSelected={onTimeRangeSelected}
          ref={calendarRef}
          startDate={startDate}
        />
      </div>
    </div>
  );
}