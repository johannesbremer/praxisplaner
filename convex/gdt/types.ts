import type { Doc } from "../_generated/dataModel";

// Error handling types
export interface GdtError {
  field?: keyof typeof GDT_FIELD_IDS;
  message: string;
  type: GdtErrorType;
}

export type GdtErrorType =
  (typeof GDT_ERROR_TYPES)[keyof typeof GDT_ERROR_TYPES];

// GDT parsing types
export interface GdtField {
  content: string;
  fieldId: string;
  length: number;
}

export interface GdtValidationError {
  error: GdtError;
  isValid: false;
}

export type GdtValidationResult = GdtValidationError | GdtValidationSuccess;

export interface GdtValidationSuccess {
  isValid: true;
}

// Database mutation result type
export type ProcessingResult =
  | {
      error: string;
      success: false;
    }
  | {
      isNewPatient: boolean;
      patientId: number;
      success: true;
    };

// Type alias for DocInput to use in insert operations
export type PatientInsertFields = Omit<
  Doc<"patients">,
  "_creationTime" | "_id"
>;

// Known GDT field IDs for type checking and documentation
export const GDT_FIELD_IDS = {
  // Patient identification fields
  BIRTH_DATE: "3103", // Birth date (TTMMJJJJ)
  CITY: "3106", // City
  FIRST_NAME: "3102", // First name
  LAST_NAME: "3101", // Last name
  PATIENT_ID: "3000", // Patient ID
  STREET: "3107", // Street address
  ZIP: "3105", // ZIP/Postal code

  // Message metadata fields
  RECEIVER_ID: "8315", // Receiver ID
  SATZ_END: "8001", // Satzende
  SATZ_START: "8000", // Satzart
  SENDER_ID: "8316", // Sender ID
  VERSION: "0001", // Standard version field
  VERSION_ALT: "9218", // Alternative version field for older formats

  // Test/Examination fields
  EXAM_DATE: "7620", // Date of examination (TTMMJJJJ)
  TEST_DESC: "6220", // Test/examination description
  TEST_PROCEDURE: "8402", // Test/procedure identifier
  TEST_REF: "6201", // Test number/reference
} as const;

export const GDT_ERROR_TYPES = {
  EMPTY_FILE: "EMPTY_FILE",
  INVALID_FORMAT: "INVALID_FORMAT",
  MISSING_FIELD: "MISSING_FIELD",
  PARSE_ERROR: "PARSE_ERROR",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
} as const;
