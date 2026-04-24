// Calendar selection step component (Path A6 for new patients, Path B4 for existing patients)

import { useMutation, useQuery } from "convex/react";
import { ResultAsync } from "neverthrow";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

import type { StepComponentProps } from "./types";

import {
  captureFrontendError,
  frontendErrorFromUnknown,
} from "../../utils/frontend-errors";

const TIMEZONE = "Europe/Berlin";

// Helper to format ISO date string from Date
function formatDateISO(date: Temporal.PlainDate): string {
  return date.toString();
}

// Helper to convert Date to Temporal.PlainDate
function dateToTemporal(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
}

// Helper to format time from ISO string
type CalendarSelectionState = Extract<
  StepComponentProps["state"],
  { step: "existing-calendar-selection" | "new-calendar-selection" }
>;

interface SlotInfo {
  practitionerLineageKey: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
}

export function CalendarSelectionStep({
  practiceId,
  ruleSetId,
  sessionId,
  state,
}: StepComponentProps) {
  const isCalendarState = isCalendarSelectionState(state);
  const isNewPatient = state.step === "new-calendar-selection";
  const locationLineageKey = isCalendarState
    ? state.locationLineageKey
    : undefined;
  const existingPractitionerLineageKey =
    state.step === "existing-calendar-selection"
      ? state.practitionerLineageKey
      : undefined;
  const personalData = isCalendarState ? state.personalData : undefined;
  const patientDateOfBirth = personalData?.dateOfBirth;

  // Date selection state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    () => new Date(),
  );
  const [
    selectedAppointmentTypeLineageKey,
    setSelectedAppointmentTypeLineageKey,
  ] = useState<Id<"appointmentTypes"> | undefined>();
  const [reasonDescription, setReasonDescription] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [hasTouchedAppointmentType, setHasTouchedAppointmentType] =
    useState(false);
  const [hasTouchedReasonDescription, setHasTouchedReasonDescription] =
    useState(false);

  // Selected slot state
  const [selectedSlot, setSelectedSlot] = useState<null | SlotInfo>(null);

  // Fetch appointment types to get duration info
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const appointmentType = appointmentTypes?.find(
    (t) => t.lineageKey === selectedAppointmentTypeLineageKey,
  );
  const locationName = isCalendarState ? state.locationName : undefined;
  const practitionerName =
    state.step === "existing-calendar-selection"
      ? state.practitionerName
      : undefined;

  // Build simulated context for slot query - only include lineage references.
  const simulatedContext = {
    patient: {
      isNew: isNewPatient,
      ...(patientDateOfBirth && { dateOfBirth: patientDateOfBirth }),
    },
    ...(selectedAppointmentTypeLineageKey && {
      appointmentTypeLineageKey: selectedAppointmentTypeLineageKey,
    }),
    ...(locationLineageKey && { locationLineageKey }),
  };

  // Query slots for the selected day
  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    selectedDate && selectedAppointmentTypeLineageKey
      ? {
          date: formatDateISO(dateToTemporal(selectedDate)),
          enforceFutureOnly: true,
          practiceId,
          ruleSetId,
          simulatedContext,
        }
      : "skip",
  );

  // Mutations for selecting a slot
  const selectNewPatientSlot = useMutation(
    api.bookingSessions.selectNewPatientSlot,
  );
  const selectExistingPatientSlot = useMutation(
    api.bookingSessions.selectExistingPatientSlot,
  );

  const handleSelectSlot = (slot: SlotInfo) => {
    const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
    if (!isSlotStartInFuture(slot.startTime, nowEpochMilliseconds)) {
      return;
    }
    setSelectedSlot(slot);
  };

  const handleConfirmSlot = async () => {
    setHasAttemptedSubmit(true);
    const trimmedReason = reasonDescription.trim();
    const hasMissingAppointmentType = !selectedAppointmentTypeLineageKey;
    const hasMissingReason = trimmedReason.length === 0;
    if (
      !selectedSlot ||
      !appointmentType ||
      hasMissingAppointmentType ||
      hasMissingReason
    ) {
      return;
    }

    const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
    if (!isSlotStartInFuture(selectedSlot.startTime, nowEpochMilliseconds)) {
      toast.error("Dieser Termin liegt in der Vergangenheit");
      return;
    }

    const slotData = {
      practitionerLineageKey: selectedSlot.practitionerLineageKey,
      practitionerName: selectedSlot.practitionerName,
      startTime: selectedSlot.startTime,
    };

    await ResultAsync.fromPromise(
      isNewPatient
        ? selectNewPatientSlot({
            appointmentTypeLineageKey: selectedAppointmentTypeLineageKey,
            reasonDescription: trimmedReason,
            selectedSlot: slotData,
            sessionId,
          })
        : selectExistingPatientSlot({
            appointmentTypeLineageKey: selectedAppointmentTypeLineageKey,
            reasonDescription: trimmedReason,
            selectedSlot: slotData,
            sessionId,
          }),
      (error) =>
        frontendErrorFromUnknown(error, {
          kind: "unknown",
          message: "Termin konnte nicht ausgewählt werden.",
          source: "CalendarSelectionStep.handleConfirmSlot",
        }),
    ).match(
      () => void 0,
      (error) => {
        captureFrontendError(error, {
          appointmentTypeLineageKey: appointmentType.lineageKey,
          isNewPatient,
          sessionId,
          slotStart: selectedSlot.startTime,
        });
        toast.error("Termin konnte nicht ausgewählt werden", {
          description: error.message || "Bitte versuchen Sie es erneut.",
        });
      },
    );
  };

  // Filter to only available slots
  const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
  const availableSlots =
    slotsResult?.slots.filter(
      (slot) =>
        slot.status === "AVAILABLE" &&
        isSlotStartInFuture(slot.startTime, nowEpochMilliseconds),
    ) ?? [];

  // For existing patients, filter by practitioner
  const filteredSlots = existingPractitionerLineageKey
    ? availableSlots.filter(
        (slot) =>
          slot.practitionerLineageKey === existingPractitionerLineageKey,
      )
    : availableSlots;

  // Sort slots by time and keep only the first free slot for the selected day.
  // This behavior is specific to /buchung.
  const sortedSlots = filteredSlots.toSorted(
    (a, b) =>
      getSlotStartEpochMilliseconds(a.startTime) -
      getSlotStartEpochMilliseconds(b.startTime),
  );
  const displayedSlots = sortedSlots[0] ? [sortedSlots[0]] : [];

  // Calculate booking window (e.g., next 4 weeks)
  const today = Temporal.Now.plainDateISO(TIMEZONE);
  const windowStart = new Date(today.year, today.month - 1, today.day);
  const windowEnd = new Date(
    today.add({ days: 28 }).year,
    today.add({ days: 28 }).month - 1,
    today.add({ days: 28 }).day,
  );

  if (!locationLineageKey) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Fehler</CardTitle>
          <CardDescription>
            Es fehlen erforderliche Informationen. Bitte starten Sie die Buchung
            erneut.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Wählen Sie Ihren Termin</CardTitle>
        <CardDescription>
          Wählen Sie Terminart, Termingrund, Datum und dann eine verfügbare
          Uhrzeit.
          {appointmentType && (
            <span className="block mt-1">
              Terminart: {appointmentType.name} (ca. {appointmentType.duration}{" "}
              Min.)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Calendar */}
          <div>
            <Calendar
              className="rounded-md border p-3"
              disabled={[{ before: windowStart }, { after: windowEnd }]}
              formatters={{
                formatWeekdayName: (date) =>
                  date.toLocaleString("de-DE", { weekday: "short" }),
              }}
              mode="single"
              onSelect={(date) => {
                setSelectedDate(date ?? undefined);
                setSelectedSlot(null);
              }}
              selected={selectedDate}
              showOutsideDays={false}
              weekStartsOn={1}
            />
          </div>

          {/* Time slots */}
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Termindetails</p>
              <Field
                data-invalid={
                  (hasAttemptedSubmit || hasTouchedAppointmentType) &&
                  !selectedAppointmentTypeLineageKey
                }
              >
                <FieldLabel>Terminart *</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    setHasTouchedAppointmentType(true);
                    const selectedType = appointmentTypes?.find(
                      (type) => type.lineageKey === value,
                    );
                    setSelectedAppointmentTypeLineageKey(
                      selectedType?.lineageKey,
                    );
                    setSelectedSlot(null);
                  }}
                  {...(selectedAppointmentTypeLineageKey
                    ? { value: selectedAppointmentTypeLineageKey }
                    : {})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointmentTypes?.map((type) => (
                      <SelectItem key={type._id} value={type.lineageKey}>
                        {type.name} (ca. {type.duration} Min.)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(hasAttemptedSubmit || hasTouchedAppointmentType) &&
                  !selectedAppointmentTypeLineageKey && (
                    <FieldError
                      errors={[{ message: "Bitte wählen Sie eine Terminart." }]}
                    />
                  )}
              </Field>
              <Field
                data-invalid={
                  (hasAttemptedSubmit || hasTouchedReasonDescription) &&
                  reasonDescription.trim().length === 0
                }
              >
                <FieldLabel htmlFor="reason-description">
                  Termingrund *
                </FieldLabel>
                <Input
                  id="reason-description"
                  onBlur={() => {
                    setHasTouchedReasonDescription(true);
                  }}
                  onChange={(event) => {
                    setHasTouchedReasonDescription(true);
                    setReasonDescription(event.target.value);
                  }}
                  placeholder="z.B. Erkältungssymptome seit 3 Tagen"
                  value={reasonDescription}
                />
                {(hasAttemptedSubmit || hasTouchedReasonDescription) &&
                  reasonDescription.trim().length === 0 && (
                    <FieldError
                      errors={[
                        { message: "Bitte geben Sie einen Termingrund ein." },
                      ]}
                    />
                  )}
              </Field>
            </div>

            <h4 className="font-medium text-sm">
              {selectedDate
                ? `Termine am ${selectedDate.toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "long",
                    weekday: "long",
                  })}`
                : "Bitte wählen Sie ein Datum"}
            </h4>

            {selectedDate ? (
              selectedAppointmentTypeLineageKey ? (
                slotsResult === undefined ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : displayedSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Keine Termine an diesem Tag verfügbar. Bitte wählen Sie ein
                    anderes Datum.
                  </p>
                ) : (
                  <div className="grid gap-2 max-h-80 overflow-y-auto">
                    {displayedSlots.map((slot) => {
                      const isSelected =
                        selectedSlot?.startTime === slot.startTime &&
                        selectedSlot.practitionerLineageKey ===
                          slot.practitionerLineageKey;

                      return (
                        <Button
                          className="justify-between"
                          key={`${slot.practitionerLineageKey}-${slot.startTime}`}
                          onClick={() => {
                            handleSelectSlot({
                              practitionerLineageKey:
                                slot.practitionerLineageKey,
                              practitionerName: slot.practitionerName,
                              startTime: slot.startTime,
                            });
                          }}
                          variant={isSelected ? "default" : "outline"}
                        >
                          <span>{formatTime(slot.startTime)} Uhr</span>
                          {!existingPractitionerLineageKey && (
                            <span className="text-xs opacity-70">
                              {slot.practitionerName}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  Bitte wählen Sie zuerst eine Terminart.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                Wählen Sie links ein Datum, um die verfügbaren Termine zu sehen.
              </p>
            )}
          </div>
        </div>

        {/* Confirm button */}
        {selectedSlot && (
          <div className="mt-6 pt-6 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  Gewählter Termin:{" "}
                </span>
                <span className="font-medium">
                  {selectedDate?.toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "long",
                    weekday: "long",
                    year: "numeric",
                  })}{" "}
                  um {formatTime(selectedSlot.startTime)} Uhr
                </span>
                <span className="block text-muted-foreground">
                  bei {selectedSlot.practitionerName}
                </span>
                <span className="block text-muted-foreground">
                  Termingrund: {reasonDescription.trim()}
                </span>
              </div>
              <Button onClick={() => void handleConfirmSlot()}>
                Termin bestätigen
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border p-4 space-y-3">
          <h4 className="font-medium">Ihre Angaben (nicht editierbar)</h4>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <ReadOnlyItem label="Standort" value={locationName} />
            <ReadOnlyItem
              label="Patiententyp"
              value={isNewPatient ? "Neu" : "Bestand"}
            />
            {existingPractitionerLineageKey && (
              <ReadOnlyItem
                label="Behandler/in"
                value={practitionerName ?? existingPractitionerLineageKey}
              />
            )}
            {"insuranceType" in state && (
              <ReadOnlyItem
                label="Versicherungsart"
                value={state.insuranceType.toUpperCase()}
              />
            )}
            {"hzvStatus" in state && (
              <ReadOnlyItem label="HZV-Status" value={state.hzvStatus} />
            )}
            {"pkvInsuranceType" in state && (
              <ReadOnlyItem
                label="PKV-Art"
                value={state.pkvInsuranceType ?? "Keine Angabe"}
              />
            )}
            {"pkvTariff" in state && (
              <ReadOnlyItem
                label="PKV-Tarif"
                value={state.pkvTariff ?? "Keine Angabe"}
              />
            )}
            {"beihilfeStatus" in state && (
              <ReadOnlyItem
                label="Beihilfe"
                value={state.beihilfeStatus ?? "Keine Angabe"}
              />
            )}
            {personalData && (
              <ReadOnlyItem
                label="Name"
                value={`${personalData.firstName} ${personalData.lastName}`}
              />
            )}
            {personalData && (
              <ReadOnlyItem
                label="Geburtsdatum"
                value={personalData.dateOfBirth}
              />
            )}
            {personalData && (
              <ReadOnlyItem label="Telefon" value={personalData.phoneNumber} />
            )}
            {personalData?.email && (
              <ReadOnlyItem label="E-Mail" value={personalData.email} />
            )}
            {personalData &&
              (personalData.street ||
                personalData.postalCode ||
                personalData.city) && (
                <ReadOnlyItem
                  label="Adresse"
                  value={[
                    personalData.street,
                    [personalData.postalCode, personalData.city]
                      .filter(Boolean)
                      .join(" "),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTime(isoString: string): string {
  const zdt = Temporal.ZonedDateTime.from(isoString);
  return zdt.toPlainTime().toString({ smallestUnit: "minute" });
}

function getSlotStartEpochMilliseconds(startTime: string): number {
  return Temporal.ZonedDateTime.from(startTime).epochMilliseconds;
}

function isCalendarSelectionState(
  state: StepComponentProps["state"],
): state is CalendarSelectionState {
  return (
    state.step === "existing-calendar-selection" ||
    state.step === "new-calendar-selection"
  );
}

function isSlotStartInFuture(
  startTime: string,
  nowEpochMilliseconds: number,
): boolean {
  return getSlotStartEpochMilliseconds(startTime) > nowEpochMilliseconds;
}

function ReadOnlyItem({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value && value.length > 0 ? value : "-"}</p>
    </div>
  );
}
