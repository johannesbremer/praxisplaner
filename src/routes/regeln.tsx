// src/routes/regeln.tsx
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { de } from "date-fns/locale";
import { Plus, RefreshCw, Save } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
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
import type { SchedulingSimulatedContext, SchedulingSlot } from "../types";

import { AppointmentTypeSelector } from "../components/appointment-type-selector";
import { AppointmentTypesManagement } from "../components/appointment-types-management";
import BaseScheduleManagement from "../components/base-schedule-management";
import { DebugView } from "../components/debug-view";
import { LocationsManagement } from "../components/locations-management";
import { MedicalStaffDisplay } from "../components/medical-staff-display";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import RuleCreationFormNew from "../components/rule-creation-form-new";
import { RuleEnableCombobox } from "../components/rule-enable-combobox";
import { RuleListNew } from "../components/rule-list-new";
import { VersionGraph } from "../components/version-graph/index";
import { useErrorTracking } from "../utils/error-tracking";
import { useLocalAppointments } from "../utils/local-appointments";
import {
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
  type RegelnSearchParams,
  type RegelnTabParam,
  useRegelnUrl,
} from "../utils/regeln-url";

export const Route = createFileRoute("/regeln")({
  component: LogicView,
  validateSearch: (search): RegelnSearchParams => {
    const params = search;

    const result: RegelnSearchParams = {};

    if (params["tab"] === "mitarbeiter" || params["tab"] === "debug") {
      result.tab = params["tab"] as RegelnTabParam;
    }

    if (
      typeof params["location"] === "string" &&
      params["location"].length > 0
    ) {
      result.location = params["location"];
    }

    if (
      typeof params["date"] === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(params["date"])
    ) {
      result.date = params["date"];
    }

    if (params["patientType"] === EXISTING_PATIENT_SEGMENT) {
      result.patientType = EXISTING_PATIENT_SEGMENT;
    } else if (params["patientType"] === NEW_PATIENT_SEGMENT) {
      result.patientType = NEW_PATIENT_SEGMENT;
    }

    if (typeof params["ruleSet"] === "string" && params["ruleSet"].length > 0) {
      result.ruleSet = params["ruleSet"];
    }

    return result;
  },
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

type SimulatedContext = SchedulingSimulatedContext;
type SlotDetails = SchedulingSlot;

// Helper: slugify German names to URL-safe strings
function LogicView() {
  // URL helpers: central source of truth for parsing and navigation
  // URL is the source of truth. No local tab/date/patientType/ruleSet state.
  // Practices and initialization
  const practicesQuery = useQuery(api.practices.getAllPractices, {});
  const initializePracticeMutation = useMutation(
    api.practices.initializeDefaultPractice,
  );
  // pushParams will be defined after data queries and derived state
  const { captureError } = useErrorTracking();

  // No explicit selected saved rule set state; selection is driven by URL
  const [unsavedRuleSetId, setUnsavedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null); // New: tracks unsaved rule set
  const [isInitializingPractice, setIsInitializingPractice] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [pendingRuleSetId, setPendingRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();
  const [activationName, setActivationName] = useState("");

  // Local appointments for simulation
  const { addLocalAppointment, clearAllLocalAppointments, localAppointments } =
    useLocalAppointments();

  const [simulatedContext, setSimulatedContext] = useState<SimulatedContext>({
    appointmentType: "Erstberatung",
    patient: { isNew: true },
  });
  const [selectedSlot, setSelectedSlot] = useState<null | SlotDetails>(null);
  // URL will be parsed after queries and unsaved draft are known

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
  // Fetch locations for slug mapping
  const locationsListQuery = useQuery(
    api.locations.getLocations,
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
  // selectedRuleSet will be computed after unsavedRuleSet and ruleSetIdFromUrl are available

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsQuery?.find(
    (rs: { description: string; isActive: boolean }) =>
      !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  const unsavedRuleSet =
    ruleSetsQuery?.find((rs: { _id: string }) => rs._id === unsavedRuleSetId) ??
    existingUnsavedRuleSet;

  // URL derivations & actions (now that we have queries and unsavedRuleSet)
  const {
    activeTab,
    isNewPatient,
    locationIdFromUrl,
    navigateTab,
    pushUrl,
    raw,
    ruleSetIdFromUrl,
    selectedDate,
  } = useRegelnUrl({
    locationsListQuery,
    ruleSetsQuery,
    unsavedRuleSet: unsavedRuleSet ?? null,
  });

  const selectedRuleSet = useMemo(
    () => ruleSetsQuery?.find((rs) => rs._id === ruleSetIdFromUrl),
    [ruleSetsQuery, ruleSetIdFromUrl],
  );

  // Helper to push the canonical URL reflecting current UI intent
  // pushUrl and navigateTab come from useRegelnUrl

  // Ensure the URL reflects an existing unsaved draft selection
  // If an unsaved rule set exists but the URL doesn't say 'ungespeichert',
  // navigate to include it so the URL remains the single source of truth.
  React.useEffect(() => {
    // Only enforce when the ruleSet segment is missing entirely.
    // Do NOT override a user-chosen named rule set in the URL.
    if (
      unsavedRuleSet &&
      !raw.ruleSet &&
      // Avoid navigating before we know the date from URL/state
      selectedDate instanceof Date
    ) {
      pushUrl({ ruleSetId: unsavedRuleSet._id as Id<"ruleSets"> });
    }
  }, [
    unsavedRuleSet,
    raw.ruleSet,
    activeTab,
    simulatedContext.patient.isNew,
    selectedDate,
    pushUrl,
  ]);

  // Reset simulation helper (after pushParams is defined)
  const resetSimulation = () => {
    setSimulatedContext({
      appointmentType: "Erstberatung",
      patient: { isNew: true },
    });
    setSelectedSlot(null);
    clearAllLocalAppointments();
    pushUrl({ date: new Date(), isNewPatient: true, ruleSetId: undefined });
  };

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
  const currentWorkingRuleSet = useMemo(
    () => unsavedRuleSet ?? selectedRuleSet ?? activeRuleSet,
    [unsavedRuleSet, selectedRuleSet, activeRuleSet],
  );

  // Keep patient.isNew in local simulatedContext in sync with URL
  React.useEffect(() => {
    if (simulatedContext.patient.isNew !== isNewPatient) {
      setSimulatedContext((prev) => ({
        ...prev,
        patient: { isNew: isNewPatient },
      }));
    }
  }, [isNewPatient, simulatedContext.patient.isNew]);

  // Map URL slugs -> internal IDs for rule set and location
  React.useEffect(() => {
    if (
      locationIdFromUrl &&
      simulatedContext.locationId !== locationIdFromUrl
    ) {
      setSimulatedContext((prev) => ({
        ...prev,
        locationId: locationIdFromUrl,
      }));
    }
  }, [locationIdFromUrl, simulatedContext.locationId]);
  // No automatic URL mutation when unsaved exists; only mutate on user actions

  // Fetch rules for the current working rule set (only enabled ones)
  const rulesQuery = useQuery(
    api.rules.getRulesForRuleSet,
    currentWorkingRuleSet
      ? { enabledOnly: true, ruleSetId: currentWorkingRuleSet._id }
      : "skip",
  );

  // Create date range representing a full calendar day without timezone issues (after selectedDate is known)
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  const dateRange = {
    end: endOfDay.toISOString(),
    start: startOfDay.toISOString(),
  };

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
    // 1) Already tracking an unsaved draft
    if (unsavedRuleSetId) {
      pushUrl({ ruleSetId: unsavedRuleSetId });
      return unsavedRuleSetId;
    }

    // 2) A draft exists in DB but not yet tracked in state
    if (existingUnsavedRuleSet) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
      pushUrl({ ruleSetId: existingUnsavedRuleSet._id });
      return existingUnsavedRuleSet._id;
    }

    // 3) Create a draft from the currently selected rule set
    if (selectedRuleSet) {
      const newId = await createUnsavedCopy(selectedRuleSet._id);
      if (newId) {
        pushUrl({ ruleSetId: newId });
      }
      return newId;
    }

    // 4) Create a draft from the active rule set
    if (activeRuleSet) {
      const newId = await createUnsavedCopy(activeRuleSet._id);
      if (newId) {
        pushUrl({ ruleSetId: newId });
      }
      return newId;
    }

    // 5) Create the initial draft if there are no rule sets yet
    const initialId = await createInitialUnsaved();
    if (initialId) {
      pushUrl({ ruleSetId: initialId });
    }
    return initialId;
  }, [
    unsavedRuleSetId,
    existingUnsavedRuleSet,
    selectedRuleSet,
    activeRuleSet,
    createUnsavedCopy,
    createInitialUnsaved,
    pushUrl,
  ]);

  const handleVersionClick = React.useCallback(
    (version: VersionNode) => {
      if (!currentPractice) {
        toast.error("Keine Praxis gefunden");
        return;
      }

      const versionId = version.hash as Id<"ruleSets">;

      // If we have unsaved changes and the target is not the unsaved draft, show save dialog
      if (unsavedRuleSet && versionId !== unsavedRuleSet._id) {
        setPendingRuleSetId(versionId);
        setActivationName("");
        setIsSaveDialogOpen(true);
        return;
      }

      // Navigate to the chosen version
      setUnsavedRuleSetId(null);
      pushUrl({ ruleSetId: versionId });
    },
    [currentPractice, unsavedRuleSet, pushUrl],
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

      // If we came from the save dialog, switch to the pending rule set (or active when undefined)
      if (pendingRuleSetId === undefined) {
        // Keep URL in sync with the activated rule set
        pushUrl({ ruleSetId });
      } else {
        pushUrl({ ruleSetId: pendingRuleSetId });
        setPendingRuleSetId(undefined);
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
    if (currentWorkingRuleSet && pendingRuleSetId !== undefined) {
      // Activate current working rule set with the given name, then switch to pending
      void (async () => {
        try {
          await activateRuleSetMutation({
            name,
            practiceId: currentPractice._id,
            ruleSetId: currentWorkingRuleSet._id,
          });

          setUnsavedRuleSetId(null);
          setPendingRuleSetId(undefined);
          setIsSaveDialogOpen(false);
          setActivationName("");
          toast.success("Änderungen gespeichert");

          // Keep URL in sync with the selected (pending) rule set
          pushUrl({ ruleSetId: pendingRuleSetId });
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

          // Navigate to target (pending or active)
          pushUrl({ ruleSetId: pendingRuleSetId });
          setPendingRuleSetId(undefined);

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
      <ClientOnly fallback={<div />}>
        <Tabs
          className="space-y-6"
          onValueChange={(val) => {
            navigateTab(val as typeof activeTab);
          }}
          value={activeTab}
        >
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
                              {...((unsavedRuleSetId || ruleSetIdFromUrl) && {
                                selectedVersionId: (unsavedRuleSetId ||
                                  ruleSetIdFromUrl) as string,
                              })}
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
                        {/* Show save button when we have an unsaved rule set or when creating the first one */}
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

                        {/* Show activate button when a different rule set is selected and there are no unsaved changes */}
                        {selectedRuleSet &&
                          !unsavedRuleSet &&
                          !selectedRuleSet.isActive && (
                            <Button
                              onClick={() =>
                                void handleActivateRuleSet(
                                  selectedRuleSet._id,
                                  selectedRuleSet.description,
                                )
                              }
                              variant="outline"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Aktivieren
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
                                      <Badge
                                        className="ml-2"
                                        variant="secondary"
                                      >
                                        Ungespeicherte Änderungen
                                      </Badge>
                                    </>
                                  ) : (
                                    <>
                                      Regeln in{" "}
                                      {currentWorkingRuleSet.description}
                                      {currentWorkingRuleSet.isActive && (
                                        <Badge
                                          className="ml-2"
                                          variant="default"
                                        >
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
                            onNeedRuleSet={ensureUnsavedRuleSet}
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
                            onNeedRuleSet={ensureUnsavedRuleSet}
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
                  <PractitionerManagement
                    onNeedRuleSet={ensureUnsavedRuleSet}
                    practiceId={currentPractice._id}
                  />

                  {/* Base Schedule Management */}
                  <BaseScheduleManagement
                    onNeedRuleSet={ensureUnsavedRuleSet}
                    practiceId={currentPractice._id}
                  />

                  {/* Locations Management */}
                  <LocationsManagement
                    onNeedRuleSet={ensureUnsavedRuleSet}
                    practiceId={currentPractice._id}
                  />
                </div>
              </div>

              {/* Right Panel - Patient View + Simulation Controls */}
              <div className="space-y-6">
                <div className="flex justify-center">
                  <PatientBookingFlow
                    dateRange={dateRange}
                    localAppointments={localAppointments}
                    onCreateLocalAppointment={addLocalAppointment}
                    onSlotClick={handleSlotClick}
                    onUpdateSimulatedContext={setSimulatedContext}
                    practiceId={currentPractice._id}
                    ruleSetId={ruleSetIdFromUrl}
                    simulatedContext={simulatedContext}
                  />
                </div>

                <SimulationControls
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({ isNewPatient: ctx.patient.isNew });
                  }}
                  onSimulationRuleSetChange={(id) => {
                    // If unsaved exists and target is not the unsaved id, show save dialog
                    if (unsavedRuleSet && id !== unsavedRuleSet._id) {
                      setPendingRuleSetId(id);
                      setActivationName("");
                      setIsSaveDialogOpen(true);
                      return;
                    }
                    pushUrl({ ruleSetId: id });
                  }}
                  ruleSetsQuery={ruleSetsQuery}
                  selectedDate={selectedDate}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
                />
              </div>
            </div>

            {/* Full width Appointment Types Management */}
            <div className="mt-6">
              <AppointmentTypesManagement
                onNeedRuleSet={ensureUnsavedRuleSet}
                practiceId={currentPractice._id}
              />
            </div>
          </TabsContent>

          {/* Tab 2: Staff View Only */}
          <TabsContent value="staff-view">
            <div className="space-y-6">
              <div className="space-y-6">
                <MedicalStaffDisplay
                  dateRange={dateRange}
                  localAppointments={localAppointments}
                  onCreateLocalAppointment={addLocalAppointment}
                  onSlotClick={handleSlotClick}
                  onUpdateSimulatedContext={setSimulatedContext}
                  practiceId={currentPractice._id}
                  ruleSetId={ruleSetIdFromUrl}
                  simulatedContext={simulatedContext}
                />

                <SimulationControls
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({ isNewPatient: ctx.patient.isNew });
                  }}
                  onSimulationRuleSetChange={(id) => {
                    if (unsavedRuleSet && id !== unsavedRuleSet._id) {
                      setPendingRuleSetId(id);
                      setActivationName("");
                      setIsSaveDialogOpen(true);
                      return;
                    }
                    pushUrl({ ruleSetId: id });
                  }}
                  ruleSetsQuery={ruleSetsQuery}
                  selectedDate={selectedDate}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
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
                    onUpdateSimulatedContext={setSimulatedContext}
                    practiceId={currentPractice._id}
                    ruleSetId={ruleSetIdFromUrl}
                    simulatedContext={simulatedContext}
                  />

                  <SlotInspector selectedSlot={selectedSlot} />
                </div>

                <SimulationControls
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({ isNewPatient: ctx.patient.isNew });
                  }}
                  onSimulationRuleSetChange={(id) => {
                    if (unsavedRuleSet && id !== unsavedRuleSet._id) {
                      setPendingRuleSetId(id);
                      setActivationName("");
                      setIsSaveDialogOpen(true);
                      return;
                    }
                    pushUrl({ ruleSetId: id });
                  }}
                  ruleSetsQuery={ruleSetsQuery}
                  selectedDate={selectedDate}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </ClientOnly>

      {/* Save Dialog */}
      <Dialog
        onOpenChange={(open) => {
          setIsSaveDialogOpen(open);
          if (!open) {
            setPendingRuleSetId(undefined);
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
            onSubmit: ({ value }: { value: string }) =>
              value.trim() ? undefined : "Name ist erforderlich",
          }}
        >
          {(field: {
            handleChange: (value: string) => void;
            name: string;
            state: { value: string };
          }) => (
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

// slugify moved to shared util

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
  // Compute once to avoid duplicate finds
  const unsavedRuleSet = ruleSetsQuery?.find(
    (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

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

        <AppointmentTypeSelector
          onTypeSelect={(type: string) => {
            onSimulatedContextChange({
              ...simulatedContext,
              appointmentType: type,
            });
          }}
          selectedType={simulatedContext.appointmentType}
        />

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
  const locationQuery = useQuery(
    api.locations.getLocation,
    selectedSlot?.locationId ? { locationId: selectedSlot.locationId } : "skip",
  );

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

            {(selectedSlot.locationId || locationQuery) && (
              <div>
                <Label className="text-sm font-medium">Standort</Label>
                <div>
                  {locationQuery ? locationQuery.name : "Wird geladen..."}
                </div>
              </div>
            )}

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
