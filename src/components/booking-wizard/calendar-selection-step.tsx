// Calendar selection step component (Path A6 for new patients, Path B4 for existing patients)

import { useMutation, useQuery } from "convex/react";
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
interface SlotInfo {
  duration: number;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
}

export function CalendarSelectionStep({
  practiceId,
  ruleSetId,
  sessionId,
  state,
}: StepComponentProps) {
  const isNewPatient = state.step === "new-calendar-selection";

  const initialAppointmentTypeId =
    "appointmentTypeId" in state
      ? (state.appointmentTypeId as Id<"appointmentTypes">)
      : undefined;
  const locationId =
    "locationId" in state ? (state.locationId as Id<"locations">) : undefined;

  // For existing patient path, we need the practitioner ID
  const existingPractitionerId =
    "practitionerId" in state
      ? (state.practitionerId as Id<"practitioners">)
      : undefined;
  const personalData = "personalData" in state ? state.personalData : undefined;
  const initialReasonDescription =
    "reasonDescription" in state ? state.reasonDescription : "";

  // Date selection state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    () => new Date(),
  );
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<
    Id<"appointmentTypes"> | undefined
  >(initialAppointmentTypeId);
  const [reasonDescription, setReasonDescription] = useState(
    initialReasonDescription,
  );

  // Selected slot state
  const [selectedSlot, setSelectedSlot] = useState<null | SlotInfo>(null);

  // Fetch appointment types to get duration info
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const locations = useQuery(api.entities.getLocations, { ruleSetId });
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const appointmentType = appointmentTypes?.find(
    (t) => t._id === selectedAppointmentTypeId,
  );
  const locationName = locations?.find(
    (location) => location._id === locationId,
  )?.name;
  const practitionerName = existingPractitionerId
    ? practitioners?.find(
        (practitioner) => practitioner._id === existingPractitionerId,
      )?.name
    : undefined;

  // Build simulated context for slot query - only include locationId if defined
  const simulatedContext = {
    patient: { isNew: isNewPatient },
    ...(selectedAppointmentTypeId && {
      appointmentTypeId: selectedAppointmentTypeId,
    }),
    ...(locationId && { locationId }),
  };

  // Query slots for the selected day
  const slotsResult = useQuery(
    api.scheduling.getSlotsForDay,
    selectedDate && selectedAppointmentTypeId
      ? {
          date: formatDateISO(dateToTemporal(selectedDate)),
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
    setSelectedSlot(slot);
  };

  const handleConfirmSlot = async () => {
    const trimmedReason = reasonDescription.trim();
    if (
      !selectedSlot ||
      !appointmentType ||
      !selectedAppointmentTypeId ||
      !trimmedReason
    ) {
      return;
    }

    const slotData = {
      duration: appointmentType.duration,
      practitionerId: selectedSlot.practitionerId,
      practitionerName: selectedSlot.practitionerName,
      startTime: selectedSlot.startTime,
    };

    try {
      if (isNewPatient) {
        await selectNewPatientSlot({
          appointmentTypeId: selectedAppointmentTypeId,
          reasonDescription: trimmedReason,
          selectedSlot: slotData,
          sessionId,
        });
      } else {
        await selectExistingPatientSlot({
          appointmentTypeId: selectedAppointmentTypeId,
          reasonDescription: trimmedReason,
          selectedSlot: slotData,
          sessionId,
        });
      }
    } catch (error) {
      console.error("Failed to select slot:", error);
      toast.error("Termin konnte nicht ausgewählt werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  };

  // Filter to only available slots
  const availableSlots =
    slotsResult?.slots.filter((slot) => slot.status === "AVAILABLE") ?? [];

  // For existing patients, filter by practitioner
  const filteredSlots = existingPractitionerId
    ? availableSlots.filter(
        (slot) => slot.practitionerId === existingPractitionerId,
      )
    : availableSlots;

  // Sort slots by time
  const sortedSlots = filteredSlots.toSorted(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  // Calculate booking window (e.g., next 4 weeks)
  const today = Temporal.Now.plainDateISO(TIMEZONE);
  const windowStart = new Date(today.year, today.month - 1, today.day);
  const windowEnd = new Date(
    today.add({ days: 28 }).year,
    today.add({ days: 28 }).month - 1,
    today.add({ days: 28 }).day,
  );

  if (!locationId) {
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
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Terminart *</p>
                <Select
                  onValueChange={(value) => {
                    setSelectedAppointmentTypeId(
                      value as Id<"appointmentTypes">,
                    );
                    setSelectedSlot(null);
                  }}
                  {...(selectedAppointmentTypeId
                    ? { value: selectedAppointmentTypeId }
                    : {})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointmentTypes?.map((type) => (
                      <SelectItem key={type._id} value={type._id}>
                        {type.name} (ca. {type.duration} Min.)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Termingrund *</p>
                <Input
                  onChange={(event) => {
                    setReasonDescription(event.target.value);
                  }}
                  placeholder="z.B. Erkältungssymptome seit 3 Tagen"
                  value={reasonDescription}
                />
              </div>
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
              selectedAppointmentTypeId ? (
                slotsResult === undefined ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : sortedSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Keine Termine an diesem Tag verfügbar. Bitte wählen Sie ein
                    anderes Datum.
                  </p>
                ) : (
                  <div className="grid gap-2 max-h-80 overflow-y-auto">
                    {sortedSlots.map((slot) => {
                      const isSelected =
                        selectedSlot?.startTime === slot.startTime &&
                        selectedSlot.practitionerId === slot.practitionerId;

                      return (
                        <Button
                          className="justify-between"
                          key={`${slot.practitionerId}-${slot.startTime}`}
                          onClick={() => {
                            handleSelectSlot({
                              duration: slot.duration,
                              practitionerId: slot.practitionerId,
                              practitionerName: slot.practitionerName,
                              startTime: slot.startTime,
                            });
                          }}
                          variant={isSelected ? "default" : "outline"}
                        >
                          <span>{formatTime(slot.startTime)} Uhr</span>
                          {!existingPractitionerId && (
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
              <Button
                disabled={
                  !selectedAppointmentTypeId || reasonDescription.trim() === ""
                }
                onClick={() => void handleConfirmSlot()}
              >
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
            {existingPractitionerId && (
              <ReadOnlyItem
                label="Behandler/in"
                value={practitionerName ?? existingPractitionerId}
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
