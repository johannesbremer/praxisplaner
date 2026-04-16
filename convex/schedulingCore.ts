import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export const SCHEDULING_TIMEZONE = "Europe/Berlin";

export interface CandidateSlot {
  blockedByBlockedSlotId?: string;
  blockedByRuleId?: string;
  duration: number;
  locationId?: string;
  practitionerId: string;
  practitionerName?: string;
  reason?: string;
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

const DEFAULT_SLOT_DURATION_MINUTES = 5;

export async function generateCandidateSlotsForDay(
  db: DatabaseReader,
  args: {
    date: Temporal.PlainDate;
    locationId?: Id<"locations">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<CandidateSlot[]> {
  const { date: targetPlainDate, locationId, practiceId, ruleSetId } = args;

  const [practitioners, schedules] = await Promise.all([
    db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
    db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
  ]);

  const practitionersForPractice = practitioners.filter(
    (practitioner) => practitioner.practiceId === practiceId,
  );
  const practitionerNameById = new Map(
    practitionersForPractice.map((practitioner) => [
      practitioner._id,
      practitioner.name,
    ]),
  );

  const dayOfWeek =
    targetPlainDate.dayOfWeek === 7 ? 0 : targetPlainDate.dayOfWeek;

  const filteredSchedules = schedules.filter((schedule) => {
    if (schedule.practiceId !== practiceId) {
      return false;
    }

    if (schedule.dayOfWeek !== dayOfWeek) {
      return false;
    }

    if (locationId && schedule.locationId !== locationId) {
      return false;
    }

    return true;
  });

  const candidateSlots: CandidateSlot[] = [];

  for (const schedule of filteredSchedules) {
    const scheduleStartTime = Temporal.PlainTime.from(
      `${schedule.startTime}:00`,
    );
    const scheduleEndTime = Temporal.PlainTime.from(`${schedule.endTime}:00`);

    const scheduleStart = targetPlainDate
      .toZonedDateTime({
        plainTime: scheduleStartTime,
        timeZone: SCHEDULING_TIMEZONE,
      })
      .toInstant();

    const scheduleEnd = targetPlainDate
      .toZonedDateTime({
        plainTime: scheduleEndTime,
        timeZone: SCHEDULING_TIMEZONE,
      })
      .toInstant();

    let currentInstant = scheduleStart;
    while (Temporal.Instant.compare(currentInstant, scheduleEnd) < 0) {
      const slotZoned = currentInstant.toZonedDateTimeISO(SCHEDULING_TIMEZONE);
      const timeString = `${slotZoned.hour.toString().padStart(2, "0")}:${slotZoned.minute.toString().padStart(2, "0")}`;

      const isBreakTime =
        schedule.breakTimes?.some(
          (breakTime) =>
            timeString >= breakTime.start && timeString < breakTime.end,
        ) ?? false;

      if (!isBreakTime) {
        candidateSlots.push({
          duration: DEFAULT_SLOT_DURATION_MINUTES,
          locationId: schedule.locationId,
          practitionerId: schedule.practitionerId,
          practitionerName:
            practitionerNameById.get(schedule.practitionerId) ??
            "Unknown Practitioner",
          startTime: slotZoned.toString(),
          status: "AVAILABLE",
        });
      }

      currentInstant = currentInstant.add({
        minutes: DEFAULT_SLOT_DURATION_MINUTES,
      });
    }
  }

  return candidateSlots;
}

export function isSlotStartInFuture(
  startTime: string,
  nowInstant: Temporal.Instant,
): boolean {
  try {
    const slotInstant = Temporal.ZonedDateTime.from(startTime).toInstant();
    return Temporal.Instant.compare(slotInstant, nowInstant) > 0;
  } catch {
    return false;
  }
}

export function slotOverlapsAppointment(
  slot: Pick<
    CandidateSlot,
    "duration" | "locationId" | "practitionerId" | "startTime"
  >,
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "practitionerLineageKey" | "start"
  >,
): boolean {
  if (slot.locationId !== appointment.locationLineageKey) {
    return false;
  }

  if (slot.practitionerId !== appointment.practitionerLineageKey) {
    return false;
  }

  const slotZoned = Temporal.ZonedDateTime.from(slot.startTime);
  const slotEndZoned = slotZoned.add({
    minutes: slot.duration,
  });
  const appointmentStart = Temporal.ZonedDateTime.from(
    appointment.start,
  ).toInstant();
  const appointmentEnd = Temporal.ZonedDateTime.from(
    appointment.end,
  ).toInstant();

  return (
    Temporal.Instant.compare(slotZoned.toInstant(), appointmentEnd) < 0 &&
    Temporal.Instant.compare(slotEndZoned.toInstant(), appointmentStart) > 0
  );
}

export function slotOverlapsBlockedSlot(
  slot: Pick<CandidateSlot, "duration" | "practitionerId" | "startTime">,
  blockedSlot: Doc<"blockedSlots">,
): boolean {
  const slotZoned = Temporal.ZonedDateTime.from(slot.startTime);
  const slotEndZoned = slotZoned.add({
    minutes: slot.duration,
  });
  const blockedStart = Temporal.ZonedDateTime.from(
    blockedSlot.start,
  ).toInstant();
  const blockedEnd = Temporal.ZonedDateTime.from(blockedSlot.end).toInstant();

  if (
    blockedSlot.practitionerId &&
    blockedSlot.practitionerId !== slot.practitionerId
  ) {
    return false;
  }

  const slotInstant = slotZoned.toInstant();
  const slotEndInstant = slotEndZoned.toInstant();
  return (
    Temporal.Instant.compare(slotInstant, blockedEnd) < 0 &&
    Temporal.Instant.compare(slotEndInstant, blockedStart) > 0
  );
}
