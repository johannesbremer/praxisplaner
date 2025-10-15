// src/components/rule-list-new.tsx
"use client";

import { useMutation } from "convex/react";
import { Edit, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";
import RuleEditorAdvanced from "./rule-editor-advanced";

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
  const { captureError } = useErrorTracking();
  const deleteRuleMutation = useMutation(api.ruleEngine.api.deleteRule);
  const toggleRuleMutation = useMutation(api.ruleEngine.api.toggleRule);

  const handleDeleteRule = async (rule: Doc<"rules">) => {
    try {
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

  const handleToggleRule = async (rule: Doc<"rules">) => {
    try {
      const result = await toggleRuleMutation({
        practiceId,
        ruleId: rule._id,
        sourceRuleSetId: ruleSetId,
      });

      toast.success(result.enabled ? "Regel aktiviert" : "Regel deaktiviert", {
        description: `Die Regel wurde ${result.enabled ? "aktiviert" : "deaktiviert"}.`,
      });

      // Notify parent about the change
      onRuleChanged?.();
    } catch (error: unknown) {
      captureError(error, {
        context: "RuleListNew - Toggle rule",
        ruleId: rule._id,
        ruleName: rule.name,
      });
      toast.error("Fehler beim Aktivieren/Deaktivieren der Regel", {
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
          mit dem erweiterten Editor.
        </p>
      </div>
    );
  }

  // Sort rules by priority (lower number = higher priority)
  const sortedRules = [...rules].toSorted((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      {sortedRules.map((rule) => (
        <Card
          className={`p-4 ${rule.enabled ? "" : "opacity-50"}`}
          key={rule._id}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{rule.name}</h3>
                <Badge
                  variant={rule.action === "BLOCK" ? "destructive" : "default"}
                >
                  {rule.action}
                </Badge>
                <Badge variant="outline">Priorität: {rule.priority}</Badge>
                {!rule.enabled && (
                  <Badge variant="secondary">Deaktiviert</Badge>
                )}
              </div>

              {rule.description && (
                <p className="text-sm text-muted-foreground">
                  {rule.description}
                </p>
              )}

              <p className="text-sm text-muted-foreground italic">
                {rule.message}
              </p>

              <div className="text-xs text-muted-foreground font-mono">
                {formatConditionSummary(rule.condition)}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
              {/* Toggle Enable/Disable */}
              <Button
                onClick={() => {
                  void handleToggleRule(rule);
                }}
                size="sm"
                title={rule.enabled ? "Regel deaktivieren" : "Regel aktivieren"}
                variant="ghost"
              >
                <Power
                  className={`h-4 w-4 ${rule.enabled ? "text-green-600" : ""}`}
                />
              </Button>

              {/* Edit Rule */}
              <RuleEditorAdvanced
                customTrigger={
                  <Button size="sm" title="Regel bearbeiten" variant="ghost">
                    <Edit className="h-4 w-4" />
                  </Button>
                }
                onRuleCreated={onRuleChanged}
                practiceId={practiceId}
                ruleId={rule._id}
                ruleSetId={ruleSetId}
              />

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
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function formatConditionSummary(condition: unknown): string {
  if (!condition || typeof condition !== "object") {
    return "Ungültige Bedingung";
  }

  const c = condition as Record<string, unknown>;
  const type = c["type"];

  if (typeof type !== "string") {
    return "Ungültiger Typ";
  }

  switch (type) {
    case "Adjacent": {
      return `Adjacent(${String(c["entity"])}, ${String(c["direction"])})`;
    }
    case "AND": {
      return `AND(${Array.isArray(c["children"]) ? c["children"].length : 0} conditions)`;
    }
    case "Count": {
      return `Count(${String(c["entity"])}) ${String(c["op"])} ${String(c["value"])}`;
    }
    case "NOT": {
      return `NOT(...)`;
    }
    case "OR": {
      return `OR(${Array.isArray(c["children"]) ? c["children"].length : 0} conditions)`;
    }
    case "Property": {
      return `${String(c["entity"])}.${String(c["attr"])} ${String(c["op"])} ${JSON.stringify(c["value"])}`;
    }
    case "TimeRangeFree": {
      return `TimeRangeFree(${String(c["start"])}, ${String(c["duration"])})`;
    }
    default: {
      return type;
    }
  }
}
