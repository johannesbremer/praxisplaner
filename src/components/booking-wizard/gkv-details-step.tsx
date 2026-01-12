// GKV details step component (New patient path A3a)

import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

const hzvStatusSchema = z.enum(["has-contract", "interested", "no-interest"]);

type HzvStatus = z.infer<typeof hzvStatusSchema>;

const hzvOptions: { description: string; label: string; value: HzvStatus }[] = [
  {
    description: "Ich bin bereits im Hausarztvertrag eingeschrieben",
    label: "Ich habe bereits einen Hausarztvertrag",
    value: "has-contract",
  },
  {
    description: "Ich möchte mich gerne informieren und einschreiben",
    label: "Ich bin interessiert",
    value: "interested",
  },
  {
    description: "Ich möchte keinen Hausarztvertrag abschließen",
    label: "Kein Interesse",
    value: "no-interest",
  },
];

export function GkvDetailsStep({ sessionId }: StepComponentProps) {
  const confirmGkvDetails = useMutation(api.bookingSessions.confirmGkvDetails);

  const form = useForm({
    defaultValues: {
      hzvStatus: undefined as HzvStatus | undefined,
    },
    onSubmit: async ({ value }) => {
      if (value.hzvStatus) {
        try {
          await confirmGkvDetails({ hzvStatus: value.hzvStatus, sessionId });
        } catch (error) {
          console.error("Failed to confirm GKV details:", error);
          toast.error("GKV-Details konnten nicht gespeichert werden", {
            description:
              error instanceof Error
                ? error.message
                : "Bitte versuchen Sie es erneut.",
          });
        }
      }
    },
    validators: {
      onSubmit: z.object({
        hzvStatus: hzvStatusSchema,
      }),
    },
  });

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Hausarztvertrag (HZV)</CardTitle>
        <CardDescription>
          Der Hausarztvertrag bietet Ihnen besondere Vorteile bei der
          hausärztlichen Versorgung. Bitte geben Sie Ihren Status an.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="hzvStatus">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel className="sr-only">
                    Hausarztvertrag-Status
                  </FieldLabel>
                  <div className="space-y-3">
                    {hzvOptions.map((option) => (
                      <Button
                        className="h-auto p-4 justify-start w-full text-left"
                        data-selected={field.state.value === option.value}
                        key={option.value}
                        onClick={() => {
                          field.handleChange(option.value);
                        }}
                        type="button"
                        variant={
                          field.state.value === option.value
                            ? "default"
                            : "outline"
                        }
                      >
                        <div>
                          <div className="font-medium">{option.label}</div>
                          <div
                            className={`text-xs mt-1 ${
                              field.state.value === option.value
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            {option.description}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <div className="mt-6">
            <Button className="w-full" size="lg" type="submit">
              Weiter
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
