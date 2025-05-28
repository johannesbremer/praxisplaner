import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Play, RefreshCw, Info } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { PatientContext, AvailableSlot } from "@/lib/types";
import { RulesEngine } from "@/lib/rules-engine";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/sim")({
  component: DebugView,
});

export default function DebugView() {
  const [patientContext, setPatientContext] = useState<PatientContext>({
    isNewPatient: true,
    lastVisit: null,
    assignedDoctor: null,
    medicalHistory: [],
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [appointmentType, setAppointmentType] =
    useState<string>("Erstberatung");
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [appliedRules, setAppliedRules] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const rulesEngine = new RulesEngine();

  const runSimulation = async () => {
    setIsLoading(true);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = rulesEngine.generateAvailableSlots(
      selectedDate,
      appointmentType,
      patientContext,
    );

    setAvailableSlots(result.slots);
    setAppliedRules(result.appliedRules);
    setIsLoading(false);
  };

  const resetSimulation = () => {
    setPatientContext({
      isNewPatient: true,
      lastVisit: null,
      assignedDoctor: null,
      medicalHistory: [],
    });
    setSelectedDate(new Date());
    setAppointmentType("Erstberatung");
    setAvailableSlots([]);
    setAppliedRules([]);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Debug View - Regelsimulation
        </h1>
        <p className="text-muted-foreground">
          Testen Sie Ihre Regelkonfiguration mit verschiedenen
          Patientenszenarien
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Patientenkontext simulieren</CardTitle>
              <CardDescription>
                Definieren Sie die Eigenschaften des simulierten Patienten
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="patient-type">Patiententyp</Label>
                  <Select
                    value={patientContext.isNewPatient ? "new" : "existing"}
                    onValueChange={(value) =>
                      setPatientContext({
                        ...patientContext,
                        isNewPatient: value === "new",
                      })
                    }
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
                    value={appointmentType}
                    onValueChange={setAppointmentType}
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
                  <Label htmlFor="assigned-doctor">Zugewiesener Arzt</Label>
                  <Select
                    value={patientContext.assignedDoctor || "none"}
                    onValueChange={(value) =>
                      setPatientContext({
                        ...patientContext,
                        assignedDoctor: value === "none" ? null : value,
                      })
                    }
                  >
                    <SelectTrigger id="assigned-doctor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Kein zugewiesener Arzt
                      </SelectItem>
                      <SelectItem value="dr-mueller">Dr. Müller</SelectItem>
                      <SelectItem value="dr-schmidt">Dr. Schmidt</SelectItem>
                      <SelectItem value="dr-weber">Dr. Weber</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last-visit">Letzter Besuch</Label>
                  <Select
                    value={patientContext.lastVisit || "never"}
                    onValueChange={(value) =>
                      setPatientContext({
                        ...patientContext,
                        lastVisit: value === "never" ? null : value,
                      })
                    }
                  >
                    <SelectTrigger id="last-visit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Noch nie</SelectItem>
                      <SelectItem value="week">Vor einer Woche</SelectItem>
                      <SelectItem value="month">Vor einem Monat</SelectItem>
                      <SelectItem value="year">Vor einem Jahr</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Datum auswählen</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  locale={de}
                  className="rounded-md border"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={runSimulation}
                  disabled={isLoading}
                  className="flex-1 sm:flex-none"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {isLoading ? "Simulation läuft..." : "Simulation starten"}
                </Button>
                <Button onClick={resetSimulation} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Zurücksetzen
                </Button>
              </div>
            </CardContent>
          </Card>

          {availableSlots.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Verfügbare Termine</CardTitle>
                <CardDescription>
                  Generiert für{" "}
                  {format(selectedDate, "EEEE, d. MMMM yyyy", { locale: de })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {availableSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="p-3 border rounded-lg hover:bg-accent transition-colors"
                    >
                      <div className="font-medium">{slot.time}</div>
                      <div className="text-sm text-muted-foreground">
                        {slot.doctor}
                      </div>
                      {slot.notes && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {slot.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Angewendete Regeln</CardTitle>
              <CardDescription>
                Diese Regeln haben die Verfügbarkeit beeinflusst
              </CardDescription>
            </CardHeader>
            <CardContent>
              {appliedRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Starten Sie eine Simulation, um die angewendeten Regeln zu
                  sehen.
                </p>
              ) : (
                <div className="space-y-2">
                  {appliedRules.map((rule, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="text-sm">{rule}</div>
                    </div>
                  ))}
                </div>
              )}
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
                    patientContext.isNewPatient ? "default" : "secondary"
                  }
                >
                  {patientContext.isNewPatient ? "Neu" : "Bestand"}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Terminart:</span>
                <span className="font-medium">{appointmentType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Datum:</span>
                <span className="font-medium">
                  {format(selectedDate, "dd.MM.yyyy", { locale: de })}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
