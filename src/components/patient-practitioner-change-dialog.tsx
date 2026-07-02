"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";

import { Combobox } from "./combobox";

interface PatientPractitionerChangeDialogProps {
  onAssociated?: (() => void) | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  patientDisplayName: string;
  patientId: Id<"patients"> | undefined;
  practiceId: Id<"practices"> | undefined;
  ruleSetId: Id<"ruleSets"> | undefined;
  schedulingRuleSetId: Id<"ruleSets"> | undefined;
}

interface PractitionerComboboxOption {
  label: string;
  searchText: string;
  value: Id<"practitioners">;
}

export function PatientPractitionerChangeDialog({
  onAssociated,
  onOpenChange,
  open,
  patientDisplayName,
  patientId,
  practiceId,
  ruleSetId,
  schedulingRuleSetId,
}: PatientPractitionerChangeDialogProps) {
  const [
    manuallySelectedPractitionerLineageKey,
    setManuallySelectedPractitionerLineageKey,
  ] = React.useState<"" | Id<"practitioners"> | undefined>();
  const [isSaving, startSaving] = React.useTransition();
  const practitioners = useQuery(
    api.entities.getPractitioners,
    open && ruleSetId !== undefined ? { ruleSetId } : "skip",
  );
  const currentAssociation = useQuery(
    api.practitionerAssociations.getPreferredPractitionerAssociationForPatient,
    open && practiceId !== undefined && patientId !== undefined
      ? { patientId, practiceId }
      : "skip",
  );
  const setAssociation = useMutation(
    api.practitionerAssociations.setManualPractitionerAssociationForPatient,
  );

  const options = React.useMemo(
    (): PractitionerComboboxOption[] =>
      (practitioners ?? []).map((practitioner) => ({
        label: practitioner.name,
        searchText: practitioner.name,
        value: practitioner.lineageKey,
      })),
    [practitioners],
  );
  const selectedPractitionerLineageKey =
    manuallySelectedPractitionerLineageKey ??
    currentAssociation?.practitionerLineageKey ??
    "";
  const canSave =
    patientId !== undefined &&
    practiceId !== undefined &&
    schedulingRuleSetId !== undefined &&
    selectedPractitionerLineageKey.length > 0 &&
    !isSaving;

  const handleConfirm = () => {
    if (
      patientId === undefined ||
      practiceId === undefined ||
      schedulingRuleSetId === undefined ||
      selectedPractitionerLineageKey === "" ||
      isSaving
    ) {
      return;
    }

    startSaving(() => {
      void setAssociation({
        patientId,
        practiceId,
        practitionerLineageKey: selectedPractitionerLineageKey,
        ruleSetId: schedulingRuleSetId,
      })
        .then(() => {
          toast.success("Behandler wurde geändert.");
          onAssociated?.();
          handleOpenChange(false);
        })
        .catch(() => {
          toast.error("Der Behandler konnte nicht geändert werden.");
        });
    });
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setManuallySelectedPractitionerLineageKey(undefined);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Behandler ändern</DialogTitle>
          <DialogDescription>
            Wählen Sie den Behandler für {patientDisplayName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Combobox
            className="w-full"
            emptyMessage="Keine Behandler gefunden."
            onValueChange={(value) => {
              const selectedOption = options.find(
                (option) => option.value === value,
              );
              setManuallySelectedPractitionerLineageKey(
                selectedOption?.value ?? "",
              );
            }}
            options={options}
            placeholder={
              practitioners === undefined
                ? "Behandler werden geladen..."
                : "Behandler auswählen"
            }
            searchPlaceholder="Behandler suchen..."
            value={selectedPractitionerLineageKey}
          />

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {patientId === undefined
                ? "Patient zuerst speichern"
                : "Sind Sie sicher?"}
            </AlertTitle>
            <AlertDescription>
              {patientId === undefined
                ? "Der Behandler kann erst geändert werden, wenn ein gespeicherter Patient ausgewählt ist."
                : "Diese Änderung betrifft alle zukünftigen Termine dieses Patienten."}
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            disabled={isSaving}
            onClick={() => {
              handleOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Abbrechen
          </Button>
          <Button disabled={!canSave} onClick={handleConfirm} type="button">
            {isSaving ? "Speichern..." : "Bestätigen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
