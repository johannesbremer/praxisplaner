// src/routes/regeln.tsx
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Save } from "lucide-react";
import { RuleEditor } from "@/src/components/rule-editor";
import { RuleList } from "@/src/components/rule-list";
import { toast } from "sonner"; // Correctly using sonner
import type { Rule } from "@/lib/types";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/regeln")({
  component: LogicView,
});

export default function LogicView() {
  const [rules, setRules] = useState<Rule[]>([
    {
      id: "1",
      name: "Neue Patienten - Ersttermin",
      type: "CONDITIONAL_AVAILABILITY",
      conditions: {
        patientType: "new",
        appointmentType: "Erstberatung",
      },
      actions: {
        requireExtraTime: true,
        extraMinutes: 15,
        limitPerDay: 3,
      },
      priority: 1,
      active: true,
    },
    {
      id: "2",
      name: "Grippeimpfung - Saisonale Verfügbarkeit",
      type: "SEASONAL_AVAILABILITY",
      conditions: {
        appointmentType: "Grippeimpfung",
        dateRange: {
          start: "2024-10-01",
          end: "2024-12-31",
        },
      },
      actions: {
        enableBatchAppointments: true,
        batchSize: 4,
        batchDuration: 60,
      },
      priority: 2,
      active: true,
    },
  ]);

  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  // Removed: const { toast } = useToast();

  const handleSaveRule = (rule: Rule) => {
    if (editingRule) {
      setRules(rules.map((r) => (r.id === rule.id ? rule : r)));
      toast.success(`Regel "${rule.name}" aktualisiert`, {
        description: "Die Regel wurde erfolgreich aktualisiert.",
      });
    } else {
      setRules([...rules, { ...rule, id: Date.now().toString() }]);
      toast.success(`Regel "${rule.name}" erstellt`, {
        description: "Die Regel wurde erfolgreich erstellt.",
      });
    }
    setShowEditor(false);
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    const ruleName = rules.find((r) => r.id === id)?.name || "Die Regel";
    setRules(rules.filter((r) => r.id !== id));
    toast.info(`${ruleName} gelöscht`, {
      description: "Die Regel wurde erfolgreich gelöscht.",
    });
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setShowEditor(true);
  };

  const handleSaveConfiguration = () => {
    toast.info("Konfiguration gespeichert", {
      description: "Eine neue Version der Regelkonfiguration wurde erstellt.",
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Logic View - Regelverwaltung
        </h1>
        <p className="text-muted-foreground">
          Konfigurieren Sie die Verfügbarkeitsregeln für Ihre Praxis
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Aktive Regeln</CardTitle>
              <CardDescription>
                Diese Regeln bestimmen die Terminverfügbarkeit
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Button
                  onClick={() => {
                    setEditingRule(null);
                    setShowEditor(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Neue Regel erstellen
                </Button>
              </div>

              <RuleList
                rules={rules}
                onEdit={handleEditRule}
                onDelete={handleDeleteRule}
                onToggle={(id) => {
                  setRules(
                    rules.map((r) =>
                      r.id === id ? { ...r, active: !r.active } : r,
                    ),
                  );
                  const toggledRule = rules.find((r) => r.id === id);
                  if (toggledRule) {
                    toast.info(
                      `Regel "${toggledRule.name}" ${toggledRule.active ? "deaktiviert" : "aktiviert"}.`,
                    );
                  }
                }}
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Konfiguration</CardTitle>
              <CardDescription>
                Verwalten Sie Ihre Regelkonfiguration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Aktive Regeln: {rules.filter((r) => r.active).length}
                </p>
                <p className="text-sm text-muted-foreground">
                  Inaktive Regeln: {rules.filter((r) => !r.active).length}
                </p>
              </div>

              <Button
                onClick={handleSaveConfiguration}
                className="w-full"
                variant="default"
              >
                <Save className="h-4 w-4 mr-2" />
                Konfiguration speichern
              </Button>

              <p className="text-xs text-muted-foreground">
                Beim Speichern wird eine neue Version erstellt, die jederzeit
                wiederhergestellt werden kann.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {showEditor && (
        <RuleEditor
          rule={editingRule}
          onSave={handleSaveRule}
          onCancel={() => {
            setShowEditor(false);
            setEditingRule(null);
          }}
        />
      )}
    </div>
  );
}
