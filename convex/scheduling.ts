import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { api } from "./_generated/api";
import { query } from "./_generated/server";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

export const getAvailableSlots = query({
  args: {
    dateRange: dateRangeValidator,
    practiceId: v.id("practices"),
    ruleSetId: v.optional(v.id("ruleSets")), // Null for active set, specified for drafts
    simulatedContext: simulatedContextValidator,
  },
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

    // 1. Fetch all enabled rules for this rule set
    let rules: {
      [key: string]: unknown;
      _id: string;
      appliesTo?: "ALL_PRACTITIONERS" | "SPECIFIC_PRACTITIONERS";
      block_appointmentTypes?: string[];
      block_dateRangeEnd?: string;
      block_dateRangeStart?: string;
      block_daysOfWeek?: number[];
      block_timeRangeEnd?: string;
      block_timeRangeStart?: string;
      description?: string;
      limit_appointmentTypes?: string[];
      limit_count?: number;
      limit_perPractitioner?: boolean;
      priority: number;
      ruleType: "BLOCK" | "LIMIT_CONCURRENT";
      specificPractitioners?: string[];
    }[] = [];

    if (ruleSetId) {
      // Use the new rules system to get enabled rules for this rule set
      const rulesWithInfo = await ctx.runQuery(api.rules.getRulesForRuleSet, {
        enabledOnly: true,
        ruleSetId,
      });
      rules = rulesWithInfo.map((rule: {
        [key: string]: unknown;
        _id: { toString(): string };
        priority: number;
        ruleType: "BLOCK" | "LIMIT_CONCURRENT";
      }) => ({
        ...rule,
        _id: rule._id.toString(),
      }));
    } else {
      log.push("No rule set provided - no rules will be applied");
    }

    log.push(`Found ${rules.length} rules to evaluate`);

    // 2. Fetch relevant practitioners and their base schedules
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    log.push(`Found ${practitioners.length} practitioners`);

    // 3. Generate all "candidate slots" in memory for the date range
    const candidateSlots: {
      blockedByRuleId?: string;
      duration: number;
      locationId?: string;
      practitionerId: string;
      practitionerName: string;
      startTime: string;
      status: "AVAILABLE" | "BLOCKED";
    }[] = [];

    const startDate = new Date(args.dateRange.start);
    const endDate = new Date(args.dateRange.end);

    for (const practitioner of practitioners) {
      // Get base schedules for this practitioner
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) =>
          q.eq("practitionerId", practitioner._id),
        )
        .collect();

      // Generate slots for each day in the date range
      for (
        let currentDate = new Date(startDate);
        currentDate <= endDate;
        currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const dayOfWeek = currentDate.getDay();
        const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);

        if (schedule) {
          // Generate slots for this day based on schedule
          const [startHour, startMinute] = schedule.startTime
            .split(":")
            .map(Number);
          const [endHour, endMinute] = schedule.endTime.split(":").map(Number);

          if (
            startHour === undefined ||
            startMinute === undefined ||
            endHour === undefined ||
            endMinute === undefined
          ) {
            continue; // Skip invalid time format
          }

          // Create time objects using UTC to avoid timezone issues
          // Since currentDate is already in UTC representing the calendar day,
          // we need to set the hours in UTC as well to maintain consistency
          const dayStart = new Date(currentDate);
          dayStart.setUTCHours(startHour, startMinute, 0, 0);

          const dayEnd = new Date(currentDate);
          dayEnd.setUTCHours(endHour, endMinute, 0, 0);

          // Generate slots every 30 minutes (default duration)
          const slotDuration = 30;
          for (
            let slotTime = new Date(dayStart);
            slotTime < dayEnd;
            slotTime = new Date(slotTime.getTime() + slotDuration * 60 * 1000)
          ) {
            // Skip break times
            // Extract UTC time components for comparison with stored break times
            // This ensures consistent time handling regardless of server timezone
            const timeString = `${slotTime.getUTCHours().toString().padStart(2, "0")}:${slotTime.getUTCMinutes().toString().padStart(2, "0")}`;
            const isBreakTime =
              schedule.breakTimes?.some(
                (breakTime) =>
                  timeString >= breakTime.start && timeString < breakTime.end,
              ) ?? false;

            if (!isBreakTime) {
              candidateSlots.push({
                duration: slotDuration,
                practitionerId: practitioner._id,
                practitionerName: practitioner.name,
                startTime: slotTime.toISOString(),
                status: "AVAILABLE",
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
      const beforeCount = candidateSlots.filter(
        (s) => s.status === "AVAILABLE",
      ).length;

      // Apply rule based on its type and flat columns
      if (rule.ruleType === "BLOCK") {
        for (const slot of candidateSlots) {
          if (slot.status === "BLOCKED") {
            continue;
          } // Already blocked

          let shouldBlock = true;

          // Check days of week condition
          if (rule.block_daysOfWeek && Array.isArray(rule.block_daysOfWeek) && rule.block_daysOfWeek.length > 0) {
            const slotDate = new Date(slot.startTime);
            const dayOfWeek = slotDate.getDay();
            shouldBlock &&= (rule.block_daysOfWeek).includes(dayOfWeek);
          }

          // Check appointment type condition
          if (
            rule.block_appointmentTypes &&
            Array.isArray(rule.block_appointmentTypes) &&
            rule.block_appointmentTypes.length > 0
          ) {
            shouldBlock &&= (rule.block_appointmentTypes).includes(
              args.simulatedContext.appointmentType,
            );
          }

          // Practitioner tags feature has been removed

          // Check time range condition
          if (rule.block_timeRangeStart && rule.block_timeRangeEnd) {
            const slotDate = new Date(slot.startTime);
            const slotTime = `${slotDate.getHours().toString().padStart(2, "0")}:${slotDate.getMinutes().toString().padStart(2, "0")}`;
            shouldBlock &&=
              slotTime >= (rule.block_timeRangeStart) &&
              slotTime < (rule.block_timeRangeEnd);
          }

          // Check date range condition
          if (rule.block_dateRangeStart && rule.block_dateRangeEnd) {
            const slotDate = new Date(slot.startTime);
            const startDate = new Date(rule.block_dateRangeStart);
            const endDate = new Date(rule.block_dateRangeEnd);
            shouldBlock &&= slotDate >= startDate && slotDate <= endDate;
          }

          if (shouldBlock) {
            slot.status = "BLOCKED";
            slot.blockedByRuleId = rule._id;
          }
        }
      } else {
        // Implementation for concurrent limit rules
        if (
          rule.limit_count &&
          Array.isArray(rule.limit_appointmentTypes) &&
          (rule.limit_appointmentTypes).includes(
            args.simulatedContext.appointmentType,
          )
        ) {
          const availableSlots = candidateSlots.filter(
            (s) => s.status === "AVAILABLE",
          );

          if (rule.limit_perPractitioner) {
            // Limit per practitioner
            const practitionerGroups = new Map<string, typeof availableSlots>();
            for (const slot of availableSlots) {
              if (!practitionerGroups.has(slot.practitionerId)) {
                practitionerGroups.set(slot.practitionerId, []);
              }
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              practitionerGroups.get(slot.practitionerId)!.push(slot);
            }

            for (const [, slots] of practitionerGroups) {
              const limitCount = rule.limit_count;
              if (limitCount && slots.length > limitCount) {
                // Block excess slots (keeping first N)
                for (let i = limitCount; i < slots.length; i++) {
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
            const limitCount = rule.limit_count;
            if (limitCount && availableSlots.length > limitCount) {
              for (let i = limitCount; i < availableSlots.length; i++) {
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

      const afterCount = candidateSlots.filter(
        (s) => s.status === "AVAILABLE",
      ).length;
      if (beforeCount !== afterCount) {
        log.push(
          `Rule "${rule.description || rule._id}" blocked ${beforeCount - afterCount} slots`,
        );
      }
    }

    // 5. Return the full list of candidate slots with their final status
    const finalSlots = candidateSlots.map((slot) => ({
      blockedByRuleId: slot.blockedByRuleId as Id<"rules"> | undefined,
      duration: slot.duration,
      locationId: slot.locationId as Id<"locations"> | undefined,
      practitionerId: slot.practitionerId as Id<"practitioners">,
      practitionerName: slot.practitionerName,
      startTime: slot.startTime,
      status: slot.status,
    }));

    log.push(
      `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
    );

    return { log, slots: finalSlots };
  },
  returns: availableSlotsResultValidator,
});
