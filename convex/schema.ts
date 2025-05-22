import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  gdtDirectoryPreference: defineTable({
    directoryName: v.string(),
    singletonKey: v.literal("user_preference"),
    // initialPermissionGrantedOnLoad: v.optional(v.boolean()), // REMOVED
  }).index("by_singletonKey", ["singletonKey"]),

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
