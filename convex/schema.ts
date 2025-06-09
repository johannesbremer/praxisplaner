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

  // Practice management
  practices: defineTable({
    name: v.string(),
    currentActiveRuleConfigurationId: v.optional(v.id("ruleConfigurations")),
    settings: v.optional(v.object({
      defaultSlotDuration: v.optional(v.number()),
      workingHours: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
    })),
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_createdAt", ["createdAt"]),

  // Rule configurations (versioning support)
  ruleConfigurations: defineTable({
    practiceId: v.id("practices"),
    version: v.number(),
    description: v.string(),
    createdBy: v.string(),
    createdAt: v.int64(),
    isActive: v.boolean(),
  })
    .index("by_practice_and_version", ["practiceId", "version"])
    .index("by_practice_and_active", ["practiceId", "isActive"])
    .index("by_createdAt", ["createdAt"]),

  // Individual rules within a configuration
  rules: defineTable({
    ruleConfigurationId: v.id("ruleConfigurations"),
    name: v.string(),
    type: v.union(
      v.literal("CONDITIONAL_AVAILABILITY"),
      v.literal("RESOURCE_CONSTRAINT"),
      v.literal("SEASONAL_AVAILABILITY"),
      v.literal("TIME_BLOCK")
    ),
    priority: v.number(),
    active: v.boolean(),
    
    // Rule conditions (stored as JSON-compatible objects)
    conditions: v.object({
      appointmentType: v.optional(v.string()),
      patientType: v.optional(v.string()),
      dateRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      timeRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      dayOfWeek: v.optional(v.array(v.number())),
      requiredResources: v.optional(v.array(v.string())),
    }),
    
    // Rule actions (stored as JSON-compatible objects)
    actions: v.object({
      requireExtraTime: v.optional(v.boolean()),
      extraMinutes: v.optional(v.number()),
      limitPerDay: v.optional(v.number()),
      requireSpecificDoctor: v.optional(v.string()),
      enableBatchAppointments: v.optional(v.boolean()),
      batchSize: v.optional(v.number()),
      batchDuration: v.optional(v.number()),
      blockTimeSlots: v.optional(v.array(v.string())),
    }),
    
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_configuration", ["ruleConfigurationId"])
    .index("by_configuration_and_priority", ["ruleConfigurationId", "priority"])
    .index("by_configuration_and_active", ["ruleConfigurationId", "active"]),

  // Base availability schedules (doctor's standard weekly schedules)
  baseAvailability: defineTable({
    practiceId: v.id("practices"),
    doctorId: v.string(),
    dayOfWeek: v.number(), // 0-6 (Sunday-Saturday)
    startTime: v.string(), // "09:00"
    endTime: v.string(), // "17:00"
    slotDuration: v.number(), // minutes
    breakTimes: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
    }))),
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practice_and_doctor", ["practiceId", "doctorId"])
    .index("by_practice_doctor_and_day", ["practiceId", "doctorId", "dayOfWeek"]),

  // Appointment types configuration
  appointmentTypes: defineTable({
    practiceId: v.id("practices"),
    name: v.string(),
    defaultDuration: v.number(), // minutes
    description: v.optional(v.string()),
    color: v.optional(v.string()), // for UI display
    requiresResources: v.optional(v.array(v.string())),
    active: v.boolean(),
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practice", ["practiceId"])
    .index("by_practice_and_active", ["practiceId", "active"]),
});
