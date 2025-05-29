import { v } from "convex/values";

import type { ProcessingResult } from "./types";

import { mutation, query } from "../_generated/server";
import { extractPatientData, parseGdtContent } from "./processing";
import { validateGdtContent } from "./validation";

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
