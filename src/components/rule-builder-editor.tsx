import { useForm } from "@tanstack/react-form";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

import type { Doc } from "../../convex/_generated/dataModel";
import type { ConditionTreeNode } from "../../lib/condition-tree";
import type {
  Condition,
  ConditionType,
  RuleFromDB,
} from "./rule-builder-types";

import {
  conditionTreeToConditions,
  dayNameToNumber,
  generateRuleName,
} from "../../lib/rule-name-generator";
import { Combobox, type ComboboxOption } from "./combobox";

interface ConcurrentCountConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

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

interface DayOfWeekConditionProps {
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

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

interface RuleEditDialogProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  existingRule?: RuleFromDB | undefined;
  isOpen: boolean;
  locations: Doc<"locations">[];
  onClose: () => void;
  onCreate: (conditionTree: ConditionTreeNode) => Promise<void>;
  practitioners: Doc<"practitioners">[];
}

interface SameDayCountConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  onUpdate: (updates: Partial<Condition>) => void;
}

interface SimpleValueConditionProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  condition: Condition;
  invalidFields?: Map<string, string> | undefined;
  locations: Doc<"locations">[];
  onUpdate: (updates: Partial<Condition>) => void;
  practitioners: Doc<"practitioners">[];
}

export function RuleEditDialog({
  appointmentTypes,
  existingRule,
  isOpen,
  locations,
  onClose,
  onCreate,
  practitioners,
}: RuleEditDialogProps) {
  const initialConditions: Condition[] = existingRule
    ? conditionTreeToConditions(existingRule.conditionTree)
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
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto sm:max-w-5xl">
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

                const previewRuleName = generateRuleName(
                  field.state.value,
                  appointmentTypes,
                  practitioners,
                  locations,
                );

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

                    <div className="mt-4 border-t pt-4">
                      <FieldDescription className="mt-2 rounded-md bg-muted p-3">
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
    (appointmentType) => ({
      label: appointmentType.name,
      value: appointmentType._id,
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
    { label: "Stunden im Voraus", value: "HOURS_AHEAD" },
    { label: "Gleichzeitige Termine", value: "CONCURRENT_COUNT" },
    { label: "Termine am gleichen Tag", value: "DAILY_CAPACITY" },
  ];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => {
              const nextType = parseConditionType(value);
              if (!nextType) {
                return;
              }
              const nextOperator: Condition["operator"] =
                nextType === "HOURS_AHEAD"
                  ? "LESS_THAN"
                  : nextType === "DAYS_AHEAD" ||
                      nextType === "PATIENT_AGE" ||
                      nextType === "CONCURRENT_COUNT" ||
                      nextType === "DAILY_CAPACITY"
                    ? "GREATER_THAN_OR_EQUAL"
                    : "IS";
              onUpdate({
                operator: nextOperator,
                type: nextType,
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

          {condition.type === "HOURS_AHEAD" && (
            <HoursAheadCondition
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

function conditionsToConditionTree(conditions: Condition[]): ConditionTreeNode {
  const nodes: ConditionTreeNode[] = [];

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
      case "HOURS_AHEAD": {
        if (condition.valueNumber) {
          nodes.push({
            conditionType: "HOURS_AHEAD",
            nodeType: "CONDITION",
            operator: "LESS_THAN",
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
    return {
      children: [],
      nodeType: "AND",
    };
  }

  if (nodes.length === 1) {
    const firstNode = nodes[0];
    if (firstNode) {
      return firstNode;
    }
  }

  return {
    children: nodes,
    nodeType: "AND",
  };
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
        onUpdate({ valueNumber: Number.isNaN(parsed) ? null : parsed });
      }}
      placeholder="z.B. 7"
      type="number"
      value={condition.valueNumber || ""}
    />
  );
}

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
        return "Bitte geben Sie mindestens 1 Termin ein.";
      }
      if (invalidField === "appointmentTypes") {
        return "Bitte wählen Sie mindestens einen Termintyp aus.";
      }
      if (invalidField === "scope") {
        return "Bitte wählen Sie einen Geltungsbereich aus.";
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
      return invalidField === "valueNumber"
        ? "Bitte geben Sie mindestens 1 Tag ein."
        : "";
    }
    case "HOURS_AHEAD": {
      return invalidField === "valueNumber"
        ? "Bitte geben Sie mindestens 1 Stunde ein."
        : "";
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

function HoursAheadCondition({
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
        onUpdate({ valueNumber: Number.isNaN(parsed) ? null : parsed });
      }}
      placeholder="z.B. 1"
      type="number"
      value={condition.valueNumber || ""}
    />
  );
}

function parseConditionType(value: string): ConditionType | undefined {
  switch (value) {
    case "APPOINTMENT_TYPE":
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY":
    case "DAY_OF_WEEK":
    case "DAYS_AHEAD":
    case "HOURS_AHEAD":
    case "LOCATION":
    case "PATIENT_AGE":
    case "PRACTITIONER": {
      return value;
    }
    default: {
      return undefined;
    }
  }
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
          onUpdate({ valueNumber: Number.isNaN(parsed) ? null : parsed });
        }}
        placeholder="z.B. 65"
        type="number"
        value={condition.valueNumber ?? ""}
      />
    </>
  );
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
    (appointmentType) => ({
      label: appointmentType.name,
      value: appointmentType._id,
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
        return locations.map((location) => ({
          label: location.name,
          value: location._id,
        }));
      }
      case "PRACTITIONER": {
        return practitioners.map((practitioner) => ({
          label: practitioner.name,
          value: practitioner._id,
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

function validateCondition(condition: Condition): string[] {
  const errors: string[] = [];

  switch (condition.type) {
    case "APPOINTMENT_TYPE":
    case "DAY_OF_WEEK":
    case "LOCATION":
    case "PRACTITIONER": {
      if (!condition.operator) {
        errors.push("operator");
      }
      if (!condition.valueIds || condition.valueIds.length === 0) {
        errors.push("valueIds");
      }
      break;
    }
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY": {
      if (!condition.count || condition.count < 1) {
        errors.push("count");
      }
      if (
        !condition.appointmentTypes ||
        condition.appointmentTypes.length === 0
      ) {
        errors.push("appointmentTypes");
      }
      if (!condition.scope) {
        errors.push("scope");
      }
      break;
    }
    case "DAYS_AHEAD":
    case "HOURS_AHEAD": {
      if (!condition.valueNumber || condition.valueNumber < 1) {
        errors.push("valueNumber");
      }
      break;
    }
    case "PATIENT_AGE": {
      if (!condition.operator) {
        errors.push("operator");
      }
      if (
        condition.valueNumber === null ||
        condition.valueNumber === undefined ||
        condition.valueNumber < 0
      ) {
        errors.push("valueNumber");
      }
      break;
    }
    default: {
      break;
    }
  }

  return errors;
}
