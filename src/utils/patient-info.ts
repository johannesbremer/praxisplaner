import type { Doc } from "../../convex/_generated/dataModel";
import type { PatientInfo } from "../types";

import { isIsoDateString } from "../../lib/typed-regex.js";

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

export function normalizePatientDateOfBirth(dateOfBirth?: string) {
  if (dateOfBirth === undefined) {
    return;
  }

  return isIsoDateString(dateOfBirth) ? dateOfBirth : undefined;
}

export function patientDocToInfo(patient: Doc<"patients">): PatientInfo {
  const dateOfBirth = normalizePatientDateOfBirth(patient.dateOfBirth);

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
}
