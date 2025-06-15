"use client";

import { AlertCircle, Edit2, Trash2 } from "lucide-react";

import type { Rule } from "@/lib/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface RuleListProperties {
  onDelete: (id: string) => void;
  onEdit: (rule: Rule) => void;
  onToggle: (id: string) => void;
  rules: Rule[];
}

export function RuleList({
  onDelete,
  onEdit,
  onToggle,
  rules,
}: RuleListProperties) {
  if (rules.length === 0) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">
          Keine Regeln definiert. Erstellen Sie Ihre erste Regel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <Card className="p-4" key={rule.id}>
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{rule.name}</h3>
                <Badge variant={rule.active ? "default" : "secondary"}>
                  {rule.active ? "Aktiv" : "Inaktiv"}
                </Badge>
                <Badge variant="outline">Priorität: {rule.priority}</Badge>
              </div>

              <p className="text-sm text-muted-foreground">
                Typ: {getRuleTypeLabel(rule.type)}
              </p>

              {rule.conditions.appointmentType && (
                <p className="text-sm text-muted-foreground">
                  Terminart: {rule.conditions.appointmentType}
                </p>
              )}

              {rule.conditions.patientType &&
                rule.conditions.patientType !== "all" && (
                  <p className="text-sm text-muted-foreground">
                    Patiententyp:{" "}
                    {rule.conditions.patientType === "new"
                      ? "Neue Patienten"
                      : "Bestandspatienten"}
                  </p>
                )}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={rule.active}
                onCheckedChange={() => {
                  onToggle(rule.id);
                }}
              />
              <Button
                onClick={() => {
                  onEdit(rule);
                }}
                size="icon"
                variant="ghost"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => {
                  onDelete(rule.id);
                }}
                size="icon"
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

function getRuleTypeLabel(type: Rule["type"]): string {
  const labels: Record<Rule["type"], string> = {
    CONDITIONAL_AVAILABILITY: "Bedingte Verfügbarkeit",
    RESOURCE_CONSTRAINT: "Ressourcenbeschränkung",
    SEASONAL_AVAILABILITY: "Saisonale Verfügbarkeit",
    TIME_BLOCK: "Zeitblock",
  };
  return labels[type] || type;
}
