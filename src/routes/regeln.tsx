// src/routes/regeln.tsx
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { de } from "date-fns/locale";
import { Plus, RefreshCw, Save } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

import type { VersionNode } from "../components/version-graph/types";

import BaseScheduleManagement from "../components/base-schedule-management";
import { DebugView } from "../components/debug-view";
import { MedicalStaffDisplay } from "../components/medical-staff-display";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import RuleCreationFormNew from "../components/rule-creation-form-new";
import { RuleEnableCombobox } from "../components/rule-enable-combobox";
import { RuleListNew } from "../components/rule-list-new";
import { VersionGraph } from "../components/version-graph/index";
import { useErrorTracking } from "../utils/error-tracking";

export const Route = createFileRoute("/regeln")({
  component: LogicView,
});

interface SaveDialogFormProps {
  activationName: string;
  currentWorkingRuleSet: null | undefined | { _id: Id<"ruleSets"> };
  onDiscard?: (() => void) | null;
  onSaveAndActivate: (name: string) => void;
  onSaveOnly: (name: string) => void;
  practiceId: Id<"practices">;
  setActivationName: (name: string) => void;
}

interface SimulatedContext {
  appointmentType: string;
  patient: { isNew: boolean };
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

export default function LogicView() {
  // Get or initialize a practice for development
  const practicesQuery = useQuery(api.practices.getAllPractices);
  const initializePracticeMutation = useMutation(
    api.practices.initializeDefaultPractice,
  );
  const { captureError } = useErrorTracking();

  const [selectedRuleSetId, setSelectedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null);
  const [unsavedRuleSetId, setUnsavedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null); // New: tracks unsaved rule set
  const [isInitializingPractice, setIsInitializingPractice] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [pendingRuleSetId, setPendingRuleSetId] =
    useState<Id<"ruleSets"> | null>(null);
  const [activationName, setActivationName] = useState("");

  // Simulation state - moved from SimulationPanel
  const [simulatedContext, setSimulatedContext] = useState<SimulatedContext>({
    appointmentType: "Erstberatung",
    patient: { isNew: true },
  });
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<null | SlotDetails>(null);
  const [simulationRuleSetId, setSimulationRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();

  // Create date range representing a full calendar day without timezone issues
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  const dateRange = {
    end: endOfDay.toISOString(),
    start: startOfDay.toISOString(),
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

  // Use the first available practice or initialize one
  const currentPractice = practicesQuery?.[0];

  const handleRuleChange = useCallback(() => {
    // This will trigger a re-fetch of the rules query
    // which will update the UI automatically via Convex reactivity
  }, []);

  // Initialize practice if none exists
  const handleInitializePractice = useCallback(async () => {
    try {
      setIsInitializingPractice(true);
      await initializePracticeMutation();
    } catch (error: unknown) {
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
    api.rules.getRuleSets,
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Fetch version history for visualization
  const versionsQuery = useQuery(
    api.rules.getVersionHistory,
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Mutations
  const createDraftMutation = useMutation(api.rules.createDraftFromActive);
  const createDraftFromRuleSetMutation = useMutation(
    api.rules.createDraftFromRuleSet,
  );
  const createInitialRuleSetMutation = useMutation(
    api.rules.createInitialRuleSet,
  );
  const activateRuleSetMutation = useMutation(api.rules.activateRuleSet);
  const deleteRuleSetMutation = useMutation(api.rules.deleteRuleSet);

  // Function to create an initial unsaved rule set
  const createInitialUnsaved = React.useCallback(async () => {
    if (!currentPractice) {
      return;
    }

    try {
      let newRuleSetId: Id<"ruleSets">;

      // Check if this practice has any rule sets
      if (!ruleSetsQuery || ruleSetsQuery.length === 0) {
        // No rule sets exist, create the first one as an unsaved draft
        newRuleSetId = await createInitialRuleSetMutation({
          description: "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
        });
      } else {
        // Rule sets exist, create a draft from the active one
        newRuleSetId = await createDraftMutation({
          description: "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
        });
      }

      setUnsavedRuleSetId(newRuleSetId);
      return newRuleSetId;
    } catch (error: unknown) {
      captureError(error, {
        context: "initial_unsaved_creation",
        practiceId: currentPractice._id,
      });

      toast.error("Fehler beim Erstellen des Regelsets", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
      return null;
    }
  }, [
    currentPractice,
    createDraftMutation,
    createInitialRuleSetMutation,
    captureError,
    ruleSetsQuery,
  ]);

  const activeRuleSet = ruleSetsQuery?.find(
    (rs: { isActive: boolean }) => rs.isActive,
  );
  const selectedRuleSet = ruleSetsQuery?.find(
    (rs: { _id: string }) => rs._id === selectedRuleSetId,
  );

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsQuery?.find(
    (rs: { description: string; isActive: boolean }) =>
      !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  const unsavedRuleSet =
    ruleSetsQuery?.find((rs: { _id: string }) => rs._id === unsavedRuleSetId) ??
    existingUnsavedRuleSet;

  // Auto-detect existing unsaved rule set on load
  React.useEffect(() => {
    if (existingUnsavedRuleSet && !unsavedRuleSetId) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
    }
  }, [existingUnsavedRuleSet, unsavedRuleSetId]);

  // Auto-create an initial unsaved rule set when no rule sets exist
  React.useEffect(() => {
    if (
      currentPractice &&
      ruleSetsQuery &&
      ruleSetsQuery.length === 0 &&
      !unsavedRuleSetId
    ) {
      void createInitialUnsaved();
    }
  }, [currentPractice, ruleSetsQuery, unsavedRuleSetId, createInitialUnsaved]);

  // Use unsaved rule set if available, otherwise selected rule set, otherwise active rule set
  const currentWorkingRuleSet =
    unsavedRuleSet ?? selectedRuleSet ?? activeRuleSet;

  // Fetch rules for the current working rule set (only enabled ones)
  const rulesQuery = useQuery(
    api.rules.getRulesForRuleSet,
    currentWorkingRuleSet
      ? { enabledOnly: true, ruleSetId: currentWorkingRuleSet._id }
      : "skip",
  );

  // Function to create an unsaved copy when modifying a saved rule set
  const createUnsavedCopy = React.useCallback(
    async (baseRuleSetId: Id<"ruleSets">) => {
      if (!currentPractice) {
        toast.error("Keine Praxis gefunden");
        return;
      }

      try {
        const newRuleSetId = await createDraftFromRuleSetMutation({
          description: "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
          sourceRuleSetId: baseRuleSetId,
        });

        setUnsavedRuleSetId(newRuleSetId);
        return newRuleSetId;
      } catch (error: unknown) {
        captureError(error, {
          baseRuleSetId,
          context: "unsaved_copy_creation",
          practiceId: currentPractice._id,
        });

        toast.error("Fehler beim Erstellen der Arbeitskopie", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
        return null;
      }
    },
    [currentPractice, createDraftFromRuleSetMutation, captureError],
  );

  // Function to ensure an unsaved rule set exists - called when user starts making changes
  const ensureUnsavedRuleSet = React.useCallback(async () => {
    if (unsavedRuleSetId) {
      return unsavedRuleSetId; // Already have an unsaved rule set
    }

    // Check if there's already an existing unsaved rule set we can use
    if (existingUnsavedRuleSet) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
      return existingUnsavedRuleSet._id;
    }

    // If we have a selected rule set (active or non-active), create an unsaved copy of it
    if (selectedRuleSet) {
      return await createUnsavedCopy(selectedRuleSet._id);
    }

    // If we have an active rule set but no selected rule set, create copy of active
    if (activeRuleSet) {
      return await createUnsavedCopy(activeRuleSet._id);
    }

    // Otherwise create initial unsaved rule set
    return await createInitialUnsaved();
  }, [
    unsavedRuleSetId,
    existingUnsavedRuleSet,
    selectedRuleSet,
    activeRuleSet,
    createUnsavedCopy,
    createInitialUnsaved,
  ]);

  const handleVersionClick = React.useCallback(
    (version: VersionNode) => {
      if (!currentPractice) {
        toast.error("Keine Praxis gefunden");
        return;
      }

      const versionId = version.hash as Id<"ruleSets">;

      // If we have unsaved changes, show save dialog first
      if (unsavedRuleSet) {
        setPendingRuleSetId(versionId);
        setActivationName("");
        setIsSaveDialogOpen(true);
        return;
      }

      // If clicking on the currently selected version, do nothing
      if (selectedRuleSetId === versionId) {
        return;
      }

      // Switch to the selected version
      setSelectedRuleSetId(versionId);
      setUnsavedRuleSetId(null);
    },
    [currentPractice, unsavedRuleSet, selectedRuleSetId],
  );

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

  const handleActivateRuleSet = async (
    ruleSetId: Id<"ruleSets">,
    name: string,
  ) => {
    try {
      await activateRuleSetMutation({
        name: name.trim(),
        practiceId: currentPractice._id,
        ruleSetId,
      });

      toast.success("Regelset aktiviert", {
        description:
          "Das Regelset wurde erfolgreich gespeichert und aktiviert.",
      });

      setIsSaveDialogOpen(false);
      setActivationName("");
      setUnsavedRuleSetId(null); // Clear unsaved state

      // If we came from the save dialog, switch to the pending rule set
      if (pendingRuleSetId) {
        setSelectedRuleSetId(pendingRuleSetId);
        setPendingRuleSetId(null);
      } else {
        setSelectedRuleSetId(ruleSetId); // Set the activated rule set as selected
      }
    } catch (error: unknown) {
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

  const handleOpenSaveDialog = () => {
    if (currentWorkingRuleSet) {
      setActivationName(""); // Always start with empty name
      setIsSaveDialogOpen(true);
    }
  };

  // Save dialog handlers
  const handleSaveOnly = (name: string) => {
    if (currentWorkingRuleSet && pendingRuleSetId) {
      // Activate current working rule set with the given name, then switch to pending
      void (async () => {
        try {
          await activateRuleSetMutation({
            name,
            practiceId: currentPractice._id,
            ruleSetId: currentWorkingRuleSet._id,
          });

          setSelectedRuleSetId(pendingRuleSetId);
          setUnsavedRuleSetId(null);
          setPendingRuleSetId(null);
          setIsSaveDialogOpen(false);
          setActivationName("");
          toast.success("Änderungen gespeichert");
        } catch (error: unknown) {
          captureError(error, {
            context: "save_only",
            practiceId: currentPractice._id,
            ruleSetId: currentWorkingRuleSet._id,
          });
          toast.error("Fehler beim Speichern", {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          });
        }
      })();
    } else if (currentWorkingRuleSet) {
      // Just activate the current working rule set
      void handleActivateRuleSet(currentWorkingRuleSet._id, name);
    }
  };

  const handleSaveAndActivate = (name: string) => {
    if (currentWorkingRuleSet) {
      void handleActivateRuleSet(currentWorkingRuleSet._id, name);
    }
  };

  const handleDiscardChanges = () => {
    if (unsavedRuleSet) {
      // Delete the unsaved rule set from the database
      void (async () => {
        try {
          await deleteRuleSetMutation({
            practiceId: currentPractice._id,
            ruleSetId: unsavedRuleSet._id,
          });

          setUnsavedRuleSetId(null);

          if (pendingRuleSetId) {
            setSelectedRuleSetId(pendingRuleSetId);
            setPendingRuleSetId(null);
          }

          setIsSaveDialogOpen(false);
          setActivationName("");
          toast.success("Änderungen verworfen");
        } catch (error: unknown) {
          captureError(error, {
            context: "discard_changes",
            practiceId: currentPractice._id,
            ruleSetId: unsavedRuleSet._id,
          });

          toast.error("Fehler beim Verwerfen der Änderungen", {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          });
        }
      })();
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Regelverwaltung & Simulation
        </h1>
        <p className="text-muted-foreground">
          Verwalten Sie Regelsets und testen Sie diese in verschiedenen
          Ansichten
        </p>
      </div>

      {/* Page-level Tabs */}
      <Tabs className="space-y-6" defaultValue="rule-management">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="rule-management">
            Regelverwaltung + Patientensicht
          </TabsTrigger>
          <TabsTrigger value="staff-view">Praxismitarbeiter</TabsTrigger>
          <TabsTrigger value="debug-views">Debug Views</TabsTrigger>
        </TabsList>

        {/* Tab 1: Rule Management + Patient View */}
        <TabsContent value="rule-management">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Panel - Regelverwaltung */}
            <div className="space-y-6">
              <div className="space-y-6">
                {/* Rule Set Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle>Regelset Auswahl</CardTitle>
                    <CardDescription>
                      {ruleSetsQuery && ruleSetsQuery.length === 0
                        ? "Erstellen Sie Ihr erstes Regelset durch das Hinzufügen von Regeln, Ärzten oder Arbeitszeiten."
                        : "Wählen Sie ein gespeichertes Regelset aus oder arbeiten Sie mit ungespeicherten Änderungen."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Show version graph when there are saved rule sets */}
                    {versionsQuery && versionsQuery.length > 0 && (
                      <div className="space-y-2">
                        <Label>Regelset-Versionshistorie</Label>
                        <div className="border rounded-lg p-4">
                          <VersionGraph
                            onVersionClick={handleVersionClick}
                            versions={versionsQuery}
                          />
                        </div>
                        {/* Show current state indicator */}
                        {unsavedRuleSet && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge className="text-xs" variant="secondary">
                              Ungespeicherte Änderungen
                            </Badge>
                            <span>Arbeiten Sie gerade an Änderungen</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {/* Show activation button when we have an unsaved rule set or when creating the first one */}
                      {(unsavedRuleSet ??
                        (ruleSetsQuery &&
                          ruleSetsQuery.length === 0 &&
                          currentWorkingRuleSet)) && (
                        <Button
                          onClick={handleOpenSaveDialog}
                          variant="default"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Speichern
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Rules List */}
                {(currentWorkingRuleSet ??
                  (ruleSetsQuery && ruleSetsQuery.length === 0)) && (
                  <Card>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>
                            {currentWorkingRuleSet ? (
                              <>
                                {unsavedRuleSet ? (
                                  <>
                                    Regeln in{" "}
                                    <Badge className="ml-2" variant="secondary">
                                      Ungespeicherte Änderungen
                                    </Badge>
                                  </>
                                ) : (
                                  <>
                                    Regeln in{" "}
                                    {currentWorkingRuleSet.description}
                                    {currentWorkingRuleSet.isActive && (
                                      <Badge className="ml-2" variant="default">
                                        AKTIV
                                      </Badge>
                                    )}
                                  </>
                                )}
                              </>
                            ) : (
                              "Regeln"
                            )}
                          </CardTitle>
                          <CardDescription>
                            {currentWorkingRuleSet
                              ? currentWorkingRuleSet.description
                              : "Fügen Sie Ihre erste Regel hinzu"}
                          </CardDescription>
                        </div>
                      </div>
                      {/* Rule Management Controls - New line for space reasons */}
                      <div className="flex gap-2 mt-4">
                        {/* Create New Rule Button - Always show */}
                        <RuleCreationFormNew
                          customTrigger={
                            unsavedRuleSet ? undefined : (
                              <Button
                                onClick={() => {
                                  void ensureUnsavedRuleSet();
                                }}
                                size="sm"
                                variant="outline"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Neue Regel
                              </Button>
                            )
                          }
                          onRuleCreated={handleRuleChange}
                          practiceId={currentPractice._id}
                          {...(unsavedRuleSet && {
                            ruleSetId: unsavedRuleSet._id,
                          })}
                        />

                        {/* Enable Existing Rule Combobox - Always show */}
                        <RuleEnableCombobox
                          onNeedRuleSet={() => {
                            void ensureUnsavedRuleSet();
                          }}
                          onRuleEnabled={handleRuleChange}
                          practiceId={currentPractice._id}
                          {...(unsavedRuleSet && {
                            ruleSetId: unsavedRuleSet._id,
                          })}
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      {rulesQuery && currentWorkingRuleSet ? (
                        <RuleListNew
                          onRuleChanged={handleRuleChange}
                          practiceId={currentPractice._id}
                          rules={rulesQuery}
                          ruleSetId={currentWorkingRuleSet._id}
                        />
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
            </div>

            {/* Right Panel - Patient View + Simulation Controls */}
            <div className="space-y-6">
              <div className="flex justify-center">
                <PatientBookingFlow
                  dateRange={dateRange}
                  onSlotClick={handleSlotClick}
                  onUpdateSimulatedContext={setSimulatedContext}
                  practiceId={currentPractice._id}
                  ruleSetId={simulationRuleSetId}
                  simulatedContext={simulatedContext}
                />
              </div>

              <SimulationControls
                onDateChange={setSelectedDate}
                onResetSimulation={resetSimulation}
                onSimulatedContextChange={setSimulatedContext}
                onSimulationRuleSetChange={setSimulationRuleSetId}
                ruleSetsQuery={ruleSetsQuery}
                selectedDate={selectedDate}
                simulatedContext={simulatedContext}
                simulationRuleSetId={simulationRuleSetId}
              />
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Staff View Only */}
        <TabsContent value="staff-view">
          <div className="space-y-6">
            <div className="space-y-6">
              <MedicalStaffDisplay
                dateRange={dateRange}
                onSlotClick={handleSlotClick}
                onUpdateSimulatedContext={setSimulatedContext}
                practiceId={currentPractice._id}
                ruleSetId={simulationRuleSetId}
                simulatedContext={simulatedContext}
              />

              <SimulationControls
                onDateChange={setSelectedDate}
                onResetSimulation={resetSimulation}
                onSimulatedContextChange={setSimulatedContext}
                onSimulationRuleSetChange={setSimulationRuleSetId}
                ruleSetsQuery={ruleSetsQuery}
                selectedDate={selectedDate}
                simulatedContext={simulatedContext}
                simulationRuleSetId={simulationRuleSetId}
              />
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: Debug Views Only */}
        <TabsContent value="debug-views">
          <div className="space-y-6">
            <div className="space-y-6">
              <div className="space-y-6">
                <DebugView
                  dateRange={dateRange}
                  onSlotClick={handleSlotClick}
                  practiceId={currentPractice._id}
                  ruleSetId={simulationRuleSetId}
                  simulatedContext={simulatedContext}
                />

                <SlotInspector selectedSlot={selectedSlot} />
              </div>

              <SimulationControls
                onDateChange={setSelectedDate}
                onResetSimulation={resetSimulation}
                onSimulatedContextChange={setSimulatedContext}
                onSimulationRuleSetChange={setSimulationRuleSetId}
                ruleSetsQuery={ruleSetsQuery}
                selectedDate={selectedDate}
                simulatedContext={simulatedContext}
                simulationRuleSetId={simulationRuleSetId}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Save Dialog */}
      <Dialog
        onOpenChange={(open) => {
          setIsSaveDialogOpen(open);
          if (!open) {
            setPendingRuleSetId(null);
            setActivationName("");
          }
        }}
        open={isSaveDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regelset speichern</DialogTitle>
            <DialogDescription>
              {pendingRuleSetId
                ? "Sie haben ungespeicherte Änderungen. Möchten Sie diese speichern, bevor Sie zu einem anderen Regelset wechseln?"
                : "Geben Sie einen eindeutigen Namen für dieses Regelset ein."}
            </DialogDescription>
          </DialogHeader>
          <SaveDialogForm
            activationName={activationName}
            currentWorkingRuleSet={currentWorkingRuleSet}
            onDiscard={pendingRuleSetId ? handleDiscardChanges : null}
            onSaveAndActivate={handleSaveAndActivate}
            onSaveOnly={handleSaveOnly}
            practiceId={currentPractice._id}
            setActivationName={setActivationName}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveDialogForm({
  activationName,
  currentWorkingRuleSet,
  onDiscard,
  onSaveAndActivate,
  onSaveOnly,
  practiceId,
  setActivationName,
}: SaveDialogFormProps) {
  const validateRuleSetNameQuery = useQuery(
    api.rules.validateRuleSetName,
    activationName.trim()
      ? {
          name: activationName.trim(),
          practiceId,
          ...(currentWorkingRuleSet?._id && {
            excludeRuleSetId: currentWorkingRuleSet._id,
          }),
        }
      : "skip",
  );

  const form = useForm({
    defaultValues: {
      name: activationName,
    },
    onSubmit: async () => {
      // This will be handled by individual button clicks
    },
  });

  React.useEffect(() => {
    form.setFieldValue("name", activationName);
  }, [activationName, form]);

  // Check if the current name is valid
  const isValidName = React.useMemo(() => {
    const trimmedName = form.getFieldValue("name").trim();
    if (!trimmedName) {
      return false;
    }

    // If validation is still loading, consider it invalid to prevent premature submission
    if (validateRuleSetNameQuery === undefined) {
      return false;
    }

    return validateRuleSetNameQuery.isUnique;
  }, [form, validateRuleSetNameQuery]);

  const validationError = React.useMemo(() => {
    const trimmedName = form.getFieldValue("name").trim();
    if (!trimmedName) {
      return "Name ist erforderlich";
    }

    if (validateRuleSetNameQuery && !validateRuleSetNameQuery.isUnique) {
      return validateRuleSetNameQuery.message;
    }

    return;
  }, [form, validateRuleSetNameQuery]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="space-y-4">
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : "Name ist erforderlich",
          }}
        >
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Name für das Regelset</Label>
              <Input
                id={field.name}
                onChange={(e) => {
                  field.handleChange(e.target.value);
                  setActivationName(e.target.value);
                }}
                placeholder="z.B. Wintersprechzeiten 2024"
                required
                value={field.state.value}
              />
              {validationError && (
                <div className="text-sm text-destructive">
                  {validationError}
                </div>
              )}
            </div>
          )}
        </form.Field>
      </div>
      <DialogFooter className="flex gap-2 mt-6">
        {onDiscard && (
          <Button onClick={onDiscard} type="button" variant="outline">
            Änderungen verwerfen
          </Button>
        )}
        <Button
          disabled={!isValidName}
          onClick={() => {
            const name = form.getFieldValue("name").trim();
            if (isValidName && name) {
              onSaveOnly(name);
            }
          }}
          type="button"
          variant="secondary"
        >
          Speichern
        </Button>
        <Button
          disabled={!isValidName}
          onClick={() => {
            const name = form.getFieldValue("name").trim();
            if (isValidName && name) {
              onSaveAndActivate(name);
            }
          }}
          type="button"
          variant="default"
        >
          Speichern & Aktivieren
        </Button>
      </DialogFooter>
    </form>
  );
}

// Simulation Controls Component - Extracted from SimulationPanel
function SimulationControls({
  onDateChange,
  onResetSimulation,
  onSimulatedContextChange,
  onSimulationRuleSetChange,
  ruleSetsQuery,
  selectedDate,
  simulatedContext,
  simulationRuleSetId,
}: {
  onDateChange: (date: Date) => void;
  onResetSimulation: () => void;
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
  simulatedContext: SimulatedContext;
  simulationRuleSetId: Id<"ruleSets"> | undefined;
}) {
  return (
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
            locale={de}
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
          onClick={onResetSimulation}
          variant="outline"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Zurücksetzen
        </Button>
      </CardContent>
    </Card>
  );
}

// Slot Inspector Component - Extracted from SimulationPanel
function SlotInspector({ selectedSlot }: { selectedSlot: null | SlotDetails }) {
  return (
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
                {/* Always display time as German time by extracting UTC components */}
                {(() => {
                  const date = new Date(selectedSlot.startTime);
                  const hours = date.getUTCHours().toString().padStart(2, "0");
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
  );
}
