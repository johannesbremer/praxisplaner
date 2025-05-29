// convex/gdtFiles.ts
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// GDT field types based on the specification
interface GdtField {
  content: string;
  fieldId: GdtFieldId;
  length: number;
}

type GdtFieldId = string; // All GDT field IDs are 4-digit strings

// Known GDT field IDs for type checking and documentation
const GDT_FIELD_IDS = {
  BIRTH_DATE: "3103", // Birth date (DDMMYYYY)
  FIRST_NAME: "3102", // First name
  GENDER: "3110", // Gender (M/W/D/X)
  LAST_NAME: "3101", // Last name
  PATIENT_ID: "3000", // Patient ID
  SATZ_END: "8001", // Satzende
  SATZ_START: "8000", // Satzart
} as const;

type ProcessingResult =
  | {
      error: string;
      success: false;
    }
  | {
      isNewPatient: boolean;
      patientId: string;
      success: true;
    };

// Gender types according to GDT specification
type GdtGender = "D" | "M" | "W" | "X";

/** Validates whether a string represents a valid GDT gender value. */
function isValidGender(gender: string): gender is GdtGender {
  return ["D", "M", "W", "X"].includes(gender);
}

/** Validates whether a string conforms to the DDMMYYYY date format as used in GDT files. */
function isValidBirthDate(date: string): boolean {
  if (!/^\d{8}$/.test(date)) {
    return false;
  }

  const day = parseInt(date.substring(0, 2), 10);
  const month = parseInt(date.substring(2, 4), 10);
  const year = parseInt(date.substring(4, 8), 10);

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

// Extract patient data from GDT content
interface PatientData {
  address?: string;
  dateOfBirth?: string;
  firstName?: string;
  gender?: string;
  lastName?: string;
  patientId: string;
  title?: string;
}

/** Extracts patient-related data from GDT content according to GDT 3.5 specification. */
function extractPatientData(gdtContent: string): PatientData {
  const lines = gdtContent.split(/\r?\n/);
  const patientData: {
    address?: string;
    dateOfBirth?: string;
    firstName?: string;
    gender?: string;
    lastName?: string;
    patientId: string;
    title?: string;
  } = {
    patientId: "", // Will be set from FK 3000
  };

  for (const line of lines) {
    const field = parseGdtLine(line);
    if (!field) {
      continue;
    }

    // Extract patient-related fields
    switch (field.fieldId) {
      case GDT_FIELD_IDS.BIRTH_DATE:
        patientData.dateOfBirth = field.content;
        break;
      case GDT_FIELD_IDS.FIRST_NAME:
        patientData.firstName = field.content;
        break;
      case GDT_FIELD_IDS.GENDER:
        patientData.gender = field.content;
        break;
      case GDT_FIELD_IDS.LAST_NAME:
        patientData.lastName = field.content;
        break;
      case GDT_FIELD_IDS.PATIENT_ID:
        patientData.patientId = field.content;
        break;
    }
  }

  return patientData;
}

/** Validates GDT content according to GDT 3.5 specification. */
function validateGdtContent(
  gdtContent: string,
): { error: string; isValid: false } | { isValid: true } {
  // Basic validation of GDT content
  const lines = gdtContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  // Check if file has content
  if (lines.length === 0) {
    return { error: "Empty GDT file", isValid: false };
  }

  // Check first line for Satzart
  const firstLine = lines[0] ? parseGdtLine(lines[0]) : null;
  if (!firstLine || firstLine.fieldId !== GDT_FIELD_IDS.SATZ_START) {
    return {
      error: "Invalid GDT file: Missing or invalid Satzart",
      isValid: false,
    };
  }

  // Check for mandatory patient ID (FK 3000)
  let hasPatientId = false;
  for (const line of lines) {
    const field = parseGdtLine(line);
    if (field?.fieldId === GDT_FIELD_IDS.PATIENT_ID) {
      hasPatientId = true;
      break;
    }
  }

  if (!hasPatientId) {
    return {
      error: "Invalid GDT file: Missing patient ID (FK 3000)",
      isValid: false,
    };
  }

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
      // Log invalid file but continue
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

    // Extract patient data
    const patientData = extractPatientData(args.fileContent);

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
    if (patientData.dateOfBirth && !isValidBirthDate(patientData.dateOfBirth)) {
      const error = `Invalid birth date format: ${patientData.dateOfBirth}. Must be DDMMYYYY`;
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

    // Store the GDT file first to get its ID
    const gdtFileId = await ctx.db.insert("processedGdtFiles", {
      fileContent: args.fileContent,
      fileName: args.fileName,
      gdtParsedSuccessfully: true,
      processedAt: BigInt(Date.now()),
      sourceDirectoryName: args.sourceDirectoryName,
    });

    // Check if patient already exists
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) =>
        q.eq("patientId", patientData.patientId),
      )
      .unique();

    const now = BigInt(Date.now());
    if (!existingPatient) {
      // Prepare insert data with required fields
      const insertData = {
        createdAt: now,
        lastModified: now,
        patientId: patientData.patientId,
        sourceGdtFileId: gdtFileId,
        // Add optional fields conditionally
        ...(patientData.address?.trim() && { address: patientData.address }),
        ...(patientData.dateOfBirth?.trim() && {
          dateOfBirth: patientData.dateOfBirth,
        }),
        ...(patientData.firstName?.trim() && {
          firstName: patientData.firstName,
        }),
        ...(patientData.lastName?.trim() && { lastName: patientData.lastName }),
        ...(patientData.title?.trim() && { title: patientData.title }),
        ...(patientData.gender &&
          isValidGender(patientData.gender) && { gender: patientData.gender }),
      };

      await ctx.db.insert("patients", insertData);

      return {
        isNewPatient: true,
        patientId: patientData.patientId,
        success: true,
      };
    }

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
