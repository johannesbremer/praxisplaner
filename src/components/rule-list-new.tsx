"use client";

import { useMutation } from "convex/react";
import { Copy, EyeOff } from "lucide-react";
import { toast } from "sonner";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";
import RuleCreationFormNew from "./rule-creation-form-new";

interface RuleListNewProps {
  onNeedRuleSet?: () => Promise<Id<"ruleSets"> | null | undefined>;
  onRuleChanged?: () => void;
  practiceId: Id<"practices">;
  rules: RuleWithRuleSetInfo[];
  ruleSetId: Id<"ruleSets">;
}

interface RuleWithRuleSetInfo extends Doc<"rules"> {
  // Additional fields from the junction table
  enabled: boolean;
  priority: number;
  ruleSetRuleId: Id<"ruleSetRules">;
}

export function RuleListNew({
  onNeedRuleSet,
  onRuleChanged,
  practiceId,
  rules,
  ruleSetId,
}: RuleListNewProps) {
  const { captureError } = useErrorTracking();
  const disableRuleMutation = useMutation(api.rules.disableRuleInRuleSet);
  const updateRuleSetRuleMutation = useMutation(api.rules.updateRuleSetRule);

  const handleToggleRule = async (rule: RuleWithRuleSetInfo) => {
    try {
      // Ensure we have an unsaved rule set before making changes
      if (onNeedRuleSet) {
        const resultRuleSetId = await onNeedRuleSet();
        if (!resultRuleSetId) {
          toast.error("Fehler beim Erstellen der Arbeitskopie");
          return;
        }
      }

      // Since we only show enabled rules, we only handle disabling here
      await disableRuleMutation({
        ruleId: rule._id,
        ruleSetId,
      });
      toast.success("Regel deaktiviert", {
        description: "Die Regel wurde in diesem Regelset deaktiviert.",
      });
      onRuleChanged?.();
    } catch (error: unknown) {
      captureError(error, {
        context: "RuleListNew - Toggle rule (disable)",
        ruleId: rule._id,
        ruleName: rule.name,
        ruleSetId,
      });
      toast.error("Fehler beim Deaktivieren der Regel", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handlePriorityChange = async (
    rule: RuleWithRuleSetInfo,
    newPriority: number,
  ) => {
    try {
      await updateRuleSetRuleMutation({
        ruleSetRuleId: rule.ruleSetRuleId,
        updates: { priority: newPriority },
      });
      toast.success("Priorität geändert");
      onRuleChanged?.();
    } catch (error: unknown) {
      captureError(error, {
        context: "RuleListNew - Change priority",
        newPriority,
        oldPriority: rule.priority,
        ruleId: rule._id,
        ruleSetRuleId: rule.ruleSetRuleId,
      });
      toast.error("Fehler beim Ändern der Priorität", {
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

  // Sort rules by priority (all rules passed here are already enabled)
  const sortedRules = [...rules].toSorted((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      {sortedRules.map((rule) => (
        <Card className="p-4" key={rule._id}>
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{rule.name}</h3>
                <Badge variant="outline">Priorität: {rule.priority}</Badge>
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
              {/* Priority Controls */}
              <div className="flex flex-col gap-1">
                <Button
                  onClick={() => {
                    void handlePriorityChange(rule, rule.priority - 5);
                  }}
                  size="sm"
                  title="Priorität erhöhen (niedrigere Zahl)"
                  variant="ghost"
                >
                  ↑
                </Button>
                <Button
                  onClick={() => {
                    void handlePriorityChange(rule, rule.priority + 5);
                  }}
                  size="sm"
                  title="Priorität verringern (höhere Zahl)"
                  variant="ghost"
                >
                  ↓
                </Button>
              </div>

              {/* Enable/Disable Toggle - Now this disables the rule (removes from view) */}
              <Button
                onClick={() => {
                  void handleToggleRule(rule);
                }}
                size="sm"
                title="Regel deaktivieren (aus diesem Regelset entfernen)"
                variant="ghost"
              >
                <EyeOff className="h-4 w-4" />
              </Button>

              {/* Copy Rule */}
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
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function formatRuleDetails(rule: RuleWithRuleSetInfo): string {
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
