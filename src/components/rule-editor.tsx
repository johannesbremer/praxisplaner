// components/rule-editor.tsx
import type React from "react";

import { useEffect, useState } from "react"; // Added useEffect

import type { Rule } from "@/lib/types"; // Assuming RuleActions type is part of Rule

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface RuleEditorProperties {
  onCancel: () => void;
  onSave: (rule: Rule) => void;
  rule: null | Rule;
}

export function RuleEditor({ onCancel, onSave, rule }: RuleEditorProperties) {
  const [formData, setFormData] = useState<Rule>(
    rule ?? {
      actions: {}, // Start with empty actions, will be populated by form
      active: true,
      conditions: {},
      id: "", // Will be set on save for new rules
      name: "",
      priority: 1,
      type: "CONDITIONAL_AVAILABILITY",
    },
  );

  // Synchronize formData if the rule prop changes (e.g., when editing a different rule)
  useEffect(() => {
    setFormData(
      rule ?? {
        actions: {},
        active: true,
        conditions: {},
        id: "",
        name: "",
        priority: 1,
        type: "CONDITIONAL_AVAILABILITY",
      },
    );
  }, [rule]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const finalActions = prepareActionsForSave(formData.actions);
    onSave({ ...formData, actions: finalActions });
  };

  const handleActionChange = <K extends keyof Rule["actions"]>(
    key: K,
    value: Rule["actions"][K],
  ) => {
    setFormData((previous) => ({
      ...previous,
      actions: {
        ...previous.actions,
        [key]: value,
      },
    }));
  };

  const handleConditionChange = <K extends keyof Rule["conditions"]>(
    key: K,
    value: Rule["conditions"][K],
  ) => {
    setFormData((previous) => ({
      ...previous,
      conditions: {
        ...previous.conditions,
        [key]: value,
      },
    }));
  };

  return (
    <Dialog onOpenChange={onCancel} open>
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
                onChange={(event) => {
                  setFormData({ ...formData, name: event.target.value });
                }}
                placeholder="z.B. Neue Patienten - Ersttermin"
                required
                value={formData.name}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Regeltyp</Label>
              <Select
                onValueChange={(value) => {
                  setFormData({ ...formData, type: value as Rule["type"] });
                }}
                value={formData.type}
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

            <Tabs className="w-full" defaultValue="conditions">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="conditions">Bedingungen</TabsTrigger>
                <TabsTrigger value="actions">Aktionen</TabsTrigger>
              </TabsList>

              <TabsContent className="space-y-4 pt-4" value="conditions">
                <div className="space-y-2">
                  <Label htmlFor="patient-type">Patiententyp</Label>
                  <Select
                    onValueChange={(value) => {
                      handleConditionChange(
                        "patientType",
                        value === "all"
                          ? undefined
                          : (value as "existing" | "new"),
                      );
                    }}
                    value={formData.conditions.patientType || "all"}
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
                    onChange={(event) => {
                      handleConditionChange(
                        "appointmentType",
                        event.target.value || undefined,
                      );
                    }}
                    placeholder="z.B. Erstberatung, Grippeimpfung"
                    value={formData.conditions.appointmentType || ""}
                  />
                </div>
                {/* Add more condition fields here based on Rule['conditions'] type */}
              </TabsContent>

              <TabsContent className="space-y-4 pt-4" value="actions">
                <div className="flex items-center justify-between">
                  <Label htmlFor="extra-time">
                    Zusätzliche Zeit erforderlich
                  </Label>
                  <Switch
                    checked={formData.actions.requireExtraTime || false}
                    id="extra-time"
                    onCheckedChange={(checked) => {
                      handleActionChange("requireExtraTime", checked);
                    }}
                  />
                </div>

                {formData.actions.requireExtraTime && (
                  <div className="space-y-2">
                    <Label htmlFor="extra-minutes">Zusätzliche Minuten</Label>
                    <Input
                      id="extra-minutes"
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value);
                        handleActionChange(
                          "extraMinutes",
                          Number.isNaN(value) ? 0 : value,
                        );
                      }}
                      type="number"
                      value={formData.actions.extraMinutes || 0}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="limit-per-day">
                    Maximale Termine pro Tag (pro Arzt)
                  </Label>
                  <Input
                    id="limit-per-day"
                    onChange={(event) => {
                      const value = event.target.value;
                      handleActionChange(
                        "limitPerDay",
                        value === "" ? undefined : Number.parseInt(value),
                      );
                    }}
                    placeholder="Keine Begrenzung"
                    type="number"
                    value={formData.actions.limitPerDay ?? ""}
                  />
                </div>
                {/* Add more action fields here based on Rule['actions'] type */}
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="priority">Priorität</Label>
              <Input
                id="priority"
                max="100"
                min="1"
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value);
                  setFormData({
                    ...formData,
                    priority: Number.isNaN(value) ? 1 : value,
                  });
                }}
                required
                type="number"
                value={formData.priority}
              />
              <p className="text-xs text-muted-foreground">
                Niedrigere Zahlen haben höhere Priorität (1 = höchste)
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.active}
                id="active"
                onCheckedChange={(checked) => {
                  setFormData({ ...formData, active: checked });
                }}
              />
              <Label htmlFor="active">Regel aktiv</Label>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={onCancel} type="button" variant="outline">
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
