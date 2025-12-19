// src/routes/regeln.tsx
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

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
import type { PatientInfo } from "../types";
import type { SchedulingSimulatedContext } from "../types";

import { createSimulatedContext } from "../../lib/utils";
import { AppointmentTypeSelector } from "../components/appointment-type-selector";
import { AppointmentTypesManagement } from "../components/appointment-types-management";
import BaseScheduleManagement from "../components/base-schedule-management";
import { LocationSelector } from "../components/location-selector";
import { LocationsManagement } from "../components/locations-management";
import { MedicalStaffDisplay } from "../components/medical-staff-display";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import { RuleBuilder } from "../components/rule-builder";
import { VersionGraph } from "../components/version-graph/index";
import { useErrorTracking } from "../utils/error-tracking";
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
      typeof params["standort"] === "string" &&
      params["standort"].length > 0
    ) {
      result.standort = params["standort"];
    }

    if (
      typeof params["datum"] === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(params["datum"])
    ) {
      result.datum = params["datum"];
    }

    if (params["patientType"] === EXISTING_PATIENT_SEGMENT) {
      result.patientType = EXISTING_PATIENT_SEGMENT;
    } else if (params["patientType"] === NEW_PATIENT_SEGMENT) {
      result.patientType = NEW_PATIENT_SEGMENT;
    }

    if (
      typeof params["regelwerk"] === "string" &&
      params["regelwerk"].length > 0
    ) {
      result.regelwerk = params["regelwerk"];
    }

    return result;
  },
});

interface SaveDialogFormProps {
  activationName: string;
  onDiscard?: (() => void) | null;
  onSaveAndActivate: (name: string) => void;
  onSaveOnly: (name: string) => void;
  setActivationName: (name: string) => void;
}

type SimulatedContext = SchedulingSimulatedContext;

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
  const [isClearingSimulatedAppointments, setIsClearingSimulatedAppointments] =
    useState(false);
  const [isResettingSimulation, setIsResettingSimulation] = useState(false);

  const deleteAllSimulatedDataMutation = useMutation(
    api.appointments.deleteAllSimulatedData,
  );

  // Local appointments for simulation
  const [simulatedContext, setSimulatedContext] = useState<SimulatedContext>({
    patient: { isNew: true },
  });
  // URL will be parsed after queries and unsaved draft are known

  // Use the first available practice or initialize one
  const currentPractice = practicesQuery?.[0];

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
  const shouldInitialize = practicesQuery?.length === 0;

  React.useEffect(() => {
    if (shouldInitialize && !isInitializingPractice) {
      void handleInitializePractice();
    }
  }, [shouldInitialize, isInitializingPractice, handleInitializePractice]);

  const performClearSimulatedAppointments = useCallback(
    async (options: { silent?: boolean }) => {
      const { silent = false } = options;
      try {
        const result = await deleteAllSimulatedDataMutation({});
        const totalDeleted = result.total;

        if (!silent) {
          if (totalDeleted > 0) {
            const parts = [];
            if (result.appointmentsDeleted > 0) {
              parts.push(
                `${result.appointmentsDeleted} Termin${result.appointmentsDeleted === 1 ? "" : "e"}`,
              );
            }
            if (result.blockedSlotsDeleted > 0) {
              parts.push(
                `${result.blockedSlotsDeleted} Sperrung${result.blockedSlotsDeleted === 1 ? "" : "en"}`,
              );
            }
            toast.success(`${parts.join(" und ")} gelöscht`);
          } else {
            toast.info("Keine Simulationsdaten vorhanden");
          }
        }

        return totalDeleted;
      } catch (error: unknown) {
        captureError(error, {
          context: "simulation_clear",
        });

        const description =
          error instanceof Error ? error.message : "Unbekannter Fehler";

        toast.error("Simulationsdaten konnten nicht gelöscht werden", {
          description,
        });
        throw error;
      }
    },
    [captureError, deleteAllSimulatedDataMutation],
  );

  const handleClearSimulatedAppointments = useCallback(async () => {
    try {
      setIsClearingSimulatedAppointments(true);
      await performClearSimulatedAppointments({});
    } finally {
      setIsClearingSimulatedAppointments(false);
    }
  }, [performClearSimulatedAppointments]);

  // Fetch rule sets for this practice
  const ruleSetsQuery = useQuery(
    api.ruleSets.getAllRuleSets, // Include unsaved for navigation
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Fetch version history for visualization
  const versionsQuery = useQuery(
    api.ruleSets.getVersionHistory,
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Get the first rule set to fetch appointment types
  const firstRuleSetId = ruleSetsQuery?.[0]?._id;

  // Query appointment types to get a valid default
  const appointmentTypesQuery = useQuery(
    api.entities.getAppointmentTypes,
    firstRuleSetId ? { ruleSetId: firstRuleSetId } : "skip",
  );

  // Get the first appointment type ID for default
  const defaultAppointmentTypeId = appointmentTypesQuery?.[0]?._id;

  // Initialize appointmentTypeId once appointment types are loaded
  React.useEffect(() => {
    if (defaultAppointmentTypeId && !simulatedContext.appointmentTypeId) {
      setSimulatedContext((prev) => ({
        ...prev,
        appointmentTypeId: defaultAppointmentTypeId,
      }));
    }
  }, [defaultAppointmentTypeId, simulatedContext.appointmentTypeId]);

  // Transform rule sets to include isActive computed field
  // RuleSetSummary interface expects: { _id, description, isActive, version }
  const ruleSetsWithActive = useMemo(() => {
    if (!ruleSetsQuery || !currentPractice) {
      return;
    }
    return ruleSetsQuery.map((rs) => ({
      _id: rs._id,
      description: rs.description,
      isActive: currentPractice.currentActiveRuleSetId === rs._id,
      version: rs.version,
    }));
  }, [ruleSetsQuery, currentPractice]);

  // Mutations
  const activateRuleSetMutation = useMutation(api.ruleSets.setActiveRuleSet);
  const saveUnsavedRuleSetMutation = useMutation(
    api.ruleSets.saveUnsavedRuleSet,
  );
  const deleteUnsavedRuleSetMutation = useMutation(
    api.ruleSets.deleteUnsavedRuleSet,
  );

  const activeRuleSet = ruleSetsWithActive?.find((rs) => rs.isActive);
  // selectedRuleSet will be computed after unsavedRuleSet and ruleSetIdFromUrl are available

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsWithActive?.find(
    (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  // Transform unsavedRuleSet from raw query to include isActive
  const unsavedRuleSet = useMemo(() => {
    const rawUnsaved =
      ruleSetsQuery?.find((rs) => rs._id === unsavedRuleSetId) ??
      (existingUnsavedRuleSet
        ? ruleSetsQuery?.find((rs) => rs._id === existingUnsavedRuleSet._id)
        : undefined);
    if (!rawUnsaved || !currentPractice) {
      return;
    }
    return {
      _id: rawUnsaved._id,
      description: rawUnsaved.description,
      isActive: currentPractice.currentActiveRuleSetId === rawUnsaved._id,
      version: rawUnsaved.version,
    };
  }, [
    ruleSetsQuery,
    unsavedRuleSetId,
    existingUnsavedRuleSet,
    currentPractice,
  ]);

  // Get the search params directly to determine which rule set to use
  const routeSearch: RegelnSearchParams = Route.useSearch();

  // Determine current working rule set based on URL
  // We'll do a preliminary calculation to fetch locations
  const preliminarySelectedRuleSet = useMemo(() => {
    // We need to extract ruleSetIdFromUrl logic inline here to avoid circular dependency
    const ruleSetSlug = routeSearch.regelwerk;
    if (!ruleSetSlug) {
      return;
    }
    if (ruleSetSlug === "ungespeichert") {
      return ruleSetsWithActive?.find((rs) => rs._id === unsavedRuleSet?._id);
    }
    // Match by ID directly - IDs are unique and prevent collisions
    return ruleSetsWithActive?.find((rs) => rs._id === ruleSetSlug);
  }, [ruleSetsWithActive, unsavedRuleSet, routeSearch.regelwerk]);

  const preliminaryWorkingRuleSet = useMemo(
    () => unsavedRuleSet ?? preliminarySelectedRuleSet ?? activeRuleSet,
    [unsavedRuleSet, preliminarySelectedRuleSet, activeRuleSet],
  );

  // Fetch locations for the working rule set
  const locationsListQuery = useQuery(
    api.entities.getLocations,
    preliminaryWorkingRuleSet
      ? { ruleSetId: preliminaryWorkingRuleSet._id }
      : "skip",
  );

  // Now call the hook ONCE with all the data we have
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
    locationsListQuery: locationsListQuery ?? undefined,
    ruleSetsQuery: ruleSetsWithActive,
    unsavedRuleSet: unsavedRuleSet ?? null,
  });

  // Determine current working rule set based on the properly computed ruleSetIdFromUrl
  const selectedRuleSet = useMemo(
    () => ruleSetsWithActive?.find((rs) => rs._id === ruleSetIdFromUrl),
    [ruleSetsWithActive, ruleSetIdFromUrl],
  );

  // Use unsaved rule set if available, otherwise selected rule set, otherwise active rule set
  const currentWorkingRuleSet = useMemo(
    () => unsavedRuleSet ?? selectedRuleSet ?? activeRuleSet,
    [unsavedRuleSet, selectedRuleSet, activeRuleSet],
  );

  // Function to get or wait for the unsaved rule set
  // With CoW, the unsaved rule set is created automatically by mutations when needed
  const createInitialUnsaved = React.useCallback(() => {
    if (!currentPractice) {
      return;
    }

    // Simply return the existing unsaved rule set if it exists
    if (existingUnsavedRuleSet) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
      return existingUnsavedRuleSet._id;
    }

    // If no unsaved rule set exists yet, it will be created automatically
    // by the first mutation that tries to modify data (via CoW)
    // For now, we return null and let the mutations handle it
    return null;
  }, [currentPractice, existingUnsavedRuleSet]);

  // Callback to handle rule set creation from mutations
  // When a mutation creates a new rule set (via CoW), this navigates to it
  const handleRuleSetCreated = useCallback(
    (ruleSetId: Id<"ruleSets">) => {
      setUnsavedRuleSetId(ruleSetId);
      pushUrl({ ruleSetId });
    },
    [pushUrl],
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
  const resetSimulation = useCallback(async () => {
    setIsResettingSimulation(true);
    try {
      const resetContext = createSimulatedContext({
        ...(defaultAppointmentTypeId && {
          appointmentTypeId: defaultAppointmentTypeId,
        }),
        isNewPatient: true,
      });
      setSimulatedContext(resetContext);
      pushUrl({
        date: new Date(),
        isNewPatient: true,
        ruleSetId: undefined,
      });

      await performClearSimulatedAppointments({ silent: true });
    } finally {
      setIsResettingSimulation(false);
    }
  }, [defaultAppointmentTypeId, performClearSimulatedAppointments, pushUrl]);

  // Auto-detect existing unsaved rule set on load
  React.useEffect(() => {
    if (existingUnsavedRuleSet && !unsavedRuleSetId) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
    }
  }, [existingUnsavedRuleSet, unsavedRuleSetId]);

  // Auto-create an initial unsaved rule set when no rule sets exist
  React.useEffect(() => {
    if (currentPractice && ruleSetsQuery?.length === 0 && !unsavedRuleSetId) {
      void createInitialUnsaved();
    }
  }, [currentPractice, ruleSetsQuery, unsavedRuleSetId, createInitialUnsaved]);

  // Keep patient.isNew in local simulatedContext in sync with URL
  React.useEffect(() => {
    if (simulatedContext.patient.isNew !== isNewPatient) {
      setSimulatedContext((prev) => ({
        ...prev,
        patient: { isNew: isNewPatient },
      }));
    }
  }, [isNewPatient, simulatedContext.patient.isNew]);

  // Sync URL location to Context on initial load or URL change (e.g., from shared link)
  // This is ONE-WAY: URL → Context only. User changes go through onLocationChange → pushUrl → URL
  React.useEffect(() => {
    if (locationIdFromUrl) {
      setSimulatedContext((prev) => {
        if (prev.locationId === locationIdFromUrl) {
          return prev;
        }
        return {
          ...prev,
          locationId: locationIdFromUrl,
        };
      });
    }
  }, [locationIdFromUrl]);

  // TODO: Fetch rules for the current working rule set (re-enable once new rule system is implemented)
  // const rulesQuery = useQuery(
  //   api.entities.getRules,
  //   currentWorkingRuleSet ? { ruleSetId: currentWorkingRuleSet._id } : "skip",
  // );

  // Convert selectedDate (JS Date) to Temporal.PlainDate for the calendar components
  const simulationDate = useMemo(
    () =>
      Temporal.PlainDate.from({
        day: selectedDate.getDate(),
        month: selectedDate.getMonth() + 1, // JS months are 0-indexed
        year: selectedDate.getFullYear(),
      }),
    [selectedDate],
  );

  // Create date range representing a full calendar day without timezone issues (after selectedDate is known)
  // This is still used by PatientBookingFlow which hasn't been converted to Temporal yet
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  const dateRange = {
    end: endOfDay.toISOString(),
    start: startOfDay.toISOString(),
  };

  // Create patient info for the right sidebar in staff view
  // This extracts patient information from the simulated context
  const patientInfo: PatientInfo = useMemo(
    () => ({
      isNewPatient,
    }),
    [isNewPatient],
  );

  // With CoW, we don't need to explicitly create copies
  // The backend will handle draft creation automatically when mutations are made
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

  const handleActivateRuleSet = async (ruleSetId: Id<"ruleSets">) => {
    try {
      // Check if this is the unsaved rule set
      const isUnsavedRuleSet = ruleSetId === unsavedRuleSetId;

      if (isUnsavedRuleSet) {
        // Save and activate the unsaved rule set
        await saveUnsavedRuleSetMutation({
          description: activationName || "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
          setAsActive: true,
        });
      } else {
        // Just activate an already-saved rule set
        await activateRuleSetMutation({
          practiceId: currentPractice._id,
          ruleSetId,
        });
      }

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
  // Note: name parameter is required by the interface but not used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSaveOnly = (_name: string) => {
    if (!currentWorkingRuleSet) {
      return;
    }

    void (async () => {
      try {
        const isUnsavedRuleSet = currentWorkingRuleSet._id === unsavedRuleSetId;

        if (isUnsavedRuleSet) {
          // Save the unsaved rule set WITHOUT activating
          await saveUnsavedRuleSetMutation({
            description: activationName || "Ungespeicherte Änderungen",
            practiceId: currentPractice._id,
            setAsActive: false, // Key difference: don't activate
          });
        }
        // If it's already saved, there's nothing to do

        setUnsavedRuleSetId(null);
        setPendingRuleSetId(undefined);
        setIsSaveDialogOpen(false);
        setActivationName("");
        toast.success("Änderungen gespeichert");

        // Navigate to pending rule set if there was one, otherwise stay on current
        if (pendingRuleSetId === undefined) {
          // Stay on the saved rule set (don't navigate away)
          pushUrl({ ruleSetId: currentWorkingRuleSet._id });
        } else {
          pushUrl({ ruleSetId: pendingRuleSetId });
        }
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
  };

  // Note: name parameter is required by the interface but not used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSaveAndActivate = (_name: string) => {
    if (currentWorkingRuleSet) {
      void handleActivateRuleSet(currentWorkingRuleSet._id);
    }
  };

  const handleDiscardChanges = () => {
    if (unsavedRuleSet) {
      // Delete the unsaved rule set from the database
      void (async () => {
        try {
          await deleteUnsavedRuleSetMutation({
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rule-management">
              Regelverwaltung + Patientensicht
            </TabsTrigger>
            <TabsTrigger value="staff-view">Praxismitarbeiter</TabsTrigger>
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
                      {ruleSetsQuery?.length === 0 && (
                        <CardDescription>
                          Erstellen Sie Ihr erstes Regelset durch das Hinzufügen
                          von Regeln, Ärzten oder Arbeitszeiten.
                        </CardDescription>
                      )}
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
                          (ruleSetsQuery?.length === 0 &&
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
                                void handleActivateRuleSet(selectedRuleSet._id)
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

                  {/* Appointment Types Management */}
                  {currentWorkingRuleSet && (
                    <AppointmentTypesManagement
                      onRuleSetCreated={(newRuleSetId) => {
                        setUnsavedRuleSetId(newRuleSetId);
                      }}
                      practiceId={currentPractice._id}
                      ruleSetId={currentWorkingRuleSet._id}
                    />
                  )}

                  {/* Practitioner Management */}
                  {currentWorkingRuleSet && (
                    <PractitionerManagement
                      onRuleSetCreated={handleRuleSetCreated}
                      practiceId={currentPractice._id}
                      ruleSetId={currentWorkingRuleSet._id}
                    />
                  )}

                  {/* Base Schedule Management */}
                  {currentWorkingRuleSet && (
                    <BaseScheduleManagement
                      onRuleSetCreated={handleRuleSetCreated}
                      practiceId={currentPractice._id}
                      ruleSetId={currentWorkingRuleSet._id}
                    />
                  )}

                  {/* Locations Management */}
                  {currentWorkingRuleSet && (
                    <LocationsManagement
                      onRuleSetCreated={handleRuleSetCreated}
                      practiceId={currentPractice._id}
                      ruleSetId={currentWorkingRuleSet._id}
                    />
                  )}
                </div>
              </div>

              {/* Right Panel - Patient View + Simulation Controls */}
              <div className="space-y-6">
                {ruleSetIdFromUrl ? (
                  <div className="flex justify-center">
                    <PatientBookingFlow
                      dateRange={dateRange}
                      onLocationChange={(locationId) => {
                        pushUrl({ locationId });
                      }}
                      onUpdateSimulatedContext={(ctx) => {
                        setSimulatedContext(ctx);
                        pushUrl({
                          isNewPatient: ctx.patient.isNew,
                          locationId: ctx.locationId,
                        });
                      }}
                      practiceId={currentPractice._id}
                      ruleSetId={ruleSetIdFromUrl}
                      simulatedContext={simulatedContext}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    Bitte wählen Sie einen Regelsatz aus, um die Patientensicht
                    anzuzeigen.
                  </div>
                )}

                <SimulationControls
                  isClearingSimulatedAppointments={
                    isClearingSimulatedAppointments
                  }
                  isResettingSimulation={isResettingSimulation}
                  locationsListQuery={locationsListQuery}
                  onClearSimulatedAppointments={
                    handleClearSimulatedAppointments
                  }
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onLocationChange={(locationId) => {
                    pushUrl({ locationId });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({
                      isNewPatient: ctx.patient.isNew,
                      locationId: ctx.locationId,
                    });
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
                  ruleSetsQuery={ruleSetsWithActive}
                  selectedDate={selectedDate}
                  selectedLocationId={locationIdFromUrl}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
                />
              </div>
            </div>

            {/* Full width Rules List */}
            {(currentWorkingRuleSet ?? ruleSetsQuery?.length === 0) && (
              <div className="mt-6">
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
                                  Regeln in {currentWorkingRuleSet.description}
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
                  </CardHeader>
                  <CardContent>
                    {currentWorkingRuleSet && (
                      <RuleBuilder
                        onRuleCreated={handleRuleSetCreated}
                        practiceId={currentPractice._id}
                        ruleSetId={currentWorkingRuleSet._id}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Staff View Only */}
          <TabsContent value="staff-view">
            <div className="space-y-6">
              <div className="space-y-6">
                {ruleSetIdFromUrl ? (
                  <MedicalStaffDisplay
                    onUpdateSimulatedContext={(ctx) => {
                      setSimulatedContext(ctx);
                      pushUrl({
                        isNewPatient: ctx.patient.isNew,
                        locationId: ctx.locationId,
                      });
                    }}
                    patient={patientInfo}
                    practiceId={currentPractice._id}
                    ruleSetId={ruleSetIdFromUrl}
                    simulatedContext={simulatedContext}
                    simulationDate={simulationDate}
                  />
                ) : (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    Bitte wählen Sie ein Regelwerk aus, um die
                    Mitarbeiteransicht anzuzeigen.
                  </div>
                )}

                <SimulationControls
                  isClearingSimulatedAppointments={
                    isClearingSimulatedAppointments
                  }
                  isResettingSimulation={isResettingSimulation}
                  locationsListQuery={locationsListQuery}
                  onClearSimulatedAppointments={
                    handleClearSimulatedAppointments
                  }
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onLocationChange={(locationId) => {
                    pushUrl({ locationId });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({
                      isNewPatient: ctx.patient.isNew,
                      locationId: ctx.locationId,
                    });
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
                  ruleSetsQuery={ruleSetsWithActive}
                  selectedDate={selectedDate}
                  selectedLocationId={locationIdFromUrl}
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
            onDiscard={pendingRuleSetId ? handleDiscardChanges : null}
            onSaveAndActivate={handleSaveAndActivate}
            onSaveOnly={handleSaveOnly}
            setActivationName={setActivationName}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveDialogForm({
  activationName,
  onDiscard,
  onSaveAndActivate,
  onSaveOnly,
  setActivationName,
}: SaveDialogFormProps) {
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

  // Simple validation: just check if name is not empty
  const isValidName = React.useMemo(() => {
    return form.getFieldValue("name").trim().length > 0;
  }, [form]);

  const validationError = React.useMemo(() => {
    const trimmedName = form.getFieldValue("name").trim();
    if (!trimmedName) {
      return "Name ist erforderlich";
    }
    return;
  }, [form]);

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
