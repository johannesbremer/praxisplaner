"use client";

import { useMutation } from "convex/react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";
import RuleCreationFormNew from "./rule-creation-form-new";

interface RuleListNewProps {
  onRuleChanged?: () => void;
  practiceId: Id<"practices">;
  rules: Doc<"rules">[];
  ruleSetId?: Id<"ruleSets">;
}

export function RuleListNew({
  onRuleChanged,
  practiceId,
  rules,
  ruleSetId,
}: RuleListNewProps) {
  const { captureError } = useErrorTracking();
  const deleteRuleMutation = useMutation(api.entities.deleteRule);

  const handleDeleteRule = async (rule: Doc<"rules">) => {
    try {
      // Ensure we have a ruleSetId
      if (!ruleSetId) {
        toast.error("Kein Regelset ausgewählt");
        return;
      }

      // Call the mutation - it will automatically create unsaved rule set if needed
      // The mutation handles Copy-on-Write internally via getOrCreateUnsavedRuleSet
      await deleteRuleMutation({
        practiceId,
        ruleId: rule._id,
        sourceRuleSetId: ruleSetId,
      });
      toast.success("Regel gelöscht", {
        description: "Die Regel wurde aus diesem Regelset entfernt.",
      });

      // Notify parent about the change
      onRuleChanged?.();
    } catch (error: unknown) {
      captureError(error, {
        context: "RuleListNew - Delete rule",
        ruleId: rule._id,
        ruleName: rule.name,
      });
      toast.error("Fehler beim Löschen der Regel", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  if (rules.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Keine aktiven Regeln in diesem Regelset. Erstellen Sie eine neue Regel
          oder fügen Sie eine vorhandene hinzu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <Card className="p-4" key={rule._id}>
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{rule.name}</h3>
                <Badge
                  variant={
                    rule.ruleType === "BLOCK" ? "destructive" : "secondary"
                  }
                >
                  {rule.ruleType}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground">
                {rule.description}
              </p>

              <div className="text-xs text-muted-foreground">
                {formatRuleDetails(rule)}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
              {/* Delete Rule */}
              <Button
                onClick={() => {
                  void handleDeleteRule(rule);
                }}
                size="sm"
                title="Regel löschen (aus diesem Regelset entfernen)"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>

              {/* Copy Rule */}
              {ruleSetId && (
                <RuleCreationFormNew
                  copyFromRule={{
                    appliesTo: rule.appliesTo,
                    block_appointmentTypes: rule.block_appointmentTypes ?? [],
                    block_dateRangeEnd: rule.block_dateRangeEnd ?? "",
                    block_dateRangeStart: rule.block_dateRangeStart ?? "",
                    block_daysOfWeek: rule.block_daysOfWeek ?? [],
                    block_timeRangeEnd: rule.block_timeRangeEnd ?? "",
                    block_timeRangeStart: rule.block_timeRangeStart ?? "",
                    description: rule.description,
                    limit_appointmentTypes: rule.limit_appointmentTypes ?? [],
                    limit_count: rule.limit_count ?? 1,
                    limit_perPractitioner: rule.limit_perPractitioner ?? false,
                    ruleType: rule.ruleType,
                    specificPractitioners: rule.specificPractitioners ?? [],
                  }}
                  customTrigger={
                    <Button size="sm" title="Regel kopieren" variant="ghost">
                      <Copy className="h-4 w-4" />
                    </Button>
                  }
                  onRuleCreated={onRuleChanged}
                  practiceId={practiceId}
                  ruleSetId={ruleSetId}
                />
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function formatRuleDetails(rule: Doc<"rules">): string {
  if (rule.ruleType === "BLOCK") {
    const parts: string[] = [];
    if (rule.block_appointmentTypes?.length) {
      parts.push(`Terminarten: ${rule.block_appointmentTypes.join(", ")}`);
    }
    if (rule.block_daysOfWeek?.length) {
      const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      const days = rule.block_daysOfWeek
        .map((d: number) => dayNames[d])
        .join(", ");
      parts.push(`Wochentage: ${days}`);
    }
    if (rule.block_timeRangeStart && rule.block_timeRangeEnd) {
      parts.push(
        `Zeit: ${rule.block_timeRangeStart} - ${rule.block_timeRangeEnd}`,
      );
    }
    if (rule.block_dateRangeStart && rule.block_dateRangeEnd) {
      parts.push(
        `Datum: ${rule.block_dateRangeStart} - ${rule.block_dateRangeEnd}`,
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
}
