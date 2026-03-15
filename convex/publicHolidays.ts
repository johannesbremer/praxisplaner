import { Temporal } from "temporal-polyfill";

import publicHolidaysJson from "../public/feiertage-niedersachsen-2025-2027.json";

interface PublicHolidayRecord {
  date: string;
  fname: string;
}

const publicHolidayDates = new Set(
  (publicHolidaysJson as PublicHolidayRecord[]).map((holiday) => holiday.date),
);

export function isPublicHoliday(date: Temporal.PlainDate): boolean {
  return publicHolidayDates.has(date.toString());
}
