// src/components/rule-creation-form.tsx
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { api } from "@/convex/_generated/api";

interface RuleCreationFormProps {
  onRuleCreated?: () => void;
  ruleSetId: Id<"ruleSets">;
}

export default function RuleCreationForm({
  onRuleCreated,
  ruleSetId,
}: RuleCreationFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    description: "",
    priority: 100,
    ruleType: "BLOCK" as "BLOCK" | "LIMIT_CONCURRENT",

    // Block rule parameters
    block_appointmentTypes: [] as string[],
    block_dateRangeEnd: "",
    block_dateRangeStart: "",
    block_daysOfWeek: [] as number[],
    block_exceptForPractitionerTags: [] as string[],
    block_timeRangeEnd: "",
    block_timeRangeStart: "",

    // Limit rule parameters
    limit_appointmentTypes: [] as string[],
    limit_count: 1,
    limit_perPractitioner: false,
  });

  const createRuleMutation = useMutation(api.rulesets.createRule);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      toast.error("Beschreibung ist erforderlich");
      return;
    }

    try {
      setIsCreating(true);

      const ruleData: Record<string, unknown> = {
        description: formData.description,
        priority: formData.priority,
        ruleSetId,
        ruleType: formData.ruleType,
      };

      // Add rule-type specific parameters
      if (formData.ruleType === "BLOCK") {
        if (formData.block_appointmentTypes.length > 0) {
          ruleData["block_appointmentTypes"] = formData.block_appointmentTypes;
        }
        if (formData.block_dateRangeStart) {
          ruleData["block_dateRangeStart"] = formData.block_dateRangeStart;
        }
        if (formData.block_dateRangeEnd) {
          ruleData["block_dateRangeEnd"] = formData.block_dateRangeEnd;
        }
        if (formData.block_daysOfWeek.length > 0) {
          ruleData["block_daysOfWeek"] = formData.block_daysOfWeek;
        }
        if (formData.block_timeRangeStart) {
          ruleData["block_timeRangeStart"] = formData.block_timeRangeStart;
        }
        if (formData.block_timeRangeEnd) {
          ruleData["block_timeRangeEnd"] = formData.block_timeRangeEnd;
        }
        if (formData.block_exceptForPractitionerTags.length > 0) {
          ruleData["block_exceptForPractitionerTags"] =
            formData.block_exceptForPractitionerTags;
        }
      } else {
        if (formData.limit_appointmentTypes.length > 0) {
          ruleData["limit_appointmentTypes"] = formData.limit_appointmentTypes;
        }
        if (formData.limit_count > 0) {
          ruleData["limit_count"] = formData.limit_count;
        }
        ruleData["limit_perPractitioner"] = formData.limit_perPractitioner;
      }

      await createRuleMutation(
        ruleData as Parameters<typeof createRuleMutation>[0],
      );

      toast.success("Regel erstellt", {
        description: "Die neue Regel wurde erfolgreich erstellt.",
      });

      // Reset form
      setFormData({
        block_appointmentTypes: [],
        block_dateRangeEnd: "",
        block_dateRangeStart: "",
        block_daysOfWeek: [],
        block_exceptForPractitionerTags: [],
        block_timeRangeEnd: "",
        block_timeRangeStart: "",
        description: "",
        limit_appointmentTypes: [],
        limit_count: 1,
        limit_perPractitioner: false,
        priority: 100,
        ruleType: "BLOCK",
      });

      setIsOpen(false);
      onRuleCreated?.();
    } catch (error) {
      toast.error("Fehler beim Erstellen der Regel", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const dayOfWeekOptions = [
    { label: "Sonntag", value: 0 },
    { label: "Montag", value: 1 },
    { label: "Dienstag", value: 2 },
    { label: "Mittwoch", value: 3 },
    { label: "Donnerstag", value: 4 },
    { label: "Freitag", value: 5 },
    { label: "Samstag", value: 6 },
  ];

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Neue Regel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Regel erstellen</DialogTitle>
          <DialogDescription>
            Erstellen Sie eine neue Regel für das ausgewählte Regelset.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(e);
          }}
        >
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Grundinformationen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">Beschreibung *</Label>
                <Input
                  id="description"
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value });
                  }}
                  placeholder="z.B. Keine Termine am Freitagnachmittag"
                  required
                  value={formData.description}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priorität</Label>
                  <Input
                    id="priority"
                    max="999"
                    min="1"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        priority: Number.parseInt(e.target.value) || 0,
                      });
                    }}
                    type="number"
                    value={formData.priority}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ruleType">Regeltyp</Label>
                  <Select
                    onValueChange={(value: "BLOCK" | "LIMIT_CONCURRENT") => {
                      setFormData({ ...formData, ruleType: value });
                    }}
                    value={formData.ruleType}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BLOCK">Blockieren</SelectItem>
                      <SelectItem value="LIMIT_CONCURRENT">
                        Anzahl limitieren
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rule Type Specific Settings */}
          {formData.ruleType === "BLOCK" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Blockier-Regeln</CardTitle>
                <CardDescription>
                  Konfigurieren Sie, wann Termine blockiert werden sollen.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="block_appointmentTypes">
                    Terminarten (kommagetrennt)
                  </Label>
                  <Input
                    id="block_appointmentTypes"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        block_appointmentTypes: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="z.B. Beratung, Untersuchung"
                    value={formData.block_appointmentTypes.join(", ")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="block_timeRangeStart">Startzeit</Label>
                    <Input
                      id="block_timeRangeStart"
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          block_timeRangeStart: e.target.value,
                        });
                      }}
                      type="time"
                      value={formData.block_timeRangeStart}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="block_timeRangeEnd">Endzeit</Label>
                    <Input
                      id="block_timeRangeEnd"
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          block_timeRangeEnd: e.target.value,
                        });
                      }}
                      type="time"
                      value={formData.block_timeRangeEnd}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="block_dateRangeStart">Startdatum</Label>
                    <Input
                      id="block_dateRangeStart"
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          block_dateRangeStart: e.target.value,
                        });
                      }}
                      type="date"
                      value={formData.block_dateRangeStart}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="block_dateRangeEnd">Enddatum</Label>
                    <Input
                      id="block_dateRangeEnd"
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          block_dateRangeEnd: e.target.value,
                        });
                      }}
                      type="date"
                      value={formData.block_dateRangeEnd}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Wochentage</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {dayOfWeekOptions.map((day) => (
                      <label
                        className="flex items-center space-x-2"
                        key={day.value}
                      >
                        <input
                          checked={formData.block_daysOfWeek.includes(
                            day.value,
                          )}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                block_daysOfWeek: [
                                  ...formData.block_daysOfWeek,
                                  day.value,
                                ],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                block_daysOfWeek:
                                  formData.block_daysOfWeek.filter(
                                    (d) => d !== day.value,
                                  ),
                              });
                            }
                          }}
                          type="checkbox"
                        />
                        <span className="text-sm">{day.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {formData.ruleType === "LIMIT_CONCURRENT" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Limitierungs-Regeln</CardTitle>
                <CardDescription>
                  Begrenzen Sie die Anzahl paralleler Termine.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="limit_appointmentTypes">
                    Terminarten (kommagetrennt)
                  </Label>
                  <Input
                    id="limit_appointmentTypes"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        limit_appointmentTypes: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                    placeholder="z.B. Beratung, Untersuchung"
                    value={formData.limit_appointmentTypes.join(", ")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="limit_count">Maximale Anzahl</Label>
                  <Input
                    id="limit_count"
                    max="100"
                    min="1"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        limit_count: Number.parseInt(e.target.value) || 1,
                      });
                    }}
                    type="number"
                    value={formData.limit_count}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={formData.limit_perPractitioner}
                    id="limit_perPractitioner"
                    onCheckedChange={(checked) => {
                      setFormData({
                        ...formData,
                        limit_perPractitioner: checked,
                      });
                    }}
                  />
                  <Label htmlFor="limit_perPractitioner">Pro Arzt</Label>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end space-x-2">
            <Button
              disabled={isCreating}
              onClick={() => {
                setIsOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button disabled={isCreating} type="submit">
              {isCreating ? "Erstelle..." : "Regel erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
