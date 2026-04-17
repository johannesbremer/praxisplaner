"use client";

import { useQuery } from "convex/react";
import { Search, UserRoundCheck } from "lucide-react";
import {
  type ChangeEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import type { PatientInfo, PracticePatientSelection } from "../types";

import {
  formatPatientOptionLabel,
  getPatientDocumentName,
  getPatientInfoDisplayName,
  patientDocToInfo,
} from "../utils/patient-info";

export type PatientSelectionPanelInitialSelection =
  | { kind: "draftTemporary"; patient: DraftTemporaryPatient }
  | { kind: "empty" }
  | { kind: "selected"; patient: PatientInfo; patientId: Id<"patients"> }
  | { kind: "selectedById"; patientId: Id<"patients"> };

type DraftTemporaryPatient = Extract<
  PatientInfo,
  { recordType: "temporary" }
> & {
  convexPatientId?: undefined;
};

interface PatientSelectionPanelProps {
  initialSelection: PatientSelectionPanelInitialSelection;
  onPatientSelected: (patient?: PracticePatientSelection) => void;
  practiceId: Id<"practices">;
}

const EMPTY_DRAFT = {
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [draftPatient, setDraftPatient] = useState(() =>
    getInitialDraftPatient(initialSelection),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedExistingPatientId, setSelectedExistingPatientId] = useState(
    () => getInitialSelectedPatientId(initialSelection),
  );
  const patientsQuery = useQuery(api.patients.searchPatients, {
    practiceId,
    searchTerm: "",
  });
  const patients = useMemo(() => patientsQuery ?? [], [patientsQuery]);

  const patientOptions = useMemo(
    () =>
      patients
        .toSorted((left, right) =>
          formatPatientOptionLabel(left).localeCompare(
            formatPatientOptionLabel(right),
            "de",
          ),
        )
        .map((existingPatient) => ({
          id: existingPatient._id,
          label: formatPatientOptionLabel(existingPatient),
          name: getPatientDocumentName(existingPatient),
          patient: existingPatient,
          searchText: [
            getPatientDocumentName(existingPatient),
            existingPatient.firstName,
            existingPatient.lastName,
            existingPatient.name,
            existingPatient.patientId,
            existingPatient.phoneNumber,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("de"),
        })),
    [patients],
  );

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (selectedExistingPatientId) {
      const selectedPatient = patientOptions.find(
        (option) => option.id === selectedExistingPatientId,
      );
      if (selectedPatient) {
        onPatientSelected({
          id: selectedPatient.id,
          info: patientDocToInfo(selectedPatient.patient),
        });
        return;
      }

      const initialSelectedPatient = getInitialSelectedPatient(
        initialSelection,
        selectedExistingPatientId,
      );
      if (initialSelectedPatient) {
        onPatientSelected({
          id: selectedExistingPatientId,
          info: initialSelectedPatient,
        });
      }

      return;
    }

    const name = draftPatient.name.trim();
    const phoneNumber = draftPatient.phoneNumber.trim();

    if (name.length === 0) {
      onPatientSelected();
      return;
    }

    if (phoneNumber.length === 0) {
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
  }, [
    draftPatient,
    initialSelection,
    onPatientSelected,
    patientOptions,
    selectedExistingPatientId,
  ]);

  const filteredPatients = useMemo(() => {
    const searchTerm = draftPatient.name.trim().toLocaleLowerCase("de");
    if (searchTerm.length === 0) {
      return patientOptions;
    }

    return patientOptions.filter((option) =>
      option.searchText.includes(searchTerm),
    );
  }, [draftPatient.name, patientOptions]);

  const showPhoneField =
    selectedExistingPatientId === undefined &&
    draftPatient.name.trim().length > 0;

  const selectExistingPatient = (patientId: Id<"patients">) => {
    const selectedPatient = patientOptions.find(
      (option) => option.id === patientId,
    );
    if (!selectedPatient) {
      return;
    }

    setSelectedExistingPatientId(selectedPatient.id);
    setDraftPatient({
      name: selectedPatient.name,
      phoneNumber: "",
    });
    setIsOpen(false);
  };

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.target.value;

    setSelectedExistingPatientId(undefined);
    setDraftPatient((current) => ({
      name: nextName,
      phoneNumber:
        selectedExistingPatientId === undefined ? current.phoneNumber : "",
    }));
    setIsOpen(true);
  };

  return (
    <div className="space-y-4" ref={panelRef}>
      <div className="space-y-2">
        <Label htmlFor={`${panelId}-patient-name`}>Patient</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="pl-9"
            id={`${panelId}-patient-name`}
            onChange={handleNameChange}
            onFocus={() => {
              setIsOpen(true);
            }}
            placeholder="Patient suchen oder neuen Namen eingeben"
            value={draftPatient.name}
          />
          {isOpen && (
            <div className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-50 rounded-md border bg-popover shadow-md">
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredPatients.length > 0 ? (
                  filteredPatients.map((option) => {
                    const isSelected = option.id === selectedExistingPatientId;

                    return (
                      <button
                        className={cn(
                          "flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        )}
                        key={option.id}
                        onClick={() => {
                          selectExistingPatient(option.id);
                        }}
                        type="button"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {option.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {option.label}
                          </div>
                        </div>
                        {isSelected && (
                          <UserRoundCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Kein bestehender Patient gefunden. Beim Buchen wird ein
                    temporärer Patient angelegt.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {selectedExistingPatientId ? (
          <p className="text-sm text-muted-foreground">
            Bestandspatient ausgewählt.
          </p>
        ) : draftPatient.name.trim().length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Wenn kein Treffer gewählt wird, wird beim Buchen ein temporärer
            Patient angelegt.
          </p>
        ) : null}
      </div>

      {showPhoneField && (
        <div className="space-y-2">
          <Label htmlFor={`${panelId}-temporary-patient-phone-number`}>
            Telefonnummer
          </Label>
          <PhoneInput
            id={`${panelId}-temporary-patient-phone-number`}
            onChange={(value: string) => {
              setDraftPatient((current) => ({
                ...current,
                phoneNumber: value,
              }));
            }}
            value={draftPatient.phoneNumber}
          />
        </div>
      )}
    </div>
  );
}

function getInitialDraftPatient(
  initialSelection: PatientSelectionPanelInitialSelection,
) {
  switch (initialSelection.kind) {
    case "draftTemporary": {
      return {
        name: initialSelection.patient.name,
        phoneNumber: initialSelection.patient.phoneNumber,
      };
    }
    case "empty":
    case "selectedById": {
      return EMPTY_DRAFT;
    }
    case "selected": {
      return {
        name: getPatientInfoDisplayName(initialSelection.patient),
        phoneNumber: "",
      };
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
    : undefined;
}

function getInitialSelectedPatientId(
  initialSelection: PatientSelectionPanelInitialSelection,
) {
  switch (initialSelection.kind) {
    case "draftTemporary":
    case "empty": {
      return;
    }
    case "selected":
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
