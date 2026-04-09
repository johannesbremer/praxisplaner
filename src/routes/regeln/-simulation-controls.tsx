import { RefreshCw, Trash2 } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { SchedulingSimulatedContext } from "../../types";

import { AppointmentTypeSelector } from "../../components/appointment-type-selector";
import { LocationSelector } from "../../components/location-selector";

type SimulatedContext = SchedulingSimulatedContext;

function SimulationControls({
  isClearingSimulatedAppointments,
  isResettingSimulation,
  locationsListQuery,
  onClearSimulatedAppointments,
  onDateChange,
  onLocationChange,
  onResetSimulation,
  onSimulatedContextChange,
  onSimulationRuleSetChange,
  ruleSetsQuery,
  selectedDate,
  selectedLocationId,
  simulatedContext,
  simulationRuleSetId,
}: {
  isClearingSimulatedAppointments: boolean;
  isResettingSimulation: boolean;
  locationsListQuery:
    | undefined
    | {
        _id: Id<"locations">;
        name: string;
      }[];
  onClearSimulatedAppointments: () => Promise<void>;
  onDateChange: (date: Date) => void;
  onLocationChange: (locationId: Id<"locations"> | undefined) => void;
  onResetSimulation: () => Promise<void>;
  onSimulatedContextChange: (context: SimulatedContext) => void;
  onSimulationRuleSetChange: (ruleSetId: Id<"ruleSets"> | undefined) => void;
  ruleSetsQuery:
    | undefined
    | {
        _id: Id<"ruleSets">;
        description: string;
        isActive: boolean;
        version: number;
      }[];
  selectedDate: Date;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext: SimulatedContext;
  simulationRuleSetId: Id<"ruleSets"> | undefined;
}) {
  // Compute once to avoid duplicate finds
  const unsavedRuleSet = ruleSetsQuery?.find(
    (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulation Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rule-set">Regelset</Label>
          <Select
            onValueChange={(value) => {
              onSimulationRuleSetChange(
                value === "active" ? undefined : (value as Id<"ruleSets">),
              );
            }}
            value={simulationRuleSetId || "active"}
          >
            <SelectTrigger id="rule-set">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktives Regelset</SelectItem>
              {/* Show unsaved rule set if it exists */}
              {unsavedRuleSet && (
                <SelectItem value={unsavedRuleSet._id}>
                  Ungespeicherte Änderungen
                </SelectItem>
              )}
              {ruleSetsQuery
                ?.filter((rs) => rs.description !== "Ungespeicherte Änderungen")
                .map((ruleSet) => (
                  <SelectItem key={ruleSet._id} value={ruleSet._id}>
                    v{ruleSet.version} - {ruleSet.description}
                    {ruleSet.isActive && " (aktiv)"}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {simulationRuleSetId && (
          <AppointmentTypeSelector
            onTypeDeselect={() => {
              const updated = { ...simulatedContext };
              delete updated.appointmentTypeId;
              onSimulatedContextChange(updated);
            }}
            onTypeSelect={(type) => {
              onSimulatedContextChange({
                ...simulatedContext,
                appointmentTypeId: type,
              });
            }}
            ruleSetId={simulationRuleSetId}
            selectedType={simulatedContext.appointmentTypeId}
          />
        )}

        <div className="space-y-2">
          <Label>Standort auswählen</Label>
          {locationsListQuery && locationsListQuery.length > 0 ? (
            <LocationSelector
              locations={locationsListQuery}
              onLocationSelect={(locationId) => {
                onLocationChange(locationId);
              }}
              selectedLocationId={selectedLocationId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine Standorte verfügbar
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="patient-type">Patiententyp</Label>
          <Select
            onValueChange={(value) => {
              onSimulatedContextChange({
                ...simulatedContext,
                patient: { isNew: value === "new" },
              });
            }}
            value={simulatedContext.patient.isNew ? "new" : "existing"}
          >
            <SelectTrigger id="patient-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Neuer Patient</SelectItem>
              <SelectItem value="existing">Bestandspatient</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Datum auswählen</Label>
          <Calendar
            className="rounded-md border"
            mode="single"
            onSelect={(date) => {
              if (date) {
                onDateChange(date);
              }
            }}
            selected={selectedDate}
          />
        </div>

        <Button
          className="w-full"
          disabled={isResettingSimulation}
          onClick={() => {
            void onResetSimulation();
          }}
          variant="outline"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isResettingSimulation ? "animate-spin" : ""}`}
          />
          Zurücksetzen
        </Button>

        <Button
          className="w-full"
          disabled={isClearingSimulatedAppointments}
          onClick={() => {
            void onClearSimulatedAppointments();
          }}
          variant="destructive"
        >
          <Trash2
            className={`h-4 w-4 mr-2 ${
              isClearingSimulatedAppointments ? "animate-spin" : ""
            }`}
          />
          Alle Simulationstermine löschen
        </Button>
      </CardContent>
    </Card>
  );
}

export { SimulationControls };
