// src/components/rule-edit-form.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit } from "lucide-react";
import { useState } from "react";
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

import { useErrorTracking } from "../utils/error-tracking";

interface FlatRule {
  _creationTime: number;
  _id: Id<"rules">;
  description: string;
  priority: number;
  ruleSetId: Id<"ruleSets">;
  ruleType: "BLOCK" | "LIMIT_CONCURRENT";

  // Practitioner application
  appliesTo?: "ALL_PRACTITIONERS" | "SPECIFIC_PRACTITIONERS";
  specificPractitioners?: Id<"practitioners">[];

  // Block rule parameters
  block_appointmentTypes?: string[];
  block_dateRangeEnd?: string;
  block_dateRangeStart?: string;
  block_daysOfWeek?: number[];
  block_exceptForPractitionerTags?: string[];
  block_timeRangeEnd?: string;
  block_timeRangeStart?: string;

  // Limit rule parameters
  limit_appointmentTypes?: string[];
  limit_atLocation?: Id<"locations">;
  limit_count?: number;
  limit_perPractitioner?: boolean;
}

interface RuleEditFormProps {
  practiceId: Id<"practices">;
  rule: FlatRule;
}

export default function RuleEditForm({ practiceId, rule }: RuleEditFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { captureError } = useErrorTracking();

  const updateRuleMutation = useMutation(api.rulesets.updateRule);
  const practitionersQuery = useQuery(api.practitioners.getPractitioners, {
    practiceId,
  });

  const form = useForm({
    defaultValues: {
      appliesTo: rule.appliesTo ?? "ALL_PRACTITIONERS",
      block_appointmentTypes: rule.block_appointmentTypes ?? [],
      block_dateRangeEnd: rule.block_dateRangeEnd ?? "",
      block_dateRangeStart: rule.block_dateRangeStart ?? "",
      block_daysOfWeek: rule.block_daysOfWeek ?? [],
      block_exceptForPractitionerTags: rule.block_exceptForPractitionerTags ?? [],
      block_timeRangeEnd: rule.block_timeRangeEnd ?? "",
      block_timeRangeStart: rule.block_timeRangeStart ?? "",
      description: rule.description,
      limit_appointmentTypes: rule.limit_appointmentTypes ?? [],
      limit_count: rule.limit_count ?? 1,
      limit_perPractitioner: rule.limit_perPractitioner ?? false,
      priority: rule.priority,
      ruleType: rule.ruleType,
      specificPractitioners: rule.specificPractitioners ?? [],
    },
    onSubmit: async ({ value }) => {
      try {
        // Build update object with only changed values
        const updates: Record<string, unknown> = {};

        // Compare each field and only include if changed
        if (value.description !== rule.description) {
          updates['description'] = value.description;
        }
        if (value.priority !== rule.priority) {
          updates['priority'] = value.priority;
        }
        if (value.ruleType !== rule.ruleType) {
          updates['ruleType'] = value.ruleType;
        }
        if (value.appliesTo !== (rule.appliesTo ?? "ALL_PRACTITIONERS")) {
          updates['appliesTo'] = value.appliesTo;
        }

        // Handle specific practitioners
        const originalPractitioners = rule.specificPractitioners ?? [];
        const newPractitioners = value.specificPractitioners;
        if (JSON.stringify(originalPractitioners) !== JSON.stringify(newPractitioners)) {
          updates['specificPractitioners'] = newPractitioners.length > 0 ? newPractitioners : undefined;
        }

        // Handle block rule parameters
        if (value.ruleType === "BLOCK") {
          const blockFields = [
            'block_appointmentTypes',
            'block_dateRangeStart',
            'block_dateRangeEnd',
            'block_daysOfWeek',
            'block_timeRangeStart',
            'block_timeRangeEnd',
            'block_exceptForPractitionerTags'
          ] as const;

          for (const field of blockFields) {
            const currentValue = value[field];
            const originalValue = rule[field];
            
            if (Array.isArray(currentValue)) {
              if (JSON.stringify(currentValue) !== JSON.stringify(originalValue ?? [])) {
                updates[field] = currentValue.length > 0 ? currentValue : undefined;
              }
            } else if (currentValue !== (originalValue ?? "")) {
              updates[field] = currentValue || undefined;
            }
          }
        }

        // Handle limit rule parameters
        if (value.ruleType === "LIMIT_CONCURRENT") {
          if (JSON.stringify(value.limit_appointmentTypes) !== JSON.stringify(rule.limit_appointmentTypes ?? [])) {
            updates['limit_appointmentTypes'] = value.limit_appointmentTypes.length > 0 ? value.limit_appointmentTypes : undefined;
          }
          if (value.limit_count !== (rule.limit_count ?? 1)) {
            updates['limit_count'] = value.limit_count;
          }
          if (value.limit_perPractitioner !== (rule.limit_perPractitioner ?? false)) {
            updates['limit_perPractitioner'] = value.limit_perPractitioner;
          }
        }

        // Only update if there are actual changes
        if (Object.keys(updates).length === 0) {
          toast.info("Keine Änderungen zu speichern");
          setIsOpen(false);
          return;
        }

        await updateRuleMutation({
          ruleId: rule._id,
          updates,
        });

        toast.success("Regel aktualisiert", {
          description: "Die Regel wurde erfolgreich aktualisiert.",
        });

        setIsOpen(false);
      } catch (error: unknown) {
        captureError(error, {
          context: "rule_update",
          formData: value,
          practiceId,
          ruleId: rule._id,
        });

        toast.error("Fehler beim Aktualisieren der Regel", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    },
  });

  const dayOfWeekOptions = [
    { label: "Montag", value: 1 },
    { label: "Dienstag", value: 2 },
    { label: "Mittwoch", value: 3 },
    { label: "Donnerstag", value: 4 },
    { label: "Freitag", value: 5 },
  ];

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Regel bearbeiten</DialogTitle>
          <DialogDescription>
            Bearbeiten Sie die ausgewählte Regel.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Grundinformationen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form.Field
                name="description"
                validators={{
                  onChange: ({ value }) =>
                    !value || value.trim() === ""
                      ? "Beschreibung ist erforderlich"
                      : undefined,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Beschreibung *</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="z.B. Keine Termine am Freitagnachmittag"
                      value={field.state.value}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <div className="grid grid-cols-2 gap-4">
                <form.Field name="priority">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Priorität</Label>
                      <Input
                        id={field.name}
                        max="999"
                        min="1"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(
                            Number.parseInt(e.target.value) || 0,
                          );
                        }}
                        type="number"
                        value={field.state.value}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="ruleType">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Regeltyp</Label>
                      <Select
                        onValueChange={(
                          value: "BLOCK" | "LIMIT_CONCURRENT",
                        ) => {
                          field.handleChange(value);
                        }}
                        value={field.state.value}
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
                  )}
                </form.Field>
              </div>
            </CardContent>
          </Card>

          {/* Practitioner Application */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Anwendung auf Ärzte</CardTitle>
              <CardDescription>
                Bestimmen Sie, für welche Ärzte diese Regel gelten soll.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form.Field name="appliesTo">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Gilt für</Label>
                    <Select
                      onValueChange={(
                        value: "ALL_PRACTITIONERS" | "SPECIFIC_PRACTITIONERS",
                      ) => {
                        field.handleChange(value);
                        // Reset specific practitioners when changing to ALL_PRACTITIONERS
                        if (value === "ALL_PRACTITIONERS") {
                          form.setFieldValue("specificPractitioners", []);
                        }
                      }}
                      value={field.state.value}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL_PRACTITIONERS">
                          Alle Ärzte
                        </SelectItem>
                        <SelectItem value="SPECIFIC_PRACTITIONERS">
                          Bestimmte Ärzte
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>

              <form.Field name="appliesTo">
                {(field) =>
                  field.state.value === "SPECIFIC_PRACTITIONERS" && (
                    <form.Field name="specificPractitioners">
                      {(practitionersField) => (
                        <div className="space-y-2">
                          <Label>Spezifische Ärzte auswählen</Label>
                          {practitionersQuery ? (
                            practitionersQuery.length === 0 ? (
                              <div className="text-sm text-muted-foreground p-4 border rounded">
                                Keine Ärzte verfügbar. Bitte erstellen Sie
                                zuerst Ärzte in der Ärztevertaltung.
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-40 overflow-y-auto border rounded p-2">
                                {practitionersQuery.map((practitioner) => (
                                  <label
                                    className="flex items-center space-x-2"
                                    key={practitioner._id}
                                  >
                                    <input
                                      checked={practitionersField.state.value.includes(
                                        practitioner._id,
                                      )}
                                      onChange={(e) => {
                                        const currentIds =
                                          practitionersField.state.value;
                                        if (e.target.checked) {
                                          practitionersField.handleChange([
                                            ...currentIds,
                                            practitioner._id,
                                          ]);
                                        } else {
                                          practitionersField.handleChange(
                                            currentIds.filter(
                                              (id: string) =>
                                                id !== practitioner._id,
                                            ),
                                          );
                                        }
                                      }}
                                      type="checkbox"
                                    />
                                    <span className="text-sm">
                                      {practitioner.name}
                                    </span>
                                    {practitioner.tags &&
                                      practitioner.tags.length > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                          ({practitioner.tags.join(", ")})
                                        </span>
                                      )}
                                  </label>
                                ))}
                              </div>
                            )
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              Lade Ärzte...
                            </div>
                          )}
                        </div>
                      )}
                    </form.Field>
                  )
                }
              </form.Field>
            </CardContent>
          </Card>

          {/* Rule Type Specific Settings */}
          <form.Field name="ruleType">
            {(field) =>
              field.state.value === "BLOCK" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Blockier-Regeln</CardTitle>
                    <CardDescription>
                      Konfigurieren Sie, wann Termine blockiert werden sollen.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form.Field name="block_appointmentTypes">
                      {(appointmentTypesField) => (
                        <div className="space-y-2">
                          <Label htmlFor={appointmentTypesField.name}>
                            Terminarten (kommagetrennt)
                          </Label>
                          <Input
                            id={appointmentTypesField.name}
                            name={appointmentTypesField.name}
                            onBlur={appointmentTypesField.handleBlur}
                            onChange={(e) => {
                              appointmentTypesField.handleChange(
                                e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              );
                            }}
                            placeholder="z.B. Beratung, Untersuchung"
                            value={appointmentTypesField.state.value.join(", ")}
                          />
                        </div>
                      )}
                    </form.Field>

                    <div className="grid grid-cols-2 gap-4">
                      <form.Field name="block_timeRangeStart">
                        {(timeStartField) => (
                          <div className="space-y-2">
                            <Label htmlFor={timeStartField.name}>
                              Startzeit
                            </Label>
                            <Input
                              id={timeStartField.name}
                              name={timeStartField.name}
                              onBlur={timeStartField.handleBlur}
                              onChange={(e) => {
                                timeStartField.handleChange(e.target.value);
                              }}
                              type="time"
                              value={timeStartField.state.value}
                            />
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="block_timeRangeEnd">
                        {(timeEndField) => (
                          <div className="space-y-2">
                            <Label htmlFor={timeEndField.name}>Endzeit</Label>
                            <Input
                              id={timeEndField.name}
                              name={timeEndField.name}
                              onBlur={timeEndField.handleBlur}
                              onChange={(e) => {
                                timeEndField.handleChange(e.target.value);
                              }}
                              type="time"
                              value={timeEndField.state.value}
                            />
                          </div>
                        )}
                      </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <form.Field name="block_dateRangeStart">
                        {(dateStartField) => (
                          <div className="space-y-2">
                            <Label htmlFor={dateStartField.name}>
                              Startdatum
                            </Label>
                            <Input
                              id={dateStartField.name}
                              name={dateStartField.name}
                              onBlur={dateStartField.handleBlur}
                              onChange={(e) => {
                                dateStartField.handleChange(e.target.value);
                              }}
                              type="date"
                              value={dateStartField.state.value}
                            />
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="block_dateRangeEnd">
                        {(dateEndField) => (
                          <div className="space-y-2">
                            <Label htmlFor={dateEndField.name}>Enddatum</Label>
                            <Input
                              id={dateEndField.name}
                              name={dateEndField.name}
                              onBlur={dateEndField.handleBlur}
                              onChange={(e) => {
                                dateEndField.handleChange(e.target.value);
                              }}
                              type="date"
                              value={dateEndField.state.value}
                            />
                          </div>
                        )}
                      </form.Field>
                    </div>

                    <form.Field name="block_daysOfWeek">
                      {(daysField) => (
                        <div className="space-y-2">
                          <Label>Wochentage</Label>
                          <div className="grid grid-cols-2 gap-2">
                            {dayOfWeekOptions.map((day) => (
                              <label
                                className="flex items-center space-x-2"
                                key={day.value}
                              >
                                <input
                                  checked={daysField.state.value.includes(
                                    day.value,
                                  )}
                                  onChange={(e) => {
                                    const currentDays = daysField.state.value;
                                    if (e.target.checked) {
                                      daysField.handleChange([
                                        ...currentDays,
                                        day.value,
                                      ]);
                                    } else {
                                      daysField.handleChange(
                                        currentDays.filter(
                                          (d: number) => d !== day.value,
                                        ),
                                      );
                                    }
                                  }}
                                  type="checkbox"
                                />
                                <span className="text-sm">{day.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </form.Field>
                  </CardContent>
                </Card>
              )
            }
          </form.Field>

          <form.Field name="ruleType">
            {(field) =>
              field.state.value === "LIMIT_CONCURRENT" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Limitierungs-Regeln
                    </CardTitle>
                    <CardDescription>
                      Begrenzen Sie die Anzahl paralleler Termine.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form.Field name="limit_appointmentTypes">
                      {(appointmentTypesField) => (
                        <div className="space-y-2">
                          <Label htmlFor={appointmentTypesField.name}>
                            Terminarten (kommagetrennt)
                          </Label>
                          <Input
                            id={appointmentTypesField.name}
                            name={appointmentTypesField.name}
                            onBlur={appointmentTypesField.handleBlur}
                            onChange={(e) => {
                              appointmentTypesField.handleChange(
                                e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              );
                            }}
                            placeholder="z.B. Beratung, Untersuchung"
                            value={appointmentTypesField.state.value.join(", ")}
                          />
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="limit_count">
                      {(countField) => (
                        <div className="space-y-2">
                          <Label htmlFor={countField.name}>
                            Maximale Anzahl
                          </Label>
                          <Input
                            id={countField.name}
                            max="100"
                            min="1"
                            name={countField.name}
                            onBlur={countField.handleBlur}
                            onChange={(e) => {
                              countField.handleChange(
                                Number.parseInt(e.target.value) || 1,
                              );
                            }}
                            type="number"
                            value={countField.state.value}
                          />
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="limit_perPractitioner">
                      {(perPractitionerField) => (
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={perPractitionerField.state.value}
                            id={perPractitionerField.name}
                            onCheckedChange={(checked) => {
                              perPractitionerField.handleChange(checked);
                            }}
                          />
                          <Label htmlFor={perPractitionerField.name}>
                            Pro Arzt
                          </Label>
                        </div>
                      )}
                    </form.Field>
                  </CardContent>
                </Card>
              )
            }
          </form.Field>

          <div className="flex justify-end space-x-2">
            <Button
              disabled={form.state.isSubmitting}
              onClick={() => {
                setIsOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button disabled={form.state.isSubmitting} type="submit">
              {form.state.isSubmitting ? "Speichere..." : "Änderungen speichern"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}