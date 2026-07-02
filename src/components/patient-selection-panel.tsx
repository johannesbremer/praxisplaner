"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Search, UserRoundCheck } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { PhoneInput } from "@/components/phone-input";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import type { PatientInfo, PracticePatientSelection } from "../types";

import {
  getPatientDocumentName,
  getPatientInfoDisplayName,
  patientDocToInfo,
} from "../utils/patient-info";

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

interface PatientOption {
  id: Id<"patients">;
  name: string;
  patient: Doc<"patients">;
}

interface PatientSelectionPanelProps {
  initialSelection: PatientSelectionPanelInitialSelection;
  onPatientSelected: (patient?: PracticePatientSelection) => void;
  practiceId: Id<"practices">;
}

const EMPTY_DRAFT: DraftPatientState = {
  name: "",
  phoneNumber: "",
};

const temporaryPatientFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Der Name muss mindestens 3 Zeichen lang sein."),
  phoneNumber: z.e164("Bitte gültige Telefonnummer im Format +49... eingeben"),
});

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
  const createTemporaryPatient = useMutation(
    api.patients.createTemporaryPatient,
  );
  const [draftPatient, setDraftPatient] = useState(() =>
    getInitialDraftPatient(initialSelection),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingTemporaryPatient, setIsCreatingTemporaryPatient] =
    useState(false);
  const [selectedExistingPatientId, setSelectedExistingPatientId] = useState(
    () => getInitialSelectedPatientId(initialSelection),
  );
  const deferredSearchTerm = useDeferredValue(draftPatient.name.trim());
  const patients = useQuery(api.patients.searchPatients, {
    practiceId,
    searchTerm: deferredSearchTerm,
  });
  const selectedPatientDocument = useQuery(
    api.patients.getPatientById,
    selectedExistingPatientId === undefined
      ? "skip"
      : { id: selectedExistingPatientId },
  );
  const form = useForm({
    defaultValues: draftPatient,
    onSubmit: async ({ value }) => {
      const temporaryPatient = {
        name: value.name.trim(),
        phoneNumber: value.phoneNumber.trim(),
      };

      if (
        temporaryPatient.name.length === 0 ||
        temporaryPatient.phoneNumber.length === 0
      ) {
        onPatientSelected();
        return;
      }

      setIsCreatingTemporaryPatient(true);
      try {
        const patientId = await createTemporaryPatient({
          name: temporaryPatient.name,
          phoneNumber: temporaryPatient.phoneNumber,
          practiceId,
        });
        setSelectedExistingPatientId(patientId);
        setDraftPatient(EMPTY_DRAFT);
        form.reset(EMPTY_DRAFT);
        setIsOpen(false);
        onPatientSelected({
          id: patientId,
          info: {
            convexPatientId: patientId,
            insuranceStatus: "unknown",
            isNewPatient: false,
            name: temporaryPatient.name,
            phoneNumber: temporaryPatient.phoneNumber,
            recordType: "temporary",
          },
        });
      } catch {
        toast.error("Der temporäre Patient konnte nicht erstellt werden.");
      } finally {
        setIsCreatingTemporaryPatient(false);
      }
    },
    validators: {
      onSubmit: temporaryPatientFormSchema,
    },
  });

  const patientOptions = useMemo(
    () =>
      (patients ?? []).map((patient) => ({
        id: patient._id,
        name: getPatientDocumentName(patient),
        patient,
      })),
    [patients],
  );
  const patientNameValue =
    selectedExistingPatientId !== undefined &&
    draftPatient.name.trim().length === 0 &&
    selectedPatientDocument
      ? getPatientDocumentName(selectedPatientDocument)
      : draftPatient.name;

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

  const showPhoneField =
    selectedExistingPatientId === undefined &&
    draftPatient.name.trim().length > 0;

  const selectExistingPatient = (option: PatientOption) => {
    setSelectedExistingPatientId(option.id);
    const nextDraftPatient = {
      name: option.name,
      phoneNumber: "",
    };

    setDraftPatient(nextDraftPatient);
    form.reset(nextDraftPatient);
    setIsOpen(false);
    onPatientSelected({
      id: option.id,
      info: patientDocToInfo(option.patient)._unsafeUnwrap(),
    });
  };

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.target.value;
    const nextDraftPatient = {
      name: nextName,
      phoneNumber:
        selectedExistingPatientId === undefined ? draftPatient.phoneNumber : "",
    };

    setSelectedExistingPatientId(undefined);
    setDraftPatient(nextDraftPatient);
    form.setFieldValue("name", nextName);
    form.setFieldValue("phoneNumber", nextDraftPatient.phoneNumber);
    setIsOpen(true);
    onPatientSelected();
  };

  const handlePhoneNumberChange = (nextPhoneNumber: string) => {
    const nextDraftPatient = {
      name: draftPatient.name,
      phoneNumber: nextPhoneNumber,
    };

    setDraftPatient(nextDraftPatient);
    form.setFieldValue("phoneNumber", nextPhoneNumber);
    onPatientSelected();
  };

  const preventOuterFormSubmitOnEnter = (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "Enter") {
      return;
    }

    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className="space-y-2"
      onKeyDownCapture={preventOuterFormSubmitOnEnter}
      ref={panelRef}
    >
      <form.Field name="name">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid;

          return (
            <Field className="space-y-2" data-invalid={isInvalid}>
              <Label htmlFor={`${panelId}-patient-name`}>Patient</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  className="pl-9"
                  id={`${panelId}-patient-name`}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={handleNameChange}
                  onFocus={() => {
                    setIsOpen(true);
                  }}
                  placeholder="Patient suchen oder neuen Namen eingeben"
                  value={patientNameValue}
                />
                {isOpen && patientOptions.length > 0 ? (
                  <div className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-50 rounded-md border bg-popover shadow-md">
                    <div className="max-h-64 overflow-y-auto p-1">
                      {patientOptions.map((option) => {
                        const isSelected =
                          option.id === selectedExistingPatientId;

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
                              selectExistingPatient(option);
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault();
                            }}
                            type="button"
                          >
                            <div className="min-w-0 truncate font-medium">
                              {option.name}
                            </div>
                            {isSelected ? (
                              <UserRoundCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              {isInvalid ? (
                <FieldError errors={field.state.meta.errors} />
              ) : null}
            </Field>
          );
        }}
      </form.Field>

      {showPhoneField ? (
        <div className="space-y-3">
          <form.Field name="phoneNumber">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field className="space-y-2" data-invalid={isInvalid}>
                  <Label htmlFor={`${panelId}-temporary-patient-phone-number`}>
                    Telefonnummer
                  </Label>
                  <PhoneInput
                    aria-invalid={isInvalid}
                    id={`${panelId}-temporary-patient-phone-number`}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={handlePhoneNumberChange}
                    value={field.state.value}
                  />
                  {isInvalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              );
            }}
          </form.Field>

          <Button
            disabled={
              isCreatingTemporaryPatient ||
              draftPatient.name.trim().length === 0 ||
              draftPatient.phoneNumber.trim().length === 0
            }
            onClick={() => {
              form.setFieldValue("name", draftPatient.name);
              form.setFieldValue("phoneNumber", draftPatient.phoneNumber);
              void form.handleSubmit();
            }}
            type="button"
          >
            Erstellen
          </Button>
        </div>
      ) : null}
    </div>
  );
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
    case "empty": {
      return EMPTY_DRAFT;
    }
    case "selected": {
      return {
        name: getPatientInfoDisplayName(initialSelection.patient),
        phoneNumber: "",
      };
    }
    case "selectedById": {
      return EMPTY_DRAFT;
    }
  }
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
