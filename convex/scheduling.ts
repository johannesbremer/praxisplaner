import { query } from "./_generated/server";
import { v } from "convex/values";

export const getAvailableSlots = query({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.optional(v.id("ruleSets")), // Null for active set, specified for drafts
    dateRange: v.object({ start: v.string(), end: v.string() }),
    simulatedContext: v.object({
      appointmentType: v.string(),
      patient: v.object({ isNew: v.boolean() }),
    }),
  },
  returns: v.object({
    log: v.array(v.string()),
    slots: v.array(v.object({
      startTime: v.string(),
      practitionerId: v.id("practitioners"),
      status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
      blockedByRuleId: v.optional(v.id("rules")),
      practitionerName: v.string(),
      duration: v.number(),
      locationId: v.optional(v.id("locations")),
    })),
  }),
  handler: async (ctx, args) => {
    const log: string[] = [];
    
    // 1. Fetch active or specified ruleSet and its associated rules
    let ruleSetId = args.ruleSetId;
    if (!ruleSetId) {
      const practice = await ctx.db.get(args.practiceId);
      if (!practice?.currentActiveRuleSetId) {
        log.push("No active rule set found, using empty rules");
        return { log, slots: [] };
      }
      ruleSetId = practice.currentActiveRuleSetId;
    }

    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    log.push(`Found ${rules.length} rules to evaluate`);

    // 2. Fetch relevant practitioners and their base schedules
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    log.push(`Found ${practitioners.length} practitioners`);

    // 3. Generate all "candidate slots" in memory for the date range
    const candidateSlots: Array<{
      startTime: string;
      practitionerId: string;
      practitionerName: string;
      status: "AVAILABLE" | "BLOCKED";
      blockedByRuleId?: string;
      duration: number;
      locationId?: string;
    }> = [];

    const startDate = new Date(args.dateRange.start);
    const endDate = new Date(args.dateRange.end);

    for (const practitioner of practitioners) {
      // Get base schedules for this practitioner
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) => q.eq("practitionerId", practitioner._id))
        .collect();

      // Generate slots for each day in the date range
      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dayOfWeek = date.getDay();
        const schedule = schedules.find(s => s.dayOfWeek === dayOfWeek);
        
        if (schedule) {
          // Generate slots for this day based on schedule
          const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
          const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
          
          if (startHour === undefined || startMinute === undefined || endHour === undefined || endMinute === undefined) {
            continue; // Skip invalid time format
          }
          
          const dayStart = new Date(date);
          dayStart.setHours(startHour, startMinute, 0, 0);
          
          const dayEnd = new Date(date);
          dayEnd.setHours(endHour, endMinute, 0, 0);
          
          // Generate slots every slotDuration minutes
          for (let slotTime = new Date(dayStart); slotTime < dayEnd; slotTime.setMinutes(slotTime.getMinutes() + schedule.slotDuration)) {
            // Skip break times
            const timeString = `${slotTime.getHours().toString().padStart(2, '0')}:${slotTime.getMinutes().toString().padStart(2, '0')}`;
            const isBreakTime = schedule.breakTimes?.some(breakTime => 
              timeString >= breakTime.start && timeString < breakTime.end
            );
            
            if (!isBreakTime) {
              candidateSlots.push({
                startTime: slotTime.toISOString(),
                practitionerId: practitioner._id,
                practitionerName: practitioner.name,
                status: "AVAILABLE",
                duration: schedule.slotDuration,
              });
            }
          }
        }
      }
    }

    log.push(`Generated ${candidateSlots.length} candidate slots`);

    // 4. Apply rules in passes, ordered by priority
    const sortedRules = rules.sort((a, b) => a.priority - b.priority);
    
    for (const rule of sortedRules) {
      const beforeCount = candidateSlots.filter(s => s.status === "AVAILABLE").length;
      
      // Apply rule based on its type and flat columns
      if (rule.ruleType === "BLOCK") {
        for (const slot of candidateSlots) {
          if (slot.status === "BLOCKED") continue; // Already blocked
          
          let shouldBlock = true;
          
          // Check days of week condition
          if (rule.block_daysOfWeek && rule.block_daysOfWeek.length > 0) {
            const slotDate = new Date(slot.startTime);
            const dayOfWeek = slotDate.getDay();
            shouldBlock = shouldBlock && rule.block_daysOfWeek.includes(dayOfWeek);
          }
          
          // Check appointment type condition
          if (rule.block_appointmentTypes && rule.block_appointmentTypes.length > 0) {
            shouldBlock = shouldBlock && rule.block_appointmentTypes.includes(args.simulatedContext.appointmentType);
          }
          
          // Check practitioner tags exception
          if (rule.block_exceptForPractitionerTags && rule.block_exceptForPractitionerTags.length > 0) {
            const practitioner = practitioners.find(p => p._id === slot.practitionerId);
            const hasExceptionTag = practitioner?.tags?.some(tag => 
              rule.block_exceptForPractitionerTags!.includes(tag)
            );
            if (hasExceptionTag) {
              shouldBlock = false;
            }
          }
          
          // Check time range condition
          if (rule.block_timeRangeStart && rule.block_timeRangeEnd) {
            const slotDate = new Date(slot.startTime);
            const slotTime = `${slotDate.getHours().toString().padStart(2, '0')}:${slotDate.getMinutes().toString().padStart(2, '0')}`;
            shouldBlock = shouldBlock && (slotTime >= rule.block_timeRangeStart && slotTime < rule.block_timeRangeEnd);
          }
          
          // Check date range condition
          if (rule.block_dateRangeStart && rule.block_dateRangeEnd) {
            const slotDate = new Date(slot.startTime);
            const startDate = new Date(rule.block_dateRangeStart);
            const endDate = new Date(rule.block_dateRangeEnd);
            shouldBlock = shouldBlock && (slotDate >= startDate && slotDate <= endDate);
          }
          
          if (shouldBlock) {
            slot.status = "BLOCKED";
            slot.blockedByRuleId = rule._id;
          }
        }
      } else if (rule.ruleType === "LIMIT_CONCURRENT") {
        // Implementation for concurrent limit rules
        if (rule.limit_count && rule.limit_appointmentTypes?.includes(args.simulatedContext.appointmentType)) {
          const availableSlots = candidateSlots.filter(s => s.status === "AVAILABLE");
          
          if (rule.limit_perPractitioner) {
            // Limit per practitioner
            const practitionerGroups = new Map<string, typeof availableSlots>();
            for (const slot of availableSlots) {
              if (!practitionerGroups.has(slot.practitionerId)) {
                practitionerGroups.set(slot.practitionerId, []);
              }
              practitionerGroups.get(slot.practitionerId)!.push(slot);
            }
            
            for (const [, slots] of practitionerGroups) {
              if (slots.length > rule.limit_count) {
                // Block excess slots (keeping first N)
                for (let i = rule.limit_count; i < slots.length; i++) {
                  const slot = slots[i];
                  if (slot) {
                    slot.status = "BLOCKED";
                    slot.blockedByRuleId = rule._id;
                  }
                }
              }
            }
          } else {
            // Global limit
            if (availableSlots.length > rule.limit_count) {
              for (let i = rule.limit_count; i < availableSlots.length; i++) {
                const slot = availableSlots[i];
                if (slot) {
                  slot.status = "BLOCKED";
                  slot.blockedByRuleId = rule._id;
                }
              }
            }
          }
        }
      }
      
      const afterCount = candidateSlots.filter(s => s.status === "AVAILABLE").length;
      if (beforeCount !== afterCount) {
        log.push(`Rule "${rule.description}" blocked ${beforeCount - afterCount} slots`);
      }
    }

    // 5. Return the full list of candidate slots with their final status
    const finalSlots = candidateSlots.map(slot => ({
      startTime: slot.startTime,
      practitionerId: slot.practitionerId as any, // Type assertion for ID
      status: slot.status,
      blockedByRuleId: slot.blockedByRuleId as any, // Type assertion for optional ID
      practitionerName: slot.practitionerName,
      duration: slot.duration,
      locationId: slot.locationId as any, // Type assertion for optional ID
    }));

    log.push(`Final result: ${finalSlots.filter(s => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter(s => s.status === "BLOCKED").length} blocked slots`);

    return { log, slots: finalSlots };
  },
});