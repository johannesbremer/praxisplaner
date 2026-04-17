import type { Doc } from "../../convex/_generated/dataModel";
import type { PatientInfo } from "../types";

export function formatPatientOptionLabel(patient: Doc<"patients">): string {
  const name = [patient.firstName, patient.lastName].filter(Boolean).join(" ");

  const descriptor =
    patient.recordType === "temporary"
      ? "Temporär"
      : patient.patientId === undefined
        ? "PVS"
        : `PVS ${patient.patientId}`;

  return name.length > 0 ? `${name} · ${descriptor}` : descriptor;
}

export function patientDocToInfo(patient: Doc<"patients">): PatientInfo {
  if (patient.recordType === "temporary") {
    return {
      ...(patient.city !== undefined && { city: patient.city }),
      convexPatientId: patient._id,
      ...(patient.dateOfBirth !== undefined && {
        dateOfBirth: patient.dateOfBirth,
      }),
      firstName: patient.firstName ?? "",
      isNewPatient: false,
      lastName: patient.lastName ?? "",
      phoneNumber: patient.phoneNumber ?? "",
      recordType: "temporary",
      ...(patient.street !== undefined && { street: patient.street }),
    };
  }

  return {
    ...(patient.city !== undefined && { city: patient.city }),
    convexPatientId: patient._id,
    ...(patient.dateOfBirth !== undefined && {
      dateOfBirth: patient.dateOfBirth,
    }),
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
