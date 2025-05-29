import type { Doc } from "../_generated/dataModel";
import type { GdtField, PatientInsertFields } from "./types";

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

/** Extracts and transforms GDT fields into Convex document format. */
type ProcessedFileInput = Omit<
  Doc<"processedGdtFiles">,
  "_creationTime" | "_id"
>;

export function extractPatientData(
  fields: GdtField[],
): Omit<PatientInsertFields, "createdAt" | "lastModified" | "sourceGdtFileId"> {
  // Initialize with required fields
  const patientData: Omit<
    PatientInsertFields,
    "createdAt" | "lastModified" | "sourceGdtFileId"
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
      case GDT_FIELD_IDS.CITY:
        patientData.city = field.content;
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
        patientData.street = field.content;
        break;
      case GDT_FIELD_IDS.VERSION:
      case GDT_FIELD_IDS.VERSION_ALT:
        patientData.gdtVersion = field.content;
        break;
    }
  }

  return patientData;
}

/** Creates a new processed GDT file record from parsed fields. */
export function createProcessedFileRecord(
  args: {
    fileContent: string;
    fileName: string;
    gdtParsedSuccessfully: boolean;
    processingErrorMessage?: string;
    sourceDirectoryName: string;
  },
  patientData?: Omit<
    PatientInsertFields,
    "createdAt" | "lastModified" | "sourceGdtFileId"
  >,
): ProcessedFileInput {
  const baseRecord: Partial<ProcessedFileInput> = {
    fileContent: args.fileContent,
    fileName: args.fileName,
    gdtParsedSuccessfully: args.gdtParsedSuccessfully,
    processedAt: BigInt(Date.now()),
    sourceDirectoryName: args.sourceDirectoryName,
  };

  if (args.processingErrorMessage) {
    baseRecord.processingErrorMessage = args.processingErrorMessage;
  }

  if (patientData) {
    if (patientData.gdtVersion) {
      baseRecord.gdtVersion = patientData.gdtVersion;
    }
    if (patientData.dateOfBirth) {
      baseRecord.examDate = patientData.dateOfBirth;
    }
    if (patientData.gdtSenderId) {
      baseRecord.testReference = patientData.gdtSenderId;
    }
  }

  // We know this satisfies the type due to the schema definition
  return baseRecord as ProcessedFileInput;
}
