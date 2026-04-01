import { Temporal } from "temporal-polyfill";

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
  const matchingSchedules = schedules.filter((schedule) => {
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
