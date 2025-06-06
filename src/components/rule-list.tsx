"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Edit2, Trash2, AlertCircle } from "lucide-react";
import type { Rule } from "@/lib/types";

interface RuleListProps {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export function RuleList({ rules, onEdit, onDelete, onToggle }: RuleListProps) {
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
        <Card key={rule.id} className="p-4">
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
                onCheckedChange={() => onToggle(rule.id)}
              />
              <Button size="icon" variant="ghost" onClick={() => onEdit(rule)}>
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(rule.id)}
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
    SEASONAL_AVAILABILITY: "Saisonale Verfügbarkeit",
    RESOURCE_CONSTRAINT: "Ressourcenbeschränkung",
    TIME_BLOCK: "Zeitblock",
  };
  return labels[type] || type;
}
