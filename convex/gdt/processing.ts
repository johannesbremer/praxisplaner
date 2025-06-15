import type { GdtField, PatientInsertFields } from "./types";

import { GDT_FIELD_IDS } from "./types";
import { isValidDate, parseGdtLine } from "./validation";

/** Parses the entire GDT file content into an array of GdtField objects. */
export function parseGdtContent(content: string): GdtField[] {
  const fields: GdtField[] = [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");

  // Find Satzart for Satzende
  const firstLineText = lines[0]?.trim() ?? "";
  const firstField = firstLineText ? parseGdtLine(firstLineText) : null;
  const satzartContent = firstField?.content || "6310";

  fields.push(
    ...lines
      .filter((line) => line.trim())
      .map((line) => parseGdtLine(line))
      .filter((f): f is GdtField => f !== null),
  );

  // Add Satzende if needed
  const lastField = fields[fields.length - 1];
  if (!lastField || lastField.fieldId !== GDT_FIELD_IDS.SATZ_END) {
    fields.push({
      content: satzartContent,
      fieldId: GDT_FIELD_IDS.SATZ_END,
      length: 13,
    });
  }

  return fields;
}

/** Extracts and transforms GDT fields into patient data format. */
export function extractPatientData(
  fields: GdtField[],
): Omit<
  PatientInsertFields,
  "createdAt" | "lastModified" | "sourceGdtFileName"
> {
  // Initialize with required fields
  const patientData: Omit<
    PatientInsertFields,
    "createdAt" | "lastModified" | "sourceGdtFileName"
  > = {
    patientId: 0,
  };

  // GDT field mapping with field-specific validation/transformation
  for (const field of fields) {
    switch (field.fieldId) {
      case GDT_FIELD_IDS.BIRTH_DATE: {
        const dateResult = isValidDate(field.content);
        if (dateResult.isValid) {
          patientData.dateOfBirth = dateResult.value;
        }
        break;
      }
      case GDT_FIELD_IDS.CITY: {
        patientData.city = field.content;
        break;
      }
      case GDT_FIELD_IDS.FIRST_NAME: {
        patientData.firstName = field.content;
        break;
      }
      case GDT_FIELD_IDS.LAST_NAME: {
        patientData.lastName = field.content;
        break;
      }
      case GDT_FIELD_IDS.PATIENT_ID: {
        const parsedId = Number.parseInt(field.content.trim(), 10);
        if (!Number.isNaN(parsedId)) {
          patientData.patientId = parsedId;
        }
        break;
      }
      case GDT_FIELD_IDS.STREET: {
        patientData.street = field.content;
        break;
      }
    }
  }

  return patientData;
}
