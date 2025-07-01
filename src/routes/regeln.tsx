// src/routes/regeln.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { GitBranch, Save } from "lucide-react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

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
  // Mock practice ID - in a real app this would come from auth/context
  const mockPracticeId = "practice123" as Id<"practices">;

  const [selectedRuleSetId, setSelectedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  // Fetch rule sets for this practice
  const ruleSetsQuery = useQuery(api["rule-sets"].getRuleSets, {
    practiceId: mockPracticeId,
  });

  // Fetch rules for the selected rule set
  const rulesQuery = useQuery(
    api["rule-sets"].getRules,
    selectedRuleSetId ? { ruleSetId: selectedRuleSetId } : "skip",
  );

  // Mutations
  const createDraftMutation = useMutation(
    api["rule-sets"].createDraftFromActive,
  );
  const activateRuleSetMutation = useMutation(api["rule-sets"].activateRuleSet);

  const selectedRuleSet = ruleSetsQuery?.find(
    (rs) => rs._id === selectedRuleSetId,
  );
  const activeRuleSet = ruleSetsQuery?.find((rs) => rs.isActive);

  const handleCreateDraft = async () => {
    if (!activeRuleSet) {
      toast.error("Kein aktives Regelset gefunden");
      return;
    }

    try {
      setIsCreatingDraft(true);
      const newRuleSetId = await createDraftMutation({
        description: `Draft basierend auf v${activeRuleSet.version}`,
        practiceId: mockPracticeId,
      });

      setSelectedRuleSetId(newRuleSetId);
      toast.success("Draft erstellt", {
        description: "Ein neues Draft-Regelset wurde erstellt.",
      });
    } catch (error) {
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
        practiceId: mockPracticeId,
        ruleSetId,
      });

      toast.success("Regelset aktiviert", {
        description: "Das Regelset wurde erfolgreich aktiviert.",
      });
    } catch (error) {
      toast.error("Fehler beim Aktivieren", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Logic View - Regelverwaltung
        </h1>
        <p className="text-muted-foreground">
          Verwalten Sie Regelsets und deren Versionen für die
          Terminverfügbarkeit
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Rule Set Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Regelset Auswahl</CardTitle>
              <CardDescription>
                Wählen Sie ein Regelset aus oder erstellen Sie ein neues Draft
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
                <CardTitle>
                  Regeln in v{selectedRuleSet.version}
                  {selectedRuleSet.isActive && (
                    <Badge className="ml-2" variant="default">
                      AKTIV
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{selectedRuleSet.description}</CardDescription>
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
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Verfügbare Regelsets</CardTitle>
              <CardDescription>Alle Versionen für diese Praxis</CardDescription>
            </CardHeader>
            <CardContent>
              {ruleSetsQuery ? (
                ruleSetsQuery.length === 0 ? (
                  <div className="text-muted-foreground">
                    Keine Regelsets gefunden.
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
                <div className="text-muted-foreground">Lade Regelsets...</div>
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
                    variant={selectedRuleSet.isActive ? "default" : "secondary"}
                  >
                    {selectedRuleSet.isActive ? "Aktiv" : "Draft"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Regeln:</span>
                  <span className="font-medium">{rulesQuery?.length || 0}</span>
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
    </div>
  );
}
