// src/routes/regeln.tsx
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
  const [isActivationDialogOpen, setIsActivationDialogOpen] = useState(false);
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
  const createInitialRuleSetMutation = useMutation(
    api.rulesets.createInitialRuleSet,
  );
  const activateRuleSetMutation = useMutation(api.rulesets.activateRuleSet);
  const deleteRuleMutation = useMutation(api.rulesets.deleteRule);

  // Function to create an initial unsaved rule set
  const createInitialUnsaved = React.useCallback(async () => {
    if (!currentPractice) {
      return;
    }

    try {
      let newRuleSetId: Id<"ruleSets">;

      // Check if this practice has any rule sets
      if (!ruleSetsQuery || ruleSetsQuery.length === 0) {
        // No rule sets exist, create the first one
        newRuleSetId = await createInitialRuleSetMutation({
          description: "Neues Regelset",
          practiceId: currentPractice._id,
        });
      } else {
        // Rule sets exist, create a draft from the active one
        newRuleSetId = await createDraftMutation({
          description: "Neues Regelset",
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

  const selectedRuleSet = ruleSetsQuery?.find(
    (rs) => rs._id === selectedRuleSetId,
  );
  const unsavedRuleSet = ruleSetsQuery?.find(
    (rs) => rs._id === unsavedRuleSetId,
  );

  // Use unsaved rule set if available, otherwise selected rule set
  const currentWorkingRuleSet = unsavedRuleSet ?? selectedRuleSet;

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
        const newRuleSetId = await createDraftMutation({
          description: "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
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
    [currentPractice, createDraftMutation, captureError],
  );

  // Function to ensure an unsaved rule set exists - called when user starts making changes
  const ensureUnsavedRuleSet = React.useCallback(async () => {
    if (unsavedRuleSetId) {
      return unsavedRuleSetId; // Already have an unsaved rule set
    }

    // If we have a selected active rule set, create an unsaved copy of it
    if (selectedRuleSet?.isActive) {
      return await createUnsavedCopy(selectedRuleSet._id);
    }

    // Otherwise create initial unsaved rule set
    return await createInitialUnsaved();
  }, [
    unsavedRuleSetId,
    selectedRuleSet,
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

      setIsActivationDialogOpen(false);
      setActivationName("");
      setUnsavedRuleSetId(null); // Clear unsaved state
      setSelectedRuleSetId(ruleSetId); // Set the activated rule set as selected
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

  const handleOpenActivationDialog = () => {
    if (currentWorkingRuleSet) {
      setActivationName(""); // Always start with empty name
      setIsActivationDialogOpen(true);
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
                          setSelectedRuleSetId(value as Id<"ruleSets">);
                          setUnsavedRuleSetId(null); // Clear unsaved changes
                        }
                      }}
                      value={
                        unsavedRuleSet ? "unsaved" : selectedRuleSetId || ""
                      }
                    >
                      <SelectTrigger id="rule-set-select">
                        <SelectValue placeholder="Regelset auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {unsavedRuleSet && (
                          <SelectItem value="unsaved">
                            <div className="flex items-center gap-2">
                              <span>Ungespeicherte Änderungen</span>
                              <Badge className="text-xs" variant="secondary">
                                UNSAVED
                              </Badge>
                            </div>
                          </SelectItem>
                        )}
                        {ruleSetsQuery
                          .filter((rs) => rs.isActive || !unsavedRuleSet)
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
                    <Button
                      onClick={handleOpenActivationDialog}
                      variant="default"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Speichern & Aktivieren
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
                            Regeln in {currentWorkingRuleSet.description}
                            {currentWorkingRuleSet.isActive && (
                              <Badge className="ml-2" variant="default">
                                AKTIV
                              </Badge>
                            )}
                            {unsavedRuleSet && (
                              <Badge className="ml-2" variant="secondary">
                                UNSAVED
                              </Badge>
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
                    {!currentWorkingRuleSet?.isActive ||
                    unsavedRuleSet ||
                    (ruleSetsQuery && ruleSetsQuery.length === 0) ? (
                      // Show form if we have an unsaved rule set OR if we're creating the first rule set
                      unsavedRuleSet ? (
                        <RuleCreationForm
                          onRuleCreated={() => {
                            // Rules will auto-refresh via Convex reactivity
                          }}
                          practiceId={currentPractice._id}
                          ruleSetId={unsavedRuleSet._id}
                        />
                      ) : currentWorkingRuleSet ? (
                        <RuleCreationForm
                          onRuleCreated={() => {
                            // Rules will auto-refresh via Convex reactivity
                          }}
                          practiceId={currentPractice._id}
                          ruleSetId={currentWorkingRuleSet._id}
                        />
                      ) : (
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
                    ) : (
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

      {/* Activation Dialog */}
      <Dialog
        onOpenChange={setIsActivationDialogOpen}
        open={isActivationDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regelset aktivieren</DialogTitle>
            <DialogDescription>
              Geben Sie einen eindeutigen Namen für dieses Regelset ein, um es
              zu aktivieren. Das aktuelle aktive Regelset wird dadurch ersetzt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activation-name">Name für das Regelset</Label>
              <Input
                id="activation-name"
                onChange={(e) => {
                  setActivationName(e.target.value);
                }}
                placeholder="z.B. Wintersprechzeiten 2024"
                value={activationName}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setIsActivationDialogOpen(false);
                setActivationName("");
              }}
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button
              disabled={!activationName.trim()}
              onClick={() => {
                if (currentWorkingRuleSet && activationName.trim()) {
                  void handleActivateRuleSet(
                    currentWorkingRuleSet._id,
                    activationName,
                  );
                }
              }}
            >
              Speichern & Aktivieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
