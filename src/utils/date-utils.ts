import { Temporal } from "temporal-polyfill";

/**
 * Result type for parsing operations.
 * Discriminated union that makes success/failure explicit.
 */
export type ParseResult<T> = { ok: false } | { ok: true; value: T };

/**
 * Parse a German date string (dd.mm.yyyy) to a Temporal.PlainDate.
 * Uses Result type for explicit success/failure handling.
 */
export function parseDateDE(dateDE: string): ParseResult<Temporal.PlainDate> {
  const parts = dateDE.split(".");
  if (parts.length !== 3) {
    return { ok: false };
  }

  const [d, m, y] = parts;
  try {
    const value = Temporal.PlainDate.from({
      day: Number(d),
      month: Number(m),
      year: Number(y),
    });
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/**
 * Format a Temporal.PlainDate to German format (dd.mm.yyyy).
 */
export function formatDateDE(dt: Temporal.PlainDate): string {
  const d = String(dt.day).padStart(2, "0");
  const m = String(dt.month).padStart(2, "0");
  return `${d}.${m}.${dt.year}`;
}

/**
 * Check if a string is a valid German date format.
 * Simply tries to parse it - if parsing succeeds, it's valid.
 */
export function isValidDateDE(value: unknown): value is string {
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
export function formatJSDateDE(dt: Date): string {
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * Parse a German date string (dd.mm.yyyy) to a JavaScript Date.
 * Uses Result type for explicit success/failure handling.
 * Useful for legacy code still using Date objects.
 */
export function parseJSDateDE(dateDE: string): ParseResult<Date> {
  const parts = dateDE.split(".");
  if (parts.length !== 3) {
    return { ok: false };
  }

  const [ds, ms, ys] = parts;
  const d = Number(ds);
  const m = Number(ms);
  const y = Number(ys);

  // Validate the numbers are reasonable
  if (
    !Number.isFinite(d) ||
    !Number.isFinite(m) ||
    !Number.isFinite(y) ||
    d < 1 ||
    d > 31 ||
    m < 1 ||
    m > 12 ||
    y < 2000 ||
    y > 2100
  ) {
    return { ok: false };
  }

  const dt = new Date(y, m - 1, d);

  // Check the date didn't overflow (e.g., Feb 30 -> Mar 2)
  if (dt.getDate() !== d || dt.getMonth() !== m - 1 || dt.getFullYear() !== y) {
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
