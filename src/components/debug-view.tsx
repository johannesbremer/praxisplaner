import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { LocationSelector } from "./location-selector";

interface DebugViewProps {
  dateRange: SchedulingDateRange;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
}

export function DebugView({
  dateRange,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: DebugViewProps) {
  // Get locations for this practice
  const locationsQuery = useQuery(
    api.entities.getLocations,
    ruleSetId ? { ruleSetId } : "skip",
  );

  // Local state for selected location
  const [selectedLocationId, setSelectedLocationId] = useState<
    Id<"locations"> | undefined
  >(simulatedContext.locationId);

  const sanitizedSimulatedContext: SchedulingSimulatedContext = (() => {
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

  // First query: Get available dates (lightweight)
  const availableDatesResult = useQuery(
    api.scheduling.getAvailableDates,
    sanitizedSimulatedContext.appointmentTypeId &&
      sanitizedSimulatedContext.appointmentTypeId !==
        ("" as Id<"appointmentTypes">)
      ? {
          dateRange,
          practiceId,
          simulatedContext: sanitizedSimulatedContext,
        }
      : "skip",
  );

  // Track which date user wants to debug
  const [selectedDebugDate, setSelectedDebugDate] = useState<null | string>(
    null,
  );

  // Auto-select first available date and reset when context changes
  const firstAvailableDate = availableDatesResult?.dates[0];
  const contextKey = JSON.stringify(sanitizedSimulatedContext);

  // Reset selected date when context changes
  const [lastContextKey, setLastContextKey] = useState(contextKey);
  if (lastContextKey !== contextKey) {
    setLastContextKey(contextKey);
    setSelectedDebugDate(null);
  }

  if (!selectedDebugDate && firstAvailableDate) {
    setSelectedDebugDate(firstAvailableDate);
  }

  // Second query: Get slots for the selected date only
  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    selectedDebugDate &&
      ruleSetId &&
      sanitizedSimulatedContext.appointmentTypeId &&
      sanitizedSimulatedContext.appointmentTypeId !==
        ("" as Id<"appointmentTypes">)
      ? {
          date: selectedDebugDate,
          practiceId,
          ruleSetId,
          simulatedContext: sanitizedSimulatedContext,
        }
      : "skip",
  );

  if (!availableDatesResult) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Debug: Slot Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">
            Loading available dates...
          </div>
        </CardContent>
      </Card>
    );
  }

  const availableSlots =
    slotsResult?.slots.filter(
      (slot): slot is SchedulingSlot => slot.status === "AVAILABLE",
    ) ?? [];
  const blockedSlots =
    slotsResult?.slots.filter(
      (slot): slot is SchedulingSlot => slot.status === "BLOCKED",
    ) ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Debug: Slot Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Date to Debug:</label>
            <select
              className="w-full p-2 border rounded"
              onChange={(e) => {
                setSelectedDebugDate(e.target.value);
              }}
              value={selectedDebugDate ?? ""}
            >
              {availableDatesResult.dates.map((dateStr) => {
                const date = new Date(dateStr + "T00:00:00");
                return (
                  <option key={dateStr} value={dateStr}>
                    {format(date, "EEEE, d. MMMM yyyy", { locale: de })}
                  </option>
                );
              })}
            </select>
          </div>

          {slotsResult ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span>Available ({availableSlots.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span>Blocked ({blockedSlots.length})</span>
                </div>
              </div>

              {slotsResult.slots.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No slots found for this date.
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  <div>
                    <h4 className="font-medium mb-2 text-sm">
                      {selectedDebugDate &&
                        format(
                          new Date(selectedDebugDate + "T00:00:00"),
                          "EEEE, d. MMMM",
                          { locale: de },
                        )}
                    </h4>
                    <div className="grid gap-1 grid-cols-3">
                      {slotsResult.slots
                        .toSorted(
                          (a, b) =>
                            new Date(a.startTime).getTime() -
                            new Date(b.startTime).getTime(),
                        )
                        .map((slot) => {
                          const slotTime = new Date(slot.startTime);
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
                            <div
                              className={`p-2 border rounded text-xs cursor-pointer transition-colors ${
                                slot.status === "AVAILABLE"
                                  ? "hover:bg-green-50 border-green-200 bg-green-25"
                                  : "hover:bg-red-50 border-red-200 bg-red-25 opacity-75"
                              }`}
                              key={`${slot.practitionerId}-${slot.startTime}`}
                              onClick={() => onSlotClick?.(slot)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="font-medium">{timeString}</div>
                                <Badge
                                  className="text-xs"
                                  variant={
                                    slot.status === "AVAILABLE"
                                      ? "default"
                                      : "destructive"
                                  }
                                >
                                  {slot.status === "AVAILABLE"
                                    ? "Free"
                                    : "Block"}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {slot.practitionerName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {slot.duration}m
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">
              Loading slots for selected date...
            </div>
          )}

          {slotsResult && slotsResult.log.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2 text-sm">
                Rule Processing Log
              </h4>
              <ScrollArea className="h-40 rounded-md border bg-muted p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {slotsResult.log.join("\n")}
                </pre>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Location Selection Card */}
      {locationsQuery && locationsQuery.length > 0 && (
        <LocationSelector
          locations={locationsQuery}
          onLocationSelect={(locationId: Id<"locations">) => {
            setSelectedLocationId(locationId);
            const updatedContext: SchedulingSimulatedContext = {
              ...simulatedContext,
              locationId,
            };
            onUpdateSimulatedContext?.(updatedContext);
          }}
          selectedLocationId={selectedLocationId}
        />
      )}
    </>
  );
}
