import { err, ok, Result } from "neverthrow";

import type { Doc } from "../../convex/_generated/dataModel";
import type { IsoDateString } from "../../lib/typed-regex";
import type { PatientInfo } from "../types";

import { isIsoDateString } from "../../lib/typed-regex.js";
import { captureFrontendError, invalidStateError } from "./frontend-errors";

export function formatPatientOptionLabel(patient: Doc<"patients">): string {
  const name = getPatientDocumentName(patient);

  const descriptor =
    patient.recordType === "temporary"
      ? "Temporär"
      : patient.patientId === undefined
        ? "PVS"
        : `PVS ${patient.patientId}`;

  return name.length > 0 ? `${name} · ${descriptor}` : descriptor;
}

export function getPatientDocumentName(
  patient: Pick<
    Doc<"patients">,
    "firstName" | "lastName" | "name" | "recordType"
  >,
): string {
  if (patient.recordType === "temporary") {
    return (
      patient.name?.trim() ??
      [patient.firstName, patient.lastName].filter(Boolean).join(" ")
    );
  }

  return [patient.firstName, patient.lastName].filter(Boolean).join(" ");
}

export function getPatientInfoDisplayName(patient: PatientInfo): string {
  if (patient.recordType === "temporary") {
    return (
      patient.name.trim() ||
      [patient.firstName, patient.lastName].filter(Boolean).join(" ")
    );
  }

  const parts = [patient.title, patient.firstName, patient.lastName].filter(
    Boolean,
  );
  if (parts.length > 0) {
    return parts.join(" ");
  }

  if (patient.patientId !== undefined) {
    return `Patient ${patient.patientId}`;
  }

  return patient.email ?? "";
}

export function parseOptionalPatientDateOfBirth(params: {
  dateOfBirth: string | undefined;
  patientLabel: string;
  source: string;
}): Result<IsoDateString | undefined, ReturnType<typeof invalidStateError>> {
  if (params.dateOfBirth === undefined) {
    return ok(params.dateOfBirth);
  }

  if (isIsoDateString(params.dateOfBirth)) {
    return ok(params.dateOfBirth);
  }

  const error = invalidStateError(
    `${params.patientLabel} hat ein ungültiges dateOfBirth: "${params.dateOfBirth}".`,
    params.source,
  );
  captureFrontendError(
    error,
    {
      context: "patient_date_of_birth_invalid",
      patientLabel: params.patientLabel,
      source: params.source,
    },
    `${params.source}:${params.patientLabel}:dateOfBirth`,
  );
  return err(error);
}

export function patientDocToInfo(
  patient: Doc<"patients">,
): Result<PatientInfo, ReturnType<typeof invalidStateError>> {
  return parseOptionalPatientDateOfBirth({
    dateOfBirth: patient.dateOfBirth,
    patientLabel: `patient:${patient._id}`,
    source: "patientDocToInfo",
  }).map((dateOfBirth) => {
    if (patient.recordType === "temporary") {
      return {
        ...(patient.city !== undefined && { city: patient.city }),
        convexPatientId: patient._id,
        ...(dateOfBirth !== undefined && { dateOfBirth }),
        isNewPatient: false,
        name:
          patient.name ??
          [patient.firstName, patient.lastName].filter(Boolean).join(" "),
        phoneNumber: patient.phoneNumber ?? "",
        recordType: "temporary",
        ...(patient.street !== undefined && { street: patient.street }),
      };
    }

    return {
      ...(patient.city !== undefined && { city: patient.city }),
      convexPatientId: patient._id,
      ...(dateOfBirth !== undefined && { dateOfBirth }),
      ...(patient.firstName !== undefined && { firstName: patient.firstName }),
      isNewPatient: false,
      ...(patient.lastName !== undefined && { lastName: patient.lastName }),
      ...(patient.patientId !== undefined && { patientId: patient.patientId }),
      ...(patient.phoneNumber !== undefined && {
        phoneNumber: patient.phoneNumber,
      }),
      recordType: "pvs",
      ...(patient.street !== undefined && { street: patient.street }),
    };
  });
}
