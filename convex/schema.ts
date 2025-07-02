import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  baseSchedules: defineTable({
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.number(), // 0 = Sunday, 1 = Monday, etc.
    endTime: v.string(), // "17:00"
    practitionerId: v.id("practitioners"),
    slotDuration: v.number(), // minutes
    startTime: v.string(), // "08:00"
  }).index("by_practitionerId", ["practitionerId"]),

  locations: defineTable({
    name: v.string(),
    practiceId: v.id("practices"),
  }).index("by_practiceId", ["practiceId"]),

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
    sourceGdtFileName: v.optional(v.string()), // Original GDT filename for reference
  })
    .index("by_patientId", ["patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"]),

  practices: defineTable({
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
  }),

  practitioners: defineTable({
    name: v.string(),
    practiceId: v.id("practices"),
    tags: v.optional(v.array(v.string())), // e.g., ["specialist", "senior"]
  }).index("by_practiceId", ["practiceId"]),

  ruleSets: defineTable({
    createdAt: v.number(),
    createdBy: v.string(),
    description: v.string(),
    practiceId: v.id("practices"),
    version: v.number(),
  }).index("by_practiceId", ["practiceId"]),

  // Flat, immutable rules table
  rules: defineTable({
    description: v.string(),
    priority: v.number(),
    ruleSetId: v.id("ruleSets"),
    ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),

    // --- General rule application ---
    appliesTo: v.union(
      v.literal("ALL_PRACTITIONERS"),
      v.literal("SPECIFIC_PRACTITIONERS"),
    ),
    specificPractitioners: v.optional(v.array(v.id("practitioners"))),

    // --- Parameters for 'BLOCK' rules ---
    block_appointmentTypes: v.optional(v.array(v.string())),
    block_dateRangeEnd: v.optional(v.string()), // ISO date string
    block_dateRangeStart: v.optional(v.string()), // ISO date string
    block_daysOfWeek: v.optional(v.array(v.number())), // e.g., [1] for Monday
    block_exceptForPractitionerTags: v.optional(v.array(v.string())),
    block_timeRangeEnd: v.optional(v.string()), // "10:00"
    block_timeRangeStart: v.optional(v.string()), // "08:00"

    // --- Parameters for 'LIMIT_CONCURRENT' rules ---
    limit_appointmentTypes: v.optional(v.array(v.string())),
    limit_atLocation: v.optional(v.id("locations")),
    limit_count: v.optional(v.number()),
    limit_perPractitioner: v.optional(v.boolean()),
  }).index("by_ruleSetId", ["ruleSetId"]),
});
