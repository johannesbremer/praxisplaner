// convex/gdtFiles.ts
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// GDT field types based on the specification
interface GdtField {
  content: string;
  fieldId: string;
  length: number;
}

// Known GDT field IDs for type checking and documentation
export const GDT_FIELD_IDS = {
  // Patient identification fields
  BIRTH_DATE: "3103", // Birth date (TTMMJJJJ)
  CITY: "3106", // City
  FIRST_NAME: "3102", // First name
  GENDER: "3110", // Gender (M/W/D/X)
  INSURANCE_NUMBER: "3105", // Insurance number
  LAST_NAME: "3101", // Last name
  PATIENT_ID: "3000", // Patient ID
  PHONE: "3626", // Phone number
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
  EXAM_DATE: "7620",
  TEST_DESC: "6220",
  TEST_IDENT: "8410", // Test identifier
  TEST_NAME: "8411", // Test name
  TEST_PROCEDURE: "8402",
  TEST_REF: "6201",
  TEST_RESULT: "8420", // Test result value
  TEST_UNIT: "8421", // Test unit
} as const;

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

// Gender types according to GDT specification
type GdtGender = "D" | "M" | "W" | "X";

/** Validates whether a string represents a valid GDT gender value. */
function isValidGender(gender: string): gender is GdtGender {
  return ["D", "M", "W", "X"].includes(gender);
}

/** Validates whether a string conforms to the TTMMJJJJ date format as used in GDT files. */
function isValiddateOfBirth(date: string): boolean {
  // Check basic format first
  if (!/^\d{8}$/.test(date)) {
    return false;
  }

  const day = parseInt(date.substring(0, 2), 10);
  const month = parseInt(date.substring(2, 4), 10);
  const year = parseInt(date.substring(4, 8), 10);

  // Basic range checks first
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

  // If we get here, create a Date object for final validation
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/** Parses a single GDT line into its components according to GDT 3.5 specification. */
function parseGdtLine(line: string): GdtField | null {
  if (line.length < 9) {
    return null;
  } // Minimum length for a valid GDT line

  const lengthStr = line.slice(0, 3);
  const fieldId = line.slice(3, 7);
  const content = line.slice(7).trim();

  const length = parseInt(lengthStr, 10);
  if (isNaN(length)) {
    return null;
  }

  return { content, fieldId, length };
}

/** Parses the entire GDT file content into an array of GdtField objects and validates structure. */
function parseGdtContent(content: string): GdtField[] {
  const fields: GdtField[] = [];
  // Support both CRLF and LF line endings by normalizing to LF
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  // Find Satzart for later use with Satzende
  let satzartContent = "";
  const firstLine = lines[0]?.trim();
  if (firstLine) {
    const firstField = parseGdtLine(firstLine);
    if (firstField?.fieldId === GDT_FIELD_IDS.SATZ_START) {
      satzartContent = firstField.content;
    }
  }

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const field = parseGdtLine(line);
    if (!field) {
      continue;
    }
    fields.push(field);
  }

  // Check and fix Satzende if needed
  const lastField = fields[fields.length - 1];
  if (!lastField || lastField.fieldId !== GDT_FIELD_IDS.SATZ_END) {
    // Add proper Satzende field (length 13 = 9 + content length "6310")
    fields.push({
      content: satzartContent || "6310",
      fieldId: GDT_FIELD_IDS.SATZ_END,
      length: 13,
    });
  }

  return fields;
}

// Extract patient data from GDT content
interface PatientData {
  // Patient identification fields
  address?: string;
  dateOfBirth?: string;
  firstName?: string;
  gender?: string;
  insuranceNumber?: string;
  lastName?: string;
  patientId: number;
  phone?: string;
  title?: string;

  // Test information
  examDate?: string; // FK 7620
  testDescription?: string; // FK 6220
  testProcedure?: string; // FK 8402
  testReference?: string; // FK 6201

  // GDT metadata
  gdtReceiverId?: string;
  gdtSenderId?: string;
  gdtVersion?: string;
}

/** Extracts patient-related data from GDT content according to GDT 3.5 specification. */
function extractPatientData(fields: GdtField[]): PatientData {
  const patientData: PatientData = {
    patientId: 0, // Will be set from FK 3000
  };

  // Temporary variables for address construction
  let street: string | undefined;
  let city: string | undefined;
  let zip: string | undefined;

  for (const field of fields) {
    switch (field.fieldId) {
      case GDT_FIELD_IDS.BIRTH_DATE:
        if (/^\d{8}$/.test(field.content)) {
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
      case GDT_FIELD_IDS.GENDER:
        if (isValidGender(field.content)) {
          patientData.gender = field.content;
        }
        break;
      case GDT_FIELD_IDS.INSURANCE_NUMBER:
        patientData.insuranceNumber = field.content;
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
      case GDT_FIELD_IDS.PHONE:
        patientData.phone = field.content;
        break;
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
        zip = field.content;
        break;
    }
  }

  // Build address from components
  const addressParts: string[] = [];
  if (street) {
    addressParts.push(street);
  }
  if (zip || city) {
    const locationParts = [zip, city].filter(Boolean);
    addressParts.push(locationParts.join(" "));
  }
  if (addressParts.length > 0) {
    patientData.address = addressParts.join(", ");
  }

  return patientData;
}

/** Validates GDT content according to GDT 3.5 specification, with some leniency for older formats. */
function validateGdtContent(
  gdtContent: string,
): { error: string; isValid: false } | { isValid: true } {
  // Remove trailing newlines/spaces and split
  const lines = gdtContent
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  // Check if file has content
  if (lines.length === 0) {
    return { error: "Empty GDT file", isValid: false };
  }

  const firstLineContent = lines[0];
  if (!firstLineContent) {
    return {
      error: "Invalid GDT file: First line is missing",
      isValid: false,
    };
  }

  const firstLine = parseGdtLine(firstLineContent);
  if (!firstLine) {
    return {
      error: "Invalid GDT file: First line could not be parsed",
      isValid: false,
    };
  }

  if (firstLine.fieldId !== GDT_FIELD_IDS.SATZ_START) {
    return {
      error: "Invalid GDT file: Missing or invalid Satzart",
      isValid: false,
    };
  }

  // Check for mandatory fields
  const fields = lines
    .map(parseGdtLine)
    .filter((f): f is GdtField => f !== null);
  const foundFields = new Set(fields.map((f) => f.fieldId));

  // Check mandatory patient ID
  if (!foundFields.has(GDT_FIELD_IDS.PATIENT_ID)) {
    return {
      error: "Invalid GDT file: Missing patient ID (FK 3000)",
      isValid: false,
    };
  }

  // Check for test/procedure identifier
  if (!foundFields.has(GDT_FIELD_IDS.TEST_PROCEDURE)) {
    return {
      error: "Invalid GDT file: Missing test/procedure identifier (FK 8402)",
      isValid: false,
    };
  }

  // More lenient version check - accept either FK 0001 or FK 9218 for version
  if (!foundFields.has(GDT_FIELD_IDS.VERSION) && !foundFields.has("9218")) {
    return {
      error: "Invalid GDT file: Missing GDT version (FK 0001 or FK 9218)",
      isValid: false,
    };
  }

  // All validations passed
  return { isValid: true };
}

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
    // First validate the GDT content
    const validationResult = validateGdtContent(args.fileContent);

    if (!validationResult.isValid) {
      // Store invalid file with error
      await ctx.db.insert("processedGdtFiles", {
        fileContent: args.fileContent,
        fileName: args.fileName,
        gdtParsedSuccessfully: false,
        processedAt: BigInt(Date.now()),
        processingErrorMessage: validationResult.error,
        sourceDirectoryName: args.sourceDirectoryName,
      });
      return { error: validationResult.error, success: false };
    }

    // Parse and extract data
    const gdtFields = parseGdtContent(args.fileContent);
    const patientData = extractPatientData(gdtFields);

    // Validate gender if present
    if (patientData.gender && !isValidGender(patientData.gender)) {
      const error = `Invalid gender value: ${patientData.gender}. Must be one of: M, W, D, X`;
      await ctx.db.insert("processedGdtFiles", {
        fileContent: args.fileContent,
        fileName: args.fileName,
        gdtParsedSuccessfully: false,
        processedAt: BigInt(Date.now()),
        processingErrorMessage: error,
        sourceDirectoryName: args.sourceDirectoryName,
      });
      return { error, success: false };
    }

    // Validate birth date if present
    if (
      patientData.dateOfBirth &&
      !isValiddateOfBirth(patientData.dateOfBirth)
    ) {
      const error = `Invalid birth date format: ${patientData.dateOfBirth}. Must be TTMMJJJJ`;
      await ctx.db.insert("processedGdtFiles", {
        fileContent: args.fileContent,
        fileName: args.fileName,
        gdtParsedSuccessfully: false,
        processedAt: BigInt(Date.now()),
        processingErrorMessage: error,
        sourceDirectoryName: args.sourceDirectoryName,
      });
      return { error, success: false };
    }

    // Store the GDT file with additional fields
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

    // Check if patient already exists
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) =>
        q.eq("patientId", patientData.patientId),
      )
      .first();

    const now = BigInt(Date.now());

    if (!existingPatient) {
      // Create new patient with required fields and explicit optional fields
      await ctx.db.insert("patients", {
        createdAt: now,
        lastModified: now,
        patientId: patientData.patientId,
        sourceGdtFileId: gdtFileId,
        // Optional fields are only included if they have a non-undefined value
        ...(patientData.firstName && { firstName: patientData.firstName }),
        ...(patientData.lastName && { lastName: patientData.lastName }),
        ...(patientData.dateOfBirth && {
          dateOfBirth: patientData.dateOfBirth,
        }),
        ...(patientData.gender && { gender: patientData.gender }),
        ...(patientData.address && { address: patientData.address }),
        ...(patientData.phone && { phone: patientData.phone }),
        ...(patientData.insuranceNumber && {
          insuranceNumber: patientData.insuranceNumber,
        }),
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

    // Update existing patient fields only if they are provided in the GDT file
    const updates: Record<string, unknown> = {
      lastModified: now,
    };

    if (patientData.firstName) {
      updates["firstName"] = patientData.firstName;
    }
    if (patientData.lastName) {
      updates["lastName"] = patientData.lastName;
    }
    if (patientData.dateOfBirth) {
      updates["dateOfBirth"] = patientData.dateOfBirth;
    }
    if (patientData.gender) {
      updates["gender"] = patientData.gender;
    }
    if (patientData.address) {
      updates["address"] = patientData.address;
    }
    if (patientData.phone) {
      updates["phone"] = patientData.phone;
    }
    if (patientData.insuranceNumber) {
      updates["insuranceNumber"] = patientData.insuranceNumber;
    }
    if (patientData.gdtSenderId) {
      updates["gdtSenderId"] = patientData.gdtSenderId;
    }
    if (patientData.gdtReceiverId) {
      updates["gdtReceiverId"] = patientData.gdtReceiverId;
    }
    if (patientData.gdtVersion) {
      updates["gdtVersion"] = patientData.gdtVersion;
    }

    await ctx.db.patch(existingPatient._id, updates);

    return {
      isNewPatient: false,
      patientId: patientData.patientId,
      success: true,
    };
  },
});

/** Get the most recently processed GDT files */
export const getRecentProcessedFiles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20; // Default for display
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

/** Upload and process a GDT file, creating or updating patient records as necessary */
export const uploadGdtFile = mutation({
  args: {
    fileContent: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not logged in");
    }

    // First validate the GDT content
    const validationResult = validateGdtContent(args.fileContent);

    if (!validationResult.isValid) {
      throw new Error(`Invalid GDT file: ${validationResult.error}`);
    }

    // Store the GDT file first to get its ID
    const gdtFileId = await ctx.db.insert("processedGdtFiles", {
      fileContent: args.fileContent,
      fileName: "upload.gdt", // Default name for uploaded files
      gdtParsedSuccessfully: true,
      processedAt: BigInt(Date.now()),
      sourceDirectoryName: "upload", // Default directory for uploaded files
    });

    // Parse and extract patient data
    const gdtFields = parseGdtContent(args.fileContent);
    const patientData = extractPatientData(gdtFields);

    // Ensure required fields are present
    if (!patientData.patientId) {
      throw new Error("No patient ID found in GDT file");
    }

    // Validate any optional fields
    if (patientData.gender && !isValidGender(patientData.gender)) {
      throw new Error(
        `Invalid gender value: ${patientData.gender}. Must be one of: M, W, D, X`,
      );
    }

    if (
      patientData.dateOfBirth &&
      !isValiddateOfBirth(patientData.dateOfBirth)
    ) {
      throw new Error(
        `Invalid birth date format: ${patientData.dateOfBirth}. Must be TTMMJJJJ`,
      );
    }

    const now = BigInt(Date.now());

    // Check if patient already exists
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) =>
        q.eq("patientId", patientData.patientId),
      )
      .first();

    if (existingPatient) {
      // Update existing patient with type-safe updates
      const updates: Record<string, unknown> = {
        lastModified: now,
      };

      if (patientData.firstName) {
        updates["firstName"] = patientData.firstName;
      }
      if (patientData.lastName) {
        updates["lastName"] = patientData.lastName;
      }
      if (patientData.dateOfBirth) {
        updates["dateOfBirth"] = patientData.dateOfBirth;
      }
      if (patientData.gender) {
        updates["gender"] = patientData.gender;
      }
      if (patientData.address?.trim()) {
        updates["address"] = patientData.address;
      }
      if (patientData.insuranceNumber?.trim()) {
        updates["insuranceNumber"] = patientData.insuranceNumber;
      }
      if (patientData.phone?.trim()) {
        updates["phone"] = patientData.phone;
      }
      if (patientData.gdtReceiverId?.trim()) {
        updates["gdtReceiverId"] = patientData.gdtReceiverId;
      }
      if (patientData.gdtSenderId?.trim()) {
        updates["gdtSenderId"] = patientData.gdtSenderId;
      }
      if (patientData.gdtVersion?.trim()) {
        updates["gdtVersion"] = patientData.gdtVersion;
      }

      await ctx.db.patch(existingPatient._id, updates);

      return {
        isNewPatient: false,
        patientId: patientData.patientId,
        success: true,
      };
    }

    // Create new patient with all available fields
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
      ...(patientData.gender && { gender: patientData.gender }),
      ...(patientData.address?.trim() && { address: patientData.address }),
      ...(patientData.insuranceNumber?.trim() && {
        insuranceNumber: patientData.insuranceNumber,
      }),
      ...(patientData.phone?.trim() && { phone: patientData.phone }),
      ...(patientData.gdtReceiverId?.trim() && {
        gdtReceiverId: patientData.gdtReceiverId,
      }),
      ...(patientData.gdtSenderId?.trim() && {
        gdtSenderId: patientData.gdtSenderId,
      }),
      ...(patientData.gdtVersion?.trim() && {
        gdtVersion: patientData.gdtVersion,
      }),
    });

    return {
      isNewPatient: true,
      patientId: patientData.patientId,
      success: true,
    };
  },
});
