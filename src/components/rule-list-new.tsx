"use client";

import { Copy } from "lucide-react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import RuleCreationFormNew from "./rule-creation-form-new";

interface RuleListNewProps {
  onRuleChanged?: () => void;
  practiceId: Id<"practices">;
  rules: Doc<"rules">[];
  ruleSetId: Id<"ruleSets">;
}

export function RuleListNew({
  onRuleChanged,
  practiceId,
  rules,
  ruleSetId,
}: RuleListNewProps) {
  if (rules.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Keine Regeln in diesem Regelset. Erstellen Sie eine neue Regel.
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
                  name: rule.name,
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
