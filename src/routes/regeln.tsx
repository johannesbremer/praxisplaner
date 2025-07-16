// src/routes/regeln.tsx
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Save, Trash2 } from "lucide-react";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

import BaseScheduleManagement from "../components/base-schedule-management";
import PractitionerManagement from "../components/practitioner-management";
import RuleCreationForm from "../components/rule-creation-form";
import RuleEditForm from "../components/rule-edit-form";
import { SimulationPanel } from "../components/simulation-panel";
import { useErrorTracking } from "../utils/error-tracking";

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

interface SaveDialogFormProps {
  activationName: string;
  currentWorkingRuleSet: null | undefined | { _id: Id<"ruleSets"> };
  onDiscard?: (() => void) | null;
  onSaveAndActivate: (name: string) => void;
  onSaveOnly: (name: string) => void;
  practiceId: Id<"practices">;
  setActivationName: (name: string) => void;
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

  // Mutations
  const createDraftMutation = useMutation(api.rulesets.createDraftFromActive);
  const createDraftFromRuleSetMutation = useMutation(
    api.rulesets.createDraftFromRuleSet,
  );
  const createInitialRuleSetMutation = useMutation(
    api.rulesets.createInitialRuleSet,
  );
  const activateRuleSetMutation = useMutation(api.rulesets.activateRuleSet);
  const deleteRuleMutation = useMutation(api.rulesets.deleteRule);
  const deleteRuleSetMutation = useMutation(api.rulesets.deleteRuleSet);

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

  const activeRuleSet = ruleSetsQuery?.find((rs) => rs.isActive);
  const selectedRuleSet = ruleSetsQuery?.find(
    (rs) => rs._id === selectedRuleSetId,
  );

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsQuery?.find(
    (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  const unsavedRuleSet =
    ruleSetsQuery?.find((rs) => rs._id === unsavedRuleSetId) ??
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

  // Fetch rules for the current working rule set
  const rulesQuery = useQuery(
    api.rulesets.getRules,
    currentWorkingRuleSet ? { ruleSetId: currentWorkingRuleSet._id } : "skip",
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

  const handleDeleteRule = async (ruleId: Id<"rules">) => {
    try {
      await deleteRuleMutation({ ruleId });
      toast.success("Regel gelöscht", {
        description: "Die Regel wurde erfolgreich gelöscht.",
      });
    } catch (error: unknown) {
      captureError(error, {
        context: "rule_deletion",
        practiceId: currentPractice._id,
        ruleId,
      });

      toast.error("Fehler beim Löschen der Regel", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
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
          Verwalten Sie Regelsets und testen Sie diese in der Simulation
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Panel - Regelverwaltung */}
        <div className="space-y-6">
          <div className="border-b pb-4 mb-6">
            <h2 className="text-xl font-semibold">Regelverwaltung</h2>
            <p className="text-muted-foreground">
              Verwalten Sie Regelsets und konfigurieren Sie die Logik
            </p>
          </div>

          <div className="space-y-6">
            {/* Rule Set Selection */}
            <Card>
              <CardHeader>
                <CardTitle>Regelset Auswahl</CardTitle>
                <CardDescription>
                  {unsavedRuleSet
                    ? "Sie arbeiten an ungespeicherten Änderungen. Aktivieren Sie das Regelset um es zu speichern."
                    : ruleSetsQuery && ruleSetsQuery.length === 0
                      ? "Erstellen Sie Ihr erstes Regelset durch das Hinzufügen von Regeln, Ärzten oder Arbeitszeiten."
                      : "Wählen Sie ein gespeichertes Regelset aus oder arbeiten Sie mit ungespeicherten Änderungen."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Show select when there are saved rule sets */}
                {ruleSetsQuery && ruleSetsQuery.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="rule-set-select">Regelset</Label>
                    <Select
                      onValueChange={(value) => {
                        if (value === "unsaved") {
                          setSelectedRuleSetId(null);
                          // Keep existing unsaved rule set if it exists
                        } else {
                          // If we have unsaved changes, show save dialog
                          if (unsavedRuleSet) {
                            setPendingRuleSetId(value as Id<"ruleSets">);
                            setActivationName(""); // Clear name for new dialog
                            setIsSaveDialogOpen(true);
                          } else {
                            setSelectedRuleSetId(value as Id<"ruleSets">);
                            setUnsavedRuleSetId(null); // Clear unsaved changes
                          }
                        }
                      }}
                      value={
                        unsavedRuleSet
                          ? "unsaved"
                          : selectedRuleSetId || activeRuleSet?._id || ""
                      }
                    >
                      <SelectTrigger id="rule-set-select">
                        <SelectValue placeholder="Regelset auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {unsavedRuleSet && (
                          <SelectItem value="unsaved">
                            <div className="flex items-center gap-2">
                              <Badge className="text-xs" variant="secondary">
                                Ungespeicherte Änderungen
                              </Badge>
                            </div>
                          </SelectItem>
                        )}
                        {ruleSetsQuery
                          .filter((rs) => rs._id !== unsavedRuleSet?._id)
                          .map((ruleSet) => (
                            <SelectItem key={ruleSet._id} value={ruleSet._id}>
                              <div className="flex items-center gap-2">
                                <span>{ruleSet.description}</span>
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
                )}

                <div className="flex gap-2">
                  {/* Show activation button when we have an unsaved rule set or when creating the first one */}
                  {(unsavedRuleSet ??
                    (ruleSetsQuery &&
                      ruleSetsQuery.length === 0 &&
                      currentWorkingRuleSet)) && (
                    <Button onClick={handleOpenSaveDialog} variant="default">
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
                        {unsavedRuleSet
                          ? "Ungespeicherte Änderungen - speichern Sie das Regelset um die Änderungen zu übernehmen"
                          : currentWorkingRuleSet
                            ? currentWorkingRuleSet.description
                            : "Fügen Sie Ihre erste Regel hinzu"}
                      </CardDescription>
                    </div>
                    {unsavedRuleSet ? (
                      // Show form if we have an unsaved rule set
                      <RuleCreationForm
                        onRuleCreated={() => {
                          // Rules will auto-refresh via Convex reactivity
                        }}
                        practiceId={currentPractice._id}
                        ruleSetId={unsavedRuleSet._id}
                      />
                    ) : ruleSetsQuery && ruleSetsQuery.length === 0 ? (
                      // Show button if we're creating the first rule set (no rule sets exist)
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
                    ) : (
                      // Show button for any existing rule set (active or non-active)
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
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {rulesQuery ? (
                    rulesQuery.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {currentWorkingRuleSet
                          ? "Keine Regeln in diesem Regelset."
                          : "Fügen Sie Ihre erste Regel hinzu, um zu beginnen."}
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
                              <div className="flex gap-2 ml-4">
                                {unsavedRuleSet ? (
                                  <>
                                    <RuleEditForm
                                      practiceId={currentPractice._id}
                                      rule={rule}
                                    />
                                    <Button
                                      onClick={() => {
                                        if (
                                          confirm(
                                            "Sind Sie sicher, dass Sie diese Regel löschen möchten?",
                                          )
                                        ) {
                                          void handleDeleteRule(rule._id);
                                        }
                                      }}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      onClick={() => {
                                        void ensureUnsavedRuleSet();
                                      }}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        if (
                                          confirm(
                                            "Sind Sie sicher, dass Sie diese Regel löschen möchten?",
                                          )
                                        ) {
                                          void (async () => {
                                            await ensureUnsavedRuleSet();
                                            void handleDeleteRule(rule._id);
                                          })();
                                        }
                                      }}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
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
        </div>

        {/* Right Panel - Simulation */}
        <SimulationPanel
          practiceId={currentPractice._id}
          ruleSetsQuery={ruleSetsQuery}
        />
      </div>

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
    api.rulesets.validateRuleSetName,
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
