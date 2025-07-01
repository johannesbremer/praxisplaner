import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import { api } from "@/convex/_generated/api";

export const Route = createFileRoute("/sim")({
  component: DebugView,
});

interface SlotDetails {
  startTime: string;
  practitionerId: Id<"practitioners">;
  status: "AVAILABLE" | "BLOCKED";
  blockedByRuleId?: Id<"rules">;
  practitionerName: string;
  duration: number;
  locationId?: Id<"locations">;
}

export default function DebugView() {
  const [simulatedContext, setSimulatedContext] = useState({
    appointmentType: "Erstberatung",
    patient: { isNew: true },
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<Id<"ruleSets"> | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<SlotDetails | null>(null);

  // Mock practice ID - in a real app this would come from auth/context
  const mockPracticeId = "practice123" as Id<"practices">;

  // Calculate date range (selected date only for now)
  const dateRange = {
    start: selectedDate.toISOString(),
    end: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };

  // Fetch available rule sets for the practice
  const ruleSetsQuery = useQuery(api.ruleSets.getRuleSets, { practiceId: mockPracticeId });

  const resetSimulation = () => {
    setSimulatedContext({
      appointmentType: "Erstberatung",
      patient: { isNew: true },
    });
    setSelectedDate(new Date());
    setSelectedRuleSetId(undefined);
    setSelectedSlot(null);
  };

  const handleSlotClick = (slot: SlotDetails) => {
    setSelectedSlot(slot);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Debug View - Appointement Workstation
        </h1>
        <p className="text-muted-foreground">
          In-Browser-Simulation der Patientenbuchung mit interaktiven Kontrollen
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Panel - Controls */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Simulation Controls</CardTitle>
              <CardDescription>
                Konfigurieren Sie den Kontext für die Simulation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rule-set">Regelset</Label>
                <Select
                  onValueChange={(value) => {
                    setSelectedRuleSetId(value === "active" ? undefined : value as Id<"ruleSets">);
                  }}
                  value={selectedRuleSetId || "active"}
                >
                  <SelectTrigger id="rule-set">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktives Regelset</SelectItem>
                    {ruleSetsQuery?.map((ruleSet: { _id: string; version: number; description: string; isActive: boolean }) => (
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
                <Label htmlFor="appointment-type">Terminart</Label>
                <Select
                  onValueChange={(value) => {
                    setSimulatedContext({
                      ...simulatedContext,
                      appointmentType: value,
                    });
                  }}
                  value={simulatedContext.appointmentType}
                >
                  <SelectTrigger id="appointment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Erstberatung">Erstberatung</SelectItem>
                    <SelectItem value="Nachuntersuchung">
                      Nachuntersuchung
                    </SelectItem>
                    <SelectItem value="Grippeimpfung">
                      Grippeimpfung
                    </SelectItem>
                    <SelectItem value="Vorsorge">
                      Vorsorgeuntersuchung
                    </SelectItem>
                    <SelectItem value="Akutsprechstunde">
                      Akutsprechstunde
                    </SelectItem>
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

              <Button onClick={resetSimulation} variant="outline" className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                Zurücksetzen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Simulationsdetails</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Patiententyp:</span>
                <Badge
                  variant={
                    simulatedContext.patient.isNew ? "default" : "secondary"
                  }
                >
                  {simulatedContext.patient.isNew ? "Neu" : "Bestand"}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Terminart:</span>
                <span className="font-medium">{simulatedContext.appointmentType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Datum:</span>
                <span className="font-medium">
                  {format(selectedDate, "dd.MM.yyyy", { locale: de })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Regelset:</span>
                <span className="font-medium">
                  {selectedRuleSetId ? "Draft" : "Aktiv"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center Panel - Patient Booking Flow Simulation */}
        <div className="lg:col-span-6">
          <PatientBookingFlow
            practiceId={mockPracticeId}
            ruleSetId={selectedRuleSetId}
            simulatedContext={simulatedContext}
            dateRange={dateRange}
            onSlotClick={handleSlotClick}
          />
        </div>

        {/* Right Panel - Slot Inspector */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Slot Inspector</CardTitle>
              <CardDescription>
                Klicken Sie auf einen Termin für Details
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedSlot ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Zeit</Label>
                    <div className="text-lg font-semibold">
                      {format(new Date(selectedSlot.startTime), "HH:mm", { locale: de })}
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
                        variant={selectedSlot.status === "AVAILABLE" ? "default" : "destructive"}
                      >
                        {selectedSlot.status === "AVAILABLE" ? "Verfügbar" : "Blockiert"}
                      </Badge>
                    </div>
                  </div>
                  
                  {selectedSlot.blockedByRuleId && (
                    <div>
                      <Label className="text-sm font-medium">Blockiert durch Regel</Label>
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
        </div>
      </div>
    </div>
  );
}
