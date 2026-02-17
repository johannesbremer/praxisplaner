import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ConditionTreeNode } from "@/convex/ruleEngine";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { LocalHistoryAction } from "../hooks/use-local-history";

import { api } from "../../convex/_generated/api";
import {
  conditionTreeToConditions,
  dayNameToNumber,
  generateRuleName,
} from "../../lib/rule-name-generator";
import { Combobox, type ComboboxOption } from "./combobox";

// Condition types for the new list-based UI
interface Condition {
  id: string;
  operator?: "GREATER_THAN_OR_EQUAL" | "IS" | "IS_NOT" | "LESS_THAN";
  type: ConditionType;
  valueIds?: string[];
  valueNumber?: null | number;
  // For concurrent/daily count conditions
  appointmentTypes?: null | string[];
  count?: null | number;
  scope?: "location" | "practice" | "practitioner" | null;
}

type ConditionType =
  | "APPOINTMENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "LOCATION"
  | "PATIENT_AGE"
  | "PRACTITIONER";

// Validation helper
interface RuleBuilderProps {
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

interface RuleFromDB {
  _id: Id<"ruleConditions">;
  conditionTree: unknown;
  copyFromId: Id<"ruleConditions"> | undefined;
  createdAt: bigint;
  enabled: boolean;
  lastModified: bigint;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

export function RuleBuilder({
  onRegisterHistoryAction,
  onRuleCreated,
  practiceId,
  ruleSetId,
}: RuleBuilderProps) {
  const createRuleMutation = useMutation(api.entities.createRule);
  const deleteRuleMutation = useMutation(api.entities.deleteRule);

  // Query data from Convex
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const locations = useQuery(api.entities.getLocations, { ruleSetId });
  const existingRules = useQuery(api.entities.getRules, { ruleSetId });
  const rulesRef = useRef(existingRules ?? []);
  useEffect(() => {
    rulesRef.current = existingRules ?? [];
  }, [existingRules]);

  // Check if all data is loaded
  const dataReady = Boolean(appointmentTypes && practitioners && locations);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<
    "new" | Id<"ruleConditions"> | null
  >(null);

  const openNewRuleDialog = () => {
    setEditingRuleId("new");
    setIsDialogOpen(true);
  };

  const openEditRuleDialog = (ruleId: Id<"ruleConditions">) => {
    setEditingRuleId(ruleId);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (ruleId: Id<"ruleConditions">) => {
    try {
      const deletedRule = rulesRef.current.find((rule) => rule._id === ruleId);
      const deletedRuleName = deletedRule
        ? generateRuleName(
            conditionTreeToConditions(deletedRule.conditionTree),
            appointmentTypes ?? [],
            practitioners ?? [],
            locations ?? [],
          )
        : "Regel";

      const { ruleSetId: newRuleSetId } = await deleteRuleMutation({
        practiceId,
        ruleId,
        sourceRuleSetId: ruleSetId,
      });

      if (deletedRule) {
        let currentRuleId = ruleId;
        onRegisterHistoryAction?.({
          label: "Regel gelöscht",
          redo: async () => {
            const existing = rulesRef.current.find(
              (rule) => rule._id === currentRuleId,
            );
            if (!existing) {
              return {
                message: "Die Regel ist bereits gelöscht.",
                status: "conflict" as const,
              };
            }

            await deleteRuleMutation({
              practiceId,
              ruleId: currentRuleId,
              sourceRuleSetId: newRuleSetId,
            });
            return { status: "applied" as const };
          },
          undo: async () => {
            const recreateResult = await createRuleMutation({
              conditionTree: deletedRule.conditionTree as Parameters<
                typeof createRuleMutation
              >[0]["conditionTree"],
              enabled: deletedRule.enabled,
              name: deletedRuleName,
              practiceId,
              sourceRuleSetId: newRuleSetId,
            });
            currentRuleId = recreateResult.entityId as Id<"ruleConditions">;
            return { status: "applied" as const };
          },
        });
      }

      // Notify parent if rule set changed (new unsaved rule set was created)
      if (onRuleCreated && newRuleSetId !== ruleSetId) {
        onRuleCreated(newRuleSetId);
      }
    } catch (error) {
      console.error("Failed to delete rule:", error);
    }
  };

  // Get existing rule for editing
  const editingRule = existingRules?.find((r) => r._id === editingRuleId);

  // Early return for loading state
  if (!dataReady || !appointmentTypes || !practitioners || !locations) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">Lade Daten...</div>
      </div>
    );
  }

  // At this point, TypeScript knows all data is loaded
  return (
    <div className="space-y-4">
      {/* Render all existing rules as cards */}
      {existingRules?.map((rule) => {
        const ruleName = generateRuleName(
          conditionTreeToConditions(rule.conditionTree),
          appointmentTypes,
          practitioners,
          locations,
        );

        return (
          <Card key={rule._id}>
            <CardHeader>
              <CardTitle className="font-normal">{ruleName}</CardTitle>
              <CardAction className="flex gap-2">
                <Button
                  onClick={() => {
                    openEditRuleDialog(rule._id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => {
                    void handleDeleteRule(rule._id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        );
      })}

      {/* Add new rule button */}
      <Button className="gap-2" onClick={openNewRuleDialog}>
        <Plus className="h-4 w-4" />
        Neue Regel
      </Button>

      {/* Edit/Create Rule Dialog */}
      {editingRuleId && (
        <RuleEditDialog
          appointmentTypes={appointmentTypes}
          existingRule={editingRule}
          isOpen={isDialogOpen}
          locations={locations}
          onClose={closeDialog}
          onCreate={async (conditionTree) => {
            const previousRule =
              editingRuleId === "new"
                ? undefined
                : rulesRef.current.find((rule) => rule._id === editingRuleId);

            let finalRuleSetId = ruleSetId;

            if (editingRuleId !== "new") {
              // Delete old rule first
              const { ruleSetId: deleteRuleSetId } = await deleteRuleMutation({
                practiceId,
                ruleId: editingRuleId,
                sourceRuleSetId: ruleSetId,
              });
              finalRuleSetId = deleteRuleSetId;
            }

            const conditions = conditionTreeToConditions(
              conditionTree as ConditionTreeNode,
            );
            const ruleName = generateRuleName(
              conditions,
              appointmentTypes,
              practitioners,
              locations,
            );

            const { entityId, ruleSetId: createRuleSetId } =
              await createRuleMutation({
                conditionTree: conditionTree as Parameters<
                  typeof createRuleMutation
                >[0]["conditionTree"],
                enabled: true,
                name: ruleName,
                practiceId,
                sourceRuleSetId: finalRuleSetId,
              });

            let currentRuleId = entityId as Id<"ruleConditions">;

            if (previousRule) {
              const previousRuleName = generateRuleName(
                conditionTreeToConditions(previousRule.conditionTree),
                appointmentTypes,
                practitioners,
                locations,
              );

              onRegisterHistoryAction?.({
                label: "Regel aktualisiert",
                redo: async () => {
                  const existing = rulesRef.current.find(
                    (rule) => rule._id === currentRuleId,
                  );
                  if (!existing) {
                    return {
                      message:
                        "Die Regel kann nicht wiederhergestellt werden, weil sie bereits gelöscht wurde.",
                      status: "conflict" as const,
                    };
                  }

                  await deleteRuleMutation({
                    practiceId,
                    ruleId: currentRuleId,
                    sourceRuleSetId: createRuleSetId,
                  });

                  const recreateResult = await createRuleMutation({
                    conditionTree: conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    enabled: true,
                    name: ruleName,
                    practiceId,
                    sourceRuleSetId: createRuleSetId,
                  });
                  currentRuleId =
                    recreateResult.entityId as Id<"ruleConditions">;
                  return { status: "applied" as const };
                },
                undo: async () => {
                  const existing = rulesRef.current.find(
                    (rule) => rule._id === currentRuleId,
                  );
                  if (!existing) {
                    return {
                      message:
                        "Die aktualisierte Regel wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
                      status: "conflict" as const,
                    };
                  }

                  await deleteRuleMutation({
                    practiceId,
                    ruleId: currentRuleId,
                    sourceRuleSetId: createRuleSetId,
                  });

                  const recreatePrevious = await createRuleMutation({
                    conditionTree: previousRule.conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    enabled: previousRule.enabled,
                    name: previousRuleName,
                    practiceId,
                    sourceRuleSetId: createRuleSetId,
                  });
                  currentRuleId =
                    recreatePrevious.entityId as Id<"ruleConditions">;
                  return { status: "applied" as const };
                },
              });
            } else {
              onRegisterHistoryAction?.({
                label: "Regel erstellt",
                redo: async () => {
                  const recreateResult = await createRuleMutation({
                    conditionTree: conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    enabled: true,
                    name: ruleName,
                    practiceId,
                    sourceRuleSetId: createRuleSetId,
                  });
                  currentRuleId =
                    recreateResult.entityId as Id<"ruleConditions">;
                  return { status: "applied" as const };
                },
                undo: async () => {
                  const existing = rulesRef.current.find(
                    (rule) => rule._id === currentRuleId,
                  );
                  if (!existing) {
                    return {
                      message: "Die Regel wurde bereits gelöscht.",
                      status: "conflict" as const,
                    };
                  }

                  await deleteRuleMutation({
                    practiceId,
                    ruleId: currentRuleId,
                    sourceRuleSetId: createRuleSetId,
                  });
                  return { status: "applied" as const };
                },
              });
            }

            closeDialog();

            // Notify parent if rule set changed (new unsaved rule set was created)
            if (onRuleCreated && createRuleSetId !== ruleSetId) {
              onRuleCreated(createRuleSetId);
            }
          }}
          practitioners={practitioners}
        />
      )}
    </div>
  );
}

function validateCondition(condition: Condition): string[] {
  const invalidFields: string[] = [];

  switch (condition.type) {
    case "APPOINTMENT_TYPE":
    case "DAY_OF_WEEK":
    case "LOCATION":
    case "PRACTITIONER": {
      if (!condition.operator) {
        invalidFields.push("operator");
      }
      if (!condition.valueIds || condition.valueIds.length === 0) {
        invalidFields.push("valueIds");
      }
      break;
    }
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY": {
      if (!condition.count || condition.count < 1) {
        invalidFields.push("count");
      }
      if (
        !condition.appointmentTypes ||
        condition.appointmentTypes.length === 0
      ) {
        invalidFields.push("appointmentTypes");
      }
      if (!condition.scope) {
        invalidFields.push("scope");
      }
      break;
    }
    case "DAYS_AHEAD": {
      if (!condition.valueNumber || condition.valueNumber < 1) {
        invalidFields.push("valueNumber");
      }
      break;
    }
    case "PATIENT_AGE": {
      if (!condition.operator) {
        invalidFields.push("operator");
      }
      if (
        condition.valueNumber === null ||
        condition.valueNumber === undefined
      ) {
        invalidFields.push("valueNumber");
      } else if (condition.valueNumber < 0) {
        invalidFields.push("valueNumber");
      }
      break;
    }
  }

  return invalidFields;
}

// Helper to get user-friendly error message from field name
function getErrorMessage(condition: Condition, invalidField: string): string {
  switch (condition.type) {
    case "APPOINTMENT_TYPE":
    case "LOCATION":
    case "PRACTITIONER": {
      if (invalidField === "operator") {
        return "Bitte wählen Sie einen Operator aus.";
      }
      if (invalidField === "valueIds") {
        return "Bitte wählen Sie mindestens einen Wert aus.";
      }
      return "";
    }
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY": {
      if (invalidField === "count") {
        return "Bitte geben Sie eine Anzahl von mindestens 1 ein.";
      }
      if (invalidField === "appointmentTypes") {
        return "Bitte wählen Sie mindestens einen Termintyp aus.";
      }
      if (invalidField === "scope") {
        return "Bitte wählen Sie einen Bereich aus.";
      }
      return "";
    }
    case "DAY_OF_WEEK": {
      if (invalidField === "operator") {
        return "Bitte wählen Sie einen Operator aus.";
      }
      if (invalidField === "valueIds") {
        return "Bitte wählen Sie mindestens einen Wochentag aus.";
      }
      return "";
    }
    case "DAYS_AHEAD": {
      if (invalidField === "valueNumber") {
        return "Bitte geben Sie eine Anzahl von mindestens 1 Tag ein.";
      }
      return "";
    }
    case "PATIENT_AGE": {
      if (invalidField === "operator") {
        return "Bitte wählen Sie eine Altersbedingung aus.";
      }
      if (invalidField === "valueNumber") {
        return "Bitte geben Sie ein Alter von mindestens 0 Jahren ein.";
      }
      return "";
    }
    default: {
      return "";
    }
  }
}

// Edit Dialog Component
interface RuleEditDialogProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  existingRule?: RuleFromDB | undefined;
  isOpen: boolean;
  locations: Doc<"locations">[];
  onClose: () => void;
  onCreate: (conditionTree: unknown) => Promise<void>;
  practitioners: Doc<"practitioners">[];
}

function RuleEditDialog({
  appointmentTypes,
  existingRule,
  isOpen,
  locations,
  onClose,
  onCreate,
  practitioners,
}: RuleEditDialogProps) {
  // Initialize conditions from existing rule or create new
  const initialConditions: Condition[] = existingRule
    ? conditionTreeToConditions(existingRule.conditionTree as ConditionTreeNode)
    : [
        {
          id: "1",
          operator: "IS",
          type: "APPOINTMENT_TYPE",
          valueIds: [],
        },
      ];

  const form = useForm({
    defaultValues: {
      conditions: initialConditions,
    } satisfies { conditions: Condition[] },
    onSubmit: async ({ value }) => {
      const conditionTree = conditionsToConditionTree(value.conditions);
      await onCreate(conditionTree);
    },
  });

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent className="max-w-5xl sm:max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingRule ? "Regel bearbeiten" : "Neue Regel erstellen"}
          </DialogTitle>
          <DialogDescription>
            {existingRule
              ? "Bearbeiten Sie die Bedingungen dieser Regel."
              : "Erstellen Sie eine neue Regel mit Bedingungen."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              mode="array"
              name="conditions"
              validators={{
                onSubmit: ({ value }) => {
                  // Validate each condition and collect errors with their index
                  const errorMap = new Map<number, string[]>();
                  for (const [index, condition] of value.entries()) {
                    const errors = validateCondition(condition);
                    if (errors.length > 0) {
                      errorMap.set(index, errors);
                    }
                  }
                  if (errorMap.size > 0) {
                    return "Bitte füllen Sie alle erforderlichen Felder aus.";
                  }
                  return;
                },
              }}
            >
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;

                // Live preview of rule name
                const previewRuleName = generateRuleName(
                  field.state.value,
                  appointmentTypes,
                  practitioners,
                  locations,
                );

                // Build error map for each condition with invalid field names
                const conditionErrors = new Map<number, Map<string, string>>();
                if (isInvalid) {
                  for (const [
                    index,
                    condition,
                  ] of field.state.value.entries()) {
                    const invalidFields = validateCondition(condition);
                    if (invalidFields.length > 0) {
                      const fieldErrors = new Map<string, string>();
                      for (const invalidField of invalidFields) {
                        const message = getErrorMessage(
                          condition,
                          invalidField,
                        );
                        fieldErrors.set(invalidField, message);
                      }
                      conditionErrors.set(index, fieldErrors);
                    }
                  }
                }

                return (
                  <div className="space-y-4">
                    {field.state.value.map((condition, index) => {
                      const fieldErrors = conditionErrors.get(index);

                      return (
                        <form.Field
                          key={condition.id}
                          name={`conditions[${index}]` as const}
                        >
                          {(itemField) => (
                            <div>
                              <ConditionEditor
                                appointmentTypes={appointmentTypes}
                                condition={itemField.state.value}
                                invalidFields={fieldErrors}
                                locations={locations}
                                onRemove={() => {
                                  field.removeValue(index);
                                }}
                                onUpdate={(updates) => {
                                  itemField.handleChange({
                                    ...itemField.state.value,
                                    ...updates,
                                  });
                                }}
                                practitioners={practitioners}
                                showRemove={field.state.value.length > 1}
                              />
                              {fieldErrors && fieldErrors.size > 0 && (
                                <div className="mt-2 space-y-1">
                                  {[...fieldErrors.values()].map(
                                    (message, i) => (
                                      <FieldError
                                        errors={[{ message }]}
                                        key={i}
                                      />
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </form.Field>
                      );
                    })}

                    <Button
                      className="gap-2"
                      onClick={() => {
                        field.pushValue({
                          id: String(
                            Math.max(
                              0,
                              ...field.state.value.map((c) => Number(c.id)),
                            ) + 1,
                          ),
                          operator: "IS",
                          type: "APPOINTMENT_TYPE",
                          valueIds: [],
                        } as Condition);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4" />
                      Bedingung hinzufügen
                    </Button>
                    {/* Live Preview */}
                    <div className="border-t pt-4 mt-4">
                      <FieldDescription className="mt-2 p-3 bg-muted rounded-md">
                        {previewRuleName}
                      </FieldDescription>
                    </div>
                  </div>
                );
              }}
            </form.Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Abbrechen
              </Button>
            </DialogClose>
            <Button type="submit">
              {existingRule ? "Aktualisieren" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Condition Editor Component
interface ConditionEditorProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  locations: Doc<"locations">[];
  onRemove: () => void;
  onUpdate: (updates: Partial<Condition>) => void;
  practitioners: Doc<"practitioners">[];
  showRemove: boolean;
}

function ConditionEditor({
  appointmentTypes,
  condition,
  invalidFields,
  locations,
  onRemove,
  onUpdate,
  practitioners,
  showRemove,
}: ConditionEditorProps) {
  const conditionTypeOptions: ComboboxOption[] = [
    { label: "Termintyp", value: "APPOINTMENT_TYPE" },
    { label: "Behandler", value: "PRACTITIONER" },
    { label: "Standort", value: "LOCATION" },
    { label: "Patientenalter", value: "PATIENT_AGE" },
    { label: "Wochentag", value: "DAY_OF_WEEK" },
    { label: "Tage im Voraus", value: "DAYS_AHEAD" },
    { label: "Gleichzeitige Termine", value: "CONCURRENT_COUNT" },
    { label: "Termine am gleichen Tag", value: "DAILY_CAPACITY" },
  ];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div className="flex-1 flex items-center gap-2 flex-wrap">
          {/* Condition Type Selector */}
          <Select
            onValueChange={(value) => {
              onUpdate({
                type: value as ConditionType,
                // Reset other values when type changes
                operator:
                  value === "DAYS_AHEAD" ||
                  value === "PATIENT_AGE" ||
                  value === "CONCURRENT_COUNT" ||
                  value === "DAILY_CAPACITY"
                    ? "GREATER_THAN_OR_EQUAL"
                    : "IS",
                valueIds: [],
                valueNumber: null,
              });
            }}
            value={condition.type}
          >
            <SelectTrigger className="w-auto min-w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {conditionTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Render specific inputs based on condition type */}
          {(condition.type === "APPOINTMENT_TYPE" ||
            condition.type === "PRACTITIONER" ||
            condition.type === "LOCATION") && (
            <SimpleValueCondition
              appointmentTypes={appointmentTypes}
              condition={condition}
              invalidFields={invalidFields}
              locations={locations}
              onUpdate={onUpdate}
              practitioners={practitioners}
            />
          )}

          {condition.type === "DAY_OF_WEEK" && (
            <DayOfWeekCondition
              condition={condition}
              invalidFields={invalidFields}
              onUpdate={onUpdate}
            />
          )}

          {condition.type === "DAYS_AHEAD" && (
            <DaysAheadCondition
              condition={condition}
              invalidFields={invalidFields}
              onUpdate={onUpdate}
            />
          )}

          {condition.type === "PATIENT_AGE" && (
            <PatientAgeCondition
              condition={condition}
              invalidFields={invalidFields}
              onUpdate={onUpdate}
            />
          )}

          {condition.type === "CONCURRENT_COUNT" && (
            <ConcurrentCountCondition
              appointmentTypes={appointmentTypes}
              condition={condition}
              invalidFields={invalidFields}
              onUpdate={onUpdate}
            />
          )}

          {condition.type === "DAILY_CAPACITY" && (
            <SameDayCountCondition
              appointmentTypes={appointmentTypes}
              condition={condition}
              invalidFields={invalidFields}
              onUpdate={onUpdate}
            />
          )}
        </div>

        {showRemove && (
          <Button onClick={onRemove} size="sm" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}

// Simple value condition (appointment type, practitioner, location)
interface SimpleValueConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  locations: Doc<"locations">[];
  onUpdate: (updates: Partial<Condition>) => void;
  practitioners: Doc<"practitioners">[];
}

function SimpleValueCondition({
  appointmentTypes,
  condition,
  invalidFields,
  locations,
  onUpdate,
  practitioners,
}: SimpleValueConditionProps) {
  const getOptions = (): ComboboxOption[] => {
    switch (condition.type) {
      case "APPOINTMENT_TYPE": {
        return appointmentTypes.map((at) => ({
          label: at.name,
          value: at._id,
        }));
      }
      case "LOCATION": {
        return locations.map((l) => ({ label: l.name, value: l._id }));
      }
      case "PRACTITIONER": {
        return practitioners.map((p) => ({
          label: p.name,
          value: p._id,
        }));
      }
      default: {
        return [];
      }
    }
  };

  return (
    <>
      <Select
        onValueChange={(value) => {
          onUpdate({ operator: value as "IS" | "IS_NOT" });
        }}
        value={condition.operator || "IS"}
      >
        <SelectTrigger
          aria-invalid={invalidFields?.has("operator")}
          className="w-auto min-w-[100px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="IS">ist</SelectItem>
          <SelectItem value="IS_NOT">ist nicht</SelectItem>
        </SelectContent>
      </Select>

      <Combobox
        aria-invalid={invalidFields?.has("valueIds")}
        className="w-auto min-w-[200px]"
        multiple
        onValueChange={(value) => {
          onUpdate({ valueIds: Array.isArray(value) ? value : [value] });
        }}
        options={getOptions()}
        placeholder="Wählen..."
        value={condition.valueIds ?? []}
      />
    </>
  );
}

// Day of week condition
interface DayOfWeekConditionProps {
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

function DayOfWeekCondition({
  condition,
  invalidFields,
  onUpdate,
}: DayOfWeekConditionProps) {
  const dayOptions: ComboboxOption[] = [
    { label: "Montag", value: "MONDAY" },
    { label: "Dienstag", value: "TUESDAY" },
    { label: "Mittwoch", value: "WEDNESDAY" },
    { label: "Donnerstag", value: "THURSDAY" },
    { label: "Freitag", value: "FRIDAY" },
    { label: "Samstag", value: "SATURDAY" },
    { label: "Sonntag", value: "SUNDAY" },
  ];

  return (
    <>
      <Select
        onValueChange={(value) => {
          onUpdate({ operator: value as "IS" | "IS_NOT" });
        }}
        value={condition.operator || "IS"}
      >
        <SelectTrigger
          aria-invalid={invalidFields?.has("operator")}
          className="w-auto min-w-[100px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="IS">ist</SelectItem>
          <SelectItem value="IS_NOT">ist nicht</SelectItem>
        </SelectContent>
      </Select>

      <Combobox
        aria-invalid={invalidFields?.has("valueIds")}
        className="w-auto min-w-[200px]"
        multiple
        onValueChange={(value) => {
          onUpdate({ valueIds: Array.isArray(value) ? value : [value] });
        }}
        options={dayOptions}
        placeholder="Wählen..."
        value={condition.valueIds ?? []}
      />
    </>
  );
}

// Days ahead condition
interface DaysAheadConditionProps {
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

interface PatientAgeConditionProps {
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

function DaysAheadCondition({
  condition,
  invalidFields,
  onUpdate,
}: DaysAheadConditionProps) {
  return (
    <Input
      aria-invalid={invalidFields?.has("valueNumber")}
      className="w-auto min-w-[120px]"
      min="1"
      onChange={(e) => {
        const parsed = Number.parseInt(e.target.value);
        onUpdate({
          valueNumber: Number.isNaN(parsed) ? null : parsed,
        });
      }}
      placeholder="z.B. 7"
      type="number"
      value={condition.valueNumber || ""}
    />
  );
}

function PatientAgeCondition({
  condition,
  invalidFields,
  onUpdate,
}: PatientAgeConditionProps) {
  return (
    <>
      <Select
        onValueChange={(value) => {
          onUpdate({
            operator: value as "GREATER_THAN_OR_EQUAL" | "LESS_THAN",
          });
        }}
        value={
          condition.operator === "LESS_THAN"
            ? "LESS_THAN"
            : "GREATER_THAN_OR_EQUAL"
        }
      >
        <SelectTrigger
          aria-invalid={invalidFields?.has("operator")}
          className="w-auto min-w-[190px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GREATER_THAN_OR_EQUAL">ist mindestens</SelectItem>
          <SelectItem value="LESS_THAN">ist jünger als</SelectItem>
        </SelectContent>
      </Select>

      <Input
        aria-invalid={invalidFields?.has("valueNumber")}
        className="w-auto min-w-[120px]"
        min="0"
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value);
          onUpdate({
            valueNumber: Number.isNaN(parsed) ? null : parsed,
          });
        }}
        placeholder="z.B. 65"
        type="number"
        value={condition.valueNumber ?? ""}
      />
    </>
  );
}

// Concurrent count condition
interface ConcurrentCountConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

function ConcurrentCountCondition({
  appointmentTypes,
  condition,
  invalidFields,
  onUpdate,
}: ConcurrentCountConditionProps) {
  const scopeOptions: ComboboxOption[] = [
    { label: "Am gleichen Standort", value: "location" },
    { label: "In der gesamten Praxis", value: "practice" },
  ];

  const appointmentTypeOptions: ComboboxOption[] = appointmentTypes.map(
    (at) => ({
      label: at.name,
      value: at._id,
    }),
  );

  return (
    <>
      <Input
        aria-invalid={invalidFields?.has("count")}
        className="w-auto min-w-[120px]"
        min="1"
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value);
          onUpdate({ count: Number.isNaN(parsed) ? null : parsed });
        }}
        placeholder="z.B. 2"
        type="number"
        value={condition.count || ""}
      />

      <Combobox
        aria-invalid={invalidFields?.has("appointmentTypes")}
        className="w-auto min-w-[200px]"
        multiple
        onValueChange={(value) => {
          onUpdate({
            appointmentTypes: Array.isArray(value) ? value : [value],
          });
        }}
        options={appointmentTypeOptions}
        placeholder="Wählen..."
        value={condition.appointmentTypes ?? []}
      />

      <Select
        onValueChange={(value) => {
          onUpdate({
            scope: value as "location" | "practice" | "practitioner",
          });
        }}
        value={condition.scope ?? ""}
      >
        <SelectTrigger
          aria-invalid={invalidFields?.has("scope")}
          className="w-auto min-w-[200px]"
        >
          <SelectValue placeholder="Wählen..." />
        </SelectTrigger>
        <SelectContent>
          {scopeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

// Same day count condition
interface SameDayCountConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

function SameDayCountCondition({
  appointmentTypes,
  condition,
  invalidFields,
  onUpdate,
}: SameDayCountConditionProps) {
  const scopeOptions: ComboboxOption[] = [
    { label: "Beim gleichen Behandler", value: "practitioner" },
    { label: "Am gleichen Standort", value: "location" },
    { label: "In der gesamten Praxis", value: "practice" },
  ];

  const appointmentTypeOptions: ComboboxOption[] = appointmentTypes.map(
    (at) => ({
      label: at.name,
      value: at._id,
    }),
  );

  return (
    <>
      <Input
        aria-invalid={invalidFields?.has("count")}
        className="w-auto min-w-[120px]"
        min="1"
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value);
          onUpdate({ count: Number.isNaN(parsed) ? null : parsed });
        }}
        placeholder="z.B. 2"
        type="number"
        value={condition.count || ""}
      />

      <Combobox
        aria-invalid={invalidFields?.has("appointmentTypes")}
        className="w-auto min-w-[200px]"
        multiple
        onValueChange={(value) => {
          onUpdate({
            appointmentTypes: Array.isArray(value) ? value : [value],
          });
        }}
        options={appointmentTypeOptions}
        placeholder="Wählen..."
        value={condition.appointmentTypes ?? []}
      />

      <Select
        onValueChange={(value) => {
          onUpdate({
            scope: value as "location" | "practice" | "practitioner",
          });
        }}
        value={condition.scope ?? ""}
      >
        <SelectTrigger
          aria-invalid={invalidFields?.has("scope")}
          className="w-auto min-w-[200px]"
        >
          <SelectValue placeholder="Wählen..." />
        </SelectTrigger>
        <SelectContent>
          {scopeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

// Helper function to convert conditions array to condition tree
function conditionsToConditionTree(conditions: Condition[]): unknown {
  const nodes: unknown[] = [];

  for (const condition of conditions) {
    switch (condition.type) {
      case "CONCURRENT_COUNT": {
        if (condition.count && condition.scope) {
          nodes.push({
            conditionType: "CONCURRENT_COUNT",
            nodeType: "CONDITION",
            operator: "GREATER_THAN_OR_EQUAL",
            scope: condition.scope,
            valueIds: condition.appointmentTypes ?? [],
            valueNumber: condition.count,
          });
        }
        break;
      }
      case "DAILY_CAPACITY": {
        if (condition.count && condition.scope) {
          nodes.push({
            conditionType: "DAILY_CAPACITY",
            nodeType: "CONDITION",
            operator: "GREATER_THAN_OR_EQUAL",
            scope: condition.scope,
            valueIds: condition.appointmentTypes ?? [],
            valueNumber: condition.count,
          });
        }
        break;
      }
      case "DAY_OF_WEEK": {
        // Convert day names to numbers
        if (condition.valueIds && condition.valueIds.length > 0) {
          for (const dayName of condition.valueIds) {
            nodes.push({
              conditionType: "DAY_OF_WEEK",
              nodeType: "CONDITION",
              operator: condition.operator || "IS",
              valueNumber: dayNameToNumber(dayName),
            });
          }
        }
        break;
      }
      case "DAYS_AHEAD": {
        if (condition.valueNumber) {
          nodes.push({
            conditionType: "DAYS_AHEAD",
            nodeType: "CONDITION",
            operator: "GREATER_THAN_OR_EQUAL",
            valueNumber: condition.valueNumber,
          });
        }
        break;
      }
      case "PATIENT_AGE": {
        if (
          condition.valueNumber !== null &&
          condition.valueNumber !== undefined &&
          condition.operator
        ) {
          nodes.push({
            conditionType: "PATIENT_AGE",
            nodeType: "CONDITION",
            operator: condition.operator,
            valueNumber: condition.valueNumber,
          });
        }
        break;
      }
      default: {
        // Handle simple value conditions
        if (condition.valueIds && condition.valueIds.length > 0) {
          nodes.push({
            conditionType: condition.type,
            nodeType: "CONDITION",
            operator: condition.operator || "IS",
            valueIds: condition.valueIds,
          });
        }
      }
    }
  }

  if (nodes.length === 0) {
    return null;
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  return {
    children: nodes,
    nodeType: "AND",
  };
}
