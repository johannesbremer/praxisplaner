import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Badge } from "~/components/ui/badge";

import { RulesEngine } from "~/lib/rules-engine";
import { generateSamplePatientContexts, generateSampleAppointmentTypes, generateDateRange } from "~/lib/convex-client";
import type { PatientContext, Rule } from "~/lib/types";

export const Route = createFileRoute("/sim")({
  component: DebugView,
});

// Sample rules for demonstration
const sampleRules: Rule[] = [
  {
    id: "1",
    name: "Neue Patienten - Ersttermin",
    type: "CONDITIONAL_AVAILABILITY",
    priority: 1,
    active: true,
    conditions: {
      patientType: "new",
      appointmentType: "Erstberatung",
    },
    actions: {
      requireExtraTime: true,
      extraMinutes: 15,
      limitPerDay: 3,
    },
  },
  {
    id: "2",
    name: "Grippeimpfung - Saisonale Verfügbarkeit",
    type: "SEASONAL_AVAILABILITY",
    priority: 2,
    active: true,
    conditions: {
      appointmentType: "Grippeimpfung",
      dateRange: {
        start: "2024-10-01",
        end: "2024-12-31",
      },
    },
    actions: {
      enableBatchAppointments: true,
      batchSize: 4,
      batchDuration: 60,
    },
  },
  {
    id: "3",
    name: "Akuttermine - Begrenzte Slots",
    type: "TIME_BLOCK",
    priority: 3,
    active: true,
    conditions: {
      appointmentType: "Akutsprechstunde",
    },
    actions: {
      limitPerDay: 2,
      blockTimeSlots: ["12:00", "12:30"],
    },
  },
];

export default function DebugView() {
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<string>("Erstberatung");
  const [selectedPatientContext, setSelectedPatientContext] = useState<PatientContext>(
    generateSamplePatientContexts()[0]
  );
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [simulationResults, setSimulationResults] = useState<any>(null);
  const [engine] = useState(() => new RulesEngine(sampleRules));

  const patientContexts = generateSamplePatientContexts();
  const appointmentTypes = generateSampleAppointmentTypes();

  const runSimulation = () => {
    // Generate base slots for the selected date
    const date = new Date(selectedDate);
    const baseSlots = engine.generateBaseSlots(date);

    // Apply rules and get results
    const results = engine.generateAvailableSlots(
      baseSlots,
      selectedAppointmentType,
      selectedPatientContext,
      date
    );

    setSimulationResults({
      ...results,
      originalSlotCount: baseSlots.length,
    });
  };

  const formatPatientContext = (context: PatientContext): string => {
    const parts = [];
    parts.push(context.isNewPatient ? "Neuer Patient" : "Bestandspatient");
    if (context.assignedDoctor) parts.push(`Arzt: ${context.assignedDoctor}`);
    if (context.lastVisit) parts.push(`Letzter Besuch: ${context.lastVisit}`);
    if (context.medicalHistory.length > 0) parts.push(`Historie: ${context.medicalHistory.join(", ")}`);
    return parts.join(" | ");
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Debug View - Regelmotor Simulation</h1>
        <p className="text-muted-foreground">
          Testen Sie verschiedene Patientenkonstellationen und sehen Sie, wie die Regeln angewendet werden.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Simulation Controls */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Simulation Parameter</CardTitle>
              <CardDescription>
                Konfigurieren Sie die Testparameter für die Regelanwendung
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="appointmentType">Terminart</Label>
                <Select value={selectedAppointmentType} onValueChange={setSelectedAppointmentType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Terminart auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointmentTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="patientContext">Patientenkontext</Label>
                <Select 
                  value={patientContexts.indexOf(selectedPatientContext).toString()}
                  onValueChange={(value) => setSelectedPatientContext(patientContexts[parseInt(value)])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Patientenkontext auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {patientContexts.map((context, index) => (
                      <SelectItem key={index} value={index.toString()}>
                        {formatPatientContext(context)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="date">Datum</Label>
                <input
                  type="date"
                  id="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>

              <Button onClick={runSimulation} className="w-full">
                Simulation ausführen
              </Button>
            </CardContent>
          </Card>

          {/* Active Rules */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Aktive Regeln</CardTitle>
              <CardDescription>
                Derzeit konfigurierte Regeln im System
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sampleRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium text-sm">{rule.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Priorität: {rule.priority} | Typ: {rule.type}
                      </div>
                    </div>
                    <Badge variant={rule.active ? "default" : "secondary"}>
                      {rule.active ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2">
          {simulationResults ? (
            <div className="space-y-6">
              {/* Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Simulationsergebnisse</CardTitle>
                  <CardDescription>
                    Verfügbare Termine nach Anwendung der Regeln
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {simulationResults.originalSlotCount}
                      </div>
                      <div className="text-sm text-muted-foreground">Ursprüngliche Slots</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {simulationResults.slots.length}
                      </div>
                      <div className="text-sm text-muted-foreground">Verfügbare Slots</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {simulationResults.appliedRules.length}
                      </div>
                      <div className="text-sm text-muted-foreground">Angewendete Regeln</div>
                    </div>
                  </div>

                  {simulationResults.appliedRules.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Angewendete Regeln:</h4>
                      <div className="flex flex-wrap gap-2">
                        {simulationResults.appliedRules.map((ruleName: string, index: number) => (
                          <Badge key={index} variant="outline">
                            {ruleName}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Rule Trace */}
              <Card>
                <CardHeader>
                  <CardTitle>Regel-Trace</CardTitle>
                  <CardDescription>
                    Detaillierte Informationen über die Regelauswertung
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {simulationResults.ruleTrace?.map((trace: any, index: number) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border ${
                          trace.applied 
                            ? "bg-green-50 border-green-200" 
                            : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{trace.ruleName}</span>
                          <Badge variant={trace.applied ? "default" : "secondary"}>
                            {trace.applied ? "Angewendet" : "Nicht angewendet"}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {trace.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Available Slots */}
              <Card>
                <CardHeader>
                  <CardTitle>Verfügbare Termine</CardTitle>
                  <CardDescription>
                    Übersicht der finalen verfügbaren Terminslots
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {simulationResults.slots.slice(0, 12).map((slot: any, index: number) => (
                      <div key={index} className="p-3 border rounded-lg">
                        <div className="font-medium">{slot.time}</div>
                        <div className="text-sm text-muted-foreground">
                          {slot.doctor} • {slot.duration} Min.
                        </div>
                        {slot.notes && (
                          <div className="text-xs text-blue-600 mt-1">
                            {slot.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {simulationResults.slots.length > 12 && (
                    <div className="text-center mt-4 text-muted-foreground">
                      ... und {simulationResults.slots.length - 12} weitere Termine
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-muted-foreground mb-4">
                    Wählen Sie Parameter aus und klicken Sie auf "Simulation ausführen"
                  </div>
                  <Button onClick={runSimulation}>
                    Simulation starten
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}