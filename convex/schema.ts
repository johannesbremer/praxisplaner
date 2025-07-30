import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  appointments: defineTable({
    // Core appointment fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(),

    // Optional fields
    appointmentType: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    notes: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practitionerId: v.optional(v.id("practitioners")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_start", ["start"])
    .index("by_patientId", ["patientId"])
    .index("by_practitionerId", ["practitionerId"])
    .index("by_start_end", ["start", "end"]),

  appointmentTypes: defineTable({
    name: v.string(),
    practiceId: v.id("practices"),
    // Duration mappings for different practitioners
    createdAt: v.int64(),
    durations: v.optional(
      v.array(
        v.object({
          duration: v.number(), // in minutes
          practitionerId: v.id("practitioners"),
        }),
      ),
    ),
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_name", ["practiceId", "name"]),

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
    locationId: v.id("locations"), // Required location for the schedule
    practitionerId: v.id("practitioners"),
    startTime: v.string(), // "08:00"
  })
    .index("by_practitionerId", ["practitionerId"])
    .index("by_locationId", ["locationId"]),

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
    tags: v.optional(v.array(v.string())),
  }).index("by_practiceId", ["practiceId"]),

  ruleSets: defineTable({
    createdAt: v.number(),
    createdBy: v.string(),
    description: v.string(),
    parentVersions: v.optional(v.array(v.id("ruleSets"))), // Support for version branching
    practiceId: v.id("practices"),
    version: v.number(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_description", ["practiceId", "description"]),

  // Global rules table - rules are now shared across rule sets
  rules: defineTable({
    description: v.string(),
    name: v.string(), // Globally unique rule name
    practiceId: v.id("practices"), // Rules belong to a practice
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
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_name", ["practiceId", "name"]) // For uniqueness validation
    .searchIndex("search_rules", {
      filterFields: ["practiceId", "description"],
      searchField: "name",
    }), // For full-text search on name with description and practice filtering

  // Junction table for rule set to rule relationships
  ruleSetRules: defineTable({
    enabled: v.boolean(), // Whether this rule is enabled in this rule set
    priority: v.number(), // Priority of this rule within this rule set
    ruleId: v.id("rules"),
    ruleSetId: v.id("ruleSets"),
  })
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleId", ["ruleId"])
    .index("by_ruleSetId_enabled", ["ruleSetId", "enabled"]), // For efficient enabled rules queries
});
