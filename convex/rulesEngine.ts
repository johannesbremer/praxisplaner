import { v } from "convex/values";

import { query } from "./_generated/server";

// Type definitions for slots and rules
type AvailableSlot = {
  appointmentType: string;
  date: string;
  doctor: string;
  duration: number;
  id: string;
  notes?: string;
  time: string;
};

type RuleTrace = {
  applied: boolean;
  reason: string;
  ruleName: string;
};

type Rule = {
  _id: string;
  actions: Record<string, unknown>;
  active: boolean;
  conditions: Record<string, unknown>;
  name: string;
  priority: number;
  type:
    | "CONDITIONAL_AVAILABILITY"
    | "RESOURCE_CONSTRAINT"
    | "SEASONAL_AVAILABILITY"
    | "TIME_BLOCK";
};

type BaseAvailability = {
  breakTimes?: Array<{
    end: string;
    start: string;
  }>;
  doctorId: string;
  endTime: string;
  slotDuration: number;
  startTime: string;
};

type PatientContext = {
  assignedDoctor: null | string;
  isNewPatient: boolean;
  lastVisit: null | string;
  medicalHistory: string[];
};

/**
 * Generate available slots for a specific date, appointment type, and patient context
 * This is the core rules engine function that applies all active rules
 */
export const generateAvailableSlots = query({
  args: {
    appointmentType: v.string(),
    date: v.string(), // ISO date string
    patientContext: v.object({
      assignedDoctor: v.union(v.string(), v.null()),
      isNewPatient: v.boolean(),
      lastVisit: v.union(v.string(), v.null()),
      medicalHistory: v.array(v.string()),
    }),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get the active rule configuration for this practice
    const activeConfig = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true),
      )
      .first();

    if (!activeConfig) {
      throw new Error("No active rule configuration found for practice");
    }

    // Get all active rules for this configuration, ordered by priority
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q.eq("ruleConfigurationId", activeConfig._id).eq("active", true),
      )
      .collect();

    // Sort rules by priority (lower number = higher priority)
    rules.sort((a, b) => a.priority - b.priority);

    // Get base availability for the requested date
    const dateObj = new Date(args.date);
    const dayOfWeek = dateObj.getDay();

    const baseAvailabilities = await ctx.db
      .query("baseAvailability")
      .withIndex("by_practice_and_doctor", (q) =>
        q.eq("practiceId", args.practiceId),
      )
      .filter((q) => q.eq(q.field("dayOfWeek"), dayOfWeek))
      .collect();

    // Generate initial slots from base availability
    let slots = generateSlotsFromBaseAvailability(
      baseAvailabilities,
      args.date,
    );

    // Apply each rule in priority order
    const appliedRules: string[] = [];

    for (const rule of rules) {
      if (
        isRuleApplicable(
          rule,
          args.appointmentType,
          args.patientContext,
          dateObj,
        )
      ) {
        const result = applyRule(rule, slots);
        if (result.applied) {
          slots = result.slots;
          appliedRules.push(rule.name);
        }
      }
    }

    return {
      appliedRules,
      slots,
    };
  },
  returns: v.object({
    appliedRules: v.array(v.string()),
    slots: v.array(
      v.object({
        appointmentType: v.string(),
        date: v.string(),
        doctor: v.string(),
        duration: v.number(),
        id: v.string(),
        notes: v.optional(v.string()),
        time: v.string(),
      }),
    ),
  }),
});

/**
 * Simulate slot generation for debugging (Debug View functionality)
 */
export const simulateSlotGeneration = query({
  args: {
    appointmentType: v.string(),
    dateRange: v.object({
      end: v.string(),
      start: v.string(),
    }),
    patientContext: v.object({
      assignedDoctor: v.union(v.string(), v.null()),
      isNewPatient: v.boolean(),
      lastVisit: v.union(v.string(), v.null()),
      medicalHistory: v.array(v.string()),
    }),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Similar to generateAvailableSlots but with detailed tracing
    const activeConfig = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true),
      )
      .first();

    if (!activeConfig) {
      throw new Error("No active rule configuration found for practice");
    }

    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q.eq("ruleConfigurationId", activeConfig._id).eq("active", true),
      )
      .collect();

    rules.sort((a, b) => a.priority - b.priority);

    // Generate slots for each day in the range
    const startDate = new Date(args.dateRange.start);
    const endDate = new Date(args.dateRange.end);
    let allSlots: AvailableSlot[] = [];
    const appliedRules: string[] = [];
    const ruleTrace: RuleTrace[] = [];

    for (
      let date = new Date(startDate);
      date <= endDate;
      date.setDate(date.getDate() + 1)
    ) {
      const dateStr = date.toISOString().split("T")[0];
      if (!dateStr) {
        continue;
      }
      const dayOfWeek = date.getDay();

      const baseAvailabilities = await ctx.db
        .query("baseAvailability")
        .withIndex("by_practice_and_doctor", (q) =>
          q.eq("practiceId", args.practiceId),
        )
        .filter((q) => q.eq(q.field("dayOfWeek"), dayOfWeek))
        .collect();

      let daySlots = generateSlotsFromBaseAvailability(
        baseAvailabilities,
        dateStr!,
      );

      // Apply rules with tracing
      for (const rule of rules) {
        if (
          isRuleApplicable(
            rule,
            args.appointmentType,
            args.patientContext,
            date,
          )
        ) {
          const result = applyRule(rule, daySlots);

          ruleTrace.push({
            applied: result.applied,
            reason: result.message || "Rule conditions met",
            ruleName: rule.name,
          });

          if (result.applied) {
            daySlots = result.slots;
            if (!appliedRules.includes(rule.name)) {
              appliedRules.push(rule.name);
            }
          }
        } else {
          ruleTrace.push({
            applied: false,
            reason: "Rule conditions not met",
            ruleName: rule.name,
          });
        }
      }

      allSlots = allSlots.concat(daySlots);
    }

    return {
      appliedRules,
      ruleTrace,
      slots: allSlots,
    };
  },
  returns: v.object({
    appliedRules: v.array(v.string()),
    ruleTrace: v.array(
      v.object({
        applied: v.boolean(),
        reason: v.string(),
        ruleName: v.string(),
      }),
    ),
    slots: v.array(
      v.object({
        appointmentType: v.string(),
        date: v.string(),
        doctor: v.string(),
        duration: v.number(),
        id: v.string(),
        notes: v.optional(v.string()),
        time: v.string(),
      }),
    ),
  }),
});

// Helper functions (these would be expanded with full logic)

function applyRule(
  rule: Rule,
  slots: AvailableSlot[],
): { applied: boolean; message: string; slots: AvailableSlot[] } {
  let currentSlots = [...slots];
  let message = "";
  let applied = false;

  // Apply extra time rule
  const requireExtraTime = rule.actions["requireExtraTime"] as
    | boolean
    | undefined;
  const extraMinutes = rule.actions["extraMinutes"] as number | undefined;
  if (requireExtraTime && extraMinutes) {
    currentSlots = currentSlots.map((slot) => ({
      ...slot,
      duration: slot.duration + extraMinutes,
      notes:
        `${slot.notes || ""} (Extra ${extraMinutes} min by ${rule.name})`.trim(),
    }));
    message += `Added ${extraMinutes} extra minutes. `;
    applied = true;
  }

  // Apply limit per day rule
  const limitPerDay = rule.actions["limitPerDay"] as number | undefined;
  if (limitPerDay) {
    const limit = limitPerDay;
    const slotsPerDoctor = new Map<string, number>();
    const limitedSlots: AvailableSlot[] = [];

    for (const slot of currentSlots) {
      const count = slotsPerDoctor.get(slot.doctor) || 0;
      if (count < limit) {
        limitedSlots.push(slot);
        slotsPerDoctor.set(slot.doctor, count + 1);
      }
    }

    if (currentSlots.length !== limitedSlots.length) {
      message += `Limited to ${limit} appointments per day per doctor. `;
      applied = true;
    }
    currentSlots = limitedSlots;
  }

  // Apply block time slots rule
  const blockTimeSlots = rule.actions["blockTimeSlots"] as string[] | undefined;
  if (blockTimeSlots && blockTimeSlots.length > 0) {
    const slotsToBlock = new Set(blockTimeSlots);
    const originalLength = currentSlots.length;
    currentSlots = currentSlots.filter((slot) => !slotsToBlock.has(slot.time));

    if (currentSlots.length < originalLength) {
      message += `Blocked specific time slots. `;
      applied = true;
    }
  }

  return { applied, message, slots: currentSlots };
}

function generateSlotsFromBaseAvailability(
  baseAvailabilities: BaseAvailability[],
  date: string,
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  for (const availability of baseAvailabilities) {
    const startTime = availability.startTime;
    const endTime = availability.endTime;
    const slotDuration = availability.slotDuration;
    const breakTimes = availability.breakTimes || [];

    // Generate time slots between start and end, excluding breaks
    // This is a simplified implementation
    const startHour = parseInt(startTime.split(":")[0] ?? "0");
    const startMin = parseInt(startTime.split(":")[1] ?? "0");
    const endHour = parseInt(endTime.split(":")[0] ?? "0");
    const endMin = parseInt(endTime.split(":")[1] ?? "0");

    let currentTime = startHour * 60 + startMin; // minutes from midnight
    const endTimeMin = endHour * 60 + endMin;

    while (currentTime + slotDuration <= endTimeMin) {
      const hour = Math.floor(currentTime / 60);
      const min = currentTime % 60;
      const timeStr = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;

      // Check if this time overlaps with any break
      const isBreakTime = breakTimes.some((breakTime) => {
        const breakStart = breakTime.start.split(":");
        const breakEnd = breakTime.end.split(":");
        const breakStartMin =
          parseInt(breakStart[0] ?? "0") * 60 + parseInt(breakStart[1] ?? "0");
        const breakEndMin =
          parseInt(breakEnd[0] ?? "0") * 60 + parseInt(breakEnd[1] ?? "0");
        return currentTime >= breakStartMin && currentTime < breakEndMin;
      });

      if (!isBreakTime) {
        slots.push({
          appointmentType: "default",
          date,
          doctor: availability.doctorId,
          duration: slotDuration,
          id: `${availability.doctorId}_${date}_${timeStr}`,
          time: timeStr,
        });
      }

      currentTime += slotDuration;
    }
  }

  return slots;
}

function isRuleApplicable(
  rule: Rule,
  appointmentType: string,
  patientContext: PatientContext,
  date: Date,
): boolean {
  // Check appointment type condition
  const appointmentTypeCondition = rule.conditions["appointmentType"] as
    | string
    | undefined;
  if (
    appointmentTypeCondition &&
    appointmentTypeCondition !== appointmentType
  ) {
    return false;
  }

  // Check patient type condition
  const patientTypeCondition = rule.conditions["patientType"] as
    | string
    | undefined;
  if (patientTypeCondition) {
    if (patientTypeCondition === "new" && !patientContext.isNewPatient) {
      return false;
    }
    if (patientTypeCondition === "existing" && patientContext.isNewPatient) {
      return false;
    }
  }

  // Check date range condition
  const dateRangeCondition = rule.conditions["dateRange"] as
    | { end: string; start: string }
    | undefined;
  if (dateRangeCondition) {
    const startDate = new Date(dateRangeCondition.start);
    const endDate = new Date(dateRangeCondition.end);
    if (date < startDate || date > endDate) {
      return false;
    }
  }

  // Check day of week condition
  const dayOfWeekCondition = rule.conditions["dayOfWeek"] as
    | number[]
    | undefined;
  if (dayOfWeekCondition && dayOfWeekCondition.length > 0) {
    if (!dayOfWeekCondition.includes(date.getDay())) {
      return false;
    }
  }

  return true;
}
