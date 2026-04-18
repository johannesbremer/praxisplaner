// src/routes/regeln.tsx
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { RefreshCw, Save, Undo2 } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { RESERVED_UNSAVED_DESCRIPTION } from "@/convex/ruleSetValidation";

import type { VersionNode } from "../components/version-graph/types";
import type { LocalHistoryAction } from "../hooks/use-local-history";
import type { SchedulingSimulatedContext } from "../types";
import type { RuleSetReplayTarget } from "../utils/cow-history";

import { createSimulatedContext } from "../../lib/utils";
import { AppointmentTypesManagement } from "../components/appointment-types-management";
import BaseScheduleManagement from "../components/base-schedule-management";
import { LocationsManagement } from "../components/locations-management";
import { MedicalStaffDisplay } from "../components/medical-staff-display";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import { RuleBuilder } from "../components/rule-builder";
import { VacationScheduler } from "../components/vacation-scheduler";
import { VersionGraph } from "../components/version-graph/index";
import { useRegisterGlobalUndoRedoControls } from "../hooks/use-global-undo-redo-controls";
import { useLocalHistory } from "../hooks/use-local-history";
import { isValidDateDE } from "../utils/date-utils";
import { useErrorTracking } from "../utils/error-tracking";
import {
  frontendErrorFromUnknown,
  wrapAsyncResult,
} from "../utils/frontend-errors";
import {
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
  type RegelnSearchParams,
  type RegelnTabParam,
  useRegelnUrl,
} from "../utils/regeln-url";
import {
  type RuleSetDiff,
  RuleSetDiffChangeCount,
  RuleSetDiffView,
  SaveDialogForm,
  UNSAVED_RULE_SET_DESCRIPTION,
} from "./regeln/-rule-set-diff";
import { SimulationControls } from "./regeln/-simulation-controls";

type SimulatedContext = SchedulingSimulatedContext;

export const Route = createFileRoute("/regeln")({
  component: LogicView,
  validateSearch: (search): RegelnSearchParams => {
    const params = search;

    const result: RegelnSearchParams = {};

    if (
      params["tab"] === "mitarbeiter" ||
      params["tab"] === "debug" ||
      params["tab"] === "urlaub"
    ) {
      result.tab = params["tab"] as RegelnTabParam;
    }

    if (
      typeof params["standort"] === "string" &&
      params["standort"].length > 0
    ) {
      result.standort = params["standort"];
    }

    if (isValidDateDE(params["datum"])) {
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
  const [draftRevisionOverride, setDraftRevisionOverride] = useState<
    null | number
  >(null);
  const [isDraftEquivalentToParent, setIsDraftEquivalentToParent] =
    useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const [isInitializingPractice, setIsInitializingPractice] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [discardTargetRuleSetId, setDiscardTargetRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();
  const [pendingRuleSetId, setPendingRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();
  const [activationName, setActivationName] = useState("");
  const [isClearingSimulatedAppointments, setIsClearingSimulatedAppointments] =
    useState(false);
  const [isResettingSimulation, setIsResettingSimulation] = useState(false);
  const discardingUnsavedRuleSetIdRef = useRef<Id<"ruleSets"> | null>(null);
  const pendingDraftRuleSetNavigationIdRef = useRef<Id<"ruleSets"> | null>(
    null,
  );
  const {
    canRedo: canRedoRegelnHistoryAction,
    canUndo: canUndoRegelnHistoryAction,
    clear: clearRegelnHistoryAction,
    pushAction: pushRegelnHistoryAction,
    redo: redoRegelnHistoryAction,
    redoDepth: redoRegelnHistoryDepth,
    undo: undoRegelnHistoryAction,
  } = useLocalHistory();

  const registerRegelnHistoryAction = useCallback(
    (action: LocalHistoryAction) => {
      pushRegelnHistoryAction(action);
    },
    [pushRegelnHistoryAction],
  );

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
    (options: { silent?: boolean }) =>
      wrapAsyncResult(
        async () => {
          const { silent = false } = options;
          if (!currentPractice) {
            return 0;
          }

          const result = await deleteAllSimulatedDataMutation({
            practiceId: currentPractice._id,
          });
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
        },
        (error) => {
          captureError(error, {
            context: "simulation_clear",
          });

          const frontendError = frontendErrorFromUnknown(error, {
            kind: "invalid_state",
            message:
              error instanceof Error ? error.message : "Unbekannter Fehler",
            source: "performClearSimulatedAppointments",
          });

          toast.error("Simulationsdaten konnten nicht gelöscht werden", {
            description: frontendError.message,
          });

          return frontendError;
        },
      ),
    [captureError, currentPractice, deleteAllSimulatedDataMutation],
  );

  const handleClearSimulatedAppointments = useCallback(async () => {
    try {
      setIsClearingSimulatedAppointments(true);
      await performClearSimulatedAppointments({}).match(
        () => 0,
        () => 0,
      );
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
  const hasAutoInitializedDefaultAppointmentTypeRef = useRef(false);

  React.useEffect(() => {
    hasAutoInitializedDefaultAppointmentTypeRef.current = false;
  }, [firstRuleSetId]);

  // Initialize appointmentTypeId once appointment types are loaded
  React.useEffect(() => {
    if (
      defaultAppointmentTypeId &&
      !simulatedContext.appointmentTypeId &&
      !hasAutoInitializedDefaultAppointmentTypeRef.current
    ) {
      hasAutoInitializedDefaultAppointmentTypeRef.current = true;
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
  }, [currentPractice, ruleSetsQuery]);

  // Mutations
  const activateRuleSetMutation = useMutation(api.ruleSets.setActiveRuleSet);
  const saveUnsavedRuleSetMutation = useMutation(
    api.ruleSets.saveUnsavedRuleSet,
  );
  const deleteUnsavedRuleSetMutation = useMutation(
    api.ruleSets.deleteUnsavedRuleSet,
  ).withOptimisticUpdate((localStore, args) => {
    const queryArgs = { practiceId: args.practiceId };

    const allRuleSets = localStore.getQuery(
      api.ruleSets.getAllRuleSets,
      queryArgs,
    );
    if (allRuleSets !== undefined) {
      localStore.setQuery(
        api.ruleSets.getAllRuleSets,
        queryArgs,
        allRuleSets.filter((ruleSet) => ruleSet._id !== args.ruleSetId),
      );
    }

    const unsavedRuleSet = localStore.getQuery(
      api.ruleSets.getUnsavedRuleSet,
      queryArgs,
    );
    if (unsavedRuleSet?._id === args.ruleSetId) {
      localStore.setQuery(api.ruleSets.getUnsavedRuleSet, queryArgs, null);
    }

    const versionHistory = localStore.getQuery(
      api.ruleSets.getVersionHistory,
      queryArgs,
    );
    if (versionHistory !== undefined) {
      localStore.setQuery(
        api.ruleSets.getVersionHistory,
        queryArgs,
        versionHistory.filter((version) => version.id !== args.ruleSetId),
      );
    }
  });
  const discardEquivalentUnsavedRuleSetMutation = useMutation(
    api.ruleSets.discardUnsavedRuleSetIfEquivalentToParent,
  );

  const activeRuleSet = ruleSetsWithActive?.find((rs) => rs.isActive);
  // selectedRuleSet will be computed after unsavedRuleSet and ruleSetIdFromUrl are available

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsWithActive?.find(
    (rs) => !rs.isActive && rs.description === UNSAVED_RULE_SET_DESCRIPTION,
  );

  // Transform unsavedRuleSet from raw query to include isActive
  const unsavedRuleSet = useMemo(() => {
    const rawUnsaved = unsavedRuleSetId
      ? ruleSetsQuery?.find((rs) => rs._id === unsavedRuleSetId)
      : undefined;
    if (!currentPractice) {
      return;
    }
    if (!rawUnsaved) {
      return;
    }

    if (rawUnsaved.saved) {
      return;
    }

    return {
      _id: rawUnsaved._id,
      description: rawUnsaved.description,
      draftRevision: rawUnsaved.draftRevision,
      isActive: currentPractice.currentActiveRuleSetId === rawUnsaved._id,
      parentVersion: rawUnsaved.parentVersion,
      version: rawUnsaved.version,
    };
  }, [currentPractice, ruleSetsQuery, unsavedRuleSetId]);

  // Get the search params directly to determine which rule set to use
  const routeSearch: RegelnSearchParams = Route.useSearch();

  // Determine current working rule set based on URL
  // We'll do a preliminary calculation to fetch locations
  const preliminarySelectedRuleSet = useMemo(() => {
    // We need to extract ruleSetIdFromUrl logic inline here to avoid circular dependency
    const ruleSetId = routeSearch.regelwerk;
    if (!ruleSetId) {
      return;
    }
    if (ruleSetId === "ungespeichert") {
      return ruleSetsQuery?.find((rs) => rs._id === unsavedRuleSet?._id);
    }
    // Match by ID directly - IDs are unique and prevent collisions
    return ruleSetsQuery?.find((rs) => rs._id === ruleSetId);
  }, [ruleSetsQuery, routeSearch.regelwerk, unsavedRuleSet]);

  const preliminaryWorkingRuleSet = useMemo(
    () => preliminarySelectedRuleSet ?? unsavedRuleSet ?? activeRuleSet,
    [preliminarySelectedRuleSet, unsavedRuleSet, activeRuleSet],
  );
  const resolvedPreliminaryWorkingRuleSet = useMemo(
    () =>
      preliminaryWorkingRuleSet &&
      ruleSetsQuery?.some(
        (ruleSet) => ruleSet._id === preliminaryWorkingRuleSet._id,
      )
        ? preliminaryWorkingRuleSet
        : undefined,
    [preliminaryWorkingRuleSet, ruleSetsQuery],
  );

  // Fetch locations for the working rule set
  const locationsListQuery = useQuery(
    api.entities.getLocations,
    resolvedPreliminaryWorkingRuleSet
      ? { ruleSetId: resolvedPreliminaryWorkingRuleSet._id }
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
    () => ruleSetsQuery?.find((rs) => rs._id === ruleSetIdFromUrl),
    [ruleSetsQuery, ruleSetIdFromUrl],
  );
  const resolvedRuleSetIdFromUrl = useMemo(
    () =>
      ruleSetsQuery?.some((ruleSet) => ruleSet._id === ruleSetIdFromUrl)
        ? ruleSetIdFromUrl
        : undefined,
    [ruleSetIdFromUrl, ruleSetsQuery],
  );

  // Use unsaved rule set if available, otherwise selected rule set, otherwise active rule set
  const currentWorkingRuleSet = useMemo(
    () => selectedRuleSet ?? unsavedRuleSet ?? activeRuleSet,
    [selectedRuleSet, unsavedRuleSet, activeRuleSet],
  );
  const resolvedCurrentWorkingRuleSet = useMemo(
    () =>
      currentWorkingRuleSet &&
      ruleSetsQuery?.some(
        (ruleSet) => ruleSet._id === currentWorkingRuleSet._id,
      )
        ? currentWorkingRuleSet
        : undefined,
    [currentWorkingRuleSet, ruleSetsQuery],
  );
  const isShowingUnsavedRuleSet =
    Boolean(unsavedRuleSet) &&
    currentWorkingRuleSet?._id === unsavedRuleSet?._id;
  const hasBlockingUnsavedChanges = Boolean(
    unsavedRuleSet && !isDraftEquivalentToParent,
  );
  const ruleSetDiff = useQuery(
    api.ruleSets.getUnsavedRuleSetDiff,
    currentPractice && unsavedRuleSet && !isDraftEquivalentToParent
      ? {
          practiceId: currentPractice._id,
          ruleSetId: unsavedRuleSet._id,
        }
      : "skip",
  ) as RuleSetDiff | undefined;
  React.useEffect(() => {
    if (
      !raw.ruleSet ||
      raw.ruleSet === RESERVED_UNSAVED_DESCRIPTION ||
      !ruleSetsQuery ||
      resolvedRuleSetIdFromUrl ||
      unsavedRuleSet
    ) {
      return;
    }

    pushUrl({ ruleSetId: activeRuleSet?._id });
  }, [
    activeRuleSet?._id,
    pushUrl,
    raw.ruleSet,
    ruleSetsQuery,
    resolvedRuleSetIdFromUrl,
    unsavedRuleSet,
  ]);
  const ruleSetReplayTarget = useMemo((): null | RuleSetReplayTarget => {
    if (!resolvedCurrentWorkingRuleSet) {
      return null;
    }
    if (unsavedRuleSet?.parentVersion) {
      return {
        draftRevision: draftRevisionOverride ?? unsavedRuleSet.draftRevision,
        draftRuleSetId: unsavedRuleSet._id,
        kind: "draft",
        parentRuleSetId: unsavedRuleSet.parentVersion,
      };
    }
    return {
      kind: "saved-parent",
      parentRuleSetId: resolvedCurrentWorkingRuleSet._id,
    };
  }, [draftRevisionOverride, resolvedCurrentWorkingRuleSet, unsavedRuleSet]);
  React.useEffect(() => {
    if (!ruleSetsQuery || !unsavedRuleSetId) {
      return;
    }

    const draftStillExists = ruleSetsQuery.some(
      (ruleSet) => ruleSet._id === unsavedRuleSetId && !ruleSet.saved,
    );
    if (draftStillExists) {
      return;
    }

    setUnsavedRuleSetId(null);
    setDraftRevisionOverride(null);
    setIsDraftEquivalentToParent(false);
  }, [ruleSetsQuery, unsavedRuleSetId]);

  React.useEffect(() => {
    if (!unsavedRuleSet) {
      setDraftRevisionOverride(null);
      setIsDraftEquivalentToParent(false);
      return;
    }
    setDraftRevisionOverride(unsavedRuleSet.draftRevision);
  }, [
    unsavedRuleSet,
    unsavedRuleSet?._id,
    unsavedRuleSet?.draftRevision,
    unsavedRuleSet?.parentVersion,
  ]);

  const historyScopeKey = useMemo(() => {
    const isWorkingOnUnsavedRuleSet =
      unsavedRuleSet && currentWorkingRuleSet?._id === unsavedRuleSet._id;
    if (isWorkingOnUnsavedRuleSet && unsavedRuleSet.parentVersion) {
      return unsavedRuleSet.parentVersion;
    }
    if (ruleSetIdFromUrl) {
      return ruleSetIdFromUrl;
    }
    return null;
  }, [currentWorkingRuleSet?._id, ruleSetIdFromUrl, unsavedRuleSet]);
  const lastHistoryScopeRef = useRef<null | string>(historyScopeKey);

  React.useEffect(() => {
    if (!historyScopeKey) {
      return;
    }
    if (!lastHistoryScopeRef.current) {
      lastHistoryScopeRef.current = historyScopeKey;
      return;
    }
    if (lastHistoryScopeRef.current === historyScopeKey) {
      return;
    }

    clearRegelnHistoryAction();
    lastHistoryScopeRef.current = historyScopeKey;
  }, [clearRegelnHistoryAction, historyScopeKey]);

  const isRegelnHistoryTab =
    activeTab === "rule-management" || activeTab === "vacation-scheduler";

  const runRegelnUndo = useCallback(async () => {
    if (!currentPractice) {
      toast.info("Keine rückgängig machbare Änderung vorhanden.");
      return;
    }

    const result = await undoRegelnHistoryAction();

    if (result.status === "conflict") {
      toast.error("Änderung konnte nicht rückgängig gemacht werden", {
        description: result.message,
      });
      return;
    }
    if (result.status === "applied") {
      toast.success("Änderung rückgängig gemacht");
      if (
        !result.canUndoAfter &&
        isRegelnHistoryTab &&
        unsavedRuleSet?.parentVersion
      ) {
        const draftToDiscard = unsavedRuleSet;
        const parentRuleSetId = unsavedRuleSet.parentVersion;
        const previousDraftRevision = draftToDiscard.draftRevision;
        discardingUnsavedRuleSetIdRef.current = draftToDiscard._id;

        try {
          setUnsavedRuleSetId(null);
          setDraftRevisionOverride(null);
          setIsDraftEquivalentToParent(false);
          pushUrl({ ruleSetId: parentRuleSetId });

          const discardResult = await discardEquivalentUnsavedRuleSetMutation({
            practiceId: currentPractice._id,
            ruleSetId: draftToDiscard._id,
          });

          if (!discardResult.deleted) {
            setUnsavedRuleSetId(draftToDiscard._id);
            setDraftRevisionOverride(previousDraftRevision);
            setIsDraftEquivalentToParent(false);
            pushUrl({ ruleSetId: draftToDiscard._id });
          }
        } catch (error: unknown) {
          discardingUnsavedRuleSetIdRef.current = null;
          setUnsavedRuleSetId(draftToDiscard._id);
          setDraftRevisionOverride(previousDraftRevision);
          setIsDraftEquivalentToParent(false);
          pushUrl({ ruleSetId: draftToDiscard._id });
          captureError(error, {
            context: "discard_equivalent_draft_after_final_undo",
            practiceId: currentPractice._id,
            ruleSetId: draftToDiscard._id,
          });
        } finally {
          if (discardingUnsavedRuleSetIdRef.current === draftToDiscard._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
        }
      }
      return;
    }
    toast.info("Keine rückgängig machbare Änderung vorhanden.");
  }, [
    isRegelnHistoryTab,
    pushUrl,
    captureError,
    currentPractice,
    discardEquivalentUnsavedRuleSetMutation,
    undoRegelnHistoryAction,
    unsavedRuleSet,
  ]);

  const runRegelnRedo = useCallback(async () => {
    const previousRuleSetId = ruleSetIdFromUrl;
    setIsDraftEquivalentToParent(false);
    const shouldRestorePreviousRuleSet =
      previousRuleSetId !== undefined &&
      unsavedRuleSet !== undefined &&
      previousRuleSetId !== unsavedRuleSet._id;
    if (
      isRegelnHistoryTab &&
      redoRegelnHistoryDepth > 0 &&
      unsavedRuleSet &&
      ruleSetIdFromUrl !== unsavedRuleSet._id
    ) {
      pushUrl({ ruleSetId: unsavedRuleSet._id });
    }

    const result = await redoRegelnHistoryAction();

    if (result.status === "conflict") {
      if (shouldRestorePreviousRuleSet) {
        setIsDraftEquivalentToParent(true);
        pushUrl({ ruleSetId: previousRuleSetId });
      }
      toast.error("Änderung konnte nicht wiederhergestellt werden", {
        description: result.message,
      });
      return;
    }
    if (result.status === "applied") {
      toast.success("Änderung wiederhergestellt");
      return;
    }
    if (shouldRestorePreviousRuleSet) {
      setIsDraftEquivalentToParent(true);
      pushUrl({ ruleSetId: previousRuleSetId });
    }
    toast.info("Keine wiederherstellbare Änderung vorhanden.");
  }, [
    isRegelnHistoryTab,
    pushUrl,
    redoRegelnHistoryAction,
    redoRegelnHistoryDepth,
    ruleSetIdFromUrl,
    unsavedRuleSet,
  ]);

  const regelnUndoRedoControls = useMemo(
    () =>
      isRegelnHistoryTab &&
      (canUndoRegelnHistoryAction || canRedoRegelnHistoryAction)
        ? {
            canRedo: canRedoRegelnHistoryAction,
            canUndo: canUndoRegelnHistoryAction,
            onRedo: runRegelnRedo,
            onUndo: runRegelnUndo,
          }
        : null,
    [
      canRedoRegelnHistoryAction,
      canUndoRegelnHistoryAction,
      isRegelnHistoryTab,
      runRegelnRedo,
      runRegelnUndo,
    ],
  );

  useRegisterGlobalUndoRedoControls(regelnUndoRedoControls);

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

  const handleDraftMutation = useCallback(
    (result: { draftRevision: number; ruleSetId: Id<"ruleSets"> }) => {
      setUnsavedRuleSetId(result.ruleSetId);
      setIsDraftEquivalentToParent(false);
      setIsSaveDialogOpen(false);
      setPendingRuleSetId(undefined);
      setDraftRevisionOverride(result.draftRevision);
      pendingDraftRuleSetNavigationIdRef.current = result.ruleSetId;
    },
    [],
  );

  // Helper to push the canonical URL reflecting current UI intent
  // pushUrl and navigateTab come from useRegelnUrl

  // Ensure the URL reflects an existing unsaved draft selection
  // If an unsaved rule set exists but the URL doesn't say 'ungespeichert',
  // navigate to include it so the URL remains the single source of truth.
  React.useEffect(() => {
    // Only enforce when the ruleSet segment is missing entirely.
    // Do NOT override a user-chosen named rule set in the URL.
    if (!unsavedRuleSet) {
      return;
    }
    if (raw.ruleSet) {
      return;
    }
    if (ruleSetIdFromUrl === unsavedRuleSet._id) {
      return;
    }
    // Avoid navigating before we know the date from URL/state.
    if (!(selectedDate instanceof Date)) {
      return;
    }

    pushUrl({ ruleSetId: unsavedRuleSet._id as Id<"ruleSets"> });
  }, [unsavedRuleSet, raw.ruleSet, ruleSetIdFromUrl, selectedDate, pushUrl]);

  React.useEffect(() => {
    const pendingDraftRuleSetId = pendingDraftRuleSetNavigationIdRef.current;
    if (
      !pendingDraftRuleSetId ||
      unsavedRuleSet?._id !== pendingDraftRuleSetId
    ) {
      return;
    }

    pendingDraftRuleSetNavigationIdRef.current = null;
    if (ruleSetIdFromUrl !== pendingDraftRuleSetId) {
      pushUrl({ ruleSetId: pendingDraftRuleSetId });
    }
  }, [pushUrl, ruleSetIdFromUrl, unsavedRuleSet?._id]);

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

      await performClearSimulatedAppointments({ silent: true }).match(
        () => 0,
        () => 0,
      );
    } finally {
      setIsResettingSimulation(false);
    }
  }, [defaultAppointmentTypeId, performClearSimulatedAppointments, pushUrl]);

  // Auto-detect existing unsaved rule set on load
  React.useEffect(() => {
    if (!existingUnsavedRuleSet) {
      return;
    }

    // Respect explicit URL selection of a saved rule set.
    if (raw.ruleSet && raw.ruleSet !== "ungespeichert") {
      return;
    }

    if (!unsavedRuleSetId || unsavedRuleSetId !== existingUnsavedRuleSet._id) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
    }
  }, [existingUnsavedRuleSet, raw.ruleSet, unsavedRuleSetId]);

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
      if (hasBlockingUnsavedChanges && versionId !== unsavedRuleSet?._id) {
        setPendingRuleSetId(versionId);
        setActivationName("");
        setIsSaveDialogOpen(true);
        return;
      }

      // Navigate to the chosen version
      setUnsavedRuleSetId(null);
      pushUrl({ ruleSetId: versionId });
    },
    [currentPractice, hasBlockingUnsavedChanges, pushUrl, unsavedRuleSet],
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
      setIsDraftEquivalentToParent(false);
      setDraftRevisionOverride(null);

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
        setIsDraftEquivalentToParent(false);
        setDraftRevisionOverride(null);
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

  const handleOpenDiscardDialog = () => {
    setDiscardTargetRuleSetId(pendingRuleSetId ?? activeRuleSet?._id);
    setIsDiscardDialogOpen(true);
  };

  const handleDiscardChanges = () => {
    if (unsavedRuleSet) {
      const draftToDelete = unsavedRuleSet;
      const targetRuleSetId =
        discardTargetRuleSetId ?? pendingRuleSetId ?? activeRuleSet?._id;
      const wasSaveDialogOpen = isSaveDialogOpen;

      setIsSaveDialogOpen(false);
      setIsDiscardDialogOpen(false);
      setActivationName("");

      void (async () => {
        try {
          discardingUnsavedRuleSetIdRef.current = draftToDelete._id;
          setUnsavedRuleSetId(null);
          setIsDraftEquivalentToParent(false);
          setDraftRevisionOverride(null);
          pushUrl({ ruleSetId: targetRuleSetId });

          await deleteUnsavedRuleSetMutation({
            practiceId: currentPractice._id,
            ruleSetId: draftToDelete._id,
          });

          setPendingRuleSetId(undefined);
          setDiscardTargetRuleSetId(undefined);
          toast.success("Änderungen verworfen");
        } catch (error: unknown) {
          if (discardingUnsavedRuleSetIdRef.current === draftToDelete._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
          setUnsavedRuleSetId(draftToDelete._id);
          setDraftRevisionOverride(draftToDelete.draftRevision);
          if (wasSaveDialogOpen) {
            setIsSaveDialogOpen(true);
          }
          pushUrl({ ruleSetId: draftToDelete._id });

          captureError(error, {
            context: "discard_changes",
            practiceId: currentPractice._id,
            ruleSetId: draftToDelete._id,
          });

          toast.error("Fehler beim Verwerfen der Änderungen", {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          });
        } finally {
          if (discardingUnsavedRuleSetIdRef.current === draftToDelete._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
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

      {currentWorkingRuleSet && isShowingUnsavedRuleSet && (
        <div className="sticky top-3 z-40 mb-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 rounded-2xl border border-red-300 bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  Ungespeicherte Änderungen
                </div>
                <div className="text-sm text-muted-foreground">
                  Dieses Regelset enthält Änderungen gegenüber dem
                  übergeordneten Regelset, die noch nicht gespeichert wurden.
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  onClick={handleOpenDiscardDialog}
                  size="sm"
                  variant="outline"
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Änderungen verwerfen
                </Button>
                <Button onClick={handleOpenSaveDialog} size="sm">
                  Speichern
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <TabsTrigger value="vacation-scheduler">Urlaub</TabsTrigger>
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
                              {...((ruleSetIdFromUrl || unsavedRuleSetId) && {
                                selectedVersionId: (ruleSetIdFromUrl ||
                                  unsavedRuleSetId) as string,
                              })}
                              versions={versionsQuery}
                            />
                          </div>
                          {/* Show current state indicator */}
                          {isShowingUnsavedRuleSet && (
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
                        {(isShowingUnsavedRuleSet ||
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
                          !hasBlockingUnsavedChanges &&
                          selectedRuleSet._id !== activeRuleSet?._id && (
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
                  {ruleSetReplayTarget && (
                    <AppointmentTypesManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Practitioner Management */}
                  {ruleSetReplayTarget && (
                    <PractitionerManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Base Schedule Management */}
                  {ruleSetReplayTarget && (
                    <BaseScheduleManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Locations Management */}
                  {ruleSetReplayTarget && (
                    <LocationsManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}
                </div>
              </div>

              {/* Right Panel - Patient View + Simulation Controls */}
              <div className="space-y-6">
                {resolvedCurrentWorkingRuleSet ? (
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
                      ruleSetId={resolvedCurrentWorkingRuleSet._id}
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
                    if (
                      hasBlockingUnsavedChanges &&
                      id !== unsavedRuleSet?._id
                    ) {
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
                  simulationRuleSetId={resolvedCurrentWorkingRuleSet?._id}
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
                              {isShowingUnsavedRuleSet ? (
                                <>
                                  Regeln in{" "}
                                  <Badge className="ml-2" variant="secondary">
                                    Ungespeicherte Änderungen
                                  </Badge>
                                </>
                              ) : (
                                <>
                                  Regeln in {currentWorkingRuleSet.description}
                                  {currentWorkingRuleSet._id ===
                                    activeRuleSet?._id && (
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
                    {ruleSetReplayTarget && (
                      <RuleBuilder
                        onDraftMutation={handleDraftMutation}
                        onRegisterHistoryAction={registerRegelnHistoryAction}
                        practiceId={currentPractice._id}
                        ruleSetReplayTarget={ruleSetReplayTarget}
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
                {resolvedCurrentWorkingRuleSet ? (
                  <MedicalStaffDisplay
                    onUpdateSimulatedContext={(ctx) => {
                      setSimulatedContext(ctx);
                      pushUrl({
                        isNewPatient: ctx.patient.isNew,
                        locationId: ctx.locationId,
                      });
                    }}
                    practiceId={currentPractice._id}
                    ruleSetId={resolvedCurrentWorkingRuleSet._id}
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
                    if (
                      hasBlockingUnsavedChanges &&
                      id !== unsavedRuleSet?._id
                    ) {
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
                  simulationRuleSetId={resolvedCurrentWorkingRuleSet?._id}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="vacation-scheduler">
            {ruleSetReplayTarget && (
              <VacationScheduler
                editable
                onDateChange={(date) => {
                  pushUrl({
                    date: new Date(date.year, date.month - 1, date.day),
                  });
                }}
                onDraftMutation={handleDraftMutation}
                onRegisterHistoryAction={registerRegelnHistoryAction}
                practiceId={currentPractice._id}
                ruleSetReplayTarget={ruleSetReplayTarget}
                selectedDate={Temporal.PlainDate.from({
                  day: selectedDate.getDate(),
                  month: selectedDate.getMonth() + 1,
                  year: selectedDate.getFullYear(),
                })}
              />
            )}
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
        <DialogContent className="flex max-h-[calc(100vh-2rem)] !w-auto min-w-[min(32rem,calc(100vw-2rem))] !max-w-[calc(100vw-2rem)] flex-col overflow-auto">
          <DialogHeader>
            <DialogTitle>Änderungen speichern</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>
                {pendingRuleSetId
                  ? "Sie haben ungespeicherte Änderungen. Möchten Sie diese speichern, bevor Sie zu einem anderen Regelset wechseln?"
                  : "Geben Sie einen eindeutigen Namen für diese Änderungen ein."}
              </DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <SaveDialogForm
            activationName={activationName}
            existingSavedDescriptions={
              ruleSetsQuery
                ?.filter((rs) => rs.saved)
                .map((rs) => rs.description) ?? []
            }
            onDiscard={pendingRuleSetId ? handleDiscardChanges : null}
            onSaveAndActivate={handleSaveAndActivate}
            onSaveOnly={handleSaveOnly}
            ruleSetDiff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
            setActivationName={setActivationName}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setIsDiscardDialogOpen(open);
          if (!open) {
            setDiscardTargetRuleSetId(undefined);
          }
        }}
        open={isDiscardDialogOpen}
      >
        <DialogContent className="flex max-h-[calc(100vh-2rem)] !w-auto min-w-[min(32rem,calc(100vw-2rem))] !max-w-[calc(100vw-2rem)] flex-col overflow-auto">
          <DialogHeader>
            <DialogTitle>Änderungen verwerfen?</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>
                Diese ungespeicherten Änderungen werden gelöscht. Das kann nicht
                rückgängig gemacht werden.
              </DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <RuleSetDiffView
            diff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
          />
          <RuleSetDiffChangeCount
            diff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
          />
          <DialogFooter className="mt-2 flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              onClick={() => {
                setIsDiscardDialogOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDiscardChanges}
              type="button"
              variant="destructive"
            >
              Änderungen verwerfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
