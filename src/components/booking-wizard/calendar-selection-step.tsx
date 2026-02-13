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
import { Label } from "@/components/ui/label";
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
  const currentReasonDescription =
    "reasonDescription" in state ? state.reasonDescription : "";
  const locationId =
    "locationId" in state ? (state.locationId as Id<"locations">) : undefined;
  const personalData = "personalData" in state ? state.personalData : undefined;

  // For existing patient path, we need the practitioner ID
  const existingPractitionerId =
    "practitionerId" in state
      ? (state.practitionerId as Id<"practitioners">)
      : undefined;

  const insuranceType = "insuranceType" in state ? state.insuranceType : null;
  const hzvStatus = "hzvStatus" in state ? state.hzvStatus : undefined;
  const pkvInsuranceType =
    "pkvInsuranceType" in state ? state.pkvInsuranceType : undefined;
  const pkvTariff = "pkvTariff" in state ? state.pkvTariff : undefined;
  const beihilfeStatus =
    "beihilfeStatus" in state ? state.beihilfeStatus : undefined;
  const medicalHistory =
    "medicalHistory" in state ? state.medicalHistory : undefined;

  // Date selection state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    () => new Date(),
  );

  // Selected slot state
  const [selectedSlot, setSelectedSlot] = useState<null | SlotInfo>(null);

  // Editable appointment details for this step
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<
    Id<"appointmentTypes"> | undefined
  >(initialAppointmentTypeId);
  const [reasonDescription, setReasonDescription] = useState(
    currentReasonDescription,
  );

  // Fetch entities for selection/details
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const locations = useQuery(api.entities.getLocations, {
    ruleSetId,
  });

  const selectedAppointmentType = appointmentTypes?.find(
    (t) => t._id === selectedAppointmentTypeId,
  );
  const locationName = locations?.find(
    (location) => location._id === locationId,
  )?.name;
  const existingPractitionerName = existingPractitionerId
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

  // Mutations
  const updateCalendarSelectionDetails = useMutation(
    api.bookingSessions.updateCalendarSelectionDetails,
  );
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
    if (
      !selectedSlot ||
      !selectedAppointmentType ||
      !selectedAppointmentTypeId
    ) {
      return;
    }

    const normalizedReasonDescription = reasonDescription.trim();
    if (normalizedReasonDescription.length === 0) {
      toast.error("Bitte geben Sie einen Termingrund an.");
      return;
    }

    const detailsChanged =
      selectedAppointmentTypeId !== initialAppointmentTypeId ||
      normalizedReasonDescription !== currentReasonDescription;

    const slotData = {
      duration: selectedAppointmentType.duration,
      practitionerId: selectedSlot.practitionerId,
      practitionerName: selectedSlot.practitionerName,
      startTime: selectedSlot.startTime,
    };

    try {
      if (detailsChanged) {
        await updateCalendarSelectionDetails({
          appointmentTypeId: selectedAppointmentTypeId,
          reasonDescription: normalizedReasonDescription,
          sessionId,
        });
      }

      if (isNewPatient) {
        await selectNewPatientSlot({
          selectedSlot: slotData,
          sessionId,
        });
      } else {
        await selectExistingPatientSlot({
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

  if (!initialAppointmentTypeId || !locationId || !personalData) {
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

  if (!appointmentTypes) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-80 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle>Wählen Sie Ihren Termin</CardTitle>
        <CardDescription>
          Wählen Sie Datum und Uhrzeit. Termingrund und Terminart können Sie
          direkt hier neben der Terminauswahl anpassen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="grid gap-6 md:grid-cols-2">
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
                  Wählen Sie links ein Datum, um die verfügbaren Termine zu
                  sehen.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="font-medium">Termindetails</h4>

              <div className="space-y-2">
                <Label htmlFor="appointment-type">Terminart</Label>
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
                  <SelectTrigger className="w-full" id="appointment-type">
                    <SelectValue placeholder="Terminart wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointmentTypes.map((type) => (
                      <SelectItem key={type._id} value={type._id}>
                        {type.name} (ca. {type.duration} Min.)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason-description">Termingrund</Label>
                <Input
                  id="reason-description"
                  onChange={(event) => {
                    setReasonDescription(event.target.value);
                  }}
                  placeholder="z.B. Erkältungssymptome seit 3 Tagen"
                  value={reasonDescription}
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="font-medium">Ihre Angaben (nicht bearbeitbar)</h4>
              <SummaryRow
                label="Patientenstatus"
                value={isNewPatient ? "Neupatient/in" : "Bereits Patient/in"}
              />
              <SummaryRow
                label="Standort"
                value={locationName ?? "Unbekannt"}
              />
              {existingPractitionerId && (
                <SummaryRow
                  label="Behandler/in"
                  value={existingPractitionerName ?? "Unbekannt"}
                />
              )}
              {insuranceType && (
                <SummaryRow
                  label="Versicherung"
                  value={
                    insuranceType === "gkv"
                      ? "Gesetzlich (GKV)"
                      : "Privat (PKV)"
                  }
                />
              )}
              {hzvStatus && (
                <SummaryRow
                  label="HZV-Status"
                  value={formatHzvStatus(hzvStatus)}
                />
              )}
              {pkvInsuranceType && (
                <SummaryRow
                  label="PKV-Art"
                  value={formatPkvInsuranceType(pkvInsuranceType)}
                />
              )}
              {pkvTariff && (
                <SummaryRow
                  label="PKV-Tarif"
                  value={formatPkvTariff(pkvTariff)}
                />
              )}
              {beihilfeStatus && (
                <SummaryRow
                  label="Beihilfe"
                  value={beihilfeStatus === "yes" ? "Ja" : "Nein"}
                />
              )}
              <SummaryRow
                label="Name"
                value={`${personalData.firstName} ${personalData.lastName}`}
              />
              <SummaryRow
                label="Geburtsdatum"
                value={formatBirthDate(personalData.dateOfBirth)}
              />
              <SummaryRow label="Telefon" value={personalData.phoneNumber} />
              <SummaryRow
                label="E-Mail"
                value={personalData.email ?? "Nicht angegeben"}
              />
              <SummaryRow
                label="Adresse"
                value={formatAddress(
                  personalData.street,
                  personalData.postalCode,
                  personalData.city,
                )}
              />
              {medicalHistory && (
                <SummaryRow
                  label="Anamnese"
                  value={formatMedicalHistory(medicalHistory)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Confirm button */}
        {selectedSlot && (
          <div className="pt-6 border-t">
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
              </div>
              <Button onClick={() => void handleConfirmSlot()}>
                Termin bestätigen
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function dateToTemporal(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
}

function formatAddress(
  street: null | string | undefined,
  postalCode: null | string | undefined,
  city: null | string | undefined,
): string {
  const lines = [street, [postalCode, city].filter(Boolean).join(" ").trim()]
    .map((part) => part?.trim())
    .filter((part) => Boolean(part && part.length > 0));

  return lines.length > 0 ? lines.join(", ") : "Nicht angegeben";
}

function formatBirthDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateISO(date: Temporal.PlainDate): string {
  return date.toString();
}

function formatHzvStatus(status: string): string {
  switch (status) {
    case "has-contract": {
      return "HZV-Vertrag vorhanden";
    }
    case "interested": {
      return "Interesse an HZV";
    }
    case "no-interest": {
      return "Kein Interesse an HZV";
    }
    default: {
      return status;
    }
  }
}

function formatMedicalHistory(medicalHistory: {
  hasAllergies: boolean;
  hasDiabetes: boolean;
  hasHeartCondition: boolean;
  hasLungCondition: boolean;
}): string {
  const conditions: string[] = [];
  if (medicalHistory.hasAllergies) {
    conditions.push("Allergien");
  }
  if (medicalHistory.hasDiabetes) {
    conditions.push("Diabetes");
  }
  if (medicalHistory.hasHeartCondition) {
    conditions.push("Herzerkrankung");
  }
  if (medicalHistory.hasLungCondition) {
    conditions.push("Lungenerkrankung");
  }

  return conditions.length > 0 ? conditions.join(", ") : "Keine Angaben";
}

function formatPkvInsuranceType(pkvInsuranceType: string): string {
  switch (pkvInsuranceType) {
    case "kvb": {
      return "Krankenversorgung der Bundesbahnbeamten";
    }
    case "other": {
      return "Andere";
    }
    case "postb": {
      return "Postbeamtenkrankenkasse";
    }
    default: {
      return pkvInsuranceType;
    }
  }
}

function formatPkvTariff(pkvTariff: string): string {
  switch (pkvTariff) {
    case "basis": {
      return "Basistarif";
    }
    case "premium": {
      return "Premiumtarif";
    }
    case "standard": {
      return "Standardtarif";
    }
    default: {
      return pkvTariff;
    }
  }
}

function formatTime(isoString: string): string {
  const zdt = Temporal.ZonedDateTime.from(isoString);
  return zdt.toPlainTime().toString({ smallestUnit: "minute" });
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
