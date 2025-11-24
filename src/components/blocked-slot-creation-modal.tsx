"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";

import type { Id } from "@/convex/_generated/dataModel";

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

import { captureErrorGlobal } from "../utils/error-tracking";

const TIMEZONE = "Europe/Berlin";

const formSchema = z.object({
  durationMinutes: z
    .number()
    .min(5, "Dauer muss mindestens 5 Minuten sein.")
    .refine((val) => val % 5 === 0, {
      message: "Dauer muss durch 5 teilbar sein.",
    }),
  title: z
    .string()
    .min(3, "Titel muss mindestens 3 Zeichen lang sein.")
    .max(100, "Titel darf maximal 100 Zeichen lang sein."),
});

interface BlockedSlotCreationModalProps {
  initialDurationMinutes: number;
  initialSlotStart: string; // Temporal.Instant as string
  isSimulation?: boolean;
  locationId: Id<"locations">;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  runCreateBlockedSlot?: (args: {
    end: string;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesBlockedSlotId?: Id<"blockedSlots">;
    start: string;
    title: string;
  }) => Promise<Id<"blockedSlots"> | undefined>;
}

export function BlockedSlotCreationModal({
  initialDurationMinutes,
  initialSlotStart,
  isSimulation = false,
  locationId,
  onOpenChange,
  open,
  practiceId,
  practitionerId,
  runCreateBlockedSlot: runCreateBlockedSlotProp,
}: BlockedSlotCreationModalProps) {
  const createBlockedSlotMutation = useMutation(
    api.appointments.createBlockedSlot,
  );

  // Use the optimistic update wrapper if provided, otherwise fall back to direct mutation
  const runCreateBlockedSlot =
    runCreateBlockedSlotProp ??
    ((args: Parameters<typeof createBlockedSlotMutation>[0]) =>
      createBlockedSlotMutation(args));

  const form = useForm({
    defaultValues: {
      durationMinutes: initialDurationMinutes,
      title: "",
    },
    onSubmit: async ({ value }) => {
      try {
        // Calculate end time based on start and duration
        const startInstant = Temporal.Instant.from(initialSlotStart);
        const endInstant = startInstant.add({
          minutes: value.durationMinutes,
        });

        await runCreateBlockedSlot({
          end: endInstant.toString(),
          locationId,
          practiceId,
          start: initialSlotStart,
          title: value.title,
          ...(practitionerId && { practitionerId }),
          ...(isSimulation && { isSimulation: true }),
        });

        toast.success("Slot erfolgreich gesperrt");
        onOpenChange(false);
        form.reset();
      } catch (error: unknown) {
        captureErrorGlobal(error, {
          context: "blocked_slot_creation",
        });

        const description =
          error instanceof Error ? error.message : "Unbekannter Fehler";

        toast.error("Slot konnte nicht gesperrt werden", {
          description,
        });
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      form.reset();
    }
    onOpenChange(newOpen);
  };

  // Format start time for display
  const startTime = Temporal.Instant.from(initialSlotStart)
    .toZonedDateTimeISO(TIMEZONE)
    .toPlainTime()
    .toString()
    .slice(0, 5);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-[500px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Slot sperren</DialogTitle>
            <DialogDescription>
              Erstellen Sie eine Sperrung für {startTime} Uhr
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <form.Field name="title">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Titel</FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      autoComplete="off"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                      }}
                      placeholder="z.B. Mittagspause, Teambesprechung"
                      value={field.state.value}
                    />
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="durationMinutes">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      Dauer (Minuten)
                    </FieldLabel>
                    <Input
                      aria-invalid={isInvalid}
                      id={field.name}
                      min={5}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        const value = e.target.value;
                        field.handleChange(
                          value ? Number.parseInt(value, 10) : 0,
                        );
                      }}
                      placeholder="z.B. 15, 30, 45"
                      step={5}
                      type="number"
                      value={field.state.value}
                    />
                    <FieldDescription>
                      Die Dauer muss durch 5 teilbar sein.
                    </FieldDescription>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              onClick={() => {
                handleOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button disabled={form.state.isSubmitting} type="submit">
              {form.state.isSubmitting ? "Speichern..." : "Sperren"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
