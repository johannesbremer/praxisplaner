import type { RefObject } from "react";
import type { Matcher } from "react-day-picker";

import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { LocalAppointment } from "../utils/local-appointments";

import { AppointmentTypeSelector } from "./appointment-type-selector";
import { LocationSelector } from "./location-selector";

interface PatientFocusedViewProps {
  dateRange: SchedulingDateRange;
  localAppointments?: LocalAppointment[];
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
}

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
  // Track selected location in local state
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(simulatedContext.locationId);

  // Track calendar navigation independently from simulation dateRange
  const [calendarStartDate, setCalendarStartDate] = useState(
    new Date(dateRange.start),
  );

  // Sync calendar start date when simulation date changes
  useEffect(() => {
    setCalendarStartDate(new Date(dateRange.start));
  }, [dateRange.start]);

  // Fetch available locations
  const locationsQuery = useQuery(api.locations.getLocations, { practiceId });

  // Create expanded date range for calendar (5 days from calendar start)
  const calendarEndDate = useMemo(() => {
    const d = new Date(calendarStartDate);
    d.setDate(d.getDate() + 4);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [calendarStartDate]);

  const calendarDateRange = {
    end: calendarEndDate.toISOString(),
    start: calendarStartDate.toISOString(),
  } satisfies SchedulingDateRange;

  // Create the simulated context with selected location
  const effectiveSimulatedContext: SchedulingSimulatedContext = (() => {
    if (selectedLocationId) {
      return {
        ...simulatedContext,
        locationId: selectedLocationId,
      } as SchedulingSimulatedContext;
    }

    const contextWithoutLocation = { ...simulatedContext };
    delete contextWithoutLocation.locationId;
    return contextWithoutLocation as SchedulingSimulatedContext;
  })();

  const slotsResult = useQuery(
    api.scheduling.getAvailableSlots,
    // Only fetch slots if a location is selected
    selectedLocationId && ruleSetId
      ? {
          dateRange: calendarDateRange,
          practiceId,
          ruleSetId,
          simulatedContext: effectiveSimulatedContext,
        }
      : selectedLocationId
        ? {
            dateRange: calendarDateRange,
            practiceId,
            simulatedContext: effectiveSimulatedContext,
          }
        : "skip",
  );

  const isLocationsLoading = !locationsQuery;
  const safeLocations = locationsQuery ?? [];

  // Process slots data only when we have it
  const allSlots = useMemo<SchedulingSlot[]>(
    () => slotsResult?.slots ?? [],
    [slotsResult],
  );
  const availableSlots = useMemo<SchedulingSlot[]>(
    () => allSlots.filter((slot) => slot.status === "AVAILABLE"),
    [allSlots],
  );

  // Compute date helpers for integrated calendar
  const windowStart = useMemo(
    () =>
      new Date(
        calendarStartDate.getFullYear(),
        calendarStartDate.getMonth(),
        calendarStartDate.getDate(),
      ),
    [calendarStartDate],
  );
  const windowEnd = useMemo(
    () =>
      new Date(
        calendarEndDate.getFullYear(),
        calendarEndDate.getMonth(),
        calendarEndDate.getDate(),
        23,
        59,
        59,
        999,
      ),
    [calendarEndDate],
  );

  const datesWithAvailabilities = new Set(
    availableSlots.map((slot) => new Date(slot.startTime).toDateString()),
  );

  // Disable dates inside the 5-day window that have no availabilities, and also outside window
  const disabledDates: Matcher[] = [];
  for (
    let d = new Date(windowStart);
    d <= windowEnd;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    if (!datesWithAvailabilities.has(d.toDateString())) {
      disabledDates.push(new Date(d));
    }
  }
  disabledDates.push({ before: windowStart }, { after: windowEnd });

  // Selection state for integrated calendar + times
  const firstAvailableDate = (() => {
    const list = [...datesWithAvailabilities]
      .map((dateString) => new Date(dateString))
      .toSorted((a, b) => a.getTime() - b.getTime());
    return list[0];
  })();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    firstAvailableDate,
  );
  const [selectedSlotKey, setSelectedSlotKey] = useState<null | string>(null);

  useEffect(() => {
    // Reset selection if window shifts
    setSelectedSlotKey(null);
    if (!selectedDate && firstAvailableDate) {
      setSelectedDate(firstAvailableDate);
    }
  }, [firstAvailableDate, selectedDate, windowStart, windowEnd]);

  useEffect(() => {
    setSelectedSlotKey(null);
  }, [selectedDate]);

  const slotsForSelectedDate = selectedDate
    ? availableSlots
        .filter(
          (slot) =>
            new Date(slot.startTime).toDateString() ===
            selectedDate.toDateString(),
        )
        .toSorted(
          (slotA, slotB) =>
            new Date(slotA.startTime).getTime() -
            new Date(slotB.startTime).getTime(),
        )
    : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pt-12 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold mb-2">Terminbuchung</h2>
          <p className="text-sm text-muted-foreground">
            {selectedLocationId
              ? "Wählen Sie Ihre gewünschte Terminart und einen passenden Termin"
              : "Wählen Sie zuerst einen Standort für Ihren Termin"}
          </p>
        </div>

        {/* Location Selection */}
        <LocationSelector
          locations={safeLocations}
          onLocationSelect={(locationId: Id<"locations">) => {
            setSelectedLocationId(locationId);
            // Update simulated context with the selected location
            const updatedContext: SchedulingSimulatedContext = {
              ...simulatedContext,
              locationId,
            };
            onUpdateSimulatedContext?.(updatedContext);
          }}
          selectedLocationId={selectedLocationId}
        />

        {/* Terminart Selection - Always visible */}
        <AppointmentTypeSelector
          onTypeSelect={(type: string) => {
            onUpdateSimulatedContext?.({
              ...simulatedContext,
              appointmentType: type,
            });
          }}
          selectedType={simulatedContext.appointmentType}
        />

        {/* Show integrated calendar only when location is selected and slots are loaded */}
        {selectedLocationId && slotsResult && (
          <>
            {/* Integrated Calendar + Time list (calendar-20 style) */}
            <Card className="gap-0 p-0">
              <CardHeader className="px-4 pt-4 md:px-6 md:pt-6">
                <CardTitle className="text-base">Verfügbare Termine</CardTitle>
              </CardHeader>
              <ContainerAwareContent>
                {({
                  containerRef,
                  isWide,
                }: {
                  containerRef: RefObject<HTMLDivElement | null>;
                  isWide: boolean;
                }) => (
                  <div ref={containerRef}>
                    <CardContent
                      className={cn("relative p-0", isWide && "pr-56")}
                    >
                      <div className="px-4 pb-4 md:px-6 md:pb-6">
                        <Calendar
                          className="bg-transparent p-0 [--cell-size:--spacing(10)] md:[--cell-size:--spacing(12)]"
                          defaultMonth={selectedDate ?? calendarStartDate}
                          disabled={disabledDates}
                          formatters={{
                            formatWeekdayName: (date) =>
                              date.toLocaleString("de-DE", {
                                weekday: "short",
                              }),
                          }}
                          mode="single"
                          onSelect={(d) => {
                            setSelectedDate(d ?? undefined);
                          }}
                          selected={selectedDate}
                          showOutsideDays={false}
                        />
                      </div>
                      <div
                        className={cn(
                          "no-scrollbar flex flex-col gap-2 overflow-y-auto border-t p-4 md:p-6",
                          isWide
                            ? "absolute inset-y-0 right-0 w-56 max-h-none border-l border-t-0"
                            : "w-full max-h-72",
                        )}
                      >
                        <div className="grid gap-2">
                          {slotsForSelectedDate.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              Keine Termine an diesem Tag.
                            </div>
                          ) : (
                            slotsForSelectedDate.map((slot) => {
                              const d = new Date(slot.startTime);
                              const hh = d
                                .getUTCHours()
                                .toString()
                                .padStart(2, "0");
                              const mm = d
                                .getUTCMinutes()
                                .toString()
                                .padStart(2, "0");
                              const time = `${hh}:${mm}`;
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
                  </div>
                )}
              </ContainerAwareContent>
              <CardFooter className="flex flex-col gap-3 border-t px-4 !py-4 md:px-6 md:!py-5 md:flex-row">
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
                  size="sm"
                >
                  Termin buchen
                </Button>
              </CardFooter>
            </Card>
          </>
        )}

        {/* Show loading state when location is selected but slots are still loading */}
        {selectedLocationId && !slotsResult && (
          <Card>
            <CardContent className="py-6">
              <div className="text-center text-muted-foreground">
                Termine werden geladen...
              </div>
            </CardContent>
          </Card>
        )}

        {/* Initial locations loading state */}
        {isLocationsLoading && (
          <Card>
            <CardContent className="py-6">
              <div className="text-center text-muted-foreground">
                Standorte werden geladen...
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Internal helper to choose layout based on the actual card width (works inside phone frames)
function ContainerAwareContent({
  children,
}: {
  children: (args: {
    containerRef: RefObject<HTMLDivElement | null>;
    isWide: boolean;
  }) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => {
      const width = el.clientWidth;
      setIsWide(width >= 768);
    };
    update();
    const ro = new ResizeObserver(() => {
      update();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return <>{children({ containerRef: ref, isWide })}</>;
}
