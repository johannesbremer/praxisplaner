import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  gdtDirectoryPreference: defineTable({
    directoryName: v.string(),
    singletonKey: v.literal("user_preference"),
    // initialPermissionGrantedOnLoad: v.optional(v.boolean()), // REMOVED
  }).index("by_singletonKey", ["singletonKey"]),

  patients: defineTable({
    // Patient identification fields (from GDT file)
    city: v.optional(v.string()), // FK 3106 - City
    dateOfBirth: v.optional(v.string()), // FK 3103, format TTMMJJJJ
    firstName: v.optional(v.string()), // FK 3102
    lastName: v.optional(v.string()), // FK 3101
    patientId: v.number(), // FK 3000 - Required, unique identifier as integer
    street: v.optional(v.string()), // FK 3107 - Street address

    // Metadata and tracking fields
    createdAt: v.int64(),
    lastModified: v.int64(),
    sourceGdtFileId: v.id("processedGdtFiles"),

    // GDT metadata from file
    gdtReceiverId: v.optional(v.string()), // FK 8315 - e.g., "TERMINP1"
    gdtSenderId: v.optional(v.string()), // FK 8316 - e.g., "TERMINP1"
    gdtVersion: v.optional(v.string()), // FK 9218 - e.g., "02.10"
  })
    .index("by_patientId", ["patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"]),

  processedGdtFiles: defineTable({
    fileContent: v.string(),
    fileName: v.string(),
    gdtParsedSuccessfully: v.optional(v.boolean()),
    processedAt: v.int64(),
    processingErrorMessage: v.optional(v.string()),
    sourceDirectoryName: v.string(),
    // GDT fields based on actual files
    examDate: v.optional(v.string()), // FK 7620 - Date of examination (TTMMJJJJ)
    gdtVersion: v.optional(v.string()), // FK 9218 - GDT Version (alternative field)
    testDescription: v.optional(v.string()), // FK 6220 - Description (e.g., "Termin 27.08.2010")
    testProcedure: v.optional(v.string()), // FK 8402 - Procedure type (e.g., "ALLG00")
    testReference: v.optional(v.string()), // FK 6201 - Reference number
  }).index("by_processedAt", ["processedAt"]),

  // New table for permission events
  permissionEvents: defineTable({
    accessMode: v.union(v.literal("read"), v.literal("readwrite")), // Assuming readwrite for now
    context: v.string(), // e.g., "initial load", "user request", "polling detected change"
    errorMessage: v.optional(v.string()), // If resultState is "error"
    handleName: v.string(),
    operationType: v.union(v.literal("query"), v.literal("request")),
    resultState: v.union(
      v.literal("granted"),
      v.literal("prompt"),
      v.literal("denied"),
      v.literal("error"), // For logging errors during permission checks
    ),
    timestamp: v.int64(),
  }).index("by_timestamp", ["timestamp"]), // To fetch recent events
});
