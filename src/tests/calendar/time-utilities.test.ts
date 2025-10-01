import {
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";
import { describe, expect, test } from "vitest";

describe("Calendar Time Utilities", () => {
  describe("Time Conversion Functions", () => {
    test("should convert time string to minutes", () => {
      const timeToMinutes = (timeStr: string): number => {
        const parsed = parse(timeStr, "HH:mm", new Date(0));
        if (Number.isNaN(parsed.getTime())) {
          return 0;
        }
        return differenceInMinutes(parsed, startOfDay(parsed));
      };

      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("01:00")).toBe(60);
      expect(timeToMinutes("09:30")).toBe(570);
      expect(timeToMinutes("12:00")).toBe(720);
      expect(timeToMinutes("23:59")).toBe(1439);
    });

    test("should convert minutes to time string", () => {
      const minutesToTime = (minutes: number): string => {
        const date = addMinutes(startOfDay(new Date()), minutes);
        return format(date, "HH:mm");
      };

      expect(minutesToTime(0)).toBe("00:00");
      expect(minutesToTime(60)).toBe("01:00");
      expect(minutesToTime(570)).toBe("09:30");
      expect(minutesToTime(720)).toBe("12:00");
      expect(minutesToTime(1439)).toBe("23:59");
    });

    test("should convert slot number to time", () => {
      const SLOT_DURATION = 5;
      const slotToTime = (slot: number): string => {
        const minutes = slot * SLOT_DURATION;
        const date = addMinutes(startOfDay(new Date()), minutes);
        return format(date, "HH:mm");
      };

      expect(slotToTime(0)).toBe("00:00");
      expect(slotToTime(12)).toBe("01:00"); // 12 * 5 = 60 minutes
      expect(slotToTime(108)).toBe("09:00"); // 108 * 5 = 540 minutes
      expect(slotToTime(144)).toBe("12:00"); // 144 * 5 = 720 minutes
    });

    test("should convert time to slot number", () => {
      const SLOT_DURATION = 5;
      const timeToSlot = (time: string): number => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return Math.floor((hours * 60 + minutes) / SLOT_DURATION);
      };

      expect(timeToSlot("00:00")).toBe(0);
      expect(timeToSlot("01:00")).toBe(12);
      expect(timeToSlot("09:00")).toBe(108);
      expect(timeToSlot("09:30")).toBe(114);
      expect(timeToSlot("12:00")).toBe(144);
    });

    test("should handle invalid time strings gracefully", () => {
      const timeToMinutes = (timeStr: string): number => {
        const parsed = parse(timeStr, "HH:mm", new Date(0));
        if (Number.isNaN(parsed.getTime())) {
          return 0;
        }
        return differenceInMinutes(parsed, startOfDay(parsed));
      };

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

      const timeToMinutes = (timeStr: string): number => {
        const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
        return hours * 60 + minutes;
      };

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

      const timeToMinutes = (timeStr: string): number => {
        const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
        return hours * 60 + minutes;
      };

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

      const timeToMinutes = (timeStr: string): number => {
        const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
        return hours * 60 + minutes;
      };

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
      const selectedDate = new Date("2025-10-01");
      const appointments = [
        { start: "2025-10-01T09:00:00Z" },
        { start: "2025-10-01T14:00:00Z" },
        { start: "2025-10-02T09:00:00Z" },
      ];

      const filtered = appointments.filter((apt) => {
        const appointmentDate = parseISO(apt.start);
        return isSameDay(appointmentDate, selectedDate);
      });

      expect(filtered.length).toBe(2);
    });

    test("should handle empty appointment list", () => {
      const selectedDate = new Date("2025-10-01");
      const appointments: { start: string }[] = [];

      const filtered = appointments.filter((apt) => {
        const appointmentDate = parseISO(apt.start);
        return isSameDay(appointmentDate, selectedDate);
      });

      expect(filtered.length).toBe(0);
    });

    test("should filter appointments across different days", () => {
      const date1 = new Date("2025-10-01");
      const date2 = new Date("2025-10-02");

      const appointments = [
        { start: "2025-10-01T09:00:00Z" },
        { start: "2025-10-01T14:00:00Z" },
        { start: "2025-10-02T09:00:00Z" },
        { start: "2025-10-02T14:00:00Z" },
      ];

      const filtered1 = appointments.filter((apt) => {
        const appointmentDate = parseISO(apt.start);
        return isSameDay(appointmentDate, date1);
      });

      const filtered2 = appointments.filter((apt) => {
        const appointmentDate = parseISO(apt.start);
        return isSameDay(appointmentDate, date2);
      });

      expect(filtered1.length).toBe(2);
      expect(filtered2.length).toBe(2);
    });
  });

  describe("Current Time Slot Calculation", () => {
    test("should calculate current time slot", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const now = new Date("2025-10-01T09:30:00");

      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const minutesSinceStart =
        (currentHour - businessStartHour) * 60 + currentMinute;
      const currentSlot = Math.floor(minutesSinceStart / SLOT_DURATION);

      expect(currentSlot).toBe(18); // 1.5 hours * 12 slots per hour
    });

    test("should return -1 when current time is before business hours", () => {
      const businessStartHour = 8;
      const now = new Date("2025-10-01T07:00:00");

      const currentHour = now.getHours();
      const currentSlot = currentHour < businessStartHour ? -1 : 0;

      expect(currentSlot).toBe(-1);
    });

    test("should return -1 when current time is after business hours", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const businessEndHour = 17;
      const now = new Date("2025-10-01T18:00:00");

      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
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
      const date = new Date("2025-10-01"); // Wednesday
      const dayOfWeek = date.getDay();

      expect(dayOfWeek).toBe(3); // Wednesday is 3 (0 = Sunday)
    });

    test("should handle different days", () => {
      const days = [
        { date: "2025-09-28", expected: 0 }, // Sunday
        { date: "2025-09-29", expected: 1 }, // Monday
        { date: "2025-09-30", expected: 2 }, // Tuesday
        { date: "2025-10-01", expected: 3 }, // Wednesday
        { date: "2025-10-02", expected: 4 }, // Thursday
        { date: "2025-10-03", expected: 5 }, // Friday
        { date: "2025-10-04", expected: 6 }, // Saturday
      ];

      for (const { date, expected } of days) {
        const d = new Date(date);
        expect(d.getDay()).toBe(expected);
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
      const timeToMinutes = (timeStr: string): number => {
        const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
        return hours * 60 + minutes;
      };

      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("00:30")).toBe(30);
    });

    test("should handle end of day times", () => {
      const timeToMinutes = (timeStr: string): number => {
        const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
        return hours * 60 + minutes;
      };

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

      expect(height).toBe(16); // Minimum height enforced
    });
  });
});
