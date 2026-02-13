"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Doc, Id } from "@/convex/_generated/dataModel";

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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

import { captureErrorGlobal } from "../utils/error-tracking";

const formSchema = z.object({
  title: z
    .string()
    .min(3, "Titel muss mindestens 3 Zeichen lang sein.")
    .max(100, "Titel darf maximal 100 Zeichen lang sein."),
});

interface BlockedSlotEditModalProps {
  blockedSlotId: Id<"blockedSlots">;
  currentTitle: string;
  inSimulationContext?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
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
  runDeleteBlockedSlot?: (args: {
    id: Id<"blockedSlots">;
  }) => Promise<null | undefined>;
  runUpdateBlockedSlot?: (args: {
    id: Id<"blockedSlots">;
    isSimulation?: boolean;
    title: string;
  }) => Promise<null | undefined>;
  slotData: Doc<"blockedSlots">;
  slotIsSimulation?: boolean;
}

export function BlockedSlotEditModal({
  blockedSlotId,
  currentTitle,
  inSimulationContext = false,
  onOpenChange,
  open,
  runCreateBlockedSlot: runCreateBlockedSlotProp,
  runDeleteBlockedSlot: runDeleteBlockedSlotProp,
  runUpdateBlockedSlot: runUpdateBlockedSlotProp,
  slotData,
  slotIsSimulation = false,
}: BlockedSlotEditModalProps) {
  const deleteBlockedSlotMutation = useMutation(
    api.appointments.deleteBlockedSlot,
  );
  const updateBlockedSlotMutation = useMutation(
    api.appointments.updateBlockedSlot,
  );
  const createBlockedSlotMutation = useMutation(
    api.appointments.createBlockedSlot,
  );

  const runUpdateBlockedSlot =
    runUpdateBlockedSlotProp ??
    ((args: Parameters<typeof updateBlockedSlotMutation>[0]) =>
      updateBlockedSlotMutation(args));
  const runDeleteBlockedSlot =
    runDeleteBlockedSlotProp ??
    ((args: Parameters<typeof deleteBlockedSlotMutation>[0]) =>
      deleteBlockedSlotMutation(args));

  const runCreateBlockedSlot =
    runCreateBlockedSlotProp ??
    ((args: Parameters<typeof createBlockedSlotMutation>[0]) =>
      createBlockedSlotMutation(args));
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm({
    defaultValues: {
      title: currentTitle,
    },
    onSubmit: async ({ value }) => {
      try {
        // If we're editing a real slot in simulation mode, create a new simulated slot
        // with replacesBlockedSlotId pointing to the original (like drag and drop does)
        if (inSimulationContext && !slotIsSimulation) {
          await runCreateBlockedSlot({
            end: slotData.end,
            isSimulation: true,
            locationId: slotData.locationId,
            practiceId: slotData.practiceId,
            replacesBlockedSlotId: blockedSlotId,
            start: slotData.start,
            title: value.title,
            ...(slotData.practitionerId
              ? { practitionerId: slotData.practitionerId }
              : {}),
          });
        } else {
          // Otherwise, just update the slot directly
          await runUpdateBlockedSlot({
            id: blockedSlotId,
            title: value.title,
            ...(slotIsSimulation && { isSimulation: true }),
          });
        }

        toast.success("Titel erfolgreich aktualisiert");
        onOpenChange(false);
        form.reset();
      } catch (error: unknown) {
        captureErrorGlobal(error, {
          context: "blocked_slot_title_update",
        });

        const description =
          error instanceof Error ? error.message : "Unbekannter Fehler";

        toast.error("Titel konnte nicht aktualisiert werden", {
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

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await runDeleteBlockedSlot({ id: blockedSlotId });
      toast.success("Sperrung erfolgreich gelöscht");
      onOpenChange(false);
      form.reset();
    } catch (error: unknown) {
      captureErrorGlobal(error, {
        blockedSlotId,
        context: "blocked_slot_delete",
      });

      const description =
        error instanceof Error ? error.message : "Unbekannter Fehler";

      toast.error("Sperrung konnte nicht gelöscht werden", {
        description,
      });
    } finally {
      setIsDeleting(false);
    }
  };

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
            <DialogTitle>Sperrung bearbeiten</DialogTitle>
            <DialogDescription>
              Ändern Sie den Titel oder löschen Sie die Sperrung.
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
          </FieldGroup>

          <DialogFooter>
            <Button
              disabled={isDeleting || form.state.isSubmitting}
              onClick={() => {
                void handleDelete();
              }}
              type="button"
              variant="destructive"
            >
              {isDeleting ? "Löschen..." : "Löschen"}
            </Button>
            <Button
              disabled={isDeleting || form.state.isSubmitting}
              onClick={() => {
                handleOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button
              disabled={isDeleting || form.state.isSubmitting}
              type="submit"
            >
              {form.state.isSubmitting ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
