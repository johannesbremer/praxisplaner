// convex/validators.ts
// Shared validators derived from the schema as single source of truth

import { v } from "convex/values";

// Available colors for locations
export const LOCATION_COLORS = [
  { bg: "bg-blue-50", text: "text-blue-700" },
  { bg: "bg-green-50", text: "text-green-700" },
  { bg: "bg-purple-50", text: "text-purple-700" },
  { bg: "bg-orange-50", text: "text-orange-700" },
  { bg: "bg-pink-50", text: "text-pink-700" },
  { bg: "bg-indigo-50", text: "text-indigo-700" },
  { bg: "bg-cyan-50", text: "text-cyan-700" },
  { bg: "bg-teal-50", text: "text-teal-700" },
  { bg: "bg-lime-50", text: "text-lime-700" },
  { bg: "bg-amber-50", text: "text-amber-700" },
] as const;

// Helper function to get next available color based on count
export function getNextLocationColor(existingLocationCount: number) {
  const colorIndex = existingLocationCount % LOCATION_COLORS.length;
  const selectedColor = LOCATION_COLORS[colorIndex];
  if (!selectedColor) {
    // Fallback to first color if somehow undefined
    return LOCATION_COLORS[0];
  }
  return selectedColor;
}

// Common reusable validators based on schema definitions

// Date range validator (used in scheduling and other places)
export const dateRangeValidator = v.object({
  end: v.string(),
  start: v.string(),
});

// Break times validator (used in base schedules)
export const breakTimesValidator = v.optional(
  v.array(
    v.object({
      end: v.string(),
      start: v.string(),
    }),
  ),
);

// Simulated context for scheduling (used in debug views)
export const simulatedContextValidator = v.object({
  appointmentType: v.string(),
  locationId: v.optional(v.id("locations")),
  patient: v.object({ isNew: v.boolean() }),
});

// Patient update data (based on schema fields)
export const patientUpdateValidator = v.object({
  city: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  street: v.optional(v.string()),
});

// Practitioner update data (based on schema fields)
export const practitionerUpdateValidator = v.object({
  name: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
});

// Patient upsert result
export const patientUpsertResultValidator = v.object({
  isNewPatient: v.boolean(),
  patientId: v.number(),
  success: v.boolean(),
});

// Available slots result (for scheduling engine)
export const availableSlotsResultValidator = v.object({
  log: v.array(v.string()),
  slots: v.array(
    v.object({
      blockedByRuleId: v.optional(v.id("rules")),
      duration: v.number(),
      locationId: v.optional(v.id("locations")),
      practitionerId: v.id("practitioners"),
      practitionerName: v.string(),
      startTime: v.string(),
      status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
    }),
  ),
});

// Rule update data (based on schema fields)
export const ruleUpdateValidator = v.object({
  description: v.optional(v.string()),
  name: v.optional(v.string()),
  ruleType: v.optional(
    v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
  ),
  // Add other optional rule fields that can be updated
  appliesTo: v.optional(
    v.union(
      v.literal("ALL_PRACTITIONERS"),
      v.literal("SPECIFIC_PRACTITIONERS"),
    ),
  ),
  specificPractitioners: v.optional(v.array(v.id("practitioners"))),
  // BLOCK rule fields
  block_appointmentTypes: v.optional(v.array(v.string())),
  block_dateRangeEnd: v.optional(v.string()),
  block_dateRangeStart: v.optional(v.string()),
  block_daysOfWeek: v.optional(v.array(v.number())),
  block_exceptForPractitionerTags: v.optional(v.array(v.string())),
  block_timeRangeEnd: v.optional(v.string()),
  block_timeRangeStart: v.optional(v.string()),
  // LIMIT_CONCURRENT rule fields
  limit_appointmentTypes: v.optional(v.array(v.string())),
  limit_atLocation: v.optional(v.id("locations")),
  limit_count: v.optional(v.number()),
  limit_perPractitioner: v.optional(v.boolean()),
});

// RuleSetRule update data (for junction table)
export const ruleSetRuleUpdateValidator = v.object({
  enabled: v.optional(v.boolean()),
  priority: v.optional(v.number()),
});
