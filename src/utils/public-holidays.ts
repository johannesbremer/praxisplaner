import { format } from "date-fns";

export interface PublicHoliday {
  date: string;
  fname: string;
}

let publicHolidaysCache: null | Set<string> = null;
let publicHolidaysDataCache: null | PublicHoliday[] = null;

/**
 * Loads public holidays from the JSON file and caches them as a Set of date strings (YYYY-MM-DD).
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
 * @param date The date to check
 * @returns true if the date is a public holiday
 */
export async function isPublicHoliday(date: Date): Promise<boolean> {
  const holidays = await loadPublicHolidays();
  const dateString = format(date, "yyyy-MM-dd");
  return holidays.has(dateString);
}

/**
 * Gets all public holiday dates as Date objects.
 */
export async function getPublicHolidays(): Promise<Date[]> {
  const holidays = await loadPublicHolidays();
  return [...holidays].map((dateString) => new Date(dateString));
}

/**
 * Synchronously checks if a date is a public holiday (requires holidays to be preloaded).
 * @param date The date to check
 * @param holidays Set of holiday date strings in yyyy-MM-dd format
 */
export function isPublicHolidaySync(
  date: Date,
  holidays: Set<string>,
): boolean {
  const dateString = format(date, "yyyy-MM-dd");
  return holidays.has(dateString);
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
 * @param date The date to check
 * @returns The holiday name if found, undefined otherwise
 */
export function getPublicHolidayName(date: Date): string | undefined {
  if (!publicHolidaysDataCache) {
    return undefined;
  }
  const dateString = format(date, "yyyy-MM-dd");
  return publicHolidaysDataCache.find((h) => h.date === dateString)?.fname;
}

/**
 * Gets all public holidays data with names.
 */
export async function getPublicHolidaysData(): Promise<PublicHoliday[]> {
  await loadPublicHolidays();
  return publicHolidaysDataCache ?? [];
}
