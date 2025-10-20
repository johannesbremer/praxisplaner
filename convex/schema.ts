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
    allowedPractitionerIds: v.array(v.id("practitioners")), // Required: at least one practitioner
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

  /**
   * Rule Conditions Table - Recursive Tree Structure for Boolean Logic
   *
   * This table stores BOTH the rule metadata AND the condition tree nodes.
   * Each rule is represented by a root condition node (where parentConditionId is null and isRoot is true).
   * Child conditions reference their parent via parentConditionId, creating a recursive tree.
   *
   * Root nodes (rules) have:
   * - isRoot: true
   * - parentConditionId: null
   * - enabled: can disable without deleting
   *
   * Child nodes (conditions) have:
   * - isRoot: false
   * - parentConditionId: reference to parent condition
   * - nodeType: AND/NOT/CONDITION
   *
   * All nodes (root and children) have:
   * - practiceId, ruleSetId: for security and querying
   * - copyFromId: for copy-on-write tracking
   * - createdAt, lastModified: for auditing
   *
   * Example tree for: "(appointmentType IS 'Checkup' AND dayOfWeek IS Monday) AND NOT (location IS 'Dissen')"
   *
   * Root (Rule: "Block certain appointments")
   *  └─ Child (AND)
   *      ├─ Child (AND)
   *      │   ├─ Leaf: appointmentType IS 'Checkup'
   *      │   └─ Leaf: dayOfWeek IS Monday
   *      └─ Child (NOT)
   *          └─ Leaf: location IS 'Dissen'
   */
  ruleConditions: defineTable({
    // Metadata - required for ALL nodes (root and children) for security and querying
    copyFromId: v.optional(v.id("ruleConditions")), // Copy-on-write reference
    practiceId: v.id("practices"), // Multi-tenancy security
    ruleSetId: v.id("ruleSets"), // Easy querying of all conditions in a rule set

    // Tree structure - recursive parent reference
    childOrder: v.number(), // Order among siblings (for UI consistency and evaluation order)
    parentConditionId: v.optional(v.id("ruleConditions")), // null for root nodes (rules)

    // Root node (rule) metadata
    enabled: v.optional(v.boolean()), // Only for root nodes - can disable without deleting
    isRoot: v.boolean(), // true = this is a rule (root of tree), false = this is a condition node

    // Node type: logical operator or leaf condition (for non-root nodes)
    nodeType: v.optional(
      v.union(
        v.literal("AND"), // All children must be true
        v.literal("NOT"), // Negates single child
        v.literal("CONDITION"), // Leaf node with actual test
      ),
    ),

    // For leaf nodes (nodeType === "CONDITION") - what to test
    conditionType: v.optional(
      v.union(
        // Basic filters
        v.literal("APPOINTMENT_TYPE"), // Test appointment type name
        v.literal("DAY_OF_WEEK"), // Test day of week (0-6)
        v.literal("LOCATION"), // Test location ID
        v.literal("PRACTITIONER"), // Test practitioner ID
        v.literal("PRACTITIONER_TAG"), // Test if practitioner has tag

        // Time-based
        v.literal("DATE_RANGE"), // Test if date is in range
        v.literal("TIME_RANGE"), // Test if time is in range
        v.literal("DAYS_AHEAD"), // Test booking advance time

        // Capacity-based
        v.literal("DAILY_CAPACITY"), // Test appointments per day
        v.literal("CONCURRENT_COUNT"), // Test concurrent appointments

        // Client source
        v.literal("CLIENT_TYPE"), // Online, MFA, Phone-AI, etc.
      ),
    ),

    // Comparison operator for leaf conditions
    operator: v.optional(
      v.union(
        v.literal("IS"), // Equals (single value)
        v.literal("IS_NOT"), // Not equals (single value)
        v.literal("GREATER_THAN_OR_EQUAL"), // >= (numeric)
        v.literal("LESS_THAN_OR_EQUAL"), // <= (numeric)
        v.literal("EQUALS"), // == (numeric)
      ),
    ),

    // Polymorphic value storage - only populate what's needed
    valueIds: v.optional(v.array(v.string())), // For ID arrays (stored as strings)
    valueNumber: v.optional(v.number()), // For single numeric values

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_isRoot", ["ruleSetId", "isRoot"]) // Get all rules (roots) for a rule set
    .index("by_ruleSetId_isRoot_enabled", ["ruleSetId", "isRoot", "enabled"]) // Get enabled rules
    .index("by_parentConditionId", ["parentConditionId"]) // Get children of a node
    .index("by_parentConditionId_childOrder", [
      "parentConditionId",
      "childOrder",
    ]) // Ordered children
    .index("by_copyFromId", ["copyFromId"])
    .index("by_copyFromId_ruleSetId", ["copyFromId", "ruleSetId"]),
});
