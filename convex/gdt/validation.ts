import type {
  DateValidationResult,
  GdtField,
  GdtValidationResult,
} from "./types";

import { GDT_ERROR_TYPES, GDT_FIELD_IDS } from "./types";

/**
 * Validates and converts a date from DDMMYYYY to YYYY-MM-DD format.
 * Returns a DateValidationResult with either a converted date string or an error.
 */
export function isValidDate(date: string): DateValidationResult {
  if (!/^\d{8}$/.test(date)) {
    return {
      error: {
        message: "Date must be exactly 8 digits",
        type: GDT_ERROR_TYPES.INVALID_FORMAT,
      },
      isValid: false,
    };
  }

  const day = Number.parseInt(date.slice(0, 2), 10);
  const month = Number.parseInt(date.slice(2, 4), 10);
  const year = Number.parseInt(date.slice(4, 8), 10);

  // Basic range checks
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return {
      error: {
        message: "Invalid day or month values",
        type: GDT_ERROR_TYPES.INVALID_FORMAT,
      },
      isValid: false,
    };
  }

  // Check for valid year (allow historical dates but not future ones)
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) {
    return {
      error: {
        message: "Year must be between 1900 and current year",
        type: GDT_ERROR_TYPES.INVALID_FORMAT,
      },
      isValid: false,
    };
  }

  // Handle months with 30 days
  if ([4, 6, 9, 11].includes(month) && day > 30) {
    return {
      error: {
        message: "Invalid day for month",
        type: GDT_ERROR_TYPES.INVALID_FORMAT,
      },
      isValid: false,
    };
  }

  // Handle February
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (day > (isLeapYear ? 29 : 28)) {
      return {
        error: {
          message: "Invalid day for February",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      };
    }
  }

  // Convert to YYYY-MM-DD format
  return {
    isValid: true,
    value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** Parses a single GDT line into its components according to GDT specification. */
export function parseGdtLine(line: string): GdtField | null {
  if (line.length < 9) {
    return null;
  }

  const lengthStr = line.slice(0, 3);
  const fieldId = line.slice(3, 7);
  const content = line.slice(7).trim();

  const length = Number.parseInt(lengthStr, 10);
  if (Number.isNaN(length)) {
    return null;
  }

  return { content, fieldId, length };
}

/** Validates GDT content according to specification. */
export function validateGdtContent(gdtContent: string): GdtValidationResult {
  const lines = gdtContent
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      error: {
        message: "Empty GDT file",
        type: GDT_ERROR_TYPES.EMPTY_FILE,
      },
      isValid: false,
    };
  }

  const firstLineText = lines[0];
  if (!firstLineText) {
    return {
      error: {
        message: "First line is missing",
        type: GDT_ERROR_TYPES.INVALID_FORMAT,
      },
      isValid: false,
    };
  }

  const firstLine = parseGdtLine(firstLineText);
  if (!firstLine) {
    return {
      error: {
        message: "First line could not be parsed",
        type: GDT_ERROR_TYPES.PARSE_ERROR,
      },
      isValid: false,
    };
  }

  if (firstLine.fieldId !== GDT_FIELD_IDS.SATZ_START) {
    return {
      error: {
        field: "SATZ_START",
        message: "Missing or invalid Satzart",
        type: GDT_ERROR_TYPES.MISSING_FIELD,
      },
      isValid: false,
    };
  }

  const fields = lines
    .map((line) => parseGdtLine(line))
    .filter((f): f is GdtField => f !== null);
  const foundFields = new Set(fields.map((f) => f.fieldId));

  if (!foundFields.has(GDT_FIELD_IDS.PATIENT_ID)) {
    return {
      error: {
        field: "PATIENT_ID",
        message: "Missing patient ID (FK 3000)",
        type: GDT_ERROR_TYPES.MISSING_FIELD,
      },
      isValid: false,
    };
  }

  if (!foundFields.has(GDT_FIELD_IDS.TEST_PROCEDURE)) {
    return {
      error: {
        field: "TEST_PROCEDURE",
        message: "Missing test/procedure identifier (FK 8402)",
        type: GDT_ERROR_TYPES.MISSING_FIELD,
      },
      isValid: false,
    };
  }

  if (
    !foundFields.has(GDT_FIELD_IDS.VERSION) &&
    !foundFields.has(GDT_FIELD_IDS.VERSION_ALT)
  ) {
    return {
      error: {
        field: "VERSION",
        message: "Missing GDT version (FK 0001 or FK 9218)",
        type: GDT_ERROR_TYPES.MISSING_FIELD,
      },
      isValid: false,
    };
  }

  return { isValid: true };
}
