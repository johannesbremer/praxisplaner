import { Temporal } from "temporal-polyfill";

export interface PublicHoliday {
  date: string;
  fname: string;
}

let publicHolidaysCache: null | Set<string> = null;
let publicHolidaysDataCache: null | PublicHoliday[] = null;

/**
 * Loads public holidays from the JSON file and caches them.
 */
async function loadPublicHolidays(): Promise<Set<string>> {
  if (publicHolidaysCache) {
    return publicHolidaysCache;
  }

  try {
    const response = await fetch("/feiertage-niedersachsen-2025-2027.json");
    if (!response.ok) {
      console.error("Failed to load public holidays");
      return new Set();
    }

    const holidays = (await response.json()) as PublicHoliday[];
    publicHolidaysDataCache = holidays;
    publicHolidaysCache = new Set(holidays.map((h) => h.date));
    return publicHolidaysCache;
  } catch (error) {
    console.error("Error loading public holidays:", error);
    return new Set();
  }
}

/**
 * Checks if a given date is a public holiday.
 */
export async function isPublicHoliday(
  date: Temporal.PlainDate,
): Promise<boolean> {
  const holidays = await loadPublicHolidays();
  return holidays.has(date.toString());
}

/**
 * Gets all public holiday dates as Temporal.PlainDate objects.
 */
export async function getPublicHolidays(): Promise<Temporal.PlainDate[]> {
  const holidays = await loadPublicHolidays();
  return [...holidays].map((dateString) => Temporal.PlainDate.from(dateString));
}

/**
 * Synchronously checks if a date is a public holiday (requires holidays to be preloaded).
 */
export function isPublicHolidaySync(
  date: Temporal.PlainDate,
  holidays: Set<string>,
): boolean {
  return holidays.has(date.toString());
}

/**
 * Preload public holidays on app initialization.
 */
export async function preloadPublicHolidays(): Promise<void> {
  await loadPublicHolidays();
}

/**
 * Gets the cached public holidays set (returns empty set if not loaded).
 */
export function getPublicHolidaysSync(): Set<string> {
  return publicHolidaysCache ?? new Set();
}

/**
 * Gets the holiday name for a specific date.
 */
export function getPublicHolidayName(
  date: Temporal.PlainDate,
): string | undefined {
  if (!publicHolidaysDataCache) {
    return undefined;
  }
  return publicHolidaysDataCache.find((h) => h.date === date.toString())?.fname;
}

/**
 * Gets all public holidays data with names.
 */
export async function getPublicHolidaysData(): Promise<PublicHoliday[]> {
  await loadPublicHolidays();
  return publicHolidaysDataCache ?? [];
}
