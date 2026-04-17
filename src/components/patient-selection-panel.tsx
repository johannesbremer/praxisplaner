"use client";

import { useMutation, useQuery } from "convex/react";
import { UserPlus } from "lucide-react";
import { type ChangeEvent, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";

import type { PatientInfo } from "../types";

import {
  formatPatientOptionLabel,
  patientDocToInfo,
} from "../utils/patient-info";
import { Combobox } from "./combobox";

interface PatientSelectionPanelProps {
  onPatientSelected: (patient: {
    id: Id<"patients">;
    info: PatientInfo;
  }) => void;
  practiceId: Id<"practices">;
  selectedPatientId: Id<"patients"> | undefined;
}

const EMPTY_TEMPORARY_PATIENT = {
  firstName: "",
  lastName: "",
  phoneNumber: "",
};

export function PatientSelectionPanel({
  onPatientSelected,
  practiceId,
  selectedPatientId,
}: PatientSelectionPanelProps) {
  const panelId = useId();
  const [temporaryPatient, setTemporaryPatient] = useState(
    EMPTY_TEMPORARY_PATIENT,
  );
  const createTemporaryPatient = useMutation(
    api.patients.createTemporaryPatient,
  );
  const patientsQuery = useQuery(api.patients.searchPatients, {
    practiceId,
    searchTerm: "",
  });
  const patients = useMemo(() => patientsQuery ?? [], [patientsQuery]);

  const options = useMemo(
    () =>
      patients
        .toSorted((left, right) =>
          formatPatientOptionLabel(left).localeCompare(
            formatPatientOptionLabel(right),
            "de",
          ),
        )
        .map((patient) => ({
          label: formatPatientOptionLabel(patient),
          searchText: [
            patient.firstName,
            patient.lastName,
            patient.patientId,
            patient.phoneNumber,
          ]
            .filter(Boolean)
            .join(" "),
          value: patient._id,
        })),
    [patients],
  );

  const canCreateTemporaryPatient =
    temporaryPatient.firstName.trim().length > 0 &&
    temporaryPatient.lastName.trim().length > 0 &&
    temporaryPatient.phoneNumber.trim().length > 0;

  const handleSelectExistingPatient = (value: string | string[]) => {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    const selectedPatient = patients.find((patient) => patient._id === value);
    if (!selectedPatient) {
      return;
    }

    onPatientSelected({
      id: selectedPatient._id,
      info: patientDocToInfo(selectedPatient),
    });
  };

  const handleCreateTemporaryPatient = async () => {
    if (!canCreateTemporaryPatient) {
      toast.error("Bitte Vorname, Nachname und Telefonnummer eingeben.");
      return;
    }

    try {
      const createdPatientId = await createTemporaryPatient({
        firstName: temporaryPatient.firstName.trim(),
        lastName: temporaryPatient.lastName.trim(),
        phoneNumber: temporaryPatient.phoneNumber.trim(),
        practiceId,
      });

      onPatientSelected({
        id: createdPatientId,
        info: {
          convexPatientId: createdPatientId,
          firstName: temporaryPatient.firstName.trim(),
          isNewPatient: false,
          lastName: temporaryPatient.lastName.trim(),
          phoneNumber: temporaryPatient.phoneNumber.trim(),
          recordType: "temporary",
        },
      });
      setTemporaryPatient(EMPTY_TEMPORARY_PATIENT);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Temporärer Patient konnte nicht angelegt werden.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">Patient auswählen</div>
        <div className="text-sm text-muted-foreground">
          Vor dem Termin kann ein bestehender Patient gewählt oder ein
          temporärer Patient angelegt werden.
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${panelId}-existing-patient-combobox`}>
          Bestehender Patient
        </Label>
        <Combobox
          className="w-full justify-between"
          onValueChange={handleSelectExistingPatient}
          options={options}
          placeholder="Patient suchen..."
          value={selectedPatientId ?? ""}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="size-4 text-muted-foreground" />
          Temporären Patienten anlegen
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${panelId}-temporary-patient-first-name`}>
            Vorname
          </Label>
          <Input
            id={`${panelId}-temporary-patient-first-name`}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setTemporaryPatient((current) => ({
                ...current,
                firstName: event.target.value,
              }));
            }}
            value={temporaryPatient.firstName}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${panelId}-temporary-patient-last-name`}>
            Nachname
          </Label>
          <Input
            id={`${panelId}-temporary-patient-last-name`}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setTemporaryPatient((current) => ({
                ...current,
                lastName: event.target.value,
              }));
            }}
            value={temporaryPatient.lastName}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${panelId}-temporary-patient-phone-number`}>
            Telefonnummer
          </Label>
          <PhoneInput
            id={`${panelId}-temporary-patient-phone-number`}
            onChange={(value: string) => {
              setTemporaryPatient((current) => ({
                ...current,
                phoneNumber: value,
              }));
            }}
            value={temporaryPatient.phoneNumber}
          />
        </div>
        <Button
          disabled={!canCreateTemporaryPatient}
          onClick={() => {
            void handleCreateTemporaryPatient();
          }}
          type="button"
          variant="outline"
        >
          Temporären Patienten anlegen
        </Button>
      </div>
    </div>
  );
}
