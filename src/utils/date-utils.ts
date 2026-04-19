import { Temporal } from "temporal-polyfill";

import { DE_DATE_REGEX, type DeDateString } from "@/lib/typed-regex";

/**
 * Result type for parsing operations.
 * Discriminated union that makes success/failure explicit.
 */
export type ParseResult<T> = { ok: false } | { ok: true; value: T };

function formatDeDate(day: number, month: number, year: number): DeDateString {
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}` as DeDateString;
}

function parseDeDateParts(
  dateDE: string,
): null | { day: number; month: number; year: number } {
  const match = DE_DATE_REGEX.exec(dateDE);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

/**
 * Parse a German date string (dd.mm.yyyy) to a Temporal.PlainDate.
 * Uses Result type for explicit success/failure handling.
 */
export function parseDateDE(dateDE: string): ParseResult<Temporal.PlainDate> {
  const parts = parseDeDateParts(dateDE);
  if (!parts) {
    return { ok: false };
  }

  try {
    const value = Temporal.PlainDate.from({
      day: parts.day,
      month: parts.month,
      year: parts.year,
    });
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/**
 * Format a Temporal.PlainDate to German format (dd.mm.yyyy).
 */
export function formatDateDE(dt: Temporal.PlainDate): DeDateString {
  return formatDeDate(dt.day, dt.month, dt.year);
}

/**
 * Check if a string is a valid German date format.
 * Simply tries to parse it - if parsing succeeds, it's valid.
 */
export function isValidDateDE(value: unknown): value is DeDateString {
  return typeof value === "string" && parseDateDE(value).ok;
}

/**
 * The timezone used for all date operations in this application.
 */
export const TIMEZONE = "Europe/Berlin";

/**
 * Check if a Temporal.PlainDate is today (in Europe/Berlin timezone).
 */
export function isToday(dt?: Temporal.PlainDate): boolean {
  if (!dt) {
    return true;
  }
  const today = Temporal.Now.plainDateISO(TIMEZONE);
  return Temporal.PlainDate.compare(dt, today) === 0;
}

/**
 * Get today's date as a Temporal.PlainDate (in Europe/Berlin timezone).
 */
export function getToday(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(TIMEZONE);
}

/**
 * Check if a JavaScript Date is today (in Europe/Berlin timezone).
 * Useful for legacy code still using Date objects.
 */
export function isTodayJS(dt?: Date): boolean {
  if (!dt) {
    return true;
  }
  const today = getToday();
  return (
    dt.getFullYear() === today.year &&
    dt.getMonth() + 1 === today.month &&
    dt.getDate() === today.day
  );
}

/**
 * Format a JavaScript Date to German format (dd.mm.yyyy).
 * Useful for legacy code still using Date objects.
 */
export function formatJSDateDE(dt: Date): DeDateString {
  return formatDeDate(dt.getDate(), dt.getMonth() + 1, dt.getFullYear());
}

/**
 * Parse a German date string (dd.mm.yyyy) to a JavaScript Date.
 * Uses Result type for explicit success/failure handling.
 * Useful for legacy code still using Date objects.
 */
export function parseJSDateDE(dateDE: string): ParseResult<Date> {
  const parts = parseDeDateParts(dateDE);
  if (!parts) {
    return { ok: false };
  }

  // Validate the numbers are reasonable
  if (
    parts.day < 1 ||
    parts.day > 31 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.year < 2000 ||
    parts.year > 2100
  ) {
    return { ok: false };
  }

  const dt = new Date(parts.year, parts.month - 1, parts.day);

  // Check the date didn't overflow (e.g., Feb 30 -> Mar 2)
  if (
    dt.getDate() !== parts.day ||
    dt.getMonth() !== parts.month - 1 ||
    dt.getFullYear() !== parts.year
  ) {
    return { ok: false };
  }

  return { ok: true, value: dt };
}

/**
 * Format a Temporal.ZonedDateTime string for German locale display.
 * Parses strings like "2024-01-15T10:30:00[Europe/Berlin]" and formats
 * to "Mo, 15. Jan. 2024, 10:30 Uhr".
 */
export function formatZonedDateTimeDE(dateTimeString: string): string {
  try {
    const zdt = Temporal.ZonedDateTime.from(dateTimeString);
    const dateStr = zdt.toLocaleString("de-DE", {
      day: "numeric",
      month: "short",
      weekday: "short",
      year: "numeric",
    });
    const timeStr = zdt.toLocaleString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${dateStr}, ${timeStr} Uhr`;
  } catch {
    return dateTimeString;
  }
}
