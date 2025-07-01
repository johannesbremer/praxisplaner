import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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
    name: v.string(),
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
  }),

  practitioners: defineTable({
    practiceId: v.id("practices"),
    name: v.string(),
    tags: v.optional(v.array(v.string())), // e.g., ["specialist", "senior"]
  }).index("by_practiceId", ["practiceId"]),

  locations: defineTable({
    practiceId: v.id("practices"),
    name: v.string(),
  }).index("by_practiceId", ["practiceId"]),

  baseSchedules: defineTable({
    practitionerId: v.id("practitioners"),
    dayOfWeek: v.number(), // 0 = Sunday, 1 = Monday, etc.
    startTime: v.string(), // "08:00"
    endTime: v.string(), // "17:00"
    slotDuration: v.number(), // minutes
    breakTimes: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
    }))),
  }).index("by_practitionerId", ["practitionerId"]),

  ruleSets: defineTable({
    practiceId: v.id("practices"),
    version: v.number(),
    description: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
  }).index("by_practiceId", ["practiceId"]),

  // Flat, immutable rules table
  rules: defineTable({
    ruleSetId: v.id("ruleSets"),
    priority: v.number(),
    description: v.string(),
    ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),

    // --- Parameters for 'BLOCK' rules ---
    block_daysOfWeek: v.optional(v.array(v.number())), // e.g., [1] for Monday
    block_appointmentTypes: v.optional(v.array(v.string())),
    block_exceptForPractitionerTags: v.optional(v.array(v.string())),
    block_timeRangeStart: v.optional(v.string()), // "08:00"
    block_timeRangeEnd: v.optional(v.string()), // "10:00"
    block_dateRangeStart: v.optional(v.string()), // ISO date string
    block_dateRangeEnd: v.optional(v.string()), // ISO date string

    // --- Parameters for 'LIMIT_CONCURRENT' rules ---
    limit_count: v.optional(v.number()),
    limit_appointmentTypes: v.optional(v.array(v.string())),
    limit_atLocation: v.optional(v.id("locations")),
    limit_perPractitioner: v.optional(v.boolean()),

  }).index("by_ruleSetId", ["ruleSetId"]),
});
