// src/components/rule-creation-form-new.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Doc, Id } from "@/convex/_generated/dataModel";

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

interface RuleCreationFormNewProps {
  onRuleCreated?: (() => void) | undefined;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets">; // Optional - if provided, rule will be auto-enabled in this rule set
  // For copy functionality - use Convex inferred types
  copyFromRule?: Partial<
    Omit<Doc<"rules">, "_creationTime" | "_id" | "practiceId">
  >;
  customTrigger?: React.ReactNode; // Custom trigger element
  triggerText?: string;
}

export default function RuleCreationFormNew({
  copyFromRule,
  customTrigger,
  onRuleCreated,
  practiceId,
  ruleSetId,
  triggerText = "Neue Regel",
}: RuleCreationFormNewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { captureError } = useErrorTracking();

  const createRuleMutation = useMutation(api.rules.createRule);
  const practitionersQuery = useQuery(
    api.practitioners.getPractitioners,
    ruleSetId ? { ruleSetId } : "skip",
  );

  const form = useForm({
    defaultValues: {
      appliesTo: copyFromRule?.appliesTo ?? "ALL_PRACTITIONERS",
      block_appointmentTypes:
        copyFromRule?.block_appointmentTypes ?? ([] as string[]),
      block_dateRangeEnd: copyFromRule?.block_dateRangeEnd ?? "",
      block_dateRangeStart: copyFromRule?.block_dateRangeStart ?? "",
      block_daysOfWeek: copyFromRule?.block_daysOfWeek ?? ([] as number[]),
      block_timeRangeEnd: copyFromRule?.block_timeRangeEnd ?? "",
      block_timeRangeStart: copyFromRule?.block_timeRangeStart ?? "",
      description: copyFromRule?.description ?? "",
      limit_appointmentTypes:
        copyFromRule?.limit_appointmentTypes ?? ([] as string[]),
      limit_count: copyFromRule?.limit_count ?? 1,
      limit_perPractitioner: copyFromRule?.limit_perPractitioner ?? false,
      name: "", // Always start with empty name, even for copies
      ruleType: copyFromRule?.ruleType ?? "BLOCK",
      specificPractitioners:
        copyFromRule?.specificPractitioners ?? ([] as Id<"practitioners">[]),
    },
    onSubmit: async ({ value }) => {
      try {
        // First create the global rule
        const ruleData: Record<string, unknown> = {
          appliesTo: value.appliesTo,
          description: value.description,
          name: value.name,
          practiceId,
          ruleType: value.ruleType,
        };

        // Add specific practitioners if applicable
        if (
          value.appliesTo === "SPECIFIC_PRACTITIONERS" &&
          value.specificPractitioners.length > 0
        ) {
          ruleData["specificPractitioners"] = value.specificPractitioners;
        }

        // Add rule-type specific parameters
        if (value.ruleType === "BLOCK") {
          if (value.block_appointmentTypes.length > 0) {
            ruleData["block_appointmentTypes"] = value.block_appointmentTypes;
          }
          if (value.block_dateRangeStart) {
            ruleData["block_dateRangeStart"] = value.block_dateRangeStart;
          }
          if (value.block_dateRangeEnd) {
            ruleData["block_dateRangeEnd"] = value.block_dateRangeEnd;
          }
          if (value.block_daysOfWeek.length > 0) {
            ruleData["block_daysOfWeek"] = value.block_daysOfWeek;
          }
          if (value.block_timeRangeStart) {
            ruleData["block_timeRangeStart"] = value.block_timeRangeStart;
          }
          if (value.block_timeRangeEnd) {
            ruleData["block_timeRangeEnd"] = value.block_timeRangeEnd;
          }
        } else {
          if (value.limit_appointmentTypes.length > 0) {
            ruleData["limit_appointmentTypes"] = value.limit_appointmentTypes;
          }
          if (value.limit_count > 0) {
            ruleData["limit_count"] = value.limit_count;
          }
          ruleData["limit_perPractitioner"] = value.limit_perPractitioner;
        }

        await createRuleMutation(
          ruleData as Parameters<typeof createRuleMutation>[0],
        );

        toast.success("Regel erstellt", {
          description: "Die neue Regel wurde erfolgreich erstellt.",
        });

        // Reset form
        form.reset();
        setIsOpen(false);
        onRuleCreated?.();
      } catch (error: unknown) {
        captureError(error, {
          context: "rule_creation",
          formData: value,
          practiceId,
          ruleSetId,
        });

        toast.error("Fehler beim Erstellen der Regel", {
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
        {customTrigger || (
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {triggerText}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {copyFromRule ? "Regel kopieren" : "Neue Regel erstellen"}
          </DialogTitle>
          <DialogDescription>
            {copyFromRule
              ? "Erstellen Sie eine Kopie der Regel mit einem neuen Namen."
              : "Erstellen Sie eine neue Regel. Diese wird global verfügbar und kann in verschiedenen Regelsets verwendet werden."}
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
                name="name"
                validators={{
                  onChange: ({ value }) => {
                    if (!value || value.trim() === "") {
                      return "Name ist erforderlich";
                    }
                    // TODO: Add real-time name validation
                    return;
                  },
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Regelname *</Label>
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
                    <p className="text-xs text-muted-foreground">
                      Der Name muss eindeutig sein und kann in mehreren
                      Regelsets verwendet werden.
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

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
                      placeholder="z.B. Blockiert alle Termine am Freitagnachmittag"
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

              <form.Field name="ruleType">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Regeltyp</Label>
                    <Select
                      onValueChange={(value: "BLOCK" | "LIMIT_CONCURRENT") => {
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
              {form.state.isSubmitting ? "Erstelle..." : "Regel erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
