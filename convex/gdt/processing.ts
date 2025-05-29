import type { GdtField, PatientData } from "./types";

import { GDT_FIELD_IDS } from "./types";
import { isValidDate, parseGdtLine } from "./validation";

/** Parses the entire GDT file content into an array of GdtField objects. */
export function parseGdtContent(content: string): GdtField[] {
  const fields: GdtField[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  // Find Satzart for Satzende
  const firstLineText = lines[0]?.trim() ?? "";
  const firstField = firstLineText ? parseGdtLine(firstLineText) : null;
  const satzartContent = firstField?.content || "6310";

  fields.push(
    ...lines
      .filter((line) => line.trim())
      .map(parseGdtLine)
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

/** Extracts patient-related data from GDT fields. */
export function extractPatientData(fields: GdtField[]): PatientData {
  const patientData: PatientData = {
    patientId: 0,
  };

  // Address components
  let street: string | undefined;
  let city: string | undefined;

  for (const field of fields) {
    switch (field.fieldId) {
      case GDT_FIELD_IDS.BIRTH_DATE:
        if (isValidDate(field.content)) {
          patientData.dateOfBirth = field.content;
        }
        break;
      case GDT_FIELD_IDS.CITY:
        city = field.content;
        break;
      case GDT_FIELD_IDS.EXAM_DATE:
        patientData.examDate = field.content;
        break;
      case GDT_FIELD_IDS.FIRST_NAME:
        patientData.firstName = field.content;
        break;
      case GDT_FIELD_IDS.LAST_NAME:
        patientData.lastName = field.content;
        break;
      case GDT_FIELD_IDS.PATIENT_ID: {
        const parsedId = parseInt(field.content.trim(), 10);
        if (!isNaN(parsedId)) {
          patientData.patientId = parsedId;
        }
        break;
      }
      case GDT_FIELD_IDS.RECEIVER_ID:
        patientData.gdtReceiverId = field.content;
        break;
      case GDT_FIELD_IDS.SENDER_ID:
        patientData.gdtSenderId = field.content;
        break;
      case GDT_FIELD_IDS.STREET:
        street = field.content;
        break;
      case GDT_FIELD_IDS.TEST_DESC:
        patientData.testDescription = field.content;
        break;
      case GDT_FIELD_IDS.TEST_PROCEDURE:
        patientData.testProcedure = field.content;
        break;
      case GDT_FIELD_IDS.TEST_REF:
        patientData.testReference = field.content;
        break;
      case GDT_FIELD_IDS.VERSION:
      case GDT_FIELD_IDS.VERSION_ALT:
        patientData.gdtVersion = field.content;
        break;
      case GDT_FIELD_IDS.ZIP:
        // ZIP code is not used in the current schema
        break;
    }
  }

  // Set address fields directly
  if (street) {
    patientData.street = street;
  }
  if (city) {
    patientData.city = city;
  }

  return patientData;
}
