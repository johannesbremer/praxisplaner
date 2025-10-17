import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, Check, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import type { ConditionTree } from "@/convex/ruleEngine/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";

import { useErrorTracking } from "../utils/error-tracking";

// Zod schema for the rule form - matches the actual structure we use
const formSchema = z.object({
  action: z.enum(["ALLOW", "BLOCK"]),
  description: z.string(),
  enabled: z.boolean(),
  message: z.string(),
  name: z.string().min(3, "Rule name must be at least 3 characters"),
  priority: z.number().min(0).max(1000),
});

interface RuleEditorAdvancedProps {
  onRuleCreated?: (() => void) | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  // For editing existing rules
  ruleId?: Id<"rules">;
  // Custom trigger element
  customTrigger?: React.ReactNode;
  triggerText?: string;
}

// Example rule templates
const EXAMPLE_TEMPLATES = {
  blockWeekends: {
    action: "BLOCK" as const,
    condition: {
      children: [
        {
          attr: "dayOfWeek",
          entity: "Context" as const,
          op: "IN" as const,
          type: "Property" as const,
          value: ["0", "6"],
        },
      ],
      type: "OR" as const,
    },
    description: "Blockiert Buchungen am Wochenende",
    message: "Buchungen sind am Wochenende nicht möglich",
    name: "Wochenende blockieren",
  },
  limitAppointmentsPerDay: {
    action: "BLOCK" as const,
    condition: {
      entity: "Appointment" as const,
      filter: { overlaps: true },
      op: ">=" as const,
      type: "Count" as const,
      value: 20,
    },
    description: "Maximal 20 Termine pro Tag",
    message: "Maximale Tageskapazität erreicht",
    name: "Tägliches Limit",
  },
  requireBreakAfterAppointment: {
    action: "BLOCK" as const,
    condition: {
      child: {
        duration: "15min",
        start: "Slot.end" as const,
        type: "TimeRangeFree" as const,
      },
      type: "NOT" as const,
    },
    description: "15 Minuten Pause nach jedem Termin erforderlich",
    message: "Nach diesem Termin ist eine 15-minütige Pause erforderlich",
    name: "Pausenzeit",
  },
};

// Validation function - performs client-side validation
export default function RuleEditorAdvanced({
  customTrigger,
  onRuleCreated,
  practiceId,
  ruleId,
  ruleSetId,
  triggerText = "Neue Regel (Erweitert)",
}: RuleEditorAdvancedProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const { captureError } = useErrorTracking();

  const createRuleMutation = useMutation(api.ruleEngine.api.createRule);
  const updateRuleMutation = useMutation(api.ruleEngine.api.updateRule);

  // Load existing rule if editing
  const existingRule = useQuery(
    api.ruleEngine.api.getRule,
    ruleId ? { ruleId } : "skip",
  );

  // Helper to validate and extract a ConditionTree from unknown data
  const validateRuleData = useCallback(
    (
      rule: typeof existingRule,
    ): null | {
      action: "ALLOW" | "BLOCK";
      condition: ConditionTree;
      description: string;
      enabled: boolean;
      message: string;
      name: string;
      priority: number;
    } => {
      if (!rule) {
        return null;
      }

      // Runtime validation: ensure condition exists and has the right shape
      const condition: unknown = rule.condition;
      if (typeof condition !== "object" || condition === null) {
        return null;
      }
      if (!("type" in condition)) {
        return null;
      }

      return {
        action: rule.action,
        condition: condition as ConditionTree,
        description: rule.description ?? "",
        enabled: rule.enabled,
        message: rule.message,
        name: rule.name,
        priority: rule.priority,
      };
    },
    [], // No dependencies - function doesn't capture any external values
  );

  // We don't store condition in the form - it's managed via jsonInput state
  const form = useForm({
    defaultValues: {
      action: "BLOCK",
      description: "",
      enabled: true,
      message: "",
      name: "",
      priority: 100,
    },
    onSubmit: async ({ value }) => {
      try {
        // Parse JSON input for condition
        let condition: ConditionTree;
        try {
          const parsed: unknown = JSON.parse(jsonInput);

          // Handle two cases:
          // 1. User pastes entire rule object (with name, description, condition, etc.)
          // 2. User pastes just the condition tree
          if (parsed && typeof parsed === "object" && "condition" in parsed) {
            // Case 1: Extract condition from full rule object
            const ruleObj = parsed as Record<string, unknown>;
            const cond = ruleObj["condition"];
            if (!cond || typeof cond !== "object" || !("type" in cond)) {
              toast.error("Ungültiges JSON", {
                description:
                  "Das 'condition' Feld muss ein gültiger ConditionTree sein",
              });
              return;
            }
            condition = cond as ConditionTree;
          } else if (parsed && typeof parsed === "object" && "type" in parsed) {
            // Case 2: It's already a condition tree
            condition = parsed as ConditionTree;
          } else {
            toast.error("Ungültiges JSON", {
              description:
                "JSON muss entweder eine Regel mit 'condition' Feld oder direkt ein ConditionTree sein",
            });
            return;
          }
        } catch {
          toast.error("Ungültiges JSON", {
            description: "Die Bedingung konnte nicht geparst werden",
          });
          return;
        }

        // Validate condition tree
        const errors = validateCondition(condition);
        if (errors.length > 0) {
          setValidationErrors(errors);
          toast.error("Validierungsfehler", {
            description: "Die Regel enthält Fehler",
          });
          return;
        }

        // value.action is validated by Zod schema to be "ALLOW" | "BLOCK"
        const action = value.action as "ALLOW" | "BLOCK";

        if (ruleId) {
          // Update existing rule
          await updateRuleMutation({
            action,
            condition,
            description: value.description,
            enabled: value.enabled,
            message: value.message,
            name: value.name,
            practiceId,
            priority: value.priority,
            ruleId,
            sourceRuleSetId: ruleSetId,
          });

          toast.success("Regel aktualisiert", {
            description: `Die Regel "${value.name}" wurde erfolgreich aktualisiert`,
          });
        } else {
          // Create new rule
          await createRuleMutation({
            action,
            condition,
            description: value.description,
            enabled: value.enabled,
            message: value.message,
            name: value.name,
            practiceId,
            priority: value.priority,
            sourceRuleSetId: ruleSetId,
          });

          toast.success("Regel erstellt", {
            description: `Die Regel "${value.name}" wurde erfolgreich erstellt`,
          });
        }

        setIsOpen(false);
        onRuleCreated?.();
        form.reset();
        setJsonInput("");
        setValidationErrors([]);
      } catch (error: unknown) {
        captureError(error, {
          context: "RuleEditorAdvanced - Submit rule",
          practiceId,
          ruleSetId,
        });
        toast.error("Fehler beim Speichern der Regel", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  // Populate form when editing an existing rule
  useEffect(() => {
    const validatedRule = validateRuleData(existingRule);
    if (validatedRule) {
      form.setFieldValue("name", validatedRule.name);
      form.setFieldValue("description", validatedRule.description);
      form.setFieldValue("message", validatedRule.message);
      form.setFieldValue("action", validatedRule.action);
      form.setFieldValue("enabled", validatedRule.enabled);
      form.setFieldValue("priority", validatedRule.priority);
      // Condition is managed separately via jsonInput
      // Use queueMicrotask to avoid synchronous setState in effect
      queueMicrotask(() => {
        setJsonInput(JSON.stringify(validatedRule.condition, null, 2));
      });
    }
  }, [existingRule, form, validateRuleData]);

  const loadTemplate = (templateKey: keyof typeof EXAMPLE_TEMPLATES) => {
    const template = EXAMPLE_TEMPLATES[templateKey];
    form.setFieldValue("name", template.name);
    form.setFieldValue("description", template.description);
    form.setFieldValue("message", template.message);
    form.setFieldValue("action", template.action);
    // Condition is managed separately via jsonInput
    setJsonInput(JSON.stringify(template.condition, null, 2));
    setValidationErrors([]);
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as unknown;
      setJsonInput(JSON.stringify(parsed, null, 2));
      setValidationErrors([]);
      toast.success("JSON formatiert");
    } catch {
      toast.error("Ungültiges JSON");
    }
  };

  const validateJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonInput);

      // Check if user pasted a complete rule object
      if (parsed && typeof parsed === "object" && "condition" in parsed) {
        // Type guard: narrow to an object with a condition field
        const potentialRule = parsed as Record<string, unknown>;
        const condition = potentialRule["condition"];

        // Validate that condition exists and has proper structure
        if (
          !condition ||
          typeof condition !== "object" ||
          !("type" in condition)
        ) {
          toast.error("Ungültiges Regelobjekt", {
            description:
              "Das 'condition' Feld muss ein gültiger ConditionTree sein",
          });
          return;
        }

        // Auto-populate form fields from the pasted rule
        if (
          "name" in potentialRule &&
          typeof potentialRule["name"] === "string"
        ) {
          form.setFieldValue("name", potentialRule["name"]);
        }
        if (
          "description" in potentialRule &&
          typeof potentialRule["description"] === "string"
        ) {
          form.setFieldValue("description", potentialRule["description"]);
        }
        if (
          "message" in potentialRule &&
          typeof potentialRule["message"] === "string"
        ) {
          form.setFieldValue("message", potentialRule["message"]);
        }
        if (
          "action" in potentialRule &&
          (potentialRule["action"] === "ALLOW" ||
            potentialRule["action"] === "BLOCK")
        ) {
          form.setFieldValue("action", potentialRule["action"]);
        }
        if (
          "enabled" in potentialRule &&
          typeof potentialRule["enabled"] === "boolean"
        ) {
          form.setFieldValue("enabled", potentialRule["enabled"]);
        }
        if (
          "priority" in potentialRule &&
          typeof potentialRule["priority"] === "number"
        ) {
          form.setFieldValue("priority", potentialRule["priority"]);
        }

        // Extract and validate just the condition
        const errors = validateCondition(condition as ConditionTree);
        setValidationErrors(errors);

        // Update jsonInput to show only the condition tree
        setJsonInput(JSON.stringify(condition, null, 2));

        if (errors.length === 0) {
          toast.success("Regel geladen", {
            description: "Formularfelder wurden automatisch ausgefüllt",
          });
        } else {
          toast.warning("Regel geladen mit Fehlern", {
            description: `Formularfelder ausgefüllt, aber ${errors.length} Validierungsfehler gefunden`,
          });
        }
        return;
      }

      // It's just a condition tree
      const condition = parsed as ConditionTree;
      const errors = validateCondition(condition);
      setValidationErrors(errors);

      if (errors.length === 0) {
        toast.success("Validierung erfolgreich", {
          description: "Die Regel ist gültig",
        });
      } else {
        toast.error("Validierungsfehler", {
          description: `${errors.length} Fehler gefunden`,
        });
      }
    } catch {
      toast.error("Ungültiges JSON", {
        description: "Die Bedingung konnte nicht geparst werden",
      });
    }
  };

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        {customTrigger ?? (
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {triggerText}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {ruleId ? "Regel bearbeiten" : "Neue Regel erstellen"} (Erweitert)
          </DialogTitle>
          <DialogDescription>
            Erstellen Sie eine Regel mit JSON-Bedingungen. Verwenden Sie die
            Vorlagen als Ausgangspunkt.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <Tabs defaultValue="editor">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="templates">Vorlagen</TabsTrigger>
            </TabsList>

            <TabsContent className="space-y-4" value="editor">
              {/* Basic Info */}
              <div className="grid gap-4">
                <form.Field name="name">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Name *</Label>
                      <Input
                        id={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="z.B. Wochenende blockieren"
                        required
                        value={field.state.value}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="description">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Beschreibung</Label>
                      <Input
                        id={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="Kurze Beschreibung der Regel"
                        value={field.state.value}
                      />
                    </div>
                  )}
                </form.Field>

                <div className="grid grid-cols-2 gap-4">
                  <form.Field name="action">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Aktion *</Label>
                        <Select
                          onValueChange={(value) => {
                            field.handleChange(value as "ALLOW" | "BLOCK");
                          }}
                          value={field.state.value}
                        >
                          <SelectTrigger id={field.name}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BLOCK">BLOCK</SelectItem>
                            <SelectItem value="ALLOW">ALLOW</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="priority">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Priorität *</Label>
                        <Input
                          id={field.name}
                          min={0}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(Number(e.target.value));
                          }}
                          placeholder="100"
                          required
                          type="number"
                          value={field.state.value}
                        />
                      </div>
                    )}
                  </form.Field>
                </div>

                <form.Field name="message">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Nachricht *</Label>
                      <Input
                        id={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder="Nachricht, die angezeigt wird, wenn die Regel greift"
                        required
                        value={field.state.value}
                      />
                    </div>
                  )}
                </form.Field>

                {/* JSON Condition Editor */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="condition-json">Bedingung (JSON) *</Label>
                    <div className="flex gap-2">
                      <Button
                        onClick={formatJson}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Formatieren
                      </Button>
                      <Button
                        onClick={validateJson}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Validieren
                      </Button>
                    </div>
                  </div>
                  <textarea
                    className="w-full h-64 p-3 font-mono text-sm border rounded-md"
                    id="condition-json"
                    onChange={(e) => {
                      setJsonInput(e.target.value);
                    }}
                    placeholder='{\n  "type": "Property",\n  "entity": "Slot",\n  "attr": "dayOfWeek",\n  "op": "=",\n  "value": "0"\n}'
                    required
                    value={jsonInput}
                  />
                </div>

                {/* Validation Errors */}
                {validationErrors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Validierungsfehler</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5 space-y-1">
                        {validationErrors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>

            <TabsContent className="space-y-4" value="templates">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Wählen Sie eine Vorlage, um schnell zu beginnen. Sie können
                  die Vorlage anschließend anpassen.
                </p>

                <div className="grid gap-3">
                  <Button
                    className="justify-start h-auto p-4"
                    onClick={() => {
                      loadTemplate("blockWeekends");
                    }}
                    type="button"
                    variant="outline"
                  >
                    <div className="text-left">
                      <div className="font-semibold">Wochenende blockieren</div>
                      <div className="text-sm text-muted-foreground">
                        Blockiert Buchungen am Wochenende (Samstag und Sonntag)
                      </div>
                    </div>
                  </Button>

                  <Button
                    className="justify-start h-auto p-4"
                    onClick={() => {
                      loadTemplate("limitAppointmentsPerDay");
                    }}
                    type="button"
                    variant="outline"
                  >
                    <div className="text-left">
                      <div className="font-semibold">Tägliches Limit</div>
                      <div className="text-sm text-muted-foreground">
                        Begrenzt die Anzahl der Termine pro Tag
                      </div>
                    </div>
                  </Button>

                  <Button
                    className="justify-start h-auto p-4"
                    onClick={() => {
                      loadTemplate("requireBreakAfterAppointment");
                    }}
                    type="button"
                    variant="outline"
                  >
                    <div className="text-left">
                      <div className="font-semibold">Pausenzeit</div>
                      <div className="text-sm text-muted-foreground">
                        Erfordert eine Pause nach jedem Termin
                      </div>
                    </div>
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button
              onClick={() => {
                setIsOpen(false);
                form.reset();
                setJsonInput("");
                setValidationErrors([]);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button type="submit">
              {ruleId ? "Aktualisieren" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function validateCondition(condition: ConditionTree): string[] {
  const errors: string[] = [];

  function validateNode(node: unknown, path: string): void {
    if (!node || typeof node !== "object") {
      errors.push(
        `${path}: Invalid node structure - received ${JSON.stringify(node)}`,
      );
      return;
    }

    const n = node as Record<string, unknown>;

    if (!n["type"] || typeof n["type"] !== "string") {
      errors.push(
        `${path}: Missing or invalid 'type' field - node is ${JSON.stringify(n)}`,
      );
      return;
    }

    switch (n["type"]) {
      case "Adjacent": {
        if (n["entity"] !== "Appointment") {
          errors.push(`${path}: Invalid 'entity' field for Adjacent`);
        }
        if (!n["filter"] || typeof n["filter"] !== "object") {
          errors.push(
            `${path}: Missing or invalid 'filter' field for Adjacent`,
          );
        }
        if (n["direction"] !== "before" && n["direction"] !== "after") {
          errors.push(`${path}: Invalid 'direction' field for Adjacent`);
        }
        break;
      }

      case "AND":
      case "OR": {
        if (Array.isArray(n["children"])) {
          for (const [i, child] of (n["children"] as unknown[]).entries()) {
            validateNode(child, `${path}.children[${i}]`);
          }
        } else {
          errors.push(
            `${path}: Missing or invalid 'children' field for ${n["type"]}`,
          );
        }
        break;
      }

      case "Count": {
        if (n["entity"] !== "Appointment") {
          errors.push(`${path}: Invalid 'entity' field for Count`);
        }
        if (!n["filter"] || typeof n["filter"] !== "object") {
          errors.push(`${path}: Missing or invalid 'filter' field for Count`);
        }
        if (!n["op"] || typeof n["op"] !== "string") {
          errors.push(`${path}: Missing or invalid 'op' field for Count`);
        }
        if (typeof n["value"] !== "number") {
          errors.push(`${path}: Missing or invalid 'value' field for Count`);
        }
        break;
      }

      case "NOT": {
        if (n["child"]) {
          validateNode(n["child"], `${path}.child`);
        } else {
          errors.push(`${path}: Missing 'child' field for NOT`);
        }
        break;
      }
      case "Property": {
        if (
          !n["entity"] ||
          (n["entity"] !== "Slot" && n["entity"] !== "Context")
        ) {
          errors.push(`${path}: Invalid 'entity' field for Property`);
        }
        if (!n["attr"] || typeof n["attr"] !== "string") {
          errors.push(`${path}: Missing or invalid 'attr' field for Property`);
        }
        if (!n["op"] || typeof n["op"] !== "string") {
          errors.push(`${path}: Missing or invalid 'op' field for Property`);
        }
        if (n["value"] === undefined) {
          errors.push(`${path}: Missing 'value' field for Property`);
        }
        break;
      }

      case "TimeRangeFree": {
        if (n["start"] !== "Slot.start" && n["start"] !== "Slot.end") {
          errors.push(`${path}: Invalid 'start' field for TimeRangeFree`);
        }
        if (!n["duration"] || typeof n["duration"] !== "string") {
          errors.push(
            `${path}: Missing or invalid 'duration' field for TimeRangeFree`,
          );
        }
        break;
      }

      default: {
        errors.push(`${path}: Unknown condition type '${n["type"]}'`);
      }
    }
  }

  validateNode(condition, "root");
  return errors;
}
