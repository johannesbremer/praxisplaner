// components/rule-editor.tsx
import type React from "react";
import { useState, useEffect } from "react"; // Added useEffect
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Rule } from "@/lib/types"; // Assuming RuleActions type is part of Rule

// Helper to ensure the actions object conforms to exactOptionalPropertyTypes
// This assumes Rule['actions'] is the target type that has optional properties like `limitPerDay?: number`
const prepareActionsForSave = (
  currentActions: Partial<Rule["actions"]>,
): Rule["actions"] => {
  const actionsToSave: Rule["actions"] = {};

  if (currentActions.requireExtraTime !== undefined) {
    actionsToSave.requireExtraTime = currentActions.requireExtraTime;
  }
  if (
    currentActions.extraMinutes !== undefined &&
    !Number.isNaN(currentActions.extraMinutes)
  ) {
    actionsToSave.extraMinutes = currentActions.extraMinutes;
  }
  if (
    currentActions.limitPerDay !== undefined &&
    !Number.isNaN(currentActions.limitPerDay)
  ) {
    actionsToSave.limitPerDay = currentActions.limitPerDay;
  }
  if (currentActions.enableBatchAppointments !== undefined) {
    actionsToSave.enableBatchAppointments =
      currentActions.enableBatchAppointments;
  }
  if (
    currentActions.batchSize !== undefined &&
    !Number.isNaN(currentActions.batchSize)
  ) {
    actionsToSave.batchSize = currentActions.batchSize;
  }
  if (
    currentActions.batchDuration !== undefined &&
    !Number.isNaN(currentActions.batchDuration)
  ) {
    actionsToSave.batchDuration = currentActions.batchDuration;
  }
  if (currentActions.blockTimeSlots !== undefined) {
    actionsToSave.blockTimeSlots = currentActions.blockTimeSlots;
  }
  if (currentActions.requireSpecificDoctor !== undefined) {
    actionsToSave.requireSpecificDoctor = currentActions.requireSpecificDoctor;
  }

  return actionsToSave;
};

interface RuleEditorProps {
  rule: Rule | null;
  onSave: (rule: Rule) => void;
  onCancel: () => void;
}

export function RuleEditor({ rule, onSave, onCancel }: RuleEditorProps) {
  const [formData, setFormData] = useState<Rule>(
    rule || {
      id: "", // Will be set on save for new rules
      name: "",
      type: "CONDITIONAL_AVAILABILITY",
      conditions: {},
      actions: {}, // Start with empty actions, will be populated by form
      priority: 1,
      active: true,
    },
  );

  // Synchronize formData if the rule prop changes (e.g., when editing a different rule)
  useEffect(() => {
    setFormData(
      rule || {
        id: "",
        name: "",
        type: "CONDITIONAL_AVAILABILITY",
        conditions: {},
        actions: {},
        priority: 1,
        active: true,
      },
    );
  }, [rule]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalActions = prepareActionsForSave(formData.actions);
    onSave({ ...formData, actions: finalActions });
  };

  const handleActionChange = <K extends keyof Rule["actions"]>(
    key: K,
    value: Rule["actions"][K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      actions: {
        ...prev.actions,
        [key]: value,
      },
    }));
  };

  const handleConditionChange = <K extends keyof Rule["conditions"]>(
    key: K,
    value: Rule["conditions"][K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        [key]: value,
      },
    }));
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {rule?.id ? "Regel bearbeiten" : "Neue Regel erstellen"}
            </DialogTitle>
            <DialogDescription>
              Definieren Sie die Bedingungen und Aktionen für diese Regel
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Regelname</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="z.B. Neue Patienten - Ersttermin"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Regeltyp</Label>
              <Select
                value={formData.type}
                onValueChange={(value) =>
                  setFormData({ ...formData, type: value as Rule["type"] })
                }
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONDITIONAL_AVAILABILITY">
                    Bedingte Verfügbarkeit
                  </SelectItem>
                  <SelectItem value="SEASONAL_AVAILABILITY">
                    Saisonale Verfügbarkeit
                  </SelectItem>
                  <SelectItem value="RESOURCE_CONSTRAINT">
                    Ressourcenbeschränkung
                  </SelectItem>
                  <SelectItem value="TIME_BLOCK">Zeitblock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Tabs defaultValue="conditions" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="conditions">Bedingungen</TabsTrigger>
                <TabsTrigger value="actions">Aktionen</TabsTrigger>
              </TabsList>

              <TabsContent value="conditions" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="patient-type">Patiententyp</Label>
                  <Select
                    value={formData.conditions.patientType || "all"}
                    onValueChange={(value) =>
                      handleConditionChange(
                        "patientType",
                        value === "all"
                          ? undefined
                          : (value as "new" | "existing"),
                      )
                    }
                  >
                    <SelectTrigger id="patient-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        Alle Patienten (kein Filter)
                      </SelectItem>
                      <SelectItem value="new">Neue Patienten</SelectItem>
                      <SelectItem value="existing">
                        Bestandspatienten
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="appointment-type">
                    Terminart (genauer Text)
                  </Label>
                  <Input
                    id="appointment-type"
                    value={formData.conditions.appointmentType || ""}
                    onChange={(e) =>
                      handleConditionChange(
                        "appointmentType",
                        e.target.value || undefined,
                      )
                    }
                    placeholder="z.B. Erstberatung, Grippeimpfung"
                  />
                </div>
                {/* Add more condition fields here based on Rule['conditions'] type */}
              </TabsContent>

              <TabsContent value="actions" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="extra-time">
                    Zusätzliche Zeit erforderlich
                  </Label>
                  <Switch
                    id="extra-time"
                    checked={formData.actions.requireExtraTime || false}
                    onCheckedChange={(checked) =>
                      handleActionChange("requireExtraTime", checked)
                    }
                  />
                </div>

                {formData.actions.requireExtraTime && (
                  <div className="space-y-2">
                    <Label htmlFor="extra-minutes">Zusätzliche Minuten</Label>
                    <Input
                      id="extra-minutes"
                      type="number"
                      value={formData.actions.extraMinutes || 0}
                      onChange={(e) => {
                        const val = Number.parseInt(e.target.value);
                        handleActionChange(
                          "extraMinutes",
                          Number.isNaN(val) ? 0 : val,
                        );
                      }}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="limit-per-day">
                    Maximale Termine pro Tag (pro Arzt)
                  </Label>
                  <Input
                    id="limit-per-day"
                    type="number"
                    value={
                      formData.actions.limitPerDay === undefined
                        ? ""
                        : formData.actions.limitPerDay
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      handleActionChange(
                        "limitPerDay",
                        val === "" ? undefined : Number.parseInt(val),
                      );
                    }}
                    placeholder="Keine Begrenzung"
                  />
                </div>
                {/* Add more action fields here based on Rule['actions'] type */}
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="priority">Priorität</Label>
              <Input
                id="priority"
                type="number"
                min="1"
                max="100"
                value={formData.priority}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value);
                  setFormData({
                    ...formData,
                    priority: Number.isNaN(val) ? 1 : val,
                  });
                }}
                required
              />
              <p className="text-xs text-muted-foreground">
                Niedrigere Zahlen haben höhere Priorität (1 = höchste)
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, active: checked })
                }
              />
              <Label htmlFor="active">Regel aktiv</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Abbrechen
            </Button>
            <Button type="submit">
              {rule?.id ? "Änderungen speichern" : "Regel erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
