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
import { asPractitionerLineageKey } from "@/convex/identity";
import { createCalendarPlacement } from "@/lib/calendar-occupancy";

import type { PatientInfo, PracticePatientSelection } from "../types";
import type { CalendarAppointmentCreateCommandArgs } from "./calendar/use-calendar-planning-workbench";

import { captureErrorGlobal } from "../utils/error-tracking";
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  resultFromNullable,
} from "../utils/frontend-errors";
import { getPatientInfoDisplayName } from "../utils/patient-info";
import { zonedDateTimeStringResult } from "../utils/time-calculations";
import {
  getPatientSelectionPanelInitialSelection,
  PatientSelectionPanel,
} from "./patient-selection-panel";

type CreateTarget =
  | {
      patientId: Id<"patients">;
      recipient: { id: Id<"patients">; type: "patient" };
    }
  | {
      recipient: { id: Id<"users">; type: "user" };
      userId: Id<"users">;
    }
  | {
      temporaryPatientName: string;
      temporaryPatientPhoneNumber: string;
    };

interface StaffAppointmentCreationModalProps {
  appointmentTypeId: Id<"appointmentTypes">;
  isNewPatient?: boolean;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  onAppointmentCreated?: (
    appointmentId: Id<"appointments">,
    patient?:
      | { id: Id<"patients">; type: "patient" }
      | { id: Id<"users">; type: "user" },
  ) => void;
  onOpenChange: (open: boolean, shouldResetAppointmentType?: boolean) => void;
  onPatientSelected?:
    | ((patient?: PracticePatientSelection) => void)
    | undefined;
  onPendingTitleChange?: ((title?: string) => void) | undefined;
  open: boolean;
  patient?: PatientInfo | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  runCreateAppointment?: (
    args: CalendarAppointmentCreateCommandArgs,
  ) => Promise<Id<"appointments"> | undefined>;
  selectedDate: string;
  selectedPatientId: Id<"patients"> | undefined;
}

export function StaffAppointmentCreationModal({
  appointmentTypeId,
  isNewPatient = false,
  isSimulation = false,
  locationId,
  onAppointmentCreated,
  onOpenChange,
  onPatientSelected,
  onPendingTitleChange,
  open,
  patient,
  practiceId,
  ruleSetId,
  runCreateAppointment: runCreateAppointmentProp,
  selectedDate,
  selectedPatientId,
}: StaffAppointmentCreationModalProps) {
  const [mode, setMode] = useState<"next" | null>(null);
  const [selectedFallbackPatient, setSelectedFallbackPatient] = useState<
    PracticePatientSelection | undefined
  >();
  const [title, setTitle] = useState("");

  const createAppointmentMutation = useMutation(
    api.appointments.createAppointment,
  );

  // Get appointment type name for display - only query when modal is open
  const appointmentTypes = useQuery(
    api.entities.getAppointmentTypes,
    open ? { ruleSetId } : "skip",
  );
  const locations = useQuery(
    api.entities.getLocations,
    open ? { ruleSetId } : "skip",
  );
  const practitioners = useQuery(
    api.entities.getPractitioners,
    open ? { ruleSetId } : "skip",
  );
  // Use the optimistic update wrapper if provided, otherwise fall back to direct mutation.
  const runCreateAppointment = useMemo(
    () =>
      runCreateAppointmentProp ??
      (async (args: CalendarAppointmentCreateCommandArgs) => {
        const { end, placement, replacesAppointmentId, ...rest } = args;
        const mutationBaseArgs = {
          ...rest,
          ...(end === undefined ? {} : { end }),
          ...(replacesAppointmentId === undefined
            ? {}
            : { replacesAppointmentId }),
        };
        const fallbackLocation = locations?.find(
          (entry) => entry.lineageKey === placement.locationLineageKey,
        );
        if (fallbackLocation === undefined) {
          return await Promise.reject(
            new Error("Termin-Referenzen konnten nicht aufgelöst werden."),
          );
        }

        if (placement.occupancyScope.kind === "resource") {
          return await createAppointmentMutation({
            ...mutationBaseArgs,
            calendarResourceColumn:
              placement.occupancyScope.calendarResourceColumn,
            locationId: fallbackLocation._id,
          });
        }

        const practitionerOccupancyScope = placement.occupancyScope;
        const fallbackPractitioner = practitioners?.find(
          (practitioner) =>
            practitioner.lineageKey ===
            practitionerOccupancyScope.practitionerLineageKey,
        );
        if (fallbackPractitioner === undefined) {
          return await Promise.reject(
            new Error("Termin-Referenzen konnten nicht aufgelöst werden."),
          );
        }

        return await createAppointmentMutation({
          ...mutationBaseArgs,
          locationId: fallbackLocation._id,
          practitionerId: fallbackPractitioner._id,
        });
      }),
    [
      createAppointmentMutation,
      locations,
      practitioners,
      runCreateAppointmentProp,
    ],
  );
  const appointmentType = appointmentTypes?.find(
    (type) => type._id === appointmentTypeId,
  );
  const location = locations?.find((entry) => entry._id === locationId);
  const hasAppointmentPlan =
    (appointmentType?.appointmentPlan?.steps.length ?? 0) > 0;
  const bookingScope = isSimulation
    ? ("simulation" as const)
    : ("real" as const);
  const effectivePatient = selectedFallbackPatient?.info ?? patient;
  const effectiveSelectedPatientId =
    selectedFallbackPatient && "id" in selectedFallbackPatient
      ? selectedFallbackPatient.id
      : selectedPatientId;

  const effectiveNextAvailableSlot = useQuery(
    api.appointments.getNextAvailableCandidateSlotForStaffPlacement,
    open && location !== undefined && appointmentType !== undefined
      ? {
          appointmentTypeId,
          date: selectedDate,
          ...(effectivePatient?.dateOfBirth && {
            patientDateOfBirth: effectivePatient.dateOfBirth,
          }),
          ...(effectivePatient?.convexPatientId && {
            patientId: effectivePatient.convexPatientId,
          }),
          isNewPatient,
          locationId,
          practiceId,
          ruleSetId,
          scope: bookingScope,
          ...(effectivePatient?.userId && { userId: effectivePatient.userId }),
        }
      : "skip",
  );
  const nextAvailablePractitionerLineageKey =
    effectiveNextAvailableSlot !== undefined &&
    effectiveNextAvailableSlot !== null &&
    "practitionerLineageKey" in effectiveNextAvailableSlot
      ? effectiveNextAvailableSlot.practitionerLineageKey
      : undefined;
  const availableSeriesBlueprint = effectiveNextAvailableSlot?.seriesBlueprint;

  // Determine if we have a patient (from GDT or user-linked booking)
  const hasPersistedPatient = effectivePatient?.convexPatientId !== undefined;
  const hasUserLinkedPatient = effectivePatient?.userId !== undefined;
  const hasTemporaryPatientDraft =
    effectivePatient?.recordType === "temporary" &&
    effectivePatient.convexPatientId === undefined &&
    effectivePatient.name.trim().length > 0 &&
    effectivePatient.phoneNumber.trim().length > 0;
  const hasAnyPatient =
    hasPersistedPatient || hasUserLinkedPatient || hasTemporaryPatientDraft;

  // Get display name for patient
  const getPatientDisplayName = (): string => {
    const currentPatient = effectivePatient;
    if (!currentPatient) {
      return "Kein Patient";
    }

    return getPatientInfoDisplayName(currentPatient) || "Kein Patient";
  };

  const getCreateTarget = (): CreateTarget | null => {
    const patientId = effectivePatient?.convexPatientId;
    if (patientId) {
      return {
        patientId,
        recipient: { id: patientId, type: "patient" as const },
      };
    }

    const userId = effectivePatient?.userId;
    if (userId) {
      return {
        recipient: { id: userId, type: "user" as const },
        userId,
      };
    }

    if (
      effectivePatient?.recordType === "temporary" &&
      effectivePatient.convexPatientId === undefined
    ) {
      return {
        temporaryPatientName: effectivePatient.name.trim(),
        temporaryPatientPhoneNumber: effectivePatient.phoneNumber.trim(),
      };
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
      (error) => {
        toast.error(error.message);
        return null;
      },
    );
    if (!createTarget) {
      return;
    }

    const slot = resultFromNullable(
      effectiveNextAvailableSlot,
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
    const start = zonedDateTimeStringResult(
      Temporal.ZonedDateTime.from(slot.startTime).toString(),
      "StaffAppointmentCreationModal.start",
    ).match(
      (typedStart) => typedStart,
      (error) => {
        toast.error(error.message);
        return null;
      },
    );
    if (!start) {
      return;
    }
    const occupancyScope =
      slot.calendarResourceColumn === undefined
        ? nextAvailablePractitionerLineageKey === undefined
          ? null
          : {
              kind: "practitioner" as const,
              practitionerLineageKey: asPractitionerLineageKey(
                nextAvailablePractitionerLineageKey,
              ),
            }
        : {
            calendarResourceColumn: slot.calendarResourceColumn,
            kind: "resource" as const,
          };
    const placement = resultFromNullable(
      location?.lineageKey === undefined || occupancyScope === null
        ? null
        : createCalendarPlacement({
            locationLineageKey: location.lineageKey,
            occupancyScope,
          }),
      invalidStateError(
        "Die Referenzen für den gewählten Termin konnten nicht geladen werden.",
        "StaffAppointmentCreationModal.placement",
      ),
    ).match(
      (resolvedPlacement) => resolvedPlacement,
      (error) => {
        toast.error(error.message);
        return null;
      },
    );
    if (!placement) {
      return;
    }

    await ResultAsync.fromPromise(
      runCreateAppointment(
        "patientId" in createTarget
          ? {
              appointmentTypeId: selectedAppointmentType._id,
              isNewPatient,
              ...(isSimulation && { isSimulation: true }),
              ...(effectivePatient?.dateOfBirth && {
                patientDateOfBirth: effectivePatient.dateOfBirth,
              }),
              patientId: createTarget.patientId,
              placement,
              practiceId,
              start,
              title,
            }
          : "userId" in createTarget
            ? {
                appointmentTypeId: selectedAppointmentType._id,
                isNewPatient,
                ...(isSimulation && { isSimulation: true }),
                ...(effectivePatient?.dateOfBirth && {
                  patientDateOfBirth: effectivePatient.dateOfBirth,
                }),
                placement,
                practiceId,
                start,
                title,
                userId: createTarget.userId,
              }
            : {
                appointmentTypeId: selectedAppointmentType._id,
                isNewPatient,
                ...(isSimulation && { isSimulation: true }),
                ...(effectivePatient?.dateOfBirth && {
                  patientDateOfBirth: effectivePatient.dateOfBirth,
                }),
                placement,
                practiceId,
                start,
                temporaryPatientName: createTarget.temporaryPatientName,
                temporaryPatientPhoneNumber:
                  createTarget.temporaryPatientPhoneNumber,
                title,
              },
      ),
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
          onAppointmentCreated?.(
            appointmentId,
            "recipient" in createTarget ? createTarget.recipient : undefined,
          );
          toast.success(
            hasAppointmentPlan
              ? "Kettentermine erfolgreich erstellt"
              : "Termin erfolgreich erstellt",
          );
          onOpenChange(false, true);
          setMode(null);
          setSelectedFallbackPatient(undefined);
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
      if (mode === "next" && effectiveNextAvailableSlot) {
        await createAppointmentWithPatient();
      }
    },
  });

  const handleClose = (shouldResetAppointmentType = true) => {
    onOpenChange(false, shouldResetAppointmentType);
    setMode(null);
    setSelectedFallbackPatient(undefined);
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

  const isNextAvailableSlotLoading =
    open && effectiveNextAvailableSlot === undefined;
  const hasNoNextAvailableSlot = effectiveNextAvailableSlot === null;
  const isSubmitDisabled =
    !form.state.canSubmit ||
    isNextAvailableSlotLoading ||
    hasNoNextAvailableSlot ||
    !hasAnyPatient ||
    (hasAppointmentPlan &&
      (availableSeriesBlueprint === undefined ||
        availableSeriesBlueprint.length === 0));
  const submitButtonLabel = isNextAvailableSlotLoading
    ? "Termin wird gesucht..."
    : hasNoNextAvailableSlot
      ? "Kein Termin verfügbar"
      : hasAppointmentPlan
        ? "Termin erstellen"
        : "Termin erstellen";

  return (
    <>
      <Dialog onOpenChange={handleDialogOpenChange} open={open}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
          {mode === "next" ? (
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <DialogHeader>
                <DialogTitle>Nächster verfügbarer Termin</DialogTitle>
                <DialogDescription>
                  {isNextAvailableSlotLoading ? (
                    <>Suche nach dem nächsten verfügbaren Termin...</>
                  ) : hasNoNextAvailableSlot ? (
                    <>Es konnte kein freier Termin gefunden werden.</>
                  ) : effectiveNextAvailableSlot ? (
                    <>
                      {Temporal.ZonedDateTime.from(
                        effectiveNextAvailableSlot.startTime,
                      )
                        .toPlainDate()
                        .toLocaleString("de-DE", {
                          day: "2-digit",
                          month: "long",
                          weekday: "long",
                          year: "numeric",
                        })}{" "}
                      um{" "}
                      {Temporal.ZonedDateTime.from(
                        effectiveNextAvailableSlot.startTime,
                      )
                        .toPlainTime()
                        .toLocaleString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                      Uhr
                    </>
                  ) : (
                    <>Es konnte kein freier Termin gefunden werden.</>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-4 pr-2">
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

                <PatientSelectionPanel
                  initialSelection={getPatientSelectionPanelInitialSelection({
                    patient: effectivePatient,
                    selectedPatientId: effectiveSelectedPatientId,
                  })}
                  key="patient-selection-next"
                  onPatientSelected={(selected) => {
                    setSelectedFallbackPatient(selected);
                    onPatientSelected?.(selected);
                  }}
                  practiceId={practiceId}
                />

                {hasAppointmentPlan && (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-sm font-medium">
                      Geplante Kettentermine
                    </div>
                    {isNextAvailableSlotLoading ? (
                      <div className="text-sm text-muted-foreground">
                        Suche zuerst den Starttermin...
                      </div>
                    ) : hasNoNextAvailableSlot ? (
                      <div className="text-sm text-muted-foreground">
                        Ohne freien Starttermin können keine Kettentermine
                        geplant werden.
                      </div>
                    ) : availableSeriesBlueprint === undefined ? (
                      <div className="text-sm text-muted-foreground">
                        Es wurde kein vollständig planbarer Kettentermin
                        gefunden.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {availableSeriesBlueprint.map((step) => (
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

              <DialogFooter className="shrink-0 border-t pt-4">
                {hasAppointmentPlan &&
                  availableSeriesBlueprint === undefined &&
                  !isNextAvailableSlotLoading &&
                  !hasNoNextAvailableSlot && (
                    <div className="mr-auto text-sm text-muted-foreground">
                      Der Termin kann erst erstellt werden, wenn alle
                      Kettentermine planbar sind.
                    </div>
                  )}
                {!hasAppointmentPlan && isNextAvailableSlotLoading && (
                  <div className="mr-auto text-sm text-muted-foreground">
                    Der nächste verfügbare Termin wird gesucht.
                  </div>
                )}
                {hasNoNextAvailableSlot && (
                  <div className="mr-auto text-sm text-muted-foreground">
                    Es konnte kein freier Termin gefunden werden.
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-4 pr-2">
                <div className="space-y-2">
                  <Label htmlFor="appointment-reason">Termingrund</Label>
                  <Input
                    id="appointment-reason"
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                    placeholder="z.B. Kontrolluntersuchung"
                    value={title}
                  />
                </div>

                <PatientSelectionPanel
                  initialSelection={getPatientSelectionPanelInitialSelection({
                    patient: effectivePatient,
                    selectedPatientId: effectiveSelectedPatientId,
                  })}
                  key="patient-selection-create"
                  onPatientSelected={(selected) => {
                    setSelectedFallbackPatient(selected);
                    onPatientSelected?.(selected);
                  }}
                  practiceId={practiceId}
                />

                <Button
                  className="w-full justify-start"
                  disabled={!title.trim() || !hasAnyPatient}
                  onClick={() => {
                    setMode("next");
                  }}
                  variant="outline"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {effectiveNextAvailableSlot ? (
                    <>
                      {Temporal.ZonedDateTime.from(
                        effectiveNextAvailableSlot.startTime,
                      )
                        .toPlainTime()
                        .toLocaleString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                      Uhr am{" "}
                      {Temporal.ZonedDateTime.from(
                        effectiveNextAvailableSlot.startTime,
                      )
                        .toPlainDate()
                        .toLocaleString("de-DE")}
                      {hasAppointmentPlan ? " (mit Kettenterminen)" : ""}
                    </>
                  ) : (
                    "Nächster verfügbarer Termin"
                  )}
                </Button>

                {hasNoNextAvailableSlot && (
                  <div className="text-sm text-muted-foreground">
                    Es konnte kein freier Termin gefunden werden.
                  </div>
                )}

                {isNextAvailableSlotLoading && (
                  <div className="text-sm text-muted-foreground">
                    Der nächste verfügbare Termin wird gesucht.
                  </div>
                )}
                {!hasAnyPatient && (
                  <div className="text-sm text-muted-foreground">
                    Ohne ausgewählten Patienten öffnet sich beim nächsten
                    verfügbaren Termin zuerst die Patientenauswahl.
                  </div>
                )}

                <Button
                  className="w-full justify-start"
                  disabled={!title.trim() || !hasAnyPatient}
                  onClick={() => {
                    // Pass the appointment reason to the calendar for manual placement.
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

              <DialogFooter className="shrink-0 border-t pt-4">
                <Button
                  onClick={() => {
                    handleClose();
                  }}
                  variant="outline"
                >
                  Abbrechen
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
