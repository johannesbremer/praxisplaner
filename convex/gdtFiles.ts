import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// =============================================================================
// Types & Constants
// =============================================================================

interface GdtField {
  content: string;
  fieldId: string;
  length: number;
}

interface GdtValidationError {
  error: GdtError;
  isValid: false;
}

type GdtValidationResult = GdtValidationError | GdtValidationSuccess;

interface GdtValidationSuccess {
  isValid: true;
}

interface PatientData {
  // Patient identification fields (from GDT)
  city?: string; // FK 3106
  dateOfBirth?: string; // FK 3103
  firstName?: string; // FK 3102
  lastName?: string; // FK 3101
  patientId: number; // FK 3000
  street?: string; // FK 3107

  // Test information
  examDate?: string; // FK 7620
  testDescription?: string; // FK 6220
  testProcedure?: string; // FK 8402
  testReference?: string; // FK 6201

  // GDT metadata
  gdtReceiverId?: string; // FK 8315
  gdtSenderId?: string; // FK 8316
  gdtVersion?: string; // FK 9218 or FK 0001
}

type ProcessingResult =
  | {
      error: string;
      success: false;
    }
  | {
      isNewPatient: boolean;
      patientId: number;
      success: true;
    };

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

/** Validates whether a string conforms to the TTMMJJJJ date format as used in GDT files. */
function isValidDate(date: string): boolean {
  if (!/^\d{8}$/.test(date)) {
    return false;
  }

  const day = parseInt(date.substring(0, 2), 10);
  const month = parseInt(date.substring(2, 4), 10);
  const year = parseInt(date.substring(4, 8), 10);

  // Basic range checks
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  // Check for valid year (allow historical dates but not future ones)
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) {
    return false;
  }

  // Handle months with 30 days
  if ([4, 6, 9, 11].includes(month) && day > 30) {
    return false;
  }

  // Handle February
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (day > (isLeapYear ? 29 : 28)) {
      return false;
    }
  }

  return true;
}

/** Parses a single GDT line into its components according to GDT specification. */
function parseGdtLine(line: string): GdtField | null {
  if (line.length < 9) {
    return null;
  }

  const lengthStr = line.slice(0, 3);
  const fieldId = line.slice(3, 7);
  const content = line.slice(7).trim();

  const length = parseInt(lengthStr, 10);
  if (isNaN(length)) {
    return null;
  }

  return { content, fieldId, length };
}

/** Parses the entire GDT file content into an array of GdtField objects. */
function parseGdtContent(content: string): GdtField[] {
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
function extractPatientData(fields: GdtField[]): PatientData {
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

/** Typed errors that can occur during GDT processing */
const GDT_ERROR_TYPES = {
  EMPTY_FILE: "EMPTY_FILE",
  INVALID_FORMAT: "INVALID_FORMAT",
  MISSING_FIELD: "MISSING_FIELD",
  PARSE_ERROR: "PARSE_ERROR",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
} as const;

interface GdtError {
  field?: keyof typeof GDT_FIELD_IDS;
  message: string;
  type: GdtErrorType;
}

type GdtErrorType = (typeof GDT_ERROR_TYPES)[keyof typeof GDT_ERROR_TYPES];

/** Validates GDT content according to specification. */
function validateGdtContent(gdtContent: string): GdtValidationResult {
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
    .map(parseGdtLine)
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

// =============================================================================
// Database Mutations
// =============================================================================

/** Process and store a GDT file along with any patient data it contains. */
export const addProcessedFile = mutation({
  args: v.object({
    fileContent: v.string(),
    fileName: v.string(),
    gdtParsedSuccessfully: v.optional(v.boolean()),
    processingErrorMessage: v.optional(v.string()),
    sourceDirectoryName: v.string(),
  }),
  handler: async (ctx, args): Promise<ProcessingResult> => {
    try {
      const validationResult = validateGdtContent(args.fileContent);
      if (!validationResult.isValid) {
        await ctx.db.insert("processedGdtFiles", {
          fileContent: args.fileContent,
          fileName: args.fileName,
          gdtParsedSuccessfully: false,
          processedAt: BigInt(Date.now()),
          processingErrorMessage: validationResult.error.message,
          sourceDirectoryName: args.sourceDirectoryName,
        });
        return { error: validationResult.error.message, success: false };
      }

      // Parse and extract data
      const gdtFields = parseGdtContent(args.fileContent);
      const patientData = extractPatientData(gdtFields);

      // Store the GDT file
      const gdtFileId = await ctx.db.insert("processedGdtFiles", {
        fileContent: args.fileContent,
        fileName: args.fileName,
        gdtParsedSuccessfully: true,
        processedAt: BigInt(Date.now()),
        sourceDirectoryName: args.sourceDirectoryName,
        ...(patientData.gdtVersion && { gdtVersion: patientData.gdtVersion }),
        ...(patientData.examDate && { examDate: patientData.examDate }),
        ...(patientData.testReference && {
          testReference: patientData.testReference,
        }),
        ...(patientData.testDescription && {
          testDescription: patientData.testDescription,
        }),
        ...(patientData.testProcedure && {
          testProcedure: patientData.testProcedure,
        }),
      });

      // Check if patient exists
      const existingPatient = await ctx.db
        .query("patients")
        .withIndex("by_patientId", (q) =>
          q.eq("patientId", patientData.patientId),
        )
        .first();

      const now = BigInt(Date.now());

      if (!existingPatient) {
        // Create new patient
        await ctx.db.insert("patients", {
          createdAt: now,
          lastModified: now,
          patientId: patientData.patientId,
          sourceGdtFileId: gdtFileId,
          ...(patientData.firstName && { firstName: patientData.firstName }),
          ...(patientData.lastName && { lastName: patientData.lastName }),
          ...(patientData.dateOfBirth && {
            dateOfBirth: patientData.dateOfBirth,
          }),
          ...(patientData.street && { street: patientData.street }),
          ...(patientData.city && { city: patientData.city }),
          ...(patientData.gdtSenderId && {
            gdtSenderId: patientData.gdtSenderId,
          }),
          ...(patientData.gdtReceiverId && {
            gdtReceiverId: patientData.gdtReceiverId,
          }),
          ...(patientData.gdtVersion && { gdtVersion: patientData.gdtVersion }),
        });

        return {
          isNewPatient: true,
          patientId: patientData.patientId,
          success: true,
        };
      }

      // Update existing patient with type-safe field updates
      const updates: Record<string, unknown> = {
        lastModified: now,
        ...(patientData.firstName && { firstName: patientData.firstName }),
        ...(patientData.lastName && { lastName: patientData.lastName }),
        ...(patientData.dateOfBirth && {
          dateOfBirth: patientData.dateOfBirth,
        }),
        ...(patientData.street && { street: patientData.street }),
        ...(patientData.city && { city: patientData.city }),
        ...(patientData.gdtSenderId && {
          gdtSenderId: patientData.gdtSenderId,
        }),
        ...(patientData.gdtReceiverId && {
          gdtReceiverId: patientData.gdtReceiverId,
        }),
        ...(patientData.gdtVersion && { gdtVersion: patientData.gdtVersion }),
      };

      await ctx.db.patch(existingPatient._id, updates);

      return {
        isNewPatient: false,
        patientId: patientData.patientId,
        success: true,
      };
    } catch (error) {
      // Log and store any unexpected errors
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error processing GDT file";
      await ctx.db.insert("processedGdtFiles", {
        fileContent: args.fileContent,
        fileName: args.fileName,
        gdtParsedSuccessfully: false,
        processedAt: BigInt(Date.now()),
        processingErrorMessage: errorMessage,
        sourceDirectoryName: args.sourceDirectoryName,
      });
      return { error: errorMessage, success: false };
    }
  },
});

// =============================================================================
// Database Queries
// =============================================================================

/** Get the most recently processed GDT files */
export const getRecentProcessedFiles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db.query("processedGdtFiles").order("desc").take(limit);
  },
});

/** List patients with flexible ordering options */
export const listPatients = query({
  args: {
    limit: v.optional(v.number()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    orderBy: v.optional(
      v.union(v.literal("createdAt"), v.literal("lastModified")),
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const orderBy = args.orderBy ?? "lastModified";
    const order = args.order ?? "desc";

    return await ctx.db
      .query("patients")
      .withIndex(
        orderBy === "lastModified" ? "by_lastModified" : "by_createdAt",
      )
      .order(order)
      .take(limit);
  },
});
