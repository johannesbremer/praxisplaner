import { v } from "convex/values";
import { query } from "./_generated/server";

/** 
 * Generate available slots for a specific date, appointment type, and patient context
 * This is the core rules engine function that applies all active rules
 */
export const generateAvailableSlots = query({
  args: {
    practiceId: v.id("practices"),
    date: v.string(), // ISO date string
    appointmentType: v.string(),
    patientContext: v.object({
      isNewPatient: v.boolean(),
      assignedDoctor: v.union(v.string(), v.null()),
      lastVisit: v.union(v.string(), v.null()),
      medicalHistory: v.array(v.string()),
    }),
  },
  returns: v.object({
    slots: v.array(v.object({
      id: v.string(),
      time: v.string(),
      duration: v.number(),
      doctor: v.string(),
      appointmentType: v.string(),
      date: v.string(),
      notes: v.optional(v.string()),
    })),
    appliedRules: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get the active rule configuration for this practice
    const activeConfig = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true)
      )
      .first();
    
    if (!activeConfig) {
      throw new Error("No active rule configuration found for practice");
    }
    
    // Get all active rules for this configuration, ordered by priority
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q.eq("ruleConfigurationId", activeConfig._id).eq("active", true)
      )
      .collect();
    
    // Sort rules by priority (lower number = higher priority)
    rules.sort((a, b) => a.priority - b.priority);
    
    // Get base availability for the requested date
    const dateObj = new Date(args.date);
    const dayOfWeek = dateObj.getDay();
    
    const baseAvailabilities = await ctx.db
      .query("baseAvailability")
      .withIndex("by_practice_doctor_and_day", (q) =>
        q.eq("practiceId", args.practiceId).eq("dayOfWeek", dayOfWeek)
      )
      .collect();
    
    // Generate initial slots from base availability
    let slots = generateSlotsFromBaseAvailability(baseAvailabilities, args.date);
    
    // Apply each rule in priority order
    const appliedRules: string[] = [];
    
    for (const rule of rules) {
      if (isRuleApplicable(rule, args.appointmentType, args.patientContext, dateObj)) {
        const result = applyRule(rule, slots);
        if (result.applied) {
          slots = result.slots;
          appliedRules.push(rule.name);
        }
      }
    }
    
    return {
      slots,
      appliedRules,
    };
  },
});

/** 
 * Simulate slot generation for debugging (Debug View functionality)
 */
export const simulateSlotGeneration = query({
  args: {
    practiceId: v.id("practices"),
    dateRange: v.object({
      start: v.string(),
      end: v.string(),
    }),
    appointmentType: v.string(),
    patientContext: v.object({
      isNewPatient: v.boolean(),
      assignedDoctor: v.union(v.string(), v.null()),
      lastVisit: v.union(v.string(), v.null()),
      medicalHistory: v.array(v.string()),
    }),
  },
  returns: v.object({
    slots: v.array(v.object({
      id: v.string(),
      time: v.string(),
      duration: v.number(),
      doctor: v.string(),
      appointmentType: v.string(),
      date: v.string(),
      notes: v.optional(v.string()),
    })),
    appliedRules: v.array(v.string()),
    ruleTrace: v.array(v.object({
      ruleName: v.string(),
      applied: v.boolean(),
      reason: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    // Similar to generateAvailableSlots but with detailed tracing
    const activeConfig = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true)
      )
      .first();
    
    if (!activeConfig) {
      throw new Error("No active rule configuration found for practice");
    }
    
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q.eq("ruleConfigurationId", activeConfig._id).eq("active", true)
      )
      .collect();
    
    rules.sort((a, b) => a.priority - b.priority);
    
    // Generate slots for each day in the range
    const startDate = new Date(args.dateRange.start);
    const endDate = new Date(args.dateRange.end);
    let allSlots: any[] = [];
    const appliedRules: string[] = [];
    const ruleTrace: any[] = [];
    
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      
      const baseAvailabilities = await ctx.db
        .query("baseAvailability")
        .withIndex("by_practice_doctor_and_day", (q) =>
          q.eq("practiceId", args.practiceId).eq("dayOfWeek", dayOfWeek)
        )
        .collect();
      
      let daySlots = generateSlotsFromBaseAvailability(baseAvailabilities, dateStr);
      
      // Apply rules with tracing
      for (const rule of rules) {
        if (isRuleApplicable(rule, args.appointmentType, args.patientContext, date)) {
          const result = applyRule(rule, daySlots);
          
          ruleTrace.push({
            ruleName: rule.name,
            applied: result.applied,
            reason: result.message || "Rule conditions met",
          });
          
          if (result.applied) {
            daySlots = result.slots;
            if (!appliedRules.includes(rule.name)) {
              appliedRules.push(rule.name);
            }
          }
        } else {
          ruleTrace.push({
            ruleName: rule.name,
            applied: false,
            reason: "Rule conditions not met",
          });
        }
      }
      
      allSlots = allSlots.concat(daySlots);
    }
    
    return {
      slots: allSlots,
      appliedRules,
      ruleTrace,
    };
  },
});

// Helper functions (these would be expanded with full logic)

function generateSlotsFromBaseAvailability(baseAvailabilities: any[], date: string): any[] {
  const slots: any[] = [];
  
  for (const availability of baseAvailabilities) {
    const startTime = availability.startTime;
    const endTime = availability.endTime;
    const slotDuration = availability.slotDuration;
    const breakTimes = availability.breakTimes || [];
    
    // Generate time slots between start and end, excluding breaks
    // This is a simplified implementation
    const startHour = parseInt(startTime.split(':')[0]);
    const startMin = parseInt(startTime.split(':')[1]);
    const endHour = parseInt(endTime.split(':')[0]);
    const endMin = parseInt(endTime.split(':')[1]);
    
    let currentTime = startHour * 60 + startMin; // minutes from midnight
    const endTimeMin = endHour * 60 + endMin;
    
    while (currentTime + slotDuration <= endTimeMin) {
      const hour = Math.floor(currentTime / 60);
      const min = currentTime % 60;
      const timeStr = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
      
      // Check if this time overlaps with any break
      const isBreakTime = breakTimes.some((breakTime: any) => {
        const breakStart = breakTime.start.split(':');
        const breakEnd = breakTime.end.split(':');
        const breakStartMin = parseInt(breakStart[0]) * 60 + parseInt(breakStart[1]);
        const breakEndMin = parseInt(breakEnd[0]) * 60 + parseInt(breakEnd[1]);
        return currentTime >= breakStartMin && currentTime < breakEndMin;
      });
      
      if (!isBreakTime) {
        slots.push({
          id: `${availability.doctorId}_${date}_${timeStr}`,
          time: timeStr,
          duration: slotDuration,
          doctor: availability.doctorId,
          appointmentType: "default",
          date: date,
        });
      }
      
      currentTime += slotDuration;
    }
  }
  
  return slots;
}

function isRuleApplicable(rule: any, appointmentType: string, patientContext: any, date: Date): boolean {
  // Check appointment type condition
  if (rule.conditions.appointmentType && rule.conditions.appointmentType !== appointmentType) {
    return false;
  }
  
  // Check patient type condition
  if (rule.conditions.patientType) {
    if (rule.conditions.patientType === "new" && !patientContext.isNewPatient) {
      return false;
    }
    if (rule.conditions.patientType === "existing" && patientContext.isNewPatient) {
      return false;
    }
  }
  
  // Check date range condition
  if (rule.conditions.dateRange) {
    const startDate = new Date(rule.conditions.dateRange.start);
    const endDate = new Date(rule.conditions.dateRange.end);
    if (date < startDate || date > endDate) {
      return false;
    }
  }
  
  // Check day of week condition
  if (rule.conditions.dayOfWeek && rule.conditions.dayOfWeek.length > 0) {
    if (!rule.conditions.dayOfWeek.includes(date.getDay())) {
      return false;
    }
  }
  
  return true;
}

function applyRule(rule: any, slots: any[]): { applied: boolean; message: string; slots: any[] } {
  let currentSlots = [...slots];
  let message = "";
  let applied = false;
  
  // Apply extra time rule
  if (rule.actions.requireExtraTime && rule.actions.extraMinutes) {
    currentSlots = currentSlots.map(slot => ({
      ...slot,
      duration: slot.duration + rule.actions.extraMinutes,
      notes: `${slot.notes || ""} (Extra ${rule.actions.extraMinutes} min by ${rule.name})`.trim(),
    }));
    message += `Added ${rule.actions.extraMinutes} extra minutes. `;
    applied = true;
  }
  
  // Apply limit per day rule
  if (rule.actions.limitPerDay) {
    const limit = rule.actions.limitPerDay;
    const slotsPerDoctor = new Map<string, number>();
    const limitedSlots: any[] = [];
    
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
  if (rule.actions.blockTimeSlots && rule.actions.blockTimeSlots.length > 0) {
    const slotsToBlock = new Set(rule.actions.blockTimeSlots);
    const originalLength = currentSlots.length;
    currentSlots = currentSlots.filter(slot => !slotsToBlock.has(slot.time));
    
    if (currentSlots.length < originalLength) {
      message += `Blocked specific time slots. `;
      applied = true;
    }
  }
  
  return { applied, message, slots: currentSlots };
}