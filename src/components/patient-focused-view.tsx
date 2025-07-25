import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useEffect, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MiniCalendar,
  MiniCalendarDay,
  MiniCalendarDays,
  MiniCalendarNavigation,
} from "@/components/ui/mini-calendar";
import { api } from "@/convex/_generated/api";

import type { LocalAppointment } from "../utils/local-appointments";

interface PatientFocusedViewProps {
  dateRange: { end: string; start: string };
  localAppointments?: LocalAppointment[];
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
  onUpdateSimulatedContext?: (context: {
    appointmentType: string;
    patient: { isNew: boolean };
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  simulatedContext: {
    appointmentType: string;
    patient: { isNew: boolean };
  };
}

const appointmentTypes = [
  "Erstberatung",
  "Nachuntersuchung",
  "Grippeimpfung",
  "Vorsorge",
  "Akutsprechstunde",
];

export function PatientFocusedView({
  dateRange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Will be used later
  localAppointments: _localAppointments = [],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Will be used later
  onCreateLocalAppointment: _onCreateLocalAppointment,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: PatientFocusedViewProps) {
  // Track calendar navigation independently from simulation dateRange
  const [calendarStartDate, setCalendarStartDate] = useState(
    new Date(dateRange.start),
  );

  // Sync calendar start date when simulation date changes
  useEffect(() => {
    setCalendarStartDate(new Date(dateRange.start));
  }, [dateRange.start]);

  // Create expanded date range for calendar (5 days from calendar start)
  const calendarEndDate = new Date(calendarStartDate);
  calendarEndDate.setDate(calendarEndDate.getDate() + 4);
  calendarEndDate.setHours(23, 59, 59, 999);

  const calendarDateRange = {
    end: calendarEndDate.toISOString(),
    start: calendarStartDate.toISOString(),
  };

  const slotsResult = useQuery(
    api.scheduling.getAvailableSlots,
    ruleSetId
      ? {
          dateRange: calendarDateRange,
          practiceId,
          ruleSetId,
          simulatedContext,
        }
      : {
          dateRange: calendarDateRange,
          practiceId,
          simulatedContext,
        },
  );

  if (!slotsResult) {
    return (
      <div className="p-4 pt-12">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">Terminbuchung</h2>
          <div className="text-muted-foreground">Termine werden geladen...</div>
        </div>
      </div>
    );
  }

  // Only show available slots to patients
  const availableSlots = slotsResult.slots.filter(
    (slot) => slot.status === "AVAILABLE",
  );

  // Get unique dates that have available appointments
  const datesWithAppointments = new Set(
    availableSlots.map((slot) => {
      const date = new Date(slot.startTime);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }),
  );

  // Group available slots by date for display
  const slotsByDate = new Map<string, typeof availableSlots>();
  for (const slot of availableSlots) {
    const date = new Date(slot.startTime).toDateString();
    if (!slotsByDate.has(date)) {
      slotsByDate.set(date, []);
    }
    const dateSlots = slotsByDate.get(date);
    if (dateSlots) {
      dateSlots.push(slot);
    }
  }

  const sortedDates = [...slotsByDate.keys()].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  // Filter dates for mini-calendar to only show dates with appointments
  const shouldShowDate = (date: Date) => {
    return [...datesWithAppointments].some(
      (appointmentDate) =>
        appointmentDate.getDate() === date.getDate() &&
        appointmentDate.getMonth() === date.getMonth() &&
        appointmentDate.getFullYear() === date.getFullYear(),
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pt-12 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold mb-2">Terminbuchung</h2>
          <p className="text-sm text-muted-foreground">
            Wählen Sie Ihre gewünschte Terminart und einen passenden Termin
          </p>
        </div>

        {/* Terminart Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terminart wählen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2">
              {appointmentTypes.map((type) => (
                <Button
                  className="justify-start text-left h-auto p-3"
                  key={type}
                  onClick={() => {
                    onUpdateSimulatedContext?.({
                      ...simulatedContext,
                      appointmentType: type,
                    });
                  }}
                  size="sm"
                  variant={
                    simulatedContext.appointmentType === type
                      ? "default"
                      : "outline"
                  }
                >
                  {type}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Mini Calendar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verfügbare Tage</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniCalendar
              days={5}
              onStartDateChange={setCalendarStartDate}
              startDate={calendarStartDate}
            >
              <MiniCalendarNavigation direction="prev" />
              <MiniCalendarDays className="flex-1 min-w-0">
                {(date) => (
                  <MiniCalendarDay
                    className={
                      shouldShowDate(date)
                        ? ""
                        : "opacity-25 cursor-not-allowed"
                    }
                    date={date}
                    key={date.toISOString()}
                  />
                )}
              </MiniCalendarDays>
              <MiniCalendarNavigation direction="next" />
            </MiniCalendar>
          </CardContent>
        </Card>

        {/* Available Appointments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verfügbare Termine</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedDates.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p>Keine verfügbaren Termine gefunden.</p>
                <p className="text-sm mt-1">
                  Bitte wählen Sie einen anderen Zeitraum.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedDates.map((dateString) => {
                  const date = new Date(dateString);
                  const daySlots = slotsByDate.get(dateString);

                  if (!daySlots) {
                    return null;
                  }

                  return (
                    <div key={dateString}>
                      <h4 className="font-medium mb-2 text-sm">
                        {format(date, "EEEE, d. MMMM", { locale: de })}
                      </h4>
                      <div className="grid gap-2 grid-cols-2">
                        {daySlots
                          .sort(
                            (a, b) =>
                              new Date(a.startTime).getTime() -
                              new Date(b.startTime).getTime(),
                          )
                          .map((slot) => {
                            const slotTime = new Date(slot.startTime);
                            // Display time in German timezone
                            const hours = slotTime
                              .getUTCHours()
                              .toString()
                              .padStart(2, "0");
                            const minutes = slotTime
                              .getUTCMinutes()
                              .toString()
                              .padStart(2, "0");
                            const timeString = `${hours}:${minutes}`;

                            return (
                              <Button
                                className="h-12 flex flex-col items-center justify-center"
                                key={`${slot.practitionerId}-${slot.startTime}`}
                                onClick={() => onSlotClick?.(slot)}
                                size="sm"
                                variant="outline"
                              >
                                <span className="font-medium text-sm">
                                  {timeString}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {slot.duration} Min.
                                </span>
                              </Button>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Book Appointment Button */}
        <div className="pb-4">
          <Button className="w-full h-12" size="lg">
            Termin buchen
          </Button>
        </div>
      </div>
    </div>
  );
}
