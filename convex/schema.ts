import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  gdtDirectoryPreference: defineTable({
    directoryName: v.string(),
    singletonKey: v.literal("user_preference"),
    // initialPermissionGrantedOnLoad: v.optional(v.boolean()), // REMOVED
  }).index("by_singletonKey", ["singletonKey"]),

  patients: defineTable({
    // Patient identification fields
    address: v.optional(v.string()), // Combined address field
    dateOfBirth: v.optional(v.string()), // FK 3103, format TTMMJJJJ
    firstName: v.optional(v.string()), // FK 3102
    gender: v.optional(v.string()), // FK 3110, M/W/D/X
    insuranceNumber: v.optional(v.string()), // FK 3105
    lastName: v.optional(v.string()), // FK 3101
    patientId: v.number(), // FK 3000 - Required, unique identifier as integer
    phone: v.optional(v.string()), // FK 3626
    title: v.optional(v.string()), // Optional title

    // Metadata and tracking fields
    createdAt: v.int64(), // When the patient was first added
    lastModified: v.int64(), // Last update timestamp
    sourceGdtFileId: v.id("processedGdtFiles"), // Reference to first GDT file

    // GDT metadata (optional)
    gdtReceiverId: v.optional(v.string()), // FK 8315
    gdtSenderId: v.optional(v.string()), // FK 8316
    gdtVersion: v.optional(v.string()), // FK 0001
  })
    .index("by_patientId", ["patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"]),

  processedGdtFiles: defineTable({
    fileContent: v.string(),
    fileName: v.string(),
    gdtParsedSuccessfully: v.boolean(),
    processedAt: v.int64(),
    processingErrorMessage: v.optional(v.string()),
    sourceDirectoryName: v.string(),
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
