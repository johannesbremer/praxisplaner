"use client";

import { useQuery } from "convex/react";
import { useDeferredValue, useId, useMemo, useState } from "react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";

import type { PatientInfo, PracticePatientSelection } from "../types";

import {
  formatPatientOptionLabel,
  getPatientInfoDisplayName,
  patientDocToInfo,
} from "../utils/patient-info";
import { Combobox, type ComboboxOption } from "./combobox";

export type PatientSelectionPanelInitialSelection =
  | {
      kind: "draftTemporary";
      patient: Extract<PatientInfo, { recordType: "temporary" }> & {
        convexPatientId?: undefined;
      };
    }
  | { kind: "empty" }
  | { kind: "selected"; patient: PatientInfo; patientId: Id<"patients"> }
  | { kind: "selectedById"; patientId: Id<"patients"> };

interface DraftPatientState {
  name: string;
  phoneNumber: string;
}

type DraftTemporaryPatient = Extract<
  PatientSelectionPanelInitialSelection,
  { kind: "draftTemporary" }
>["patient"];

type PatientOption = ComboboxOption & {
  id: Id<"patients">;
  patient?: Doc<"patients">;
};

interface PatientSelectionPanelProps {
  initialSelection: PatientSelectionPanelInitialSelection;
  onPatientSelected: (patient?: PracticePatientSelection) => void;
  practiceId: Id<"practices">;
}

const EMPTY_DRAFT: DraftPatientState = {
  name: "",
  phoneNumber: "",
};

export function getPatientSelectionPanelInitialSelection({
  patient,
  selectedPatientId,
}: {
  patient: PatientInfo | undefined;
  selectedPatientId: Id<"patients"> | undefined;
}): PatientSelectionPanelInitialSelection {
  if (patient && selectedPatientId) {
    return {
      kind: "selected",
      patient,
      patientId: selectedPatientId,
    };
  }

  if (selectedPatientId) {
    return {
      kind: "selectedById",
      patientId: selectedPatientId,
    };
  }

  if (isDraftTemporaryPatient(patient)) {
    return {
      kind: "draftTemporary",
      patient,
    };
  }

  return { kind: "empty" };
}

export function PatientSelectionPanel({
  initialSelection,
  onPatientSelected,
  practiceId,
}: PatientSelectionPanelProps) {
  const panelId = useId();
  const [draftPatient, setDraftPatient] = useState(() =>
    getInitialDraftPatient(initialSelection),
  );
  const [selectedExistingPatientId, setSelectedExistingPatientId] = useState(
    () => getInitialSelectedPatientId(initialSelection),
  );
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue.trim());

  const patients = useQuery(api.patients.searchPatients, {
    practiceId,
    searchTerm: deferredSearchValue,
  });
  const selectedPatientDocument = useQuery(
    api.patients.getPatientById,
    selectedExistingPatientId === undefined
      ? "skip"
      : { id: selectedExistingPatientId },
  );

  const patientOptions = useMemo(
    () => (patients ?? []).map((patient) => toPatientOption(patient)),
    [patients],
  );

  const selectedPatientOption = useMemo(() => {
    if (selectedExistingPatientId === undefined) {
      return;
    }

    const matchingQueryOption = patientOptions.find(
      (option) => option.id === selectedExistingPatientId,
    );
    if (matchingQueryOption) {
      return matchingQueryOption;
    }

    if (selectedPatientDocument) {
      return toPatientOption(selectedPatientDocument);
    }

    const initialSelectedPatient = getInitialSelectedPatient(
      initialSelection,
      selectedExistingPatientId,
    );
    if (!initialSelectedPatient) {
      return;
    }

    return {
      id: selectedExistingPatientId,
      label: getPatientInfoDisplayName(initialSelectedPatient),
      searchText: getPatientInfoDisplayName(initialSelectedPatient),
      value: selectedExistingPatientId,
    };
  }, [
    initialSelection,
    patientOptions,
    selectedExistingPatientId,
    selectedPatientDocument,
  ]);

  const comboboxOptions = useMemo(() => {
    if (
      selectedPatientOption === undefined ||
      patientOptions.some((option) => option.id === selectedPatientOption.id)
    ) {
      return patientOptions;
    }

    return [selectedPatientOption, ...patientOptions];
  }, [patientOptions, selectedPatientOption]);

  const showPhoneField =
    selectedExistingPatientId === undefined &&
    draftPatient.name.trim().length > 0;

  const handleExistingPatientChange = (value: string | string[]) => {
    if (Array.isArray(value)) {
      return;
    }

    if (value.length === 0) {
      setSelectedExistingPatientId(undefined);
      emitDraftPatientSelection(onPatientSelected, draftPatient);
      return;
    }

    const selectedPatient = comboboxOptions.find(
      (option) => option.id === value,
    );
    if (!selectedPatient?.patient) {
      return;
    }

    setSelectedExistingPatientId(selectedPatient.id);
    setDraftPatient(EMPTY_DRAFT);
    onPatientSelected({
      id: selectedPatient.id,
      info: patientDocToInfo(selectedPatient.patient),
    });
  };

  const handleDraftNameChange = (nextName: string) => {
    const nextDraftPatient = {
      name: nextName,
      phoneNumber:
        selectedExistingPatientId === undefined ? draftPatient.phoneNumber : "",
    };

    setSelectedExistingPatientId(undefined);
    setDraftPatient(nextDraftPatient);
    emitDraftPatientSelection(onPatientSelected, nextDraftPatient);
  };

  const handleDraftPhoneNumberChange = (nextPhoneNumber: string) => {
    const nextDraftPatient = {
      name: draftPatient.name,
      phoneNumber: nextPhoneNumber,
    };

    if (selectedExistingPatientId !== undefined) {
      setSelectedExistingPatientId(undefined);
    }
    setDraftPatient(nextDraftPatient);
    emitDraftPatientSelection(onPatientSelected, nextDraftPatient);
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-2">
        <Label htmlFor={`${panelId}-existing-patient`}>
          Bestandspatient suchen
        </Label>
        <Combobox
          className="w-full justify-between"
          emptyMessage="Keine passenden Patienten gefunden."
          onSearchValueChange={setSearchValue}
          onValueChange={handleExistingPatientChange}
          options={comboboxOptions}
          placeholder="Patient auswählen"
          searchPlaceholder="Nach Vorname, Nachname oder Patientennummer suchen"
          searchValue={searchValue}
          value={selectedExistingPatientId ?? ""}
        />
        <p className="text-sm text-muted-foreground">
          Die Suche findet Vor- und Nachnamen direkt über den Convex-Index.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor={`${panelId}-temporary-patient-name`}>
          Temporären Patienten erfassen
        </Label>
        <Input
          id={`${panelId}-temporary-patient-name`}
          onChange={(event) => {
            handleDraftNameChange(event.target.value);
          }}
          placeholder="Name des Patienten"
          value={draftPatient.name}
        />
        <p className="text-sm text-muted-foreground">
          Wenn Sie keinen Bestandspatienten auswählen, wird beim Buchen ein
          temporärer Patient angelegt.
        </p>
      </div>

      {showPhoneField && (
        <div className="space-y-2">
          <Label htmlFor={`${panelId}-temporary-patient-phone-number`}>
            Telefonnummer
          </Label>
          <PhoneInput
            id={`${panelId}-temporary-patient-phone-number`}
            onChange={handleDraftPhoneNumberChange}
            value={draftPatient.phoneNumber}
          />
        </div>
      )}
    </div>
  );
}

function emitDraftPatientSelection(
  onPatientSelected: (patient?: PracticePatientSelection) => void,
  draftPatient: DraftPatientState,
) {
  const name = draftPatient.name.trim();
  const phoneNumber = draftPatient.phoneNumber.trim();

  if (name.length === 0 || phoneNumber.length === 0) {
    onPatientSelected();
    return;
  }

  onPatientSelected({
    info: {
      isNewPatient: false,
      name,
      phoneNumber,
      recordType: "temporary",
    },
  });
}

function getInitialDraftPatient(
  initialSelection: PatientSelectionPanelInitialSelection,
): DraftPatientState {
  switch (initialSelection.kind) {
    case "draftTemporary": {
      return {
        name: initialSelection.patient.name,
        phoneNumber: initialSelection.patient.phoneNumber,
      };
    }
    case "empty":
    case "selected":
    case "selectedById": {
      return EMPTY_DRAFT;
    }
  }
}

function getInitialSelectedPatient(
  initialSelection: PatientSelectionPanelInitialSelection,
  selectedPatientId: Id<"patients">,
) {
  return initialSelection.kind === "selected" &&
    initialSelection.patientId === selectedPatientId
    ? initialSelection.patient
    : null;
}

function getInitialSelectedPatientId(
  initialSelection: PatientSelectionPanelInitialSelection,
) {
  switch (initialSelection.kind) {
    case "draftTemporary": {
      return;
    }
    case "empty": {
      return;
    }
    case "selected": {
      return initialSelection.patientId;
    }
    case "selectedById": {
      return initialSelection.patientId;
    }
  }
}

function isDraftTemporaryPatient(
  patient: PatientInfo | undefined,
): patient is DraftTemporaryPatient {
  return (
    patient?.recordType === "temporary" && patient.convexPatientId === undefined
  );
}

function toPatientOption(patient: Doc<"patients">): PatientOption {
  return {
    id: patient._id,
    label: formatPatientOptionLabel(patient),
    patient,
    searchText: [
      patient.firstName,
      patient.lastName,
      patient.name,
      patient.patientId?.toString(),
      patient.phoneNumber,
    ]
      .filter(
        (value): value is string => value !== undefined && value.length > 0,
      )
      .join(" "),
    value: patient._id,
  };
}
