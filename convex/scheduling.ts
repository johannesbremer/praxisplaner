import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { SlotContext } from "./ruleEngine/types";

import { query } from "./_generated/server";
import { evaluateCondition, evaluateRules } from "./ruleEngine/evaluator";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

interface SchedulingResultSlot {
  blockedByRuleId?: Id<"rules">;
  duration: number;
  locationId?: Id<"locations">;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

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

    // 1. Fetch all rules for this rule set (ordered by priority)
    const rules = ruleSetId
      ? await ctx.db
          .query("rules")
          .withIndex("by_ruleSetId_priority", (q) =>
            q.eq("ruleSetId", ruleSetId),
          )
          .filter((q) => q.eq(q.field("enabled"), true))
          .collect()
      : [];

    log.push(`Found ${rules.length} enabled rules to evaluate`);

    // 2. Fetch relevant practitioners and their base schedules
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    log.push(`Found ${practitioners.length} practitioners`);

    // 2.5. Fetch available locations for this practice
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    log.push(`Found ${locations.length} locations`);

    // Determine which location to use for new appointments
    let defaultLocationId: string | undefined;
    if (args.simulatedContext.locationId) {
      // Use the specified location if provided
      defaultLocationId = args.simulatedContext.locationId;
      log.push(`Using specified location: ${defaultLocationId}`);
    } else if (locations.length > 0) {
      // Default to the first available location
      const firstLocation = locations[0];
      if (firstLocation) {
        defaultLocationId = firstLocation._id;
        log.push(`Using default location: ${defaultLocationId}`);
      }
    } else {
      log.push("No locations available - slots will have no location assigned");
    }

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
      // Get base schedules for this practitioner and location
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) =>
          q.eq("practitionerId", practitioner._id),
        )
        .filter((q) => {
          // If a location is specified in simulatedContext, only get schedules for that location
          if (args.simulatedContext.locationId) {
            return q.eq(
              q.field("locationId"),
              args.simulatedContext.locationId,
            );
          }
          // If no location specified, get all schedules (backward compatibility)
          return true;
        })
        .collect();

      log.push(
        `Practitioner ${practitioner.name}: Found ${schedules.length} schedules` +
          (args.simulatedContext.locationId
            ? ` for location ${args.simulatedContext.locationId}`
            : " (all locations)"),
      );

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
                ...(defaultLocationId && { locationId: defaultLocationId }),
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

    // 4. Evaluate rules using lambda calculus engine
    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED") {
        continue; // Already blocked
      }

      // Map slot to SlotContext for evaluation
      const slotContext: SlotContext = {
        doctor: slot.practitionerId,
        duration: slot.duration,
        end: new Date(
          new Date(slot.startTime).getTime() + slot.duration * 60 * 1000,
        ).toISOString(),
        start: slot.startTime,
        type: args.simulatedContext.appointmentType,
        ...(slot.locationId && { location: slot.locationId }),
      };

      // Fetch relevant appointments for this slot (needed for Count, TimeRangeFree, Adjacent conditions)
      const relevantAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_start_end", (q) =>
          q
            .gte("start", slot.startTime)
            .lte(
              "start",
              new Date(
                new Date(slot.startTime).getTime() + 4 * 60 * 60 * 1000,
              ).toISOString(),
            ),
        )
        .filter((q) => q.eq(q.field("practiceId"), args.practiceId))
        .collect();

      // Map to AppointmentContext
      const appointments = relevantAppointments.map((apt) => {
        const appointmentCtx: {
          _id: Id<"appointments">;
          doctor?: string;
          end: string;
          location?: string;
          start: string;
          type?: string;
        } = {
          _id: apt._id,
          end: apt.end,
          start: apt.start,
        };
        if (apt.appointmentType) {
          appointmentCtx.type = apt.appointmentType;
        }
        if (apt.practitionerId) {
          appointmentCtx.doctor = apt.practitionerId;
        }
        if (apt.locationId) {
          appointmentCtx.location = apt.locationId;
        }
        return appointmentCtx;
      });

      // Evaluate rules for this slot
      const result = await evaluateRules(
        ctx.db,
        rules,
        slotContext,
        appointments,
        {
          practiceId: args.practiceId,
          ruleSetId,
        },
      );

      // Apply the evaluation result
      if (result.action === "BLOCK") {
        slot.status = "BLOCKED";
        if (result.ruleId) {
          slot.blockedByRuleId = result.ruleId.toString();
        }
        if (result.ruleName) {
          log.push(
            `Slot ${slot.startTime} blocked by rule "${result.ruleName}"${result.message ? `: ${result.message}` : ""}`,
          );
        }
      } else if (result.zones?.createZone) {
        // Handle zone creation when ALLOW rule has createZone
        const { createZone } = result.zones;

        // Evaluate the zone creation condition
        const shouldCreateZone = await evaluateCondition(
          ctx.db,
          createZone.condition,
          slotContext,
          appointments,
          {
            practiceId: args.practiceId,
            ruleSetId,
          },
        );

        if (shouldCreateZone) {
          // Calculate zone start time
          const slotStartTime = new Date(slot.startTime);
          const slotEndTime = new Date(
            slotStartTime.getTime() + slot.duration * 60 * 1000,
          );
          const zoneStartTime =
            createZone.zone.start === "Slot.end" ? slotEndTime : slotStartTime;

          // Parse duration (e.g., "30m", "1h")
          const durationMatch = /^(\d+)([mh])$/.exec(createZone.zone.duration);
          if (!durationMatch?.[1]) {
            log.push(
              `Warning: Invalid zone duration format: ${createZone.zone.duration}`,
            );
            continue;
          }

          const durationValue = Number.parseInt(durationMatch[1], 10);
          const durationUnit = durationMatch[2];
          const durationMinutes =
            durationUnit === "h" ? durationValue * 60 : durationValue;

          const zoneEndTime = new Date(
            zoneStartTime.getTime() + durationMinutes * 60 * 1000,
          );

          log.push(
            `Zone should be created from ${zoneStartTime.toISOString()} to ${zoneEndTime.toISOString()} for rule "${result.ruleName}" (allows only: ${createZone.zone.allowOnly.join(", ")})`,
          );

          // Note: Actual zone creation needs to happen in a mutation when a booking is confirmed
          // This query only identifies when zones should be created
        }
      }
    }

    // 5. Return the full list of candidate slots with their final status
    const finalSlots: SchedulingResultSlot[] = candidateSlots.map((slot) => {
      const slotResult: SchedulingResultSlot = {
        duration: slot.duration,
        practitionerId: slot.practitionerId as Id<"practitioners">,
        practitionerName: slot.practitionerName,
        startTime: slot.startTime,
        status: slot.status,
      };

      if (slot.blockedByRuleId) {
        slotResult.blockedByRuleId = slot.blockedByRuleId as Id<"rules">;
      }

      if (slot.locationId) {
        slotResult.locationId = slot.locationId as Id<"locations">;
      }

      return slotResult;
    });

    log.push(
      `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
    );

    return { log, slots: finalSlots };
  },
  returns: availableSlotsResultValidator,
});
