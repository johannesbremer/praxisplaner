import { useQuery } from "convex/react";
import { de } from "date-fns/locale";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { DebugView } from "./debug-view";
import { MedicalStaffDisplay } from "./medical-staff-display";
import { PatientBookingFlow } from "./patient-booking-flow";

interface SimulationPanelProps {
  practiceId: Id<"practices">;
  ruleSetsQuery:
    | undefined
    | {
        _id: Id<"ruleSets">;
        description: string;
        isActive: boolean;
        version: number;
      }[];
}

export function SimulationPanel({
  practiceId,
  ruleSetsQuery,
}: SimulationPanelProps) {
  // Selected rule set for simulation
  const [simulationRuleSetId, setSimulationRuleSetId] =
    useState<SchedulingRuleSetId>();

  // Fetch appointment types for the selected rule set
  const appointmentTypesQuery = useQuery(
    api.entities.getAppointmentTypes,
    simulationRuleSetId ? { ruleSetId: simulationRuleSetId } : "skip",
  );

  // Get the first appointment type ID or undefined
  const firstAppointmentTypeId = appointmentTypesQuery?.[0]?._id;

  // Simulation state - initialize without appointment type
  const [simulatedContext, setSimulatedContext] = useState<{
    appointmentType?: Id<"appointmentTypes">;
    locationId?: Id<"locations">;
    patient: { isNew: boolean };
  }>({
    patient: { isNew: true },
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<null | SchedulingSlot>(null);

  // Use the first available appointment type if none is selected
  const effectiveSimulatedContext: SchedulingSimulatedContext | undefined =
    (() => {
      const appointmentType =
        simulatedContext.appointmentType || firstAppointmentTypeId;
      if (!appointmentType) {
        return;
      }
      return {
        ...simulatedContext,
        appointmentType,
      } as SchedulingSimulatedContext;
    })();

  // Create date range representing a full calendar day without timezone issues
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  const dateRange: SchedulingDateRange = {
    end: endOfDay.toISOString(),
    start: startOfDay.toISOString(),
  };

  const resetSimulation = () => {
    setSimulatedContext({
      patient: { isNew: true },
    });
    setSelectedDate(new Date());
    setSimulationRuleSetId(undefined);
    setSelectedSlot(null);
  };

  const handleSlotClick = (slot: SchedulingSlot) => {
    setSelectedSlot(slot);
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4 mb-6">
        <h2 className="text-xl font-semibold">Simulation</h2>
        <p className="text-muted-foreground">
          Testen Sie Regelsets in verschiedenen Ansichten
        </p>
      </div>

      {/* Simulation Controls - Always visible */}
      <Card>
        <CardHeader>
          <CardTitle>Simulation Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-set">Regelset</Label>
            <Select
              onValueChange={(value) => {
                setSimulationRuleSetId(
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
                {ruleSetsQuery?.map((ruleSet) => (
                  <SelectItem key={ruleSet._id} value={ruleSet._id}>
                    v{ruleSet.version} - {ruleSet.description}
                    {ruleSet.isActive && " (aktiv)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="patient-type">Patiententyp</Label>
            <Select
              onValueChange={(value) => {
                setSimulatedContext({
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
              locale={de}
              mode="single"
              onSelect={(date) => {
                if (date) {
                  setSelectedDate(date);
                }
              }}
              selected={selectedDate}
            />
          </div>

          <Button
            className="w-full"
            onClick={resetSimulation}
            variant="outline"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Zurücksetzen
          </Button>
        </CardContent>
      </Card>

      {/* Tabbed Views */}
      <Tabs className="space-y-6" defaultValue="patient">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="patient">Patientensicht</TabsTrigger>
          <TabsTrigger value="staff">Praxismitarbeiter</TabsTrigger>
          <TabsTrigger value="debug">Debug Views</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-6" value="patient">
          {effectiveSimulatedContext ? (
            <div className="flex justify-center">
              <PatientBookingFlow
                dateRange={dateRange}
                onSlotClick={handleSlotClick}
                onUpdateSimulatedContext={(ctx) => {
                  setSimulatedContext({
                    ...simulatedContext,
                    ...ctx,
                  });
                }}
                practiceId={practiceId}
                ruleSetId={simulationRuleSetId}
                simulatedContext={effectiveSimulatedContext}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  Bitte wählen Sie ein Regelset aus, um die Simulation zu
                  starten.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent className="space-y-6" value="staff">
          {effectiveSimulatedContext ? (
            <div className="flex justify-center">
              <MedicalStaffDisplay
                dateRange={dateRange}
                onSlotClick={handleSlotClick}
                onUpdateSimulatedContext={(ctx) => {
                  setSimulatedContext({
                    ...simulatedContext,
                    ...ctx,
                  });
                }}
                practiceId={practiceId}
                ruleSetId={simulationRuleSetId}
                simulatedContext={effectiveSimulatedContext}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  Bitte wählen Sie ein Regelset aus, um die Simulation zu
                  starten.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent className="space-y-6" value="debug">
          {effectiveSimulatedContext ? (
            <>
              {/* Debug View */}
              <DebugView
                dateRange={dateRange}
                onSlotClick={handleSlotClick}
                onUpdateSimulatedContext={(ctx) => {
                  setSimulatedContext({
                    ...simulatedContext,
                    ...ctx,
                  });
                }}
                practiceId={practiceId}
                ruleSetId={simulationRuleSetId}
                simulatedContext={effectiveSimulatedContext}
              />
            </>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  Bitte wählen Sie ein Regelset aus, um die Simulation zu
                  starten.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Slot Inspector */}
          <Card>
            <CardHeader>
              <CardTitle>Slot Inspector</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedSlot ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Zeit</Label>
                    <div className="text-lg font-semibold">
                      {/* Always display time as German time by extracting UTC components */}
                      {(() => {
                        const date = new Date(selectedSlot.startTime);
                        const hours = date
                          .getUTCHours()
                          .toString()
                          .padStart(2, "0");
                        const minutes = date
                          .getUTCMinutes()
                          .toString()
                          .padStart(2, "0");
                        return `${hours}:${minutes}`;
                      })()}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Arzt</Label>
                    <div>{selectedSlot.practitionerName}</div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Dauer</Label>
                    <div>{selectedSlot.duration} Minuten</div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Status</Label>
                    <div>
                      <Badge
                        variant={
                          selectedSlot.status === "AVAILABLE"
                            ? "default"
                            : "destructive"
                        }
                      >
                        {selectedSlot.status === "AVAILABLE"
                          ? "Verfügbar"
                          : "Blockiert"}
                      </Badge>
                    </div>
                  </div>

                  {selectedSlot.blockedByRuleId && (
                    <div>
                      <Label className="text-sm font-medium">
                        Blockiert durch Regel
                      </Label>
                      <div className="text-sm text-muted-foreground">
                        ID: {selectedSlot.blockedByRuleId}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Wählen Sie einen Termin aus, um Details anzuzeigen.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
