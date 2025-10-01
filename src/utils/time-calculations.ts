import {
  addMinutes,
  differenceInMinutes,
  format,
  parse,
  startOfDay,
} from "date-fns";

/**
 * Duration of each time slot in minutes
 */
export const SLOT_DURATION = 5;

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
  const parsed = parse(timeStr, "HH:mm", new Date(0));
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return differenceInMinutes(parsed, startOfDay(parsed));
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
 * Converts a slot index back to its corresponding time string.
 * @param slot Zero-based slot index within the business day.
 * @param businessStartHour The hour when business operations begin (e.g., 8 for 8 AM).
 * @param selectedDate The reference date for time calculation.
 * @returns Time value in HH:mm format.
 * @example
 * ```ts
 * slotToTime(12, 8, new Date()) // '09:00'
 * slotToTime(6, 8, new Date())  // '08:30'
 * ```
 */
export function slotToTime(
  slot: number,
  businessStartHour: number,
  selectedDate: Date,
): string {
  const minutesFromStart = businessStartHour * 60 + slot * SLOT_DURATION;
  const dateForSlot = addMinutes(startOfDay(selectedDate), minutesFromStart);
  return format(dateForSlot, "HH:mm");
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
  // Check if it's the same day
  if (
    currentTime.getFullYear() !== selectedDate.getFullYear() ||
    currentTime.getMonth() !== selectedDate.getMonth() ||
    currentTime.getDate() !== selectedDate.getDate()
  ) {
    return -1;
  }

  const minutesFromMidnight = differenceInMinutes(
    currentTime,
    startOfDay(currentTime),
  );
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
