import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import {
  asLocationId,
  asLocationLineageKey,
  asPractitionerLineageKey,
  type LocationLineageKey,
  type PractitionerLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";

export const SCHEDULING_TIMEZONE = "Europe/Berlin";

export interface CandidateSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">;
  blockedByRuleId?: Id<"ruleConditions">;
  duration: number;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey: PractitionerLineageKey;
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

  const [locations, practitioners, schedules] = await Promise.all([
    db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
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
  const practitionerLineageKeys = new Set(
    practitionersForPractice.map((practitioner) =>
      asPractitionerLineageKey(
        requireLineageKey({
          entityId: practitioner._id,
          entityType: "practitioner",
          lineageKey: practitioner.lineageKey,
          ruleSetId: practitioner.ruleSetId,
        }),
      ),
    ),
  );
  const locationIdByLineageKey = new Map(
    locations
      .filter((location) => location.practiceId === practiceId)
      .map((location) => [
        asLocationLineageKey(
          requireLineageKey({
            entityId: location._id,
            entityType: "location",
            lineageKey: location.lineageKey,
            ruleSetId: location.ruleSetId,
          }),
        ),
        asLocationId(location._id),
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

    if (
      locationId &&
      locationIdByLineageKey.get(
        asLocationLineageKey(schedule.locationLineageKey),
      ) !== asLocationId(locationId)
    ) {
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
        const locationLineageKey = asLocationLineageKey(
          schedule.locationLineageKey,
        );
        const practitionerLineageKey = asPractitionerLineageKey(
          schedule.practitionerLineageKey,
        );
        if (!locationIdByLineageKey.has(locationLineageKey)) {
          throw new Error(
            `[INVARIANT:SCHEDULE_LOCATION_NOT_RESOLVED] Arbeitszeit ${schedule._id} referenziert Standort-Lineage ${locationLineageKey}, die in Regelset ${ruleSetId} nicht aufgelöst werden konnte.`,
          );
        }
        if (!practitionerLineageKeys.has(practitionerLineageKey)) {
          throw new Error(
            `[INVARIANT:SCHEDULE_PRACTITIONER_NOT_RESOLVED] Arbeitszeit ${schedule._id} referenziert Behandler-Lineage ${practitionerLineageKey}, die in Regelset ${ruleSetId} nicht aufgelöst werden konnte.`,
          );
        }
        candidateSlots.push({
          duration: DEFAULT_SLOT_DURATION_MINUTES,
          locationLineageKey,
          practitionerLineageKey,
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
    "duration" | "locationLineageKey" | "practitionerLineageKey" | "startTime"
  >,
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "practitionerLineageKey" | "start"
  > & {
    locationLineageKey: LocationLineageKey;
    practitionerLineageKey?: PractitionerLineageKey;
  },
): boolean {
  if (slot.locationLineageKey !== appointment.locationLineageKey) {
    return false;
  }

  if (slot.practitionerLineageKey !== appointment.practitionerLineageKey) {
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
  slot: Pick<
    CandidateSlot,
    "duration" | "practitionerLineageKey" | "startTime"
  >,
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
    blockedSlot.practitionerLineageKey &&
    blockedSlot.practitionerLineageKey !== slot.practitionerLineageKey
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
