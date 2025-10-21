import type { Matcher } from "react-day-picker";

import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import {
  getPublicHolidays,
  isPublicHolidaySync,
} from "../utils/public-holidays";

interface PatientViewProps {
  dateRange: SchedulingDateRange;
  onSlotClick?: (slot: SchedulingSlot) => void;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  showDebugInfo?: boolean;
  simulatedContext: SchedulingSimulatedContext;
}

export function PatientView({
  dateRange,
  onSlotClick,
  practiceId,
  ruleSetId,
  showDebugInfo = false,
  simulatedContext,
}: PatientViewProps) {
  // First query: Get available dates for the calendar (lightweight, no rule evaluation)
  const availableDatesResult = useQuery(api.scheduling.getAvailableDates, {
    dateRange,
    practiceId,
    simulatedContext,
  });

  // Selected day state - initialized later based on available dates
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  // Second query: Get slots for the selected date only (with full rule evaluation)
  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    selectedDate && ruleSetId
      ? {
          date: format(selectedDate, "yyyy-MM-dd"),
          practiceId,
          ruleSetId,
          simulatedContext,
        }
      : "skip",
  );

  const allSlots = useMemo<SchedulingSlot[]>(
    () => slotsResult?.slots ?? [],
    [slotsResult],
  );
  const availableSlots = useMemo<SchedulingSlot[]>(
    () => allSlots.filter((slot) => slot.status === "AVAILABLE"),
    [allSlots],
  );
  const blockedSlots = useMemo<SchedulingSlot[]>(
    () => allSlots.filter((slot) => slot.status === "BLOCKED"),
    [allSlots],
  );

  // Build set of dates within the provided range, and identify dates that have available slots
  const allDatesInRange = useMemo(() => {
    const dates: Date[] = [];
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    for (
      let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      d <= end;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      dates.push(new Date(d));
    }
    return dates;
  }, [dateRange.start, dateRange.end]);

  const datesWithAvailabilities = useMemo(() => {
    const set = new Set<string>();
    if (availableDatesResult?.dates) {
      for (const dateStr of availableDatesResult.dates) {
        // Convert YYYY-MM-DD to Date and get toDateString() format
        const date = new Date(dateStr + "T00:00:00");
        set.add(date.toDateString());
      }
    }
    return set;
  }, [availableDatesResult]);

  // Load public holidays
  const [publicHolidayDates, setPublicHolidayDates] = useState<Date[]>([]);

  useEffect(() => {
    void getPublicHolidays().then(setPublicHolidayDates);
  }, []);

  const publicHolidaysSet = useMemo(() => {
    const set = new Set<string>();
    for (const date of publicHolidayDates) {
      set.add(format(date, "yyyy-MM-dd"));
    }
    return set;
  }, [publicHolidayDates]);

  const disabledMatchers = useMemo<Matcher[]>(() => {
    // Disable any date in range that has no available slots, plus weekends
    const unavailableDates = allDatesInRange.filter(
      (d) => !datesWithAvailabilities.has(d.toDateString()),
    );

    return [...unavailableDates, { dayOfWeek: [0, 6] }];
  }, [allDatesInRange, datesWithAvailabilities]);

  // Selected day state defaults to first day with availability
  const firstAvailableDate = useMemo(() => {
    const first = [...datesWithAvailabilities]
      .map((dateString) => new Date(dateString))
      .toSorted((a, b) => a.getTime() - b.getTime())[0];
    return first;
  }, [datesWithAvailabilities]);

  // Track last first available date to detect changes and auto-initialize selection
  const [lastFirstAvailableDate, setLastFirstAvailableDate] = useState<
    Date | undefined
  >(firstAvailableDate);

  // Sync with firstAvailableDate during render if not set
  if (
    !selectedDate &&
    firstAvailableDate &&
    lastFirstAvailableDate !== firstAvailableDate
  ) {
    setLastFirstAvailableDate(firstAvailableDate);
    setSelectedDate(firstAvailableDate);
  }

  // Selected slot state (optional visual selection before continuing)
  const [selectedSlotKey, setSelectedSlotKey] = useState<null | string>(null);

  // Reset selected slot when date changes by detecting the change during render
  const dateResetKey = selectedDate?.getTime() ?? "none";
  const lastDateResetKeyRef = useRef(dateResetKey);
  if (lastDateResetKeyRef.current !== dateResetKey) {
    lastDateResetKeyRef.current = dateResetKey;
    if (selectedSlotKey !== null) {
      setSelectedSlotKey(null);
    }
  }

  // Compute day-specific available slots for the side list
  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDate) {
      return [] as typeof availableSlots;
    }
    return availableSlots
      .filter(
        (slot) =>
          new Date(slot.startTime).toDateString() ===
          selectedDate.toDateString(),
      )
      .toSorted(
        (slotA, slotB) =>
          new Date(slotA.startTime).getTime() -
          new Date(slotB.startTime).getTime(),
      );
  }, [availableSlots, selectedDate]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pt-12">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Terminbuchung</h2>
          <div className="text-sm text-muted-foreground mb-3">
            {simulatedContext.appointmentType} •{" "}
            {simulatedContext.patient.isNew
              ? "Neuer Patient"
              : "Bestandspatient"}
          </div>

          <div className="flex gap-4 text-sm mb-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              <span>Verfügbar ({availableSlots.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span>Blockiert ({blockedSlots.length})</span>
            </div>
          </div>
        </div>

        {availableSlots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Keine Termine im ausgewählten Zeitraum gefunden.
          </div>
        ) : (
          <Card className="gap-0 p-0">
            <CardContent className="relative p-0 md:pr-56">
              <div className="p-4 md:p-6">
                <Calendar
                  className="bg-transparent p-0 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(12)]"
                  defaultMonth={selectedDate ?? new Date(dateRange.start)}
                  disabled={disabledMatchers}
                  formatters={{
                    formatWeekdayName: (date) =>
                      date.toLocaleString("de-DE", { weekday: "short" }),
                  }}
                  locale={de}
                  mode="single"
                  modifiers={{
                    publicHoliday: (date) =>
                      isPublicHolidaySync(date, publicHolidaysSet),
                  }}
                  modifiersClassNames={{
                    publicHoliday:
                      "bg-muted/40 text-muted-foreground opacity-60",
                  }}
                  onSelect={(d) => {
                    setSelectedDate(d ?? undefined);
                  }}
                  selected={selectedDate}
                  showOutsideDays={false}
                  weekStartsOn={1}
                />
              </div>
              <div className="no-scrollbar inset-y-0 right-0 flex max-h-72 w-full scroll-pb-6 flex-col gap-2 overflow-y-auto border-t p-4 md:absolute md:max-h-none md:w-56 md:border-t-0 md:border-l md:p-6">
                <div className="grid gap-2">
                  {slotsForSelectedDate.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Keine Termine an diesem Tag.
                    </div>
                  ) : (
                    slotsForSelectedDate.map((slot) => {
                      const slotDate = new Date(slot.startTime);
                      const hours = slotDate
                        .getUTCHours()
                        .toString()
                        .padStart(2, "0");
                      const minutes = slotDate
                        .getUTCMinutes()
                        .toString()
                        .padStart(2, "0");
                      const time = `${hours}:${minutes}`;
                      const key = `${slot.practitionerId}-${slot.startTime}`;
                      const isSelected = selectedSlotKey === key;
                      return (
                        <Button
                          className={cn(
                            "w-full justify-between shadow-none",
                            isSelected && "ring-2 ring-primary",
                          )}
                          key={key}
                          onClick={() => {
                            setSelectedSlotKey(key);
                            onSlotClick?.(slot);
                          }}
                          variant={isSelected ? "default" : "outline"}
                        >
                          <span>{time}</span>
                          <span className="text-xs text-muted-foreground">
                            {slot.practitionerName}
                          </span>
                        </Button>
                      );
                    })
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4 border-t px-4 !py-4 md:px-6 md:!py-5 md:flex-row">
              <div className="text-sm">
                {selectedDate && selectedSlotKey ? (
                  <>
                    Termin am
                    <span className="font-medium">
                      {" "}
                      {format(selectedDate, "EEEE, d. MMMM", {
                        locale: de,
                      })}{" "}
                    </span>
                    ausgewählt.
                  </>
                ) : (
                  <>Datum und Uhrzeit auswählen.</>
                )}
              </div>
              <Button
                className="w-full md:ml-auto md:w-auto"
                disabled={!selectedDate || !selectedSlotKey}
                variant="outline"
              >
                Weiter
              </Button>
            </CardFooter>
          </Card>
        )}

        {showDebugInfo && slotsResult && slotsResult.log.length > 0 && (
          <div className="mt-6 p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold mb-2 text-sm">
              Debug: Regelverarbeitung
            </h4>
            <div className="space-y-1 font-mono text-xs">
              {slotsResult.log.map((logEntry, index) => (
                <div className="text-muted-foreground" key={index}>
                  {logEntry}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
