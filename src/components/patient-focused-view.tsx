import { useQuery } from "convex/react";
import { useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import type { LocalAppointment } from "../utils/local-appointments";

import { AppointmentTypeSelector } from "./appointment-type-selector";
import { LocationSelector } from "./location-selector";
import { PatientCalendar } from "./patient-calendar";

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
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  simulatedContext: {
    appointmentType: string;
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  };
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

  // Fetch available locations
  const locationsQuery = useQuery(api.locations.getLocations, { practiceId });

  // Use the original dateRange directly for slots query
  const calendarDateRange = dateRange;

  // Create the simulated context with selected location
  const effectiveSimulatedContext = {
    ...simulatedContext,
    locationId: selectedLocationId,
  };

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

  if (!locationsQuery) {
    return (
      <div className="p-4 pt-12">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">Terminbuchung</h2>
          <div className="text-muted-foreground">
            Standorte werden geladen...
          </div>
        </div>
      </div>
    );
  }

  // Process slots data only when we have it
  const availableSlots =
    slotsResult?.slots.filter((slot) => slot.status === "AVAILABLE") ?? [];

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
          locations={locationsQuery}
          onLocationSelect={(locationId: Id<"locations">) => {
            setSelectedLocationId(locationId);
            // Update simulated context with the selected location
            onUpdateSimulatedContext?.({
              ...simulatedContext,
              locationId,
            });
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

        {/* Show calendar only when location is selected and slots are loaded */}
        {selectedLocationId && slotsResult && (
          <>
            {/* Patient Calendar with Date and Time Selection */}
            <PatientCalendar
              availableSlots={availableSlots}
              {...(onSlotClick && { onSlotClick })}
            />

            {/* Book Appointment Button */}
            <div className="pb-4">
              <Button className="w-full h-12" size="lg">
                Termin buchen
              </Button>
            </div>
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
      </div>
    </div>
  );
}
