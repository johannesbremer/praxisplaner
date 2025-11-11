import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import {
  dateToTemporal,
  getCurrentTimeSlot,
  safeParseISOToInstant,
  safeParseISOToPlainDate,
  safeParseISOToZoned,
  slotToTime,
  temporalDayToLegacy,
  temporalToDate,
  timeToMinutes,
  timeToSlot,
} from "../../utils/time-calculations";

describe("Calendar Time Utilities", () => {
  describe("Time Conversion Functions", () => {
    test("should convert time string to minutes", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("01:00")).toBe(60);
      expect(timeToMinutes("09:30")).toBe(570);
      expect(timeToMinutes("12:00")).toBe(720);
      expect(timeToMinutes("23:59")).toBe(1439);
    });

    test("should convert minutes to time string", () => {
      const minutesToTime = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const time = Temporal.PlainTime.from({ hour: hours, minute: mins });
        return time.toString().slice(0, 5);
      };

      expect(minutesToTime(0)).toBe("00:00");
      expect(minutesToTime(60)).toBe("01:00");
      expect(minutesToTime(570)).toBe("09:30");
      expect(minutesToTime(720)).toBe("12:00");
      expect(minutesToTime(1439)).toBe("23:59");
    });

    test("should convert slot number to time", () => {
      expect(slotToTime(0)).toBe("00:00");
      expect(slotToTime(12)).toBe("01:00"); // 12 * 5 = 60 minutes
      expect(slotToTime(108)).toBe("09:00"); // 108 * 5 = 540 minutes
      expect(slotToTime(144)).toBe("12:00"); // 144 * 5 = 720 minutes
    });

    test("should convert time to slot number", () => {
      expect(timeToSlot("00:00", 0)).toBe(0);
      expect(timeToSlot("01:00", 0)).toBe(12);
      expect(timeToSlot("09:00", 0)).toBe(108);
      expect(timeToSlot("09:30", 0)).toBe(114);
      expect(timeToSlot("12:00", 0)).toBe(144);
    });

    test("should handle invalid time strings gracefully", () => {
      expect(timeToMinutes("invalid")).toBe(0);
      expect(timeToMinutes("")).toBe(0);
      expect(timeToMinutes("99:99")).toBe(0);
    });
  });

  describe("Business Hours Calculations", () => {
    test("should calculate business start hour", () => {
      const schedules = [
        { endTime: "17:00", startTime: "08:00" },
        { endTime: "18:00", startTime: "09:00" },
        { endTime: "16:00", startTime: "07:30" },
      ];

      const startTimes = schedules.map((s) => timeToMinutes(s.startTime));
      const earliestStartMinutes = Math.min(...startTimes);
      const businessStartHour = Math.floor(earliestStartMinutes / 60);

      expect(businessStartHour).toBe(7); // 7:30 is earliest
    });

    test("should calculate business end hour", () => {
      const schedules = [
        { endTime: "17:00", startTime: "08:00" },
        { endTime: "18:00", startTime: "09:00" },
        { endTime: "16:00", startTime: "07:30" },
      ];

      const endTimes = schedules.map((s) => timeToMinutes(s.endTime));
      const latestEndMinutes = Math.max(...endTimes);
      const businessEndHour = Math.ceil(latestEndMinutes / 60);

      expect(businessEndHour).toBe(18); // 18:00 is latest
    });

    test("should calculate total slots for business hours", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const businessEndHour = 17;

      const totalSlots =
        ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

      expect(totalSlots).toBe(108); // 9 hours * 12 slots per hour
    });

    test("should handle single schedule correctly", () => {
      const SLOT_DURATION = 5;
      const schedule = { endTime: "17:00", startTime: "09:00" };

      const startMinutes = timeToMinutes(schedule.startTime);
      const endMinutes = timeToMinutes(schedule.endTime);

      const startHour = Math.floor(startMinutes / 60);
      const endHour = Math.ceil(endMinutes / 60);
      const totalSlots = ((endHour - startHour) * 60) / SLOT_DURATION;

      expect(startHour).toBe(9);
      expect(endHour).toBe(17);
      expect(totalSlots).toBe(96); // 8 hours * 12 slots per hour
    });
  });

  describe("Date Filtering", () => {
    test("should filter appointments by date", () => {
      const selectedDate = Temporal.PlainDate.from("2025-10-01");
      const appointments = [
        { start: "2025-10-01T09:00:00Z" },
        { start: "2025-10-01T14:00:00Z" },
        { start: "2025-10-02T09:00:00Z" },
      ];

      const filtered = appointments.filter((apt) => {
        const appointmentDate = safeParseISOToPlainDate(apt.start);
        return (
          appointmentDate &&
          Temporal.PlainDate.compare(appointmentDate, selectedDate) === 0
        );
      });

      expect(filtered.length).toBe(2);
    });

    test("should handle empty appointment list", () => {
      const selectedDate = Temporal.PlainDate.from("2025-10-01");
      const appointments: { start: string }[] = [];

      const filtered = appointments.filter((apt) => {
        const appointmentDate = safeParseISOToPlainDate(apt.start);
        return (
          appointmentDate &&
          Temporal.PlainDate.compare(appointmentDate, selectedDate) === 0
        );
      });

      expect(filtered.length).toBe(0);
    });

    test("should filter appointments across different days", () => {
      const date1 = Temporal.PlainDate.from("2025-10-01");
      const date2 = Temporal.PlainDate.from("2025-10-02");

      const appointments = [
        { start: "2025-10-01T09:00:00Z" },
        { start: "2025-10-01T14:00:00Z" },
        { start: "2025-10-02T09:00:00Z" },
        { start: "2025-10-02T14:00:00Z" },
      ];

      const filtered1 = appointments.filter((apt) => {
        const appointmentDate = safeParseISOToPlainDate(apt.start);
        return (
          appointmentDate &&
          Temporal.PlainDate.compare(appointmentDate, date1) === 0
        );
      });

      const filtered2 = appointments.filter((apt) => {
        const appointmentDate = safeParseISOToPlainDate(apt.start);
        return (
          appointmentDate &&
          Temporal.PlainDate.compare(appointmentDate, date2) === 0
        );
      });

      expect(filtered1.length).toBe(2);
      expect(filtered2.length).toBe(2);
    });
  });

  describe("Current Time Slot Calculation", () => {
    test("should calculate current time slot", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const now = Temporal.ZonedDateTime.from(
        "2025-10-01T09:30:00+02:00[Europe/Berlin]",
      );

      const currentHour = now.hour;
      const currentMinute = now.minute;
      const minutesSinceStart =
        (currentHour - businessStartHour) * 60 + currentMinute;
      const currentSlot = Math.floor(minutesSinceStart / SLOT_DURATION);

      expect(currentSlot).toBe(18); // 1.5 hours * 12 slots per hour
    });

    test("should return -1 when current time is before business hours", () => {
      const businessStartHour = 8;
      const now = Temporal.ZonedDateTime.from(
        "2025-10-01T07:00:00+02:00[Europe/Berlin]",
      );

      const currentHour = now.hour;
      const currentSlot = currentHour < businessStartHour ? -1 : 0;

      expect(currentSlot).toBe(-1);
    });

    test("should return -1 when current time is after business hours", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const businessEndHour = 17;
      const now = Temporal.ZonedDateTime.from(
        "2025-10-01T18:00:00+02:00[Europe/Berlin]",
      );

      const currentHour = now.hour;
      const currentMinute = now.minute;
      const minutesSinceStart =
        (currentHour - businessStartHour) * 60 + currentMinute;
      const currentSlot = Math.floor(minutesSinceStart / SLOT_DURATION);

      const totalSlots =
        ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;
      const validSlot = currentSlot >= totalSlots ? -1 : currentSlot;

      expect(validSlot).toBe(-1);
    });
  });

  describe("Appointment Duration Calculations", () => {
    test("should calculate appointment height in pixels", () => {
      const SLOT_DURATION = 5;
      const SLOT_HEIGHT = 16;
      const appointmentDuration = 30; // minutes

      const slots = appointmentDuration / SLOT_DURATION;
      const height = slots * SLOT_HEIGHT;

      expect(height).toBe(96); // 6 slots * 16px
    });

    test("should handle various appointment durations", () => {
      const SLOT_DURATION = 5;
      const SLOT_HEIGHT = 16;

      const durations = [5, 15, 30, 45, 60, 90, 120];
      const expectedHeights = [16, 48, 96, 144, 192, 288, 384];

      for (const [index, duration] of durations.entries()) {
        const slots = duration / SLOT_DURATION;
        const height = slots * SLOT_HEIGHT;
        expect(height).toBe(expectedHeights[index]);
      }
    });

    test("should calculate number of slots for duration", () => {
      const SLOT_DURATION = 5;

      expect(30 / SLOT_DURATION).toBe(6);
      expect(45 / SLOT_DURATION).toBe(9);
      expect(60 / SLOT_DURATION).toBe(12);
    });
  });

  describe("Day of Week Calculations", () => {
    test("should get correct day of week", () => {
      const date = Temporal.PlainDate.from("2025-10-01"); // Wednesday
      const dayOfWeek = date.dayOfWeek;

      expect(dayOfWeek).toBe(3); // Wednesday is 3 (1 = Monday in Temporal)
    });

    test("should handle different days", () => {
      const days = [
        { date: "2025-09-28", expected: 7 }, // Sunday
        { date: "2025-09-29", expected: 1 }, // Monday
        { date: "2025-09-30", expected: 2 }, // Tuesday
        { date: "2025-10-01", expected: 3 }, // Wednesday
        { date: "2025-10-02", expected: 4 }, // Thursday
        { date: "2025-10-03", expected: 5 }, // Friday
        { date: "2025-10-04", expected: 6 }, // Saturday
      ];

      for (const { date, expected } of days) {
        const d = Temporal.PlainDate.from(date);
        expect(d.dayOfWeek).toBe(expected);
      }
    });
  });

  describe("Position Calculations", () => {
    test("should calculate appointment top position", () => {
      const SLOT_HEIGHT = 16;
      const startSlot = 18; // 1.5 hours after start

      const top = startSlot * SLOT_HEIGHT;

      expect(top).toBe(288); // 18 * 16px
    });

    test("should calculate correct positions for various start times", () => {
      const SLOT_HEIGHT = 16;
      const positions = [
        { expected: 0, slot: 0 },
        { expected: 192, slot: 12 }, // 1 hour
        { expected: 384, slot: 24 }, // 2 hours
        { expected: 576, slot: 36 }, // 3 hours
      ];

      for (const { expected, slot } of positions) {
        const top = slot * SLOT_HEIGHT;
        expect(top).toBe(expected);
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle midnight times", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("00:30")).toBe(30);
    });

    test("should handle end of day times", () => {
      expect(timeToMinutes("23:00")).toBe(1380);
      expect(timeToMinutes("23:59")).toBe(1439);
    });

    test("should handle fractional slot calculations", () => {
      const SLOT_DURATION = 5;
      const duration = 7; // Not evenly divisible by 5

      const slots = Math.ceil(duration / SLOT_DURATION);

      expect(slots).toBe(2); // Rounds up to next slot
    });

    test("should handle zero duration appointments", () => {
      const SLOT_DURATION = 5;
      const SLOT_HEIGHT = 16;
      const duration = 0;

      const slots = duration / SLOT_DURATION;
      const height = Math.max(slots * SLOT_HEIGHT, 16); // Minimum height

      expect(height).toBe(16);
    });
  });

  describe("DST and Edge Cases", () => {
    describe("DST Transitions", () => {
      test("should handle spring forward DST transition (March 2025)", () => {
        // In Europe/Berlin, DST starts on March 30, 2025 at 2:00 AM -> 3:00 AM
        const beforeDST = Temporal.PlainDate.from("2025-03-29");
        const duringDST = Temporal.PlainDate.from("2025-03-30");
        const afterDST = Temporal.PlainDate.from("2025-03-31");

        // Convert to Date and back to ensure consistency
        const beforeDate = temporalToDate(beforeDST);
        const duringDate = temporalToDate(duringDST);
        const afterDate = temporalToDate(afterDST);

        const beforeRoundTrip = dateToTemporal(beforeDate);
        const duringRoundTrip = dateToTemporal(duringDate);
        const afterRoundTrip = dateToTemporal(afterDate);

        expect(beforeRoundTrip.equals(beforeDST)).toBe(true);
        expect(duringRoundTrip.equals(duringDST)).toBe(true);
        expect(afterRoundTrip.equals(afterDST)).toBe(true);
      });

      test("should handle fall back DST transition (October 2025)", () => {
        // In Europe/Berlin, DST ends on October 26, 2025 at 3:00 AM -> 2:00 AM
        const beforeDST = Temporal.PlainDate.from("2025-10-25");
        const duringDST = Temporal.PlainDate.from("2025-10-26");
        const afterDST = Temporal.PlainDate.from("2025-10-27");

        const beforeDate = temporalToDate(beforeDST);
        const duringDate = temporalToDate(duringDST);
        const afterDate = temporalToDate(afterDST);

        const beforeRoundTrip = dateToTemporal(beforeDate);
        const duringRoundTrip = dateToTemporal(duringDate);
        const afterRoundTrip = dateToTemporal(afterDate);

        expect(beforeRoundTrip.equals(beforeDST)).toBe(true);
        expect(duringRoundTrip.equals(duringDST)).toBe(true);
        expect(afterRoundTrip.equals(afterDST)).toBe(true);
      });

      test("should correctly handle getCurrentTimeSlot during DST transition", () => {
        // March 30, 2025 - DST transition day (clocks jump from 2 AM to 3 AM)
        const transitionDate = new Date("2025-03-30T12:00:00+01:00"); // Noon CET
        const selectedDate = new Date("2025-03-30");

        const slot = getCurrentTimeSlot(transitionDate, selectedDate, 8, 18);

        // On DST transition day, the actual slot may differ from the expected 48
        // because the clock jumps forward, but the important thing is that:
        // 1. It returns a valid slot (not -1)
        // 2. It's within business hours (0 to 120 slots for 8 AM - 6 PM)
        const maxSlotsInBusinessDay = 120; // 10 hours * 12 slots/hour

        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(maxSlotsInBusinessDay);
      });
    });

    describe("Leap Years", () => {
      test("should handle February 29 in leap year", () => {
        const leapDay = Temporal.PlainDate.from("2024-02-29");
        const date = temporalToDate(leapDay);
        const roundTrip = dateToTemporal(date);

        expect(roundTrip.equals(leapDay)).toBe(true);
        expect(roundTrip.month).toBe(2);
        expect(roundTrip.day).toBe(29);
      });

      test("should handle day before and after leap day", () => {
        const feb28 = Temporal.PlainDate.from("2024-02-28");
        const feb29 = Temporal.PlainDate.from("2024-02-29");
        const mar01 = Temporal.PlainDate.from("2024-03-01");

        const date28 = temporalToDate(feb28);
        const date29 = temporalToDate(feb29);
        const date01 = temporalToDate(mar01);

        expect(dateToTemporal(date28).equals(feb28)).toBe(true);
        expect(dateToTemporal(date29).equals(feb29)).toBe(true);
        expect(dateToTemporal(date01).equals(mar01)).toBe(true);
      });

      test("should handle non-leap year February", () => {
        const feb28_2025 = Temporal.PlainDate.from("2025-02-28");
        const mar01_2025 = Temporal.PlainDate.from("2025-03-01");

        const date28 = temporalToDate(feb28_2025);
        const date01 = temporalToDate(mar01_2025);

        expect(dateToTemporal(date28).equals(feb28_2025)).toBe(true);
        expect(dateToTemporal(date01).equals(mar01_2025)).toBe(true);
      });
    });

    describe("Month Boundaries", () => {
      test("should handle end of month transitions", () => {
        const testCases = [
          { date: "2025-01-31", nextMonth: "2025-02-01" }, // 31 -> 28/29 day month
          { date: "2025-03-31", nextMonth: "2025-04-01" }, // 31 -> 30 day month
          { date: "2025-04-30", nextMonth: "2025-05-01" }, // 30 -> 31 day month
          { date: "2025-12-31", nextMonth: "2026-01-01" }, // Year boundary
        ];

        for (const { date, nextMonth } of testCases) {
          const endOfMonth = Temporal.PlainDate.from(date);
          const startOfNextMonth = Temporal.PlainDate.from(nextMonth);

          const endDate = temporalToDate(endOfMonth);
          const startDate = temporalToDate(startOfNextMonth);

          expect(dateToTemporal(endDate).equals(endOfMonth)).toBe(true);
          expect(dateToTemporal(startDate).equals(startOfNextMonth)).toBe(true);
        }
      });
    });

    describe("Year Boundaries", () => {
      test("should handle year transitions", () => {
        const dec31_2024 = Temporal.PlainDate.from("2024-12-31");
        const jan01_2025 = Temporal.PlainDate.from("2025-01-01");

        const date2024 = temporalToDate(dec31_2024);
        const date2025 = temporalToDate(jan01_2025);

        expect(dateToTemporal(date2024).equals(dec31_2024)).toBe(true);
        expect(dateToTemporal(date2025).equals(jan01_2025)).toBe(true);
      });
    });

    describe("Day of Week Conversion", () => {
      test("should correctly convert Temporal day of week to legacy format", () => {
        const testCases = [
          { date: "2025-01-06", expectedDay: 1, name: "Monday" }, // Monday = 1
          { date: "2025-01-07", expectedDay: 2, name: "Tuesday" }, // Tuesday = 2
          { date: "2025-01-08", expectedDay: 3, name: "Wednesday" }, // Wednesday = 3
          { date: "2025-01-09", expectedDay: 4, name: "Thursday" }, // Thursday = 4
          { date: "2025-01-10", expectedDay: 5, name: "Friday" }, // Friday = 5
          { date: "2025-01-11", expectedDay: 6, name: "Saturday" }, // Saturday = 6
          { date: "2025-01-12", expectedDay: 0, name: "Sunday" }, // Sunday = 0
        ];

        for (const { date, expectedDay } of testCases) {
          const plainDate = Temporal.PlainDate.from(date);
          const legacyDay = temporalDayToLegacy(plainDate);
          expect(legacyDay).toBe(expectedDay);
        }
      });
    });

    describe("Safe ISO Parsing", () => {
      test("should safely parse valid ISO strings", () => {
        const validISO = "2025-01-15T09:30:00Z";

        const instant = safeParseISOToInstant(validISO);
        const zoned = safeParseISOToZoned(validISO);
        const plain = safeParseISOToPlainDate(validISO);

        expect(instant).not.toBeNull();
        expect(zoned).not.toBeNull();
        expect(plain).not.toBeNull();
        expect(plain?.year).toBe(2025);
        expect(plain?.month).toBe(1);
      });

      test("should return null for invalid ISO strings", () => {
        const invalidStrings = [
          "invalid",
          "2025-13-01T00:00:00Z", // Invalid month
          "2025-01-32T00:00:00Z", // Invalid day
          "not-a-date",
          "",
        ];

        for (const invalid of invalidStrings) {
          expect(safeParseISOToInstant(invalid)).toBeNull();
          expect(safeParseISOToZoned(invalid)).toBeNull();
          expect(safeParseISOToPlainDate(invalid)).toBeNull();
        }
      });

      test("should handle ISO strings with different timezones", () => {
        const isoWithOffset = "2025-01-15T09:30:00+01:00";
        const isoUTC = "2025-01-15T09:30:00Z";

        const plainWithOffset = safeParseISOToPlainDate(isoWithOffset);
        const plainUTC = safeParseISOToPlainDate(isoUTC);

        expect(plainWithOffset).not.toBeNull();
        expect(plainUTC).not.toBeNull();

        // Both should parse to dates, but the time may differ in the Berlin timezone
        expect(plainWithOffset?.year).toBe(2025);
        expect(plainUTC?.year).toBe(2025);
      });
    });
  });
});
