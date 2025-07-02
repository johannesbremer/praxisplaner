// convex/types.ts
// Reusable type definitions for Convex schema consistency

import { v } from "convex/values";

// Common reusable validation patterns
export const convexTypes = {
  // Date range validation
  dateRange: v.object({
    end: v.string(),
    start: v.string(),
  }),

  // Time range validation (for breaks, appointments, etc.)
  timeRange: v.object({
    end: v.string(),
    start: v.string(),
  }),

  // Simulation context validation
  simulatedContext: v.object({
    appointmentType: v.string(),
    patient: v.object({ isNew: v.boolean() }),
  }),

  // Rule updates validation (for mutations)
  ruleUpdates: v.object({
    description: v.optional(v.string()),
    priority: v.optional(v.number()),
    ruleType: v.optional(
      v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
    ),

    // Practitioner application
    appliesTo: v.optional(
      v.union(
        v.literal("ALL_PRACTITIONERS"),
        v.literal("SPECIFIC_PRACTITIONERS"),
      ),
    ),
    specificPractitioners: v.optional(
      v.optional(v.array(v.id("practitioners"))),
    ),

    // Block rule parameters
    block_appointmentTypes: v.optional(v.optional(v.array(v.string()))),
    block_dateRangeEnd: v.optional(v.optional(v.string())),
    block_dateRangeStart: v.optional(v.optional(v.string())),
    block_daysOfWeek: v.optional(v.optional(v.array(v.number()))),
    block_exceptForPractitionerTags: v.optional(
      v.optional(v.array(v.string())),
    ),
    block_timeRangeEnd: v.optional(v.optional(v.string())),
    block_timeRangeStart: v.optional(v.optional(v.string())),

    // Limit rule parameters
    limit_appointmentTypes: v.optional(v.optional(v.array(v.string()))),
    limit_atLocation: v.optional(v.optional(v.id("locations"))),
    limit_count: v.optional(v.optional(v.number())),
    limit_perPractitioner: v.optional(v.optional(v.boolean())),
  }),

  // Practitioner updates validation
  practitionerUpdates: v.object({
    name: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  }),

  // Practitioner details return type
  practitionerDetails: v.object({
    _creationTime: v.number(),
    _id: v.id("practitioners"),
    name: v.string(),
    practiceId: v.id("practices"),
    tags: v.optional(v.array(v.string())),
  }),

  // Practice details return type
  practiceDetails: v.object({
    _creationTime: v.number(),
    _id: v.id("practices"),
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
  }),

  // Patient processing result
  patientProcessingResult: v.object({
    isNewPatient: v.boolean(),
    patientId: v.number(),
    success: v.boolean(),
  }),

  // Base schedule creation/update validation
  baseScheduleData: v.object({
    breakTimes: v.optional(v.array(v.object({
      end: v.string(),
      start: v.string(),
    }))),
    dayOfWeek: v.number(),
    endTime: v.string(),
    practitionerId: v.id("practitioners"),
    slotDuration: v.number(),
    startTime: v.string(),
  }),

  // Base schedule update validation (subset of creation, no practitionerId)
  baseScheduleUpdates: v.object({
    breakTimes: v.optional(v.array(v.object({
      end: v.string(),
      start: v.string(),
    }))),
    endTime: v.string(),
    scheduleId: v.id("baseSchedules"),
    slotDuration: v.number(),
    startTime: v.string(),
  }),

  // Full base schedule return type
  baseScheduleDetails: v.object({
    _creationTime: v.number(),
    _id: v.id("baseSchedules"),
    breakTimes: v.optional(v.array(v.object({
      end: v.string(),
      start: v.string(),
    }))),
    dayOfWeek: v.number(),
    endTime: v.string(),
    practitionerId: v.id("practitioners"),
    slotDuration: v.number(),
    startTime: v.string(),
  }),

  // Extended base schedule with practitioner name
  baseScheduleWithPractitioner: v.object({
    _creationTime: v.number(),
    _id: v.id("baseSchedules"),
    breakTimes: v.optional(v.array(v.object({
      end: v.string(),
      start: v.string(),
    }))),
    dayOfWeek: v.number(),
    endTime: v.string(),
    practitionerId: v.id("practitioners"),
    practitionerName: v.string(),
    slotDuration: v.number(),
    startTime: v.string(),
  }),

  // Slot details return type
  slotDetails: v.object({
    blockedByRuleId: v.optional(v.id("rules")),
    duration: v.number(),
    locationId: v.optional(v.id("locations")),
    practitionerId: v.id("practitioners"),
    practitionerName: v.string(),
    startTime: v.string(),
    status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
  }),
} as const;