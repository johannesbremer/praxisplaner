"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { CalendarIcon, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

import type { PatientInfo } from "../types";

import { captureErrorGlobal } from "../utils/error-tracking";

interface StaffAppointmentCreationModalProps {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
  onAppointmentCreated?: (
    appointmentId: Id<"appointments">,
    patient?:
      | { id: Id<"patients">; type: "patient" }
      | { id: Id<"users">; type: "user" },
  ) => void;
  onOpenChange: (open: boolean, shouldResetAppointmentType?: boolean) => void;
  onPendingTitleChange?: ((title: string | undefined) => void) | undefined;
  open: boolean;
  patient?: PatientInfo | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  runCreateAppointment?: (args: {
    appointmentTypeId: Id<"appointmentTypes">;
    end: string;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    start: string;
    title: string;
  }) => Promise<Id<"appointments"> | undefined>;
}

export function StaffAppointmentCreationModal({
  appointmentTypeId,
  locationId,
  onAppointmentCreated,
  onOpenChange,
  onPendingTitleChange,
  open,
  patient,
  practiceId,
  ruleSetId,
  runCreateAppointment: runCreateAppointmentProp,
}: StaffAppointmentCreationModalProps) {
  const [mode, setMode] = useState<"next" | null>(null);
  const [title, setTitle] = useState("");

  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );

  // Use the optimistic update wrapper if provided, otherwise fall back to direct mutation
  const runCreateAppointment = useMemo(
    () =>
      runCreateAppointmentProp ??
      ((args: Parameters<typeof createAppointmentMutation>[0]) =>
        createAppointmentMutation(args)),
    [createAppointmentMutation, runCreateAppointmentProp],
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
              ...(patient?.dateOfBirth && {
                dateOfBirth: patient.dateOfBirth,
              }),
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

  // Determine if we have a patient (from GDT or user-linked booking)
  const hasPatientFromGdt = patient?.convexPatientId !== undefined;
  const hasUserLinkedPatient = patient?.userId !== undefined;
  const hasAnyPatient = hasPatientFromGdt || hasUserLinkedPatient;

  // Get display name for patient
  const getPatientDisplayName = (): string => {
    if (hasPatientFromGdt) {
      if (patient.firstName && patient.lastName) {
        return `${patient.firstName} ${patient.lastName}`;
      }
      return `Patient ${patient.patientId ?? ""}`;
    }

    if (hasUserLinkedPatient) {
      const parts = [patient.firstName, patient.lastName].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(" ");
      }
      return patient.email ?? "Kein Patient";
    }

    return "Kein Patient";
  };

  // Helper function to create appointment with a patient selection
  const createAppointmentWithPatient = async () => {
    if (!nextAvailableSlot) {
      return;
    }

    const patientId = patient?.convexPatientId;
    const userId = patient?.userId;

    if (!patientId && !userId) {
      toast.error("Bitte wählen Sie einen Patienten aus.");
      return;
    }

    try {
      // Parse as ZonedDateTime since scheduling query now returns that format
      const startZoned = Temporal.ZonedDateTime.from(
        nextAvailableSlot.startTime,
      );
      const endZoned = startZoned.add({
        minutes: nextAvailableSlot.duration,
      });

      const newAppointmentId = await runCreateAppointment({
        appointmentTypeId,
        end: endZoned.toString(),
        locationId,
        ...(patientId && { patientId }),
        ...(userId && { userId }),
        practiceId,
        practitionerId: nextAvailableSlot.practitionerId,
        start: startZoned.toString(),
        title,
      });

      // Notify about the created appointment for selection
      const recipient:
        | undefined
        | { id: Id<"patients">; type: "patient" }
        | { id: Id<"users">; type: "user" } = patientId
        ? { id: patientId, type: "patient" as const }
        : userId
          ? { id: userId, type: "user" as const }
          : undefined;

      if (newAppointmentId && recipient) {
        onAppointmentCreated?.(newAppointmentId, recipient);
      }

      toast.success("Termin erfolgreich erstellt");

      // Reset and close after successful creation
      onOpenChange(false, true);
      setMode(null);
      setTitle("");
      form.reset();
    } catch (error) {
      captureErrorGlobal(error, {
        context: "StaffAppointmentCreationModal - createAppointmentWithPatient",
      });
      toast.error("Fehler beim Erstellen des Termins");
    }
  };

  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      if (mode === "next" && nextAvailableSlot) {
        // Check if we have any patient - if not, show selection modal
        if (!hasAnyPatient) {
          toast.error("Bitte wählen Sie einen Patienten aus.");
          return;
        }

        // Create appointment with the selected patient
        await createAppointmentWithPatient();
      }
    },
  });

  const handleClose = (shouldResetAppointmentType = true) => {
    onOpenChange(false, shouldResetAppointmentType);
    setMode(null);
    setTitle("");
    form.reset();
  };

  const handleDialogOpenChange = (open: boolean) => {
    // When dialog closes (ESC, outside click, etc), don't reset appointment type
    // Only reset on explicit cancel button click
    if (!open) {
      handleClose(false);
    }
  };

  // Auto-create appointment when a patient is selected externally (via GDT) while modal is open
  useEffect(() => {
    const createAppointmentWithExternalPatient = async () => {
      if (
        !nextAvailableSlot ||
        (!patient?.convexPatientId && !patient?.userId)
      ) {
        return;
      }

      try {
        const startZoned = Temporal.ZonedDateTime.from(
          nextAvailableSlot.startTime,
        );
        const endZoned = startZoned.add({
          minutes: nextAvailableSlot.duration,
        });

        const newAppointmentId = await runCreateAppointment({
          appointmentTypeId,
          end: endZoned.toString(),
          locationId,
          ...(patient.convexPatientId && {
            patientId: patient.convexPatientId,
          }),
          ...(patient.userId && { userId: patient.userId }),
          practiceId,
          practitionerId: nextAvailableSlot.practitionerId,
          start: startZoned.toString(),
          title,
        });

        // Notify about the created appointment for selection
        const recipient:
          | undefined
          | { id: Id<"patients">; type: "patient" }
          | { id: Id<"users">; type: "user" } = patient.convexPatientId
          ? { id: patient.convexPatientId, type: "patient" as const }
          : patient.userId
            ? { id: patient.userId, type: "user" as const }
            : undefined;

        if (newAppointmentId && recipient) {
          onAppointmentCreated?.(newAppointmentId, recipient);
        }

        toast.success("Termin erfolgreich erstellt");
        onOpenChange(false, true);
        setMode(null);
      } catch (error) {
        captureErrorGlobal(error, {
          context:
            "StaffAppointmentCreationModal - createAppointmentWithExternalPatient",
        });
        toast.error("Fehler beim Erstellen des Termins");
      }
    };

    void createAppointmentWithExternalPatient();
  }, [
    appointmentTypeId,
    locationId,
    nextAvailableSlot,
    onAppointmentCreated,
    onOpenChange,
    patient?.convexPatientId,
    patient?.userId,
    practiceId,
    runCreateAppointment,
    title,
  ]);

  return (
    <>
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
                      {Temporal.ZonedDateTime.from(nextAvailableSlot.startTime)
                        .toPlainDate()
                        .toLocaleString("de-DE", {
                          day: "2-digit",
                          month: "long",
                          weekday: "long",
                          year: "numeric",
                        })}{" "}
                      um{" "}
                      {Temporal.ZonedDateTime.from(nextAvailableSlot.startTime)
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
                {/* Patient info display */}
                <div className="flex items-center gap-2 rounded-md border p-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {hasAnyPatient ? (
                      getPatientDisplayName()
                    ) : (
                      <span className="text-muted-foreground">
                        Kein Patient ausgewählt
                      </span>
                    )}
                  </span>
                </div>
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
                <DialogTitle>
                  {appointmentType?.name ?? "Unbekannt"}-Termin erstellen
                </DialogTitle>
                <VisuallyHidden>
                  <DialogDescription>
                    Wählen Sie eine Option, um einen Termin zu erstellen.
                  </DialogDescription>
                </VisuallyHidden>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="appointment-title">Titel</Label>
                  <Input
                    id="appointment-title"
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                    placeholder="z.B. Kontrolluntersuchung"
                    value={title}
                  />
                </div>

                <Button
                  className="w-full justify-start"
                  disabled={!nextAvailableSlot || !title.trim()}
                  onClick={() => {
                    setMode("next");
                  }}
                  variant="outline"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {nextAvailableSlot ? (
                    <>
                      {Temporal.ZonedDateTime.from(nextAvailableSlot.startTime)
                        .toPlainTime()
                        .toLocaleString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                      Uhr am{" "}
                      {Temporal.ZonedDateTime.from(nextAvailableSlot.startTime)
                        .toPlainDate()
                        .toLocaleString("de-DE")}
                    </>
                  ) : (
                    "Nächster verfügbarer Termin"
                  )}
                </Button>

                <Button
                  className="w-full justify-start"
                  disabled={availableSlots === undefined || !title.trim()}
                  onClick={() => {
                    // Pass the title to the calendar for manual placement
                    onPendingTitleChange?.(title.trim());
                    // Close modal but keep appointment type selected for manual placement
                    handleClose(false);
                  }}
                  variant="outline"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Anderer Termin
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
    </>
  );
}
