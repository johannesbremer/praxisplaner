"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { CalendarIcon, User } from "lucide-react";
import { ResultAsync } from "neverthrow";
import { useMemo, useState } from "react";
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
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  resultFromNullable,
} from "../utils/frontend-errors";

interface StaffAppointmentCreationModalProps {
  appointmentTypeId: Id<"appointmentTypes">;
  isSimulation?: boolean;
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
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    start: string;
    title: string;
    userId?: Id<"users">;
  }) => Promise<Id<"appointments"> | undefined>;
  selectedDate: string;
}

export function StaffAppointmentCreationModal({
  appointmentTypeId,
  isSimulation = false,
  locationId,
  onAppointmentCreated,
  onOpenChange,
  onPendingTitleChange,
  open,
  patient,
  practiceId,
  ruleSetId,
  runCreateAppointment: runCreateAppointmentProp,
  selectedDate,
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
  const hasFollowUpPlan = (appointmentType?.followUpPlan?.length ?? 0) > 0;

  // Query for next available slot - only query when modal is open
  const [requestedAt] = useState(() => Temporal.Now.instant().toString());

  const nextAvailableSlot = useQuery(
    api.scheduling.getNextAvailableSlot,
    open && appointmentTypeId && locationId
      ? {
          date: selectedDate,
          practiceId,
          ruleSetId,
          scope: isSimulation ? "simulation" : "real",
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

  // Determine if we have a patient (from GDT or user-linked booking)
  const hasPatientFromGdt = patient?.convexPatientId !== undefined;
  const hasUserLinkedPatient = patient?.userId !== undefined;
  const hasSimulationPatient = isSimulation;
  const hasAnyPatient =
    hasPatientFromGdt || hasUserLinkedPatient || hasSimulationPatient;
  const seriesPreview = useQuery(
    api.appointments.previewAppointmentSeries,
    open && mode === "next" && hasFollowUpPlan && nextAvailableSlot
      ? {
          locationId,
          ...(patient?.dateOfBirth && {
            patientDateOfBirth: patient.dateOfBirth,
          }),
          ...(patient?.convexPatientId && {
            patientId: patient.convexPatientId,
          }),
          practiceId,
          practitionerId: nextAvailableSlot.practitionerId,
          rootAppointmentTypeId: appointmentTypeId,
          ruleSetId,
          scope: isSimulation ? "simulation" : "real",
          start: nextAvailableSlot.startTime,
          ...(patient?.userId && { userId: patient.userId }),
        }
      : "skip",
  );

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

    if (hasSimulationPatient) {
      const parts = [patient?.firstName, patient?.lastName].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(" ");
      }
      return "Simulationspatient";
    }

    return "Kein Patient";
  };

  const getCreateTarget = () => {
    const patientId = patient?.convexPatientId;
    if (patientId) {
      return {
        patientId,
        recipient: { id: patientId, type: "patient" as const },
      };
    }

    const userId = patient?.userId;
    if (userId) {
      return {
        recipient: { id: userId, type: "user" as const },
        userId,
      };
    }

    if (isSimulation) {
      return { recipient: undefined };
    }

    return null;
  };

  // Helper function to create appointment with a patient selection
  const createAppointmentWithPatient = async () => {
    const createTarget = resultFromNullable(
      getCreateTarget(),
      invalidStateError(
        "Bitte wählen Sie einen Patienten aus.",
        "StaffAppointmentCreationModal.getCreateTarget",
      ),
    ).match(
      (selectedTarget) => selectedTarget,
      () => {
        toast.error("Bitte wählen Sie einen Patienten aus.");
        return null;
      },
    );
    if (!createTarget) {
      return;
    }

    const slot = resultFromNullable(
      nextAvailableSlot,
      invalidStateError(
        "Es wurde kein verfügbarer Termin gefunden.",
        "StaffAppointmentCreationModal.nextAvailableSlot",
      ),
    ).match(
      (availableSlot) => availableSlot,
      (error) => {
        toast.error(error.message);
        return null;
      },
    );
    if (!slot) {
      return;
    }

    const selectedAppointmentType = resultFromNullable(
      appointmentType,
      invalidStateError(
        "Die gewählte Terminart konnte nicht geladen werden.",
        "StaffAppointmentCreationModal.appointmentType",
      ),
    ).match(
      (loadedAppointmentType) => loadedAppointmentType,
      (error) => {
        toast.error(error.message);
        return null;
      },
    );
    if (!selectedAppointmentType) {
      return;
    }

    await ResultAsync.fromPromise(
      runCreateAppointment({
        appointmentTypeId: selectedAppointmentType._id,
        ...(isSimulation && { isSimulation: true }),
        locationId,
        ...(createTarget.patientId && { patientId: createTarget.patientId }),
        practiceId,
        practitionerId: slot.practitionerId,
        start: Temporal.ZonedDateTime.from(slot.startTime).toString(),
        title,
        ...(createTarget.userId && { userId: createTarget.userId }),
      }),
      (error) =>
        frontendErrorFromUnknown(error, {
          kind: "unknown",
          message: "Fehler beim Erstellen des Termins",
          source: "StaffAppointmentCreationModal.createAppointment",
        }),
    )
      .andThen((appointmentId) =>
        resultFromNullable(
          appointmentId,
          invalidStateError(
            "Der Termin konnte nicht erstellt werden.",
            "StaffAppointmentCreationModal.createAppointmentResult",
          ),
        ),
      )
      .match(
        (appointmentId) => {
          onAppointmentCreated?.(appointmentId, createTarget.recipient);
          toast.success(
            hasFollowUpPlan
              ? "Kettentermine erfolgreich erstellt"
              : "Termin erfolgreich erstellt",
          );
          onOpenChange(false, true);
          setMode(null);
          setTitle("");
          form.reset();
        },
        (error) => {
          captureFrontendError(error, {
            appointmentTypeId: selectedAppointmentType._id,
            context:
              "StaffAppointmentCreationModal.createAppointmentWithPatient",
          });
          captureErrorGlobal(error, {
            context:
              "StaffAppointmentCreationModal - createAppointmentWithPatient",
          });
          toast.error(error.message);
        },
      );
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

  const isSeriesPreviewLoading = hasFollowUpPlan && seriesPreview === undefined;
  const isSeriesPreviewBlocked = seriesPreview?.status === "blocked";
  const isSubmitDisabled =
    !form.state.canSubmit ||
    (hasFollowUpPlan && (isSeriesPreviewLoading || isSeriesPreviewBlocked));
  const submitButtonLabel = hasFollowUpPlan
    ? isSeriesPreviewLoading
      ? "Kettentermine werden geprüft..."
      : isSeriesPreviewBlocked
        ? "Kettentermine nicht planbar"
        : "Termin erstellen"
    : "Termin erstellen";

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

                {hasFollowUpPlan && (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-sm font-medium">
                      Geplante Kettentermine
                    </div>
                    {seriesPreview === undefined ? (
                      <div className="text-sm text-muted-foreground">
                        Prüfe verfügbare Folgetermine...
                      </div>
                    ) : seriesPreview.status === "blocked" ? (
                      <div className="text-sm text-destructive">
                        {seriesPreview.failureMessage ||
                          "Die Kettentermine konnten nicht geplant werden."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {seriesPreview.steps.map((step) => (
                          <div
                            className="flex items-start justify-between gap-4 text-sm"
                            key={step.stepId}
                          >
                            <div>
                              <div className="font-medium">
                                {step.seriesStepIndex + 1}.{" "}
                                {step.appointmentTypeTitle}
                              </div>
                              {step.note && (
                                <div className="text-muted-foreground">
                                  {step.note}
                                </div>
                              )}
                            </div>
                            <div className="text-right text-muted-foreground">
                              <div>
                                {Temporal.ZonedDateTime.from(step.start)
                                  .toPlainDate()
                                  .toLocaleString("de-DE")}
                              </div>
                              <div>
                                {Temporal.ZonedDateTime.from(step.start)
                                  .toPlainTime()
                                  .toLocaleString("de-DE", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}{" "}
                                Uhr
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                {hasFollowUpPlan &&
                  (isSeriesPreviewLoading || isSeriesPreviewBlocked) && (
                    <div className="mr-auto text-sm text-muted-foreground">
                      {isSeriesPreviewLoading
                        ? "Die Kettentermine werden noch geprüft."
                        : "Der Termin kann erst erstellt werden, wenn alle Kettentermine planbar sind."}
                    </div>
                  )}
                <Button
                  onClick={() => {
                    setMode(null);
                  }}
                  type="button"
                  variant="outline"
                >
                  Zurück
                </Button>
                <Button disabled={isSubmitDisabled} type="submit">
                  {submitButtonLabel}
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
                  disabled={
                    nextAvailableSlot !== null &&
                    nextAvailableSlot !== undefined
                      ? !title.trim()
                      : true
                  }
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
                      {hasFollowUpPlan ? " (mit Kettenterminen)" : ""}
                    </>
                  ) : (
                    "Nächster verfügbarer Termin"
                  )}
                </Button>

                {nextAvailableSlot === null && (
                  <div className="text-sm text-muted-foreground">
                    Es konnte kein freier Termin gefunden werden.
                  </div>
                )}

                <Button
                  className="w-full justify-start"
                  disabled={!title.trim()}
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
