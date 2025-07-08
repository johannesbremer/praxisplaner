import { useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

interface PatientBookingFlowProps {
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
  simulatedContext: {
    appointmentType: string;
    patient: { isNew: boolean };
  };
}

export function PatientBookingFlow({
  dateRange,
  onSlotClick,
  practiceId,
  ruleSetId,
  simulatedContext,
}: PatientBookingFlowProps) {
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
      <Card>
        <CardHeader>
          <CardTitle>Verfügbare Termine</CardTitle>
          <CardDescription>Termine werden geladen...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="text-muted-foreground">Lade Termine...</div>
          </div>
        </CardContent>
      </Card>
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Terminbuchung - Patientensicht</CardTitle>
          <CardDescription>
            Terminart: {simulatedContext.appointmentType} | Patient:{" "}
            {simulatedContext.patient.isNew
              ? "Neuer Patient"
              : "Bestandspatient"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span>Verfügbar ({availableSlots.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span>Blockiert ({blockedSlots.length})</span>
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
                    <h3 className="font-semibold mb-3">
                      {format(date, "EEEE, d. MMMM yyyy", { locale: de })}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {daySlots
                        .sort(
                          (a, b) =>
                            new Date(a.startTime).getTime() -
                            new Date(b.startTime).getTime(),
                        )
                        .map((slot) => {
                          const slotTime = new Date(slot.startTime);
                          const timeString = format(slotTime, "HH:mm");

                          return (
                            <div
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                slot.status === "AVAILABLE"
                                  ? "hover:bg-green-50 border-green-200 bg-green-25"
                                  : "hover:bg-red-50 border-red-200 bg-red-25 opacity-75"
                              }`}
                              key={`${slot.practitionerId}-${slot.startTime}`}
                              onClick={() => onSlotClick?.(slot)}
                            >
                              <div className="flex items-center justify-between">
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
                              <div className="text-sm text-muted-foreground mt-1">
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
        </CardContent>
      </Card>

      {slotsResult.log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Regelverarbeitung</CardTitle>
            <CardDescription>
              Detaillierte Logs der Terminverfügbarkeit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-sm">
              {slotsResult.log.map((logEntry, index) => (
                <div className="text-muted-foreground" key={index}>
                  {logEntry}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
