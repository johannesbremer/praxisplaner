"use client";

import { useMutation } from "convex/react";
import { Copy, Eye, EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import RuleCreationFormNew from "./rule-creation-form-new";

interface RuleWithRuleSetInfo {
  _id: Id<"rules">;
  name: string;
  description: string;
  ruleType: "BLOCK" | "LIMIT_CONCURRENT";
  enabled: boolean;
  priority: number;
  ruleSetRuleId: Id<"ruleSetRules">;
  // Rule parameters
  appliesTo?: "ALL_PRACTITIONERS" | "SPECIFIC_PRACTITIONERS";
  specificPractitioners?: Id<"practitioners">[];
  block_appointmentTypes?: string[];
  block_dateRangeEnd?: string;
  block_dateRangeStart?: string;
  block_daysOfWeek?: number[];
  block_timeRangeEnd?: string;
  block_timeRangeStart?: string;
  limit_appointmentTypes?: string[];
  limit_count?: number;
  limit_perPractitioner?: boolean;
}

interface RuleListNewProps {
  onRuleChanged?: () => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  rules: RuleWithRuleSetInfo[];
}

export function RuleListNew({
  onRuleChanged,
  practiceId,
  ruleSetId,
  rules,
}: RuleListNewProps) {
  const disableRuleMutation = useMutation(api.rules.disableRuleInRuleSet);
  const enableRuleMutation = useMutation(api.rules.enableRuleInRuleSet);
  const updateRuleSetRuleMutation = useMutation(api.rules.updateRuleSetRule);

  const handleToggleRule = async (rule: RuleWithRuleSetInfo) => {
    try {
      if (rule.enabled) {
        await disableRuleMutation({
          ruleId: rule._id,
          ruleSetId,
        });
        toast.success("Regel deaktiviert", {
          description: "Die Regel wurde in diesem Regelset deaktiviert.",
        });
      } else {
        await enableRuleMutation({
          priority: rule.priority, // Keep same priority
          ruleId: rule._id,
          ruleSetId,
        });
        toast.success("Regel aktiviert", {
          description: "Die Regel wurde in diesem Regelset aktiviert.",
        });
      }
      onRuleChanged?.();
    } catch (error) {
      toast.error("Fehler beim Ändern der Regel", {
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
    } catch (error) {
      toast.error("Fehler beim Ändern der Priorität", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  if (rules.length === 0) {
    return (
      <div className="text-center py-8">
        <RotateCcw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">
          Keine Regeln in diesem Regelset. Erstellen Sie eine neue Regel oder fügen Sie eine vorhandene hinzu.
        </p>
      </div>
    );
  }

  // Sort rules by priority
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      {sortedRules.map((rule) => (
        <Card className="p-4" key={rule._id}>
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{rule.name}</h3>
                <Badge variant={rule.enabled ? "default" : "secondary"}>
                  {rule.enabled ? "Aktiv" : "Inaktiv"}
                </Badge>
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
                  onClick={() => handlePriorityChange(rule, rule.priority - 5)}
                  size="sm"
                  variant="ghost"
                  title="Priorität erhöhen (niedrigere Zahl)"
                >
                  ↑
                </Button>
                <Button
                  onClick={() => handlePriorityChange(rule, rule.priority + 5)}
                  size="sm"
                  variant="ghost"
                  title="Priorität verringern (höhere Zahl)"
                >
                  ↓
                </Button>
              </div>

              {/* Enable/Disable Toggle */}
              <Button
                onClick={() => handleToggleRule(rule)}
                size="sm"
                variant="ghost"
                title={rule.enabled ? "Regel deaktivieren" : "Regel aktivieren"}
              >
                {rule.enabled ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>

              {/* Copy Rule */}
              <RuleCreationFormNew
                copyFromRule={{
                  appliesTo: rule.appliesTo || "ALL_PRACTITIONERS",
                  block_appointmentTypes: rule.block_appointmentTypes,
                  block_dateRangeEnd: rule.block_dateRangeEnd,
                  block_dateRangeStart: rule.block_dateRangeStart,
                  block_daysOfWeek: rule.block_daysOfWeek,
                  block_timeRangeEnd: rule.block_timeRangeEnd,
                  block_timeRangeStart: rule.block_timeRangeStart,
                  description: rule.description,
                  limit_appointmentTypes: rule.limit_appointmentTypes,
                  limit_count: rule.limit_count,
                  limit_perPractitioner: rule.limit_perPractitioner,
                  ruleType: rule.ruleType,
                  specificPractitioners: rule.specificPractitioners,
                }}
                customTrigger={
                  <Button size="sm" variant="ghost" title="Regel kopieren">
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