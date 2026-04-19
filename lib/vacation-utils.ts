import { Temporal } from "temporal-polyfill";

import { TIME_OF_DAY_REGEX } from "./typed-regex";

export interface BreakTimeLike {
  end: string;
  start: string;
}

export interface MinuteRange {
  endMinutes: number;
  startMinutes: number;
}

export interface ScheduleLike {
  breakTimes?: BreakTimeLike[];
  dayOfWeek: number;
  endTime: string;
  locationId?: string;
  practitionerId: string;
  startTime: string;
}

export interface VacationLike {
  date: string;
  portion: VacationPortion;
  practitionerId?: string;
  staffType: "mfa" | "practitioner";
}

export type VacationPortion = "afternoon" | "full" | "morning";

export function getPractitionerAvailabilityRangesForDate(
  date: Temporal.PlainDate,
  practitionerId: string,
  schedules: ScheduleLike[],
  vacations: VacationLike[],
  locationId?: string,
): MinuteRange[] {
  const workingRanges = getPractitionerWorkingRangesForDate(
    date,
    practitionerId,
    schedules,
    locationId,
  );

  if (workingRanges.length === 0) {
    return [];
  }

  const vacationRanges = getPractitionerVacationRangesForDate(
    date,
    practitionerId,
    schedules,
    vacations,
    locationId,
  );

  if (vacationRanges.length === 0) {
    return workingRanges;
  }

  return subtractRanges(workingRanges, vacationRanges);
}

export function getPractitionerVacationRangesForDate(
  date: Temporal.PlainDate,
  practitionerId: string,
  schedules: ScheduleLike[],
  vacations: VacationLike[],
  locationId?: string,
): MinuteRange[] {
  const dateKey = date.toString();
  const practitionerVacations = vacations.filter(
    (vacation) =>
      vacation.staffType === "practitioner" &&
      vacation.practitionerId === practitionerId &&
      vacation.date === dateKey,
  );

  if (practitionerVacations.length === 0) {
    return [];
  }

  const workingRanges = getPractitionerWorkingRangesForDate(
    date,
    practitionerId,
    schedules,
    locationId,
  );

  if (workingRanges.length === 0) {
    return [];
  }

  const fullDayRanges =
    practitionerVacations.some((vacation) => vacation.portion === "full") ||
    (practitionerVacations.some((vacation) => vacation.portion === "morning") &&
      practitionerVacations.some(
        (vacation) => vacation.portion === "afternoon",
      ));

  if (fullDayRanges) {
    return workingRanges;
  }

  const matchingSchedules = getMatchingSchedules(
    date,
    practitionerId,
    schedules,
    locationId,
  );
  const splitBreak = getPreferredSplitBreak(matchingSchedules);

  if (splitBreak) {
    const ranges: MinuteRange[] = [];

    if (
      practitionerVacations.some((vacation) => vacation.portion === "morning")
    ) {
      ranges.push(
        ...sliceRangesByMinutes(workingRanges, 0, splitBreak.startMinutes),
      );
    }

    if (
      practitionerVacations.some((vacation) => vacation.portion === "afternoon")
    ) {
      ranges.push(
        ...sliceRangesByMinutes(
          workingRanges,
          splitBreak.endMinutes,
          Number.POSITIVE_INFINITY,
        ),
      );
    }

    return mergeRanges(ranges);
  }

  const totalMinutes = workingRanges.reduce(
    (sum, range) => sum + (range.endMinutes - range.startMinutes),
    0,
  );

  if (totalMinutes === 0) {
    return [];
  }

  const midpoint = Math.ceil(totalMinutes / 10) * 5;
  const ranges: MinuteRange[] = [];

  if (
    practitionerVacations.some((vacation) => vacation.portion === "morning")
  ) {
    ranges.push(...sliceRangesByDuration(workingRanges, 0, midpoint));
  }

  if (
    practitionerVacations.some((vacation) => vacation.portion === "afternoon")
  ) {
    ranges.push(
      ...sliceRangesByDuration(workingRanges, midpoint, totalMinutes),
    );
  }

  return mergeRanges(ranges);
}

export function getPractitionerWorkingRangesForDate(
  date: Temporal.PlainDate,
  practitionerId: string,
  schedules: ScheduleLike[],
  locationId?: string,
): MinuteRange[] {
  const matchingSchedules = getMatchingSchedules(
    date,
    practitionerId,
    schedules,
    locationId,
  );

  const ranges = matchingSchedules.flatMap((schedule) => {
    const scheduleRange = {
      endMinutes: plainTimeToMinutes(schedule.endTime),
      startMinutes: plainTimeToMinutes(schedule.startTime),
    };

    if (scheduleRange.endMinutes <= scheduleRange.startMinutes) {
      return [];
    }

    return subtractBreaks(
      scheduleRange,
      normalizeBreaks(schedule.breakTimes, scheduleRange),
    );
  });

  return mergeRanges(ranges);
}

export function minuteRangeContains(
  ranges: MinuteRange[],
  minute: number,
): boolean {
  return ranges.some(
    (range) => minute >= range.startMinutes && minute < range.endMinutes,
  );
}

function getDayOfWeek(date: Temporal.PlainDate): number {
  return date.dayOfWeek === 7 ? 0 : date.dayOfWeek;
}

function getMatchingSchedules(
  date: Temporal.PlainDate,
  practitionerId: string,
  schedules: ScheduleLike[],
  locationId?: string,
): ScheduleLike[] {
  return schedules.filter((schedule) => {
    if (schedule.practitionerId !== practitionerId) {
      return false;
    }
    if (schedule.dayOfWeek !== getDayOfWeek(date)) {
      return false;
    }
    if (locationId && schedule.locationId !== locationId) {
      return false;
    }
    return true;
  });
}

function getPreferredSplitBreak(schedules: ScheduleLike[]): MinuteRange | null {
  const scheduleRanges = schedules
    .map((schedule) => ({
      breaks: normalizeBreaks(schedule.breakTimes, {
        endMinutes: plainTimeToMinutes(schedule.endTime),
        startMinutes: plainTimeToMinutes(schedule.startTime),
      }),
      endMinutes: plainTimeToMinutes(schedule.endTime),
      startMinutes: plainTimeToMinutes(schedule.startTime),
    }))
    .filter((schedule) => schedule.endMinutes > schedule.startMinutes);

  const candidateBreaks = scheduleRanges.flatMap((schedule) => schedule.breaks);

  if (candidateBreaks.length === 0) {
    return null;
  }

  const dayStart = Math.min(
    ...scheduleRanges.map((schedule) => schedule.startMinutes),
  );
  const dayEnd = Math.max(
    ...scheduleRanges.map((schedule) => schedule.endMinutes),
  );
  const dayCenter = (dayStart + dayEnd) / 2;

  const preferredBreak = candidateBreaks.toSorted((left, right) => {
    const durationDiff =
      right.endMinutes -
      right.startMinutes -
      (left.endMinutes - left.startMinutes);
    if (durationDiff !== 0) {
      return durationDiff;
    }

    const leftCenter = (left.startMinutes + left.endMinutes) / 2;
    const rightCenter = (right.startMinutes + right.endMinutes) / 2;
    const distanceDiff =
      Math.abs(leftCenter - dayCenter) - Math.abs(rightCenter - dayCenter);
    if (distanceDiff !== 0) {
      return distanceDiff;
    }

    return left.startMinutes - right.startMinutes;
  })[0];

  return preferredBreak ?? null;
}

function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  if (ranges.length <= 1) {
    return ranges;
  }

  const sorted = ranges.toSorted(
    (left, right) => left.startMinutes - right.startMinutes,
  );
  const merged: MinuteRange[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startMinutes > previous.endMinutes) {
      merged.push(range);
      continue;
    }

    previous.endMinutes = Math.max(previous.endMinutes, range.endMinutes);
  }

  return merged;
}

function normalizeBreaks(
  breakTimes: BreakTimeLike[] | undefined,
  range: MinuteRange,
): MinuteRange[] {
  if (!breakTimes || breakTimes.length === 0) {
    return [];
  }

  return breakTimes
    .map((entry) => ({
      endMinutes: Math.min(range.endMinutes, plainTimeToMinutes(entry.end)),
      startMinutes: Math.max(
        range.startMinutes,
        plainTimeToMinutes(entry.start),
      ),
    }))
    .filter((entry) => entry.endMinutes > entry.startMinutes)
    .toSorted((left, right) => left.startMinutes - right.startMinutes);
}

function plainTimeToMinutes(value: string): number {
  const match = TIME_OF_DAY_REGEX.exec(value);
  if (match) {
    const [, hours, minutes] = match;
    return Number(hours) * 60 + Number(minutes);
  }

  const time = Temporal.PlainTime.from(
    value.length === 5 ? `${value}:00` : value,
  );
  return time.hour * 60 + time.minute;
}

function sliceRangesByDuration(
  ranges: MinuteRange[],
  startOffsetMinutes: number,
  endOffsetMinutes: number,
): MinuteRange[] {
  if (endOffsetMinutes <= startOffsetMinutes) {
    return [];
  }

  const result: MinuteRange[] = [];
  let traversed = 0;

  for (const range of ranges) {
    const rangeDuration = range.endMinutes - range.startMinutes;
    const rangeStartOffset = traversed;
    const rangeEndOffset = traversed + rangeDuration;

    const overlapStart = Math.max(startOffsetMinutes, rangeStartOffset);
    const overlapEnd = Math.min(endOffsetMinutes, rangeEndOffset);

    if (overlapEnd > overlapStart) {
      result.push({
        endMinutes: range.startMinutes + (overlapEnd - rangeStartOffset),
        startMinutes: range.startMinutes + (overlapStart - rangeStartOffset),
      });
    }

    traversed = rangeEndOffset;
  }

  return result;
}

function sliceRangesByMinutes(
  ranges: MinuteRange[],
  startMinute: number,
  endMinute: number,
): MinuteRange[] {
  return ranges.flatMap((range) => {
    const overlapStart = Math.max(range.startMinutes, startMinute);
    const overlapEnd = Math.min(range.endMinutes, endMinute);

    if (overlapEnd <= overlapStart) {
      return [];
    }

    return [
      {
        endMinutes: overlapEnd,
        startMinutes: overlapStart,
      },
    ];
  });
}

function subtractBreaks(
  range: MinuteRange,
  breakRanges: MinuteRange[],
): MinuteRange[] {
  const result: MinuteRange[] = [];
  let cursor = range.startMinutes;

  for (const breakRange of breakRanges) {
    if (breakRange.startMinutes > cursor) {
      result.push({
        endMinutes: breakRange.startMinutes,
        startMinutes: cursor,
      });
    }
    cursor = Math.max(cursor, breakRange.endMinutes);
  }

  if (cursor < range.endMinutes) {
    result.push({
      endMinutes: range.endMinutes,
      startMinutes: cursor,
    });
  }

  return result;
}

function subtractRanges(
  ranges: MinuteRange[],
  blockedRanges: MinuteRange[],
): MinuteRange[] {
  if (ranges.length === 0 || blockedRanges.length === 0) {
    return ranges;
  }

  let remaining = mergeRanges(ranges);
  const mergedBlockedRanges = mergeRanges(blockedRanges);

  for (const blockedRange of mergedBlockedRanges) {
    const next: MinuteRange[] = [];

    for (const range of remaining) {
      if (
        blockedRange.endMinutes <= range.startMinutes ||
        blockedRange.startMinutes >= range.endMinutes
      ) {
        next.push(range);
        continue;
      }

      if (blockedRange.startMinutes > range.startMinutes) {
        next.push({
          endMinutes: blockedRange.startMinutes,
          startMinutes: range.startMinutes,
        });
      }

      if (blockedRange.endMinutes < range.endMinutes) {
        next.push({
          endMinutes: range.endMinutes,
          startMinutes: blockedRange.endMinutes,
        });
      }
    }

    remaining = next;
  }

  return remaining;
}
