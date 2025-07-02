// src/routes/regeln.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { GitBranch, RefreshCw, Save } from "lucide-react";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { useErrorTracking } from "../utils/error-tracking";

import BaseScheduleManagement from "../components/base-schedule-management";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import RuleCreationForm from "../components/rule-creation-form";

export const Route = createFileRoute("/regeln")({
  component: LogicView,
});

interface FlatRule {
  _creationTime: number;
  _id: Id<"rules">;
  description: string;
  priority: number;
  ruleSetId: Id<"ruleSets">;
  ruleType: "BLOCK" | "LIMIT_CONCURRENT";

  // Block rule parameters
  block_appointmentTypes?: string[];
  block_dateRangeEnd?: string;
  block_dateRangeStart?: string;
  block_daysOfWeek?: number[];
  block_exceptForPractitionerTags?: string[];
  block_timeRangeEnd?: string;
  block_timeRangeStart?: string;

  // Limit rule parameters
  limit_appointmentTypes?: string[];
  limit_atLocation?: Id<"locations">;
  limit_count?: number;
  limit_perPractitioner?: boolean;
}

interface SlotDetails {
  blockedByRuleId?: Id<"rules"> | undefined;
  duration: number;
  locationId?: Id<"locations"> | undefined;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

const formatRuleDescription = (rule: FlatRule): string => {
  if (rule.ruleType === "BLOCK") {
    const parts: string[] = [];
    if (rule.block_appointmentTypes?.length) {
      parts.push(`Terminarten: ${rule.block_appointmentTypes.join(", ")}`);
    }
    if (rule.block_daysOfWeek?.length) {
      const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      const days = rule.block_daysOfWeek.map((d) => dayNames[d]).join(", ");
      parts.push(`Wochentage: ${days}`);
    }
    if (rule.block_timeRangeStart && rule.block_timeRangeEnd) {
      parts.push(
        `Zeit: ${rule.block_timeRangeStart} - ${rule.block_timeRangeEnd}`,
      );
    }
    return parts.length > 0 ? `Blockiert: ${parts.join("; ")}` : "Blockiert";
  } else {
    const parts: string[] = [];
    if (rule.limit_count) {
      parts.push(`Max. ${rule.limit_count} parallel`);
    }
    if (rule.limit_appointmentTypes?.length) {
      parts.push(`für: ${rule.limit_appointmentTypes.join(", ")}`);
    }
    if (rule.limit_perPractitioner) {
      parts.push("pro Arzt");
    }
    return parts.join(" ");
  }
};

export default function LogicView() {
  // Get or initialize a practice for development
  const practicesQuery = useQuery(api.practices.getAllPractices);
  const initializePracticeMutation = useMutation(
    api.practices.initializeDefaultPractice,
  );
  const { captureError } = useErrorTracking();

  const [selectedRuleSetId, setSelectedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isCreatingInitial, setIsCreatingInitial] = useState(false);
  const [isInitializingPractice, setIsInitializingPractice] = useState(false);

  // Simulation state (from sim.tsx)
  const [simulatedContext, setSimulatedContext] = useState({
    appointmentType: "Erstberatung",
    patient: { isNew: true },
  });
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<null | SlotDetails>(null);
  const [simulationRuleSetId, setSimulationRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();

  // Use the first available practice or initialize one
  const currentPractice = practicesQuery?.[0];

  // Initialize practice if none exists
  const handleInitializePractice = useCallback(async () => {
    try {
      setIsInitializingPractice(true);
      await initializePracticeMutation();
    } catch (error) {
      captureError(error, {
        context: "practice_initialization",
      });

      toast.error("Fehler beim Initialisieren der Praxis", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsInitializingPractice(false);
    }
  }, [initializePracticeMutation, captureError]);

  // Simulation helper functions (from sim.tsx)
  const dateRange = {
    end: new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    start: selectedDate.toISOString(),
  };

  const resetSimulation = () => {
    setSimulatedContext({
      appointmentType: "Erstberatung",
      patient: { isNew: true },
    });
    setSelectedDate(new Date());
    setSimulationRuleSetId(undefined);
    setSelectedSlot(null);
  };

  const handleSlotClick = (slot: SlotDetails) => {
    setSelectedSlot(slot);
  };

  // If no practice exists and we haven't tried to initialize, do it automatically
  const shouldInitialize =
    practicesQuery !== undefined && practicesQuery.length === 0;

  React.useEffect(() => {
    if (shouldInitialize && !isInitializingPractice) {
      void handleInitializePractice();
    }
  }, [shouldInitialize, isInitializingPractice, handleInitializePractice]);

  // Fetch rule sets for this practice
  const ruleSetsQuery = useQuery(
    api.rulesets.getRuleSets,
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Fetch rules for the selected rule set
  const rulesQuery = useQuery(
    api.rulesets.getRules,
    selectedRuleSetId ? { ruleSetId: selectedRuleSetId } : "skip",
  );

  // Mutations
  const createDraftMutation = useMutation(api.rulesets.createDraftFromActive);
  const createInitialMutation = useMutation(api.rulesets.createInitialRuleSet);
  const activateRuleSetMutation = useMutation(api.rulesets.activateRuleSet);

  const selectedRuleSet = ruleSetsQuery?.find(
    (rs) => rs._id === selectedRuleSetId,
  );
  const activeRuleSet = ruleSetsQuery?.find((rs) => rs.isActive);

  // Show loading state if practice is being initialized
  if (practicesQuery === undefined || isInitializingPractice) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-8">
          <div className="text-lg text-muted-foreground">
            {isInitializingPractice
              ? "Initialisiere Praxis..."
              : "Lade Daten..."}
          </div>
        </div>
      </div>
    );
  }

  // Show error state if no practice could be loaded
  if (!currentPractice) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-8">
          <div className="text-lg text-destructive">
            Fehler beim Laden der Praxis
          </div>
          <Button
            className="mt-4"
            onClick={() => void handleInitializePractice()}
          >
            Praxis initialisieren
          </Button>
        </div>
      </div>
    );
  }

  const handleCreateDraft = async () => {
    if (!activeRuleSet) {
      toast.error("Kein aktives Regelset gefunden");
      return;
    }

    try {
      setIsCreatingDraft(true);
      const newRuleSetId = await createDraftMutation({
        description: `Draft basierend auf v${activeRuleSet.version}`,
        practiceId: currentPractice._id,
      });

      setSelectedRuleSetId(newRuleSetId);
      toast.success("Draft erstellt", {
        description: "Ein neues Draft-Regelset wurde erstellt.",
      });
    } catch (error) {
      captureError(error, {
        context: "draft_creation",
        activeRuleSetId: activeRuleSet._id,
        practiceId: currentPractice._id,
      });

      toast.error("Fehler beim Erstellen des Drafts", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleActivateRuleSet = async (ruleSetId: Id<"ruleSets">) => {
    try {
      await activateRuleSetMutation({
        practiceId: currentPractice._id,
        ruleSetId,
      });

      toast.success("Regelset aktiviert", {
        description: "Das Regelset wurde erfolgreich aktiviert.",
      });
    } catch (error) {
      captureError(error, {
        context: "ruleset_activation",
        practiceId: currentPractice._id,
        ruleSetId,
      });

      toast.error("Fehler beim Aktivieren", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleCreateInitial = async () => {
    try {
      setIsCreatingInitial(true);
      const newRuleSetId = await createInitialMutation({
        description: "Erstes Regelset",
        practiceId: currentPractice._id,
      });

      setSelectedRuleSetId(newRuleSetId);
      toast.success("Erstes Regelset erstellt", {
        description:
          "Das erste Regelset wurde erfolgreich erstellt und aktiviert.",
      });
    } catch (error) {
      captureError(error, {
        context: "initial_ruleset_creation",
        practiceId: currentPractice._id,
      });

      toast.error("Fehler beim Erstellen des Regelsets", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsCreatingInitial(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Regelverwaltung & Simulation
        </h1>
        <p className="text-muted-foreground">
          Verwalten Sie Regelsets und testen Sie diese in der Simulation
        </p>
      </div>

      <Tabs className="w-full" defaultValue="regeln">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="regeln">Regelverwaltung</TabsTrigger>
          <TabsTrigger value="simulation">Simulation</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-6" value="regeln">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              {/* Rule Set Selection */}
              <Card>
                <CardHeader>
                  <CardTitle>Regelset Auswahl</CardTitle>
                  <CardDescription>
                    {ruleSetsQuery && ruleSetsQuery.length === 0
                      ? "Noch keine Regelsets vorhanden. Erstellen Sie das erste Regelset für Ihre Praxis."
                      : "Wählen Sie ein Regelset aus oder erstellen Sie ein neues Draft"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="rule-set-select">Regelset</Label>
                    <Select
                      onValueChange={(value) => {
                        setSelectedRuleSetId(value as Id<"ruleSets">);
                      }}
                      value={selectedRuleSetId || ""}
                    >
                      <SelectTrigger id="rule-set-select">
                        <SelectValue placeholder="Regelset auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {ruleSetsQuery?.map((ruleSet) => (
                          <SelectItem key={ruleSet._id} value={ruleSet._id}>
                            <div className="flex items-center gap-2">
                              <span>
                                v{ruleSet.version} - {ruleSet.description}
                              </span>
                              {ruleSet.isActive && (
                                <Badge className="text-xs" variant="default">
                                  AKTIV
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2">
                    {ruleSetsQuery && ruleSetsQuery.length === 0 ? (
                      // Show "Create Initial Rule Set" when no rule sets exist
                      <Button
                        disabled={isCreatingInitial}
                        onClick={() => void handleCreateInitial()}
                        variant="default"
                      >
                        <GitBranch className="h-4 w-4 mr-2" />
                        {isCreatingInitial
                          ? "Erstelle erstes Regelset..."
                          : "Erstes Regelset erstellen"}
                      </Button>
                    ) : (
                      // Show "Create Draft" when rule sets exist
                      <Button
                        disabled={isCreatingDraft || !activeRuleSet}
                        onClick={() => void handleCreateDraft()}
                        variant="outline"
                      >
                        <GitBranch className="h-4 w-4 mr-2" />
                        {isCreatingDraft
                          ? "Erstelle Draft..."
                          : "Neues Draft erstellen"}
                      </Button>
                    )}

                    {selectedRuleSet && !selectedRuleSet.isActive && (
                      <Button
                        onClick={() => {
                          if (selectedRuleSetId) {
                            void handleActivateRuleSet(selectedRuleSetId);
                          }
                        }}
                        variant="default"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Aktivieren
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Rules List */}
              {selectedRuleSet && (
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>
                          Regeln in v{selectedRuleSet.version}
                          {selectedRuleSet.isActive && (
                            <Badge className="ml-2" variant="default">
                              AKTIV
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {selectedRuleSet.description}
                        </CardDescription>
                      </div>
                      {!selectedRuleSet.isActive && selectedRuleSetId && (
                        <RuleCreationForm
                          onRuleCreated={() => {
                            // Rules will auto-refresh via Convex reactivity
                          }}
                          practiceId={currentPractice._id}
                          ruleSetId={selectedRuleSetId}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {rulesQuery ? (
                      rulesQuery.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Keine Regeln in diesem Regelset.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {rulesQuery.map((rule) => (
                            <div
                              className="p-4 border rounded-lg hover:bg-accent transition-colors"
                              key={rule._id}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium">
                                      {rule.description}
                                    </span>
                                    <Badge
                                      className="text-xs"
                                      variant={
                                        rule.ruleType === "BLOCK"
                                          ? "destructive"
                                          : "secondary"
                                      }
                                    >
                                      {rule.ruleType}
                                    </Badge>
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {formatRuleDescription(rule)}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Priorität: {rule.priority}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        Lade Regeln...
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Practitioner Management */}
              <PractitionerManagement practiceId={currentPractice._id} />

              {/* Base Schedule Management */}
              <BaseScheduleManagement practiceId={currentPractice._id} />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Verfügbare Regelsets</CardTitle>
                  <CardDescription>
                    Alle Versionen für diese Praxis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ruleSetsQuery ? (
                    ruleSetsQuery.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="text-muted-foreground mb-4">
                          Noch keine Regelsets vorhanden.
                        </div>
                        <Button
                          disabled={isCreatingInitial}
                          onClick={() => void handleCreateInitial()}
                          size="sm"
                          variant="outline"
                        >
                          <GitBranch className="h-4 w-4 mr-2" />
                          {isCreatingInitial
                            ? "Erstelle..."
                            : "Erstes Regelset erstellen"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ruleSetsQuery
                          .sort((a, b) => b.version - a.version)
                          .map((ruleSet) => (
                            <div
                              className={`p-3 border rounded cursor-pointer transition-colors ${
                                selectedRuleSetId === ruleSet._id
                                  ? "border-blue-500 bg-blue-50"
                                  : "hover:bg-accent"
                              }`}
                              key={ruleSet._id}
                              onClick={() => {
                                setSelectedRuleSetId(ruleSet._id);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">
                                    v{ruleSet.version}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {ruleSet.description}
                                  </div>
                                </div>
                                {ruleSet.isActive && (
                                  <Badge className="text-xs" variant="default">
                                    AKTIV
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )
                  ) : (
                    <div className="text-muted-foreground">
                      Lade Regelsets...
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedRuleSet && (
                <Card>
                  <CardHeader>
                    <CardTitle>Regelset Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Version:</span>
                      <span className="font-medium">
                        v{selectedRuleSet.version}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge
                        variant={
                          selectedRuleSet.isActive ? "default" : "secondary"
                        }
                      >
                        {selectedRuleSet.isActive ? "Aktiv" : "Draft"}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Regeln:</span>
                      <span className="font-medium">
                        {rulesQuery?.length || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Erstellt:</span>
                      <span className="font-medium">
                        {new Date(selectedRuleSet.createdAt).toLocaleDateString(
                          "de-DE",
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent className="mt-6" value="simulation">
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
                        setSimulationRuleSetId(
                          value === "active"
                            ? undefined
                            : (value as Id<"ruleSets">),
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
                      value={
                        simulatedContext.patient.isNew ? "new" : "existing"
                      }
                    >
                      <SelectTrigger id="patient-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Neuer Patient</SelectItem>
                        <SelectItem value="existing">
                          Bestandspatient
                        </SelectItem>
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
                        <SelectItem value="Erstberatung">
                          Erstberatung
                        </SelectItem>
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
                    <span className="font-medium">
                      {simulatedContext.appointmentType}
                    </span>
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
                      {simulationRuleSetId ? "Draft" : "Aktiv"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Center Panel - Patient Booking Flow Simulation */}
            <div className="lg:col-span-6">
              <PatientBookingFlow
                dateRange={dateRange}
                onSlotClick={handleSlotClick}
                practiceId={currentPractice._id}
                ruleSetId={simulationRuleSetId}
                simulatedContext={simulatedContext}
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
                          {format(new Date(selectedSlot.startTime), "HH:mm", {
                            locale: de,
                          })}
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
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
