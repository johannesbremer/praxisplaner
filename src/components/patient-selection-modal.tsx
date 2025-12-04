"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

// Schema for temporary patient form validation
const temporaryPatientSchema = z.object({
  firstName: z.string().min(1, "Vorname ist erforderlich"),
  lastName: z.string().min(1, "Nachname ist erforderlich"),
  phoneNumber: z.e164("Bitte gültige Telefonnummer im Format +49... eingeben"),
});

export interface TemporaryPatientSelection {
  temporaryPatientId: Id<"temporaryPatients">;
  type: "temporary";
}

interface TemporaryPatientCreationModalProps {
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: TemporaryPatientSelection) => void;
  open: boolean;
  practiceId: Id<"practices">;
}

export function TemporaryPatientCreationModal({
  onOpenChange,
  onSelect,
  open,
  practiceId,
}: TemporaryPatientCreationModalProps) {
  // Mutation for creating temporary patient
  const createTemporaryPatient = useMutation(
    api.temporaryPatients.createTemporaryPatient,
  );

  const form = useForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      phoneNumber: "",
    },
    onSubmit: async ({ value }) => {
      const temporaryPatientId = await createTemporaryPatient({
        firstName: value.firstName,
        lastName: value.lastName,
        phoneNumber: value.phoneNumber,
        practiceId,
      });

      onSelect({
        temporaryPatientId,
        type: "temporary",
      });

      // Reset form and close modal
      form.reset();
      onOpenChange(false);
    },
    validators: {
      onSubmit: temporaryPatientSchema,
    },
  });

  const handleClose = () => {
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={handleClose} open={open}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Temporären Patienten erstellen</DialogTitle>
          <VisuallyHidden>
            <DialogDescription>
              Erstellen Sie einen temporären Patienten für diesen Termin.
            </DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="lastName">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="off"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="Mustermann"
                      value={field.state.value}
                    />
                    <VisuallyHidden>
                      <FieldDescription>
                        Nachname des Patienten
                      </FieldDescription>
                    </VisuallyHidden>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="firstName">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Vorname</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="off"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="Max"
                      value={field.state.value}
                    />
                    <VisuallyHidden>
                      <FieldDescription>Vorname des Patienten</FieldDescription>
                    </VisuallyHidden>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="phoneNumber">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Telefonnummer</FieldLabel>
                    <PhoneInput
                      aria-invalid={isInvalid}
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(value) => {
                        field.handleChange(value);
                      }}
                      value={field.state.value}
                    />
                    <VisuallyHidden>
                      <FieldDescription>
                        Telefonnummer für Rückfragen
                      </FieldDescription>
                    </VisuallyHidden>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button onClick={handleClose} type="button" variant="outline">
              Abbrechen
            </Button>
            <Button disabled={!form.state.canSubmit} type="submit">
              Patient erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
