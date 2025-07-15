import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";

interface PatientViewProps {
  dateRange: { end: string; start: string };
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  showDebugInfo?: boolean;
  simulatedContext: {
    appointmentType: string;
    patient: { isNew: boolean };
  };
}

export function PatientView({
  dateRange,
  onSlotClick,
  practiceId,
  ruleSetId,
  showDebugInfo = false,
  simulatedContext,
}: PatientViewProps) {
  const slotsResult = useQuery(
    api.scheduling.getAvailableSlots,
    ruleSetId
      ? {
          dateRange,
          practiceId,
          ruleSetId,
          simulatedContext,
        }
      : {
          dateRange,
          practiceId,
          simulatedContext,
        },
  );

  if (!slotsResult) {
    return (
      <div className="p-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">Verfügbare Termine</h2>
          <div className="text-muted-foreground">Termine werden geladen...</div>
        </div>
      </div>
    );
  }

  const availableSlots = slotsResult.slots.filter(
    (slot) => slot.status === "AVAILABLE",
  );
  const blockedSlots = slotsResult.slots.filter(
    (slot) => slot.status === "BLOCKED",
  );

  // Group slots by date
  const slotsByDate = new Map<string, typeof slotsResult.slots>();
  for (const slot of slotsResult.slots) {
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
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
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span>Verfügbar ({availableSlots.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span>Blockiert ({blockedSlots.length})</span>
            </div>
          </div>
        </div>

        {sortedDates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Keine Termine im ausgewählten Zeitraum gefunden.
          </div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map((dateString) => {
              const date = new Date(dateString);
              const daySlots = slotsByDate.get(dateString);

              if (!daySlots) {
                return null;
              }

              return (
                <div key={dateString}>
                  <h3 className="font-semibold mb-3 text-sm">
                    {format(date, "EEEE, d. MMMM", { locale: de })}
                  </h3>
                  <div className="grid gap-2 grid-cols-2">
                    {daySlots
                      .sort(
                        (a, b) =>
                          new Date(a.startTime).getTime() -
                          new Date(b.startTime).getTime(),
                      )
                      .map((slot) => {
                        const slotTime = new Date(slot.startTime);
                        // Always display time as German time by extracting UTC components
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
                            className={`p-2 border rounded-lg cursor-pointer transition-colors text-sm ${
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
                                  ? "Frei"
                                  : "Blockiert"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {slot.practitionerName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {slot.duration} Min.
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showDebugInfo && slotsResult.log.length > 0 && (
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
