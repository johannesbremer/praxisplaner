import * as React from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

interface PatientCalendarProps {
  availableSlots: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }[];
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
}

export function PatientCalendar({
  availableSlots,
  onSlotClick,
}: PatientCalendarProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = React.useState<
    PatientCalendarProps["availableSlots"][0] | undefined
  >();

  // Get unique dates that have available appointments
  const datesWithAppointments = React.useMemo(() => {
    const dates = new Set<string>();
    for (const slot of availableSlots) {
      const date = new Date(slot.startTime);
      const dateKey = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).toDateString();
      dates.add(dateKey);
    }
    return dates;
  }, [availableSlots]);

  // Get time slots for the selected date
  const timeSlotsForSelectedDate = React.useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    const selectedDateKey = selectedDate.toDateString();
    return availableSlots
      .filter((slot) => {
        const slotDate = new Date(slot.startTime);
        const slotDateKey = new Date(
          slotDate.getFullYear(),
          slotDate.getMonth(),
          slotDate.getDate(),
        ).toDateString();
        return slotDateKey === selectedDateKey;
      })
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
  }, [selectedDate, availableSlots]);

  // Dates that should be disabled (no appointments available)
  const disabledDates = React.useMemo(() => {
    // Create a function that returns true for dates that should be disabled
    return (date: Date) => {
      const dateKey = date.toDateString();
      return !datesWithAppointments.has(dateKey);
    };
  }, [datesWithAppointments]);

  const handleSlotSelect = (
    slot: PatientCalendarProps["availableSlots"][0],
  ) => {
    setSelectedSlot(slot);
    onSlotClick?.(slot);
  };

  const formatSlotTime = (startTime: string) => {
    const slotTime = new Date(startTime);
    // Display time in German timezone
    const hours = slotTime.getUTCHours().toString().padStart(2, "0");
    const minutes = slotTime.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  return (
    <Card className="gap-0 p-0">
      <CardContent className="relative p-0 md:pr-48">
        <div className="p-6">
          <Calendar
            className="bg-transparent p-0 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(12)]"
            defaultMonth={selectedDate ?? new Date()}
            disabled={disabledDates}
            formatters={{
              formatWeekdayName: (date) => {
                return date.toLocaleString("de-DE", { weekday: "short" });
              },
            }}
            mode="single"
            onSelect={setSelectedDate}
            selected={selectedDate}
            showOutsideDays={false}
          />
        </div>

        {/* Time slots panel */}
        <div className="no-scrollbar inset-y-0 right-0 flex max-h-72 w-full scroll-pb-6 flex-col gap-4 overflow-y-auto border-t p-6 md:absolute md:max-h-none md:w-48 md:border-t-0 md:border-l">
          {selectedDate ? (
            <div className="grid gap-2">
              {timeSlotsForSelectedDate.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-4">
                  Keine Termine verfügbar
                </div>
              ) : (
                timeSlotsForSelectedDate.map((slot) => (
                  <Button
                    className="w-full shadow-none flex flex-col items-center justify-center h-auto py-2"
                    key={`${slot.practitionerId}-${slot.startTime}`}
                    onClick={() => {
                      handleSlotSelect(slot);
                    }}
                    variant={selectedSlot === slot ? "default" : "outline"}
                  >
                    <span className="font-medium text-sm">
                      {formatSlotTime(slot.startTime)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {slot.duration} Min.
                    </span>
                  </Button>
                ))
              )}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-4">
              Wählen Sie zuerst ein Datum
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-4 border-t px-6 !py-5 md:flex-row">
        <div className="text-sm">
          {selectedDate && selectedSlot ? (
            <>
              Ihr Termin ist gebucht für{" "}
              <span className="font-medium">
                {selectedDate.toLocaleDateString("de-DE", {
                  day: "numeric",
                  month: "long",
                  weekday: "long",
                })}{" "}
              </span>
              um{" "}
              <span className="font-medium">
                {formatSlotTime(selectedSlot.startTime)}
              </span>
              .
            </>
          ) : selectedDate ? (
            <>Wählen Sie eine Uhrzeit für Ihren Termin.</>
          ) : (
            <>Wählen Sie ein Datum und eine Uhrzeit für Ihren Termin.</>
          )}
        </div>
        <Button
          className="w-full md:ml-auto md:w-auto"
          disabled={!selectedDate || !selectedSlot}
          onClick={() => {
            if (selectedSlot) {
              onSlotClick?.(selectedSlot);
            }
          }}
          variant="outline"
        >
          Weiter
        </Button>
      </CardFooter>
    </Card>
  );
}
