import { Temporal } from "temporal-polyfill";

/**
 * Duration of each time slot in minutes
 */
export const SLOT_DURATION = 5;

/**
 * Hardcoded timezone for Berlin
 */
const TIMEZONE = "Europe/Berlin";

/**
 * Safe time-of-day for date conversions to avoid DST edge cases.
 * Noon is chosen because it's far from DST transitions which typically occur at 2-3 AM.
 */
const SAFE_TIME_OF_DAY = "12:00:00";

/**
 * Safely parses an ISO string to a Temporal.Instant.
 * @param isoString The ISO 8601 string to parse.
 * @returns The parsed Temporal.Instant, or null if parsing fails.
 * @example
 * ```ts
 * safeParseISOToInstant("2024-01-15T09:30:00Z") // Temporal.Instant
 * safeParseISOToInstant("invalid") // null
 * ```
 */
export function safeParseISOToInstant(
  isoString: string,
): null | Temporal.Instant {
  try {
    return Temporal.Instant.from(isoString);
  } catch (error) {
    console.error(
      `Failed to parse ISO string: ${isoString}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Safely parses an ISO string to a Temporal.ZonedDateTime in the Berlin timezone.
 * @param isoString The ISO 8601 string to parse.
 * @returns The parsed Temporal.ZonedDateTime, or null if parsing fails.
 * @example
 * ```ts
 * safeParseISOToZoned("2024-01-15T09:30:00Z") // Temporal.ZonedDateTime
 * safeParseISOToZoned("invalid") // null
 * ```
 */
export function safeParseISOToZoned(
  isoString: string,
): null | Temporal.ZonedDateTime {
  const instant = safeParseISOToInstant(isoString);
  if (!instant) {
    return null;
  }

  try {
    return instant.toZonedDateTimeISO(TIMEZONE);
  } catch (error) {
    console.error(
      `Failed to convert instant to zoned datetime: ${isoString}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Safely parses an ISO string to a Temporal.PlainDate in the Berlin timezone.
 * @param isoString The ISO 8601 string to parse.
 * @returns The parsed Temporal.PlainDate, or null if parsing fails.
 * @example
 * ```ts
 * safeParseISOToPlainDate("2024-01-15T09:30:00Z") // Temporal.PlainDate
 * safeParseISOToPlainDate("invalid") // null
 * ```
 */
export function safeParseISOToPlainDate(
  isoString: string,
): null | Temporal.PlainDate {
  const zoned = safeParseISOToZoned(isoString);
  return zoned ? zoned.toPlainDate() : null;
}

/**
 * Converts a JS Date to Temporal.PlainDate.
 * Uses the Europe/Berlin timezone.
 */
export function dateToTemporal(date: Date): Temporal.PlainDate {
  const instant = Temporal.Instant.fromEpochMilliseconds(date.getTime());
  return instant.toZonedDateTimeISO(TIMEZONE).toPlainDate();
}

/**
 * Converts a Temporal.PlainDate to JS Date.
 * Uses noon to avoid DST edge cases.
 */
export function temporalToDate(plainDate: Temporal.PlainDate): Date {
  const zdt = plainDate.toZonedDateTime({
    plainTime: Temporal.PlainTime.from(SAFE_TIME_OF_DAY),
    timeZone: TIMEZONE,
  });
  return new Date(zdt.epochMilliseconds);
}

/**
 * Converts Temporal's ISO 8601 day of week (Monday=1, Sunday=7) to legacy JavaScript format (Sunday=0, Monday=1).
 * This helper centralizes the conversion logic used throughout the application.
 * @param plainDate The Temporal.PlainDate to convert.
 * @returns The day of week as a number (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 * @example
 * ```ts
 * const monday = Temporal.PlainDate.from("2024-01-15"); // Monday
 * temporalDayToLegacy(monday) // 1
 *
 * const sunday = Temporal.PlainDate.from("2024-01-14"); // Sunday
 * temporalDayToLegacy(sunday) // 0
 * ```
 */
export function temporalDayToLegacy(plainDate: Temporal.PlainDate): number {
  // Temporal uses ISO 8601: Monday=1, ..., Sunday=7
  // JavaScript Date uses: Sunday=0, Monday=1, ..., Saturday=6
  return plainDate.dayOfWeek === 7 ? 0 : plainDate.dayOfWeek;
}

/**
 * Formats a Temporal.PlainDate as YYYY-MM-DD.
 */
export function formatDateISO(date: Temporal.PlainDate): string {
  return date.toString();
}

/**
 * Formats a Temporal.PlainDate as DD.MM.YYYY (German format).
 */
export function formatDateDE(date: Temporal.PlainDate): string {
  return `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}.${date.year}`;
}

/**
 * Formats a Temporal.PlainDate with day name (German).
 * @param date The date to format.
 * @returns Formatted date string like "Montag, 15. Januar".
 * @example
 * ```ts
 * formatDateLong(Temporal.PlainDate.from("2024-01-15")) // "Montag, 15. Januar"
 * ```
 */
export function formatDateLong(date: Temporal.PlainDate): string {
  const dayNames = [
    "Sonntag",
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
  ];
  const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];

  const dayOfWeek = temporalDayToLegacy(date);
  const dayName = dayNames[dayOfWeek];
  const monthName = monthNames[date.month - 1];

  return `${dayName}, ${date.day}. ${monthName}`;
}

/**
 * Gets the day name in German for a Temporal.PlainDate.
 */
export function getDayName(date: Temporal.PlainDate): string {
  const dayNames = [
    "Sonntag",
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
  ];
  const dayOfWeek = temporalDayToLegacy(date);
  return dayNames[dayOfWeek] ?? "Sonntag";
}

/**
 * Checks if a Temporal.PlainDate is today.
 * @param date The date to check.
 * @returns True if the date is today, false otherwise.
 * @example
 * ```ts
 * isToday(Temporal.PlainDate.from("2024-01-15")) // true or false depending on current date
 * ```
 */
export function isToday(date: Temporal.PlainDate): boolean {
  const today = Temporal.Now.plainDateISO(TIMEZONE);
  return Temporal.PlainDate.compare(date, today) === 0;
}

/**
 * Formats a Temporal.PlainDate with full date and day name in German format.
 * Includes the day of week, day number, month name, and year.
 * @param date The date to format.
 * @returns Formatted date string in German.
 * @example
 * ```ts
 * const date = Temporal.PlainDate.from('2024-01-15');
 * formatDateFull(date); // "Montag, 15. Januar 2024"
 * ```
 */
export function formatDateFull(date: Temporal.PlainDate): string {
  const dayNames = [
    "Sonntag",
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
  ];
  const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];

  const dayOfWeek = temporalDayToLegacy(date);
  const dayName = dayNames[dayOfWeek];
  const monthName = monthNames[date.month - 1];

  return `${dayName}, ${String(date.day).padStart(2, "0")}. ${monthName} ${date.year}`;
}

/**
 * Converts a time string to the number of minutes elapsed since midnight.
 * @param timeStr Time value in HH:mm format.
 * @returns Minutes elapsed since midnight.
 * @example
 * ```ts
 * timeToMinutes('09:30') // 570
 * timeToMinutes('14:15') // 855
 * ```
 */
export function timeToMinutes(timeStr: string): number {
  try {
    const time = Temporal.PlainTime.from(timeStr);
    return time.hour * 60 + time.minute;
  } catch {
    return 0;
  }
}

/**
 * Converts a time string to its corresponding slot index within business hours.
 * @param time Time value in HH:mm format.
 * @param businessStartHour The hour when business operations begin (e.g., 8 for 8 AM).
 * @returns Zero-based slot index within the business day.
 * @example
 * ```ts
 * timeToSlot('09:00', 8) // 12 (9:00 is 60 minutes after 8:00, 60/5 = 12)
 * timeToSlot('08:30', 8) // 6  (8:30 is 30 minutes after 8:00, 30/5 = 6)
 * ```
 */
export function timeToSlot(time: string, businessStartHour: number): number {
  const minutesFromMidnight = timeToMinutes(time);
  const minutesFromStart = minutesFromMidnight - businessStartHour * 60;
  return Math.floor(minutesFromStart / SLOT_DURATION);
}

/**
 * Converts a slot index to its corresponding time string.
 * @param slot Zero-based slot index from midnight (each slot is 5 minutes).
 * @param businessStartHour Optional hour offset (defaults to 0 for midnight).
 * @returns Time value in HH:mm format.
 * @example
 * ```ts
 * slotToTime(12)       // '01:00' (12 slots * 5 minutes = 60 minutes from midnight)
 * slotToTime(108)      // '09:00' (108 slots * 5 minutes = 540 minutes from midnight)
 * slotToTime(12, 8)    // '09:00' (start at 8AM, 12 slots * 5 min = 60 min after 8AM)
 * ```
 */
export function slotToTime(slot: number, businessStartHour = 0): string {
  const minutesFromMidnight = businessStartHour * 60 + slot * SLOT_DURATION;
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const time = Temporal.PlainTime.from({ hour: hours, minute: minutes });
  return time.toString().slice(0, 5); // "HH:mm"
}

/**
 * Determines the current time slot index if the current time falls within business hours.
 * @param currentTime The current date and time.
 * @param selectedDate The date to compare against.
 * @param businessStartHour The hour when business operations begin.
 * @param businessEndHour The hour when business operations end.
 * @returns Slot index, or -1 if outside business hours or on a different day.
 * @example
 * ```ts
 * const now = new Date('2024-01-15T09:30:00');
 * const selected = new Date('2024-01-15');
 * getCurrentTimeSlot(now, selected, 8, 18) // 6
 * ```
 */
export function getCurrentTimeSlot(
  currentTime: Date,
  selectedDate: Date,
  businessStartHour: number,
  businessEndHour: number,
): number {
  // Convert to Temporal for comparison
  const currentTemporal = dateToTemporal(currentTime);
  const selectedTemporal = dateToTemporal(selectedDate);

  // Check if it's the same day
  if (!currentTemporal.equals(selectedTemporal)) {
    return -1;
  }

  // Get time-of-day using Temporal for consistent timezone handling
  const currentZoned = Temporal.Instant.fromEpochMilliseconds(
    currentTime.getTime(),
  ).toZonedDateTimeISO(TIMEZONE);
  const hours = currentZoned.hour;
  const minutes = currentZoned.minute;
  const minutesFromMidnight = hours * 60 + minutes;
  const minutesFromStart = minutesFromMidnight - businessStartHour * 60;
  const totalBusinessMinutes = (businessEndHour - businessStartHour) * 60;

  if (
    minutesFromStart < 0 ||
    minutesFromStart >= totalBusinessMinutes ||
    Number.isNaN(minutesFromStart)
  ) {
    return -1;
  }

  return minutesFromStart / SLOT_DURATION;
}

/**
 * Calculates the vertical position and height of an appointment in the calendar grid.
 * @param startTime Start time in HH:mm format.
 * @param duration Length of the appointment in minutes.
 * @param businessStartHour The hour when business operations begin.
 * @param slotHeight Height of each slot in pixels (default: 16).
 * @returns Object containing the top position and height in pixels.
 * @example
 * ```ts
 * getAppointmentPosition('09:00', 30, 8)
 * // { top: 192, height: 96 }
 * // (9:00 is 12 slots after 8:00, 12 * 16 = 192px)
 * // (30 minutes = 6 slots, 6 * 16 = 96px)
 * ```
 */
export function getAppointmentPosition(
  startTime: string,
  duration: number,
  businessStartHour: number,
  slotHeight = 16,
): { height: number; top: number } {
  const startSlot = timeToSlot(startTime, businessStartHour);
  const slots = Math.ceil(duration / SLOT_DURATION);

  return {
    height: slots * slotHeight,
    top: startSlot * slotHeight,
  };
}

/**
 * Calculates the overall business hours and total slots from multiple schedules.
 * @param schedules Array of schedule objects containing startTime and endTime properties.
 * @returns Object containing businessStartHour, businessEndHour, and totalSlots.
 * @example
 * ```ts
 * const schedules = [
 *   { startTime: '08:00', endTime: '16:00' },
 *   { startTime: '09:00', endTime: '17:00' },
 * ];
 * calculateBusinessHours(schedules)
 * // { businessStartHour: 8, businessEndHour: 17, totalSlots: 108 }
 * ```
 */
export function calculateBusinessHours(
  schedules: { endTime: string; startTime: string }[],
): {
  businessEndHour: number;
  businessStartHour: number;
  totalSlots: number;
} {
  if (schedules.length === 0) {
    return {
      businessEndHour: 0,
      businessStartHour: 0,
      totalSlots: 0,
    };
  }

  const startTimes = schedules.map((s) => timeToMinutes(s.startTime));
  const endTimes = schedules.map((s) => timeToMinutes(s.endTime));

  const earliestStartMinutes = Math.min(...startTimes);
  const latestEndMinutes = Math.max(...endTimes);

  const businessStartHour = Math.floor(earliestStartMinutes / 60);
  const businessEndHour = Math.ceil(latestEndMinutes / 60);
  const totalSlots =
    ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

  return {
    businessEndHour,
    businessStartHour,
    totalSlots,
  };
}

/**
 * Formats a Temporal.PlainTime to HH:mm format with proper zero-padding.
 * This is more robust than using .toString().slice(0, 5) which assumes specific string format.
 * @param time The Temporal.PlainTime to format.
 * @returns Time string in HH:mm format (e.g., "09:05", "14:30").
 * @example
 * ```ts
 * formatTime(Temporal.PlainTime.from({ hour: 9, minute: 5 })) // "09:05"
 * formatTime(Temporal.PlainTime.from({ hour: 14, minute: 30 })) // "14:30"
 * ```
 */
export function formatTime(time: Temporal.PlainTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}
