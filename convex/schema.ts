import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  appointments: defineTable({
    // Core appointment fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(),

    // Additional fields
    appointmentType: v.optional(v.string()),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_start", ["start"])
    .index("by_patientId", ["patientId"])
    .index("by_practitionerId", ["practitionerId"])
    .index("by_start_end", ["start", "end"])
    .index("by_isSimulation", ["isSimulation"])
    .index("by_replacesAppointmentId", ["replacesAppointmentId"])
    .index("by_practiceId", ["practiceId"]),

  appointmentTypes: defineTable({
    createdAt: v.int64(),
    duration: v.number(), // duration in minutes (simplified - no more separate durations table)
    lastModified: v.int64(),
    name: v.string(),
    parentId: v.optional(v.id("appointmentTypes")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: appointment types are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_name", ["practiceId", "name"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

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
    parentId: v.optional(v.id("baseSchedules")), // Reference to the entity this was copied from
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"), // Required: base schedules are versioned per rule set
    startTime: v.string(), // "08:00"
  })
    .index("by_practitionerId", ["practitionerId"])
    .index("by_locationId", ["locationId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_practitionerId", ["ruleSetId", "practitionerId"])
    .index("by_practiceId", ["practiceId"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  locations: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("locations")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: locations are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  patients: defineTable({
    // Patient identification fields (from GDT file)
    city: v.optional(v.string()), // FK 3106 - City
    dateOfBirth: v.optional(v.string()), // FK 3103, format TTMMJJJJ
    firstName: v.optional(v.string()), // FK 3102
    lastName: v.optional(v.string()), // FK 3101
    patientId: v.number(), // FK 3000 - Required, unique identifier as integer
    practiceId: v.id("practices"), // Multi-tenancy support
    street: v.optional(v.string()), // FK 3107 - Street address

    // Metadata and tracking fields
    createdAt: v.int64(),
    lastModified: v.int64(),
    sourceGdtFileName: v.optional(v.string()), // Original GDT filename for reference
  })
    .index("by_patientId", ["patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"])
    .index("by_practiceId", ["practiceId"]),

  practices: defineTable({
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
  }),

  practitioners: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("practitioners")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: practitioners are versioned per rule set
    tags: v.optional(v.array(v.string())),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  ruleSets: defineTable({
    createdAt: v.number(),
    description: v.string(),
    parentVersion: v.optional(v.id("ruleSets")), // Single parent (git-like model)
    practiceId: v.id("practices"),
    saved: v.boolean(), // true = saved rule set, false = unsaved/draft rule set
    version: v.number(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_description", ["practiceId", "description"])
    .index("by_practiceId_saved", ["practiceId", "saved"]), // For finding unsaved rule sets

  // Rules table - rules belong to a specific rule set (copy-on-write pattern)
  rules: defineTable({
    description: v.string(),
    name: v.string(), // Rule name (unique within a rule set)
    parentId: v.optional(v.id("rules")), // Reference to the entity this was copied from
    practiceId: v.id("practices"), // Rules belong to a practice
    ruleSetId: v.id("ruleSets"), // Rules belong to a specific rule set
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
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"]) // For uniqueness validation within rule set
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .searchIndex("search_rules", {
      filterFields: ["ruleSetId", "description"],
      searchField: "name",
    }), // For full-text search on name with description and rule set filtering
});
