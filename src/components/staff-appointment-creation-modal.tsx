"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

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
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

import { captureErrorGlobal } from "../utils/error-tracking";

interface StaffAppointmentCreationModalProps {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
  onOpenChange: (open: boolean, shouldResetAppointmentType?: boolean) => void;
  open: boolean;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

export function StaffAppointmentCreationModal({
  appointmentTypeId,
  locationId,
  onOpenChange,
  open,
  practiceId,
  ruleSetId,
}: StaffAppointmentCreationModalProps) {
  const [mode, setMode] = useState<"next" | null>(null);

  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );

  // Get appointment type name for display - only query when modal is open
  const appointmentTypes = useQuery(
    api.entities.getAppointmentTypes,
    open ? { ruleSetId } : "skip",
  );
  const appointmentType = appointmentTypes?.find(
    (type) => type._id === appointmentTypeId,
  );

  // Query for next available slot - only query when modal is open
  const today = Temporal.Now.plainDateISO();
  const [requestedAt] = useState(() => Temporal.Now.instant().toString());

  const availableSlots = useQuery(
    api.scheduling.getSlotsForDay,
    open && appointmentTypeId && locationId
      ? {
          date: today.toString(),
          practiceId,
          ruleSetId,
          simulatedContext: {
            appointmentTypeId,
            locationId,
            patient: {
              isNew: false,
            },
            requestedAt,
          },
        }
      : "skip",
  );

  const nextAvailableSlot = availableSlots?.slots.find(
    (slot) => slot.status === "AVAILABLE",
  );

  const form = useForm({
    defaultValues: {
      title: "",
    },
    onSubmit: async ({ value }) => {
      try {
        if (mode === "next" && nextAvailableSlot) {
          // Create appointment at next available slot
          const startTime = Temporal.Instant.from(nextAvailableSlot.startTime);
          const endTime = startTime.add({
            minutes: nextAvailableSlot.duration,
          });

          await createAppointmentMutation({
            appointmentTypeId,
            end: endTime.toString(),
            locationId,
            practiceId,
            practitionerId: nextAvailableSlot.practitionerId,
            start: nextAvailableSlot.startTime,
            title:
              value.title || `Termin - ${appointmentType?.name ?? "Unbekannt"}`,
          });

          toast.success("Termin erfolgreich erstellt");
        }

        // Reset appointment type after successful creation
        onOpenChange(false, true);
        setMode(null);
        form.reset();
      } catch (error) {
        captureErrorGlobal(error, {
          context: "StaffAppointmentCreationModal - onSubmit",
        });
        toast.error("Fehler beim Erstellen des Termins");
      }
    },
  });

  const handleClose = (shouldResetAppointmentType = true) => {
    onOpenChange(false, shouldResetAppointmentType);
    setMode(null);
    form.reset();
  };

  const handleDialogOpenChange = (open: boolean) => {
    // When dialog closes (ESC, outside click, etc), don't reset appointment type
    // Only reset on explicit cancel button click
    if (!open) {
      handleClose(false);
    }
  };

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={open}>
      <DialogContent>
        {mode === "next" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Nächster verfügbarer Termin</DialogTitle>
              <DialogDescription>
                {nextAvailableSlot && (
                  <>
                    {Temporal.Instant.from(nextAvailableSlot.startTime)
                      .toZonedDateTimeISO("Europe/Berlin")
                      .toPlainDate()
                      .toLocaleString("de-DE", {
                        day: "2-digit",
                        month: "long",
                        weekday: "long",
                        year: "numeric",
                      })}{" "}
                    um{" "}
                    {Temporal.Instant.from(nextAvailableSlot.startTime)
                      .toZonedDateTimeISO("Europe/Berlin")
                      .toPlainTime()
                      .toLocaleString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                    Uhr
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <form.Field
                name="title"
                validators={{
                  onChange: ({ value }) =>
                    value.trim().length === 0
                      ? "Titel ist erforderlich"
                      : undefined,
                }}
              >
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <Label htmlFor={field.name}>Titel</Label>
                      <Input
                        aria-invalid={isInvalid}
                        autoFocus
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        placeholder={`Termin - ${appointmentType?.name ?? "Unbekannt"}`}
                        value={field.state.value}
                      />
                      {isInvalid && (
                        <FieldError
                          errors={field.state.meta.errors
                            .filter(Boolean)
                            .map((error) => ({ message: String(error) }))}
                        />
                      )}
                    </Field>
                  );
                }}
              </form.Field>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  setMode(null);
                }}
                type="button"
                variant="outline"
              >
                Zurück
              </Button>
              <Button disabled={!form.state.canSubmit} type="submit">
                Termin erstellen
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Termin erstellen</DialogTitle>
              <DialogDescription>
                Terminart: {appointmentType?.name ?? "Unbekannt"}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <Button
                className="w-full justify-start"
                disabled={!nextAvailableSlot}
                onClick={() => {
                  setMode("next");
                }}
                variant="outline"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                Nächster verfügbarer Termin
                {nextAvailableSlot && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    (
                    {Temporal.Instant.from(nextAvailableSlot.startTime)
                      .toZonedDateTimeISO("Europe/Berlin")
                      .toPlainDate()
                      .toLocaleString("de-DE")}
                    )
                  </span>
                )}
              </Button>

              <Button
                className="w-full justify-start"
                onClick={() => {
                  // Close modal but keep appointment type selected for manual placement
                  handleClose(false);
                }}
                variant="outline"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                Termin manuell wählen
              </Button>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  handleClose();
                }}
                variant="outline"
              >
                Abbrechen
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
