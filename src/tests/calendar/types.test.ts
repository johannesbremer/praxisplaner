import { describe, expect, test } from "vitest";

import { regex } from "@/lib/arkregex";

import { toTableId } from "../../../convex/identity";
import {
  type Appointment,
  APPOINTMENT_COLORS,
  SLOT_DURATION,
} from "../../../src/components/calendar/types";

const TAILWIND_BG_COLOR_REGEX = regex.as(String.raw`^bg-\w+-\d{3}$`);

describe("Calendar Types and Constants", () => {
  const practitioner1 = toTableId<"practitioners">("practitioner_1");
  const practitioner2 = toTableId<"practitioners">("practitioner_2");

  describe("SLOT_DURATION", () => {
    test("should be 5 minutes", () => {
      expect(SLOT_DURATION).toBe(5);
    });

    test("should be a positive number", () => {
      expect(SLOT_DURATION).toBeGreaterThan(0);
    });
  });

  describe("APPOINTMENT_COLORS", () => {
    test("should be an array", () => {
      expect(Array.isArray(APPOINTMENT_COLORS)).toBe(true);
    });

    test("should have at least 5 colors", () => {
      expect(APPOINTMENT_COLORS.length).toBeGreaterThanOrEqual(5);
    });

    test("should contain valid Tailwind classes", () => {
      for (const color of APPOINTMENT_COLORS) {
        expect(color).toMatch(TAILWIND_BG_COLOR_REGEX);
      }
    });

    test("should include common colors", () => {
      expect(APPOINTMENT_COLORS).toContain("bg-blue-500");
      expect(APPOINTMENT_COLORS).toContain("bg-green-500");
      expect(APPOINTMENT_COLORS).toContain("bg-red-500");
    });

    test("should not have duplicate colors", () => {
      const uniqueColors = new Set(APPOINTMENT_COLORS);
      expect(uniqueColors.size).toBe(APPOINTMENT_COLORS.length);
    });
  });

  describe("Appointment Type", () => {
    test("should accept valid appointment object", () => {
      const appointment: Appointment = {
        color: "bg-blue-500",
        column: practitioner1,
        duration: 30,
        id: "test-1",
        isSimulation: false,
        startTime: "10:00",
        title: "Test Appointment",
      };

      expect(appointment.id).toBe("test-1");
      expect(appointment.startTime).toBe("10:00");
      expect(appointment.duration).toBe(30);
      expect(appointment.column).toBe(practitioner1);
      expect(appointment.color).toBe("bg-blue-500");
      expect(appointment.isSimulation).toBe(false);
    });

    test("should accept appointment with optional convexId", () => {
      const appointment: Appointment = {
        color: "bg-blue-500",
        column: practitioner1,
        convexId: "convex-id-123" as never,
        duration: 30,
        id: "test-1",
        isSimulation: false,
        startTime: "10:00",
        title: "Test Appointment",
      };

      expect(appointment.convexId).toBeDefined();
    });

    test("should accept appointment with resource metadata", () => {
      const appointment: Appointment = {
        color: "bg-blue-500",
        column: practitioner1,
        duration: 30,
        id: "test-1",
        isSimulation: false,
        resource: {
          appointmentTypeLineageKey:
            toTableId<"appointmentTypes">("appointmentType_1"),
          isSimulation: false,
          locationLineageKey: toTableId<"locations">("location_1"),
          patientId: "patient-1" as never,
          practitionerLineageKey: toTableId<"practitioners">("practitioner_1"),
        },
        startTime: "10:00",
        title: "Test Appointment",
      };

      expect(appointment.resource).toBeDefined();
      expect(appointment.resource?.patientId).toBe("patient-1");
    });

    test("should accept simulated appointment", () => {
      const appointment: Appointment = {
        color: "bg-blue-500",
        column: practitioner1,
        duration: 30,
        id: "test-1",
        isSimulation: true,
        replacesAppointmentId: "original-apt-id" as never,
        startTime: "10:00",
        title: "Test Appointment",
      };

      expect(appointment.isSimulation).toBe(true);
      expect(appointment.replacesAppointmentId).toBeDefined();
    });

    test("should accept appointments with different durations", () => {
      const durations = [5, 15, 30, 45, 60, 90, 120];

      for (const duration of durations) {
        const appointment: Appointment = {
          color: "bg-blue-500",
          column: practitioner1,
          duration,
          id: `test-${duration}`,
          isSimulation: false,
          startTime: "10:00",
          title: "Test Appointment",
        };

        expect(appointment.duration).toBe(duration);
      }
    });

    test("should accept appointments with different start times", () => {
      const times = ["08:00", "09:30", "12:45", "15:00", "17:30"];

      for (const startTime of times) {
        const appointment: Appointment = {
          color: "bg-blue-500",
          column: practitioner1,
          duration: 30,
          id: `test-${startTime}`,
          isSimulation: false,
          startTime,
          title: "Test Appointment",
        };

        expect(appointment.startTime).toBe(startTime);
      }
    });

    test("should accept appointments for different column types", () => {
      const columns = [practitioner1, practitioner2, "ekg", "labor"] as const;

      for (const column of columns) {
        const appointment: Appointment = {
          color: "bg-blue-500",
          column,
          duration: 30,
          id: `test-${column}`,
          isSimulation: false,
          startTime: "10:00",
          title: "Test Appointment",
        };

        expect(appointment.column).toBe(column);
      }
    });
  });

  describe("Color Assignment Logic", () => {
    test("should be able to cycle through all colors", () => {
      const appointments: Appointment[] = APPOINTMENT_COLORS.map(
        (color, index) => ({
          color,
          column: index % 2 === 0 ? practitioner1 : practitioner2,
          duration: 30,
          id: `apt-${index}`,
          isSimulation: false,
          startTime: "10:00",
          title: `Appointment ${index}`,
        }),
      );

      for (const [index, apt] of appointments.entries()) {
        expect(apt.color).toBe(APPOINTMENT_COLORS[index]);
      }
    });

    test("should wrap around when exceeding color count", () => {
      const colorIndex = APPOINTMENT_COLORS.length + 2;
      const wrappedIndex = colorIndex % APPOINTMENT_COLORS.length;
      const expectedColor = APPOINTMENT_COLORS[wrappedIndex];

      expect(expectedColor).toBeDefined();
      expect(APPOINTMENT_COLORS).toContain(expectedColor);
    });
  });

  describe("Time Slot Calculations", () => {
    test("should calculate correct number of slots per hour", () => {
      const slotsPerHour = 60 / SLOT_DURATION;
      expect(slotsPerHour).toBe(12);
    });

    test("should calculate correct number of slots for 8 hours", () => {
      const hours = 8;
      const totalSlots = (hours * 60) / SLOT_DURATION;
      expect(totalSlots).toBe(96);
    });

    test("should calculate correct number of slots for 12 hours", () => {
      const hours = 12;
      const totalSlots = (hours * 60) / SLOT_DURATION;
      expect(totalSlots).toBe(144);
    });

    test("should calculate slot height correctly", () => {
      const slotHeightPx = 16;
      const appointmentDuration = 30; // minutes
      const slots = appointmentDuration / SLOT_DURATION;
      const height = slots * slotHeightPx;

      expect(height).toBe(96);
    });

    test("should handle edge case durations", () => {
      const edgeCases = [
        { duration: 5, expectedSlots: 1 },
        { duration: 10, expectedSlots: 2 },
        { duration: 15, expectedSlots: 3 },
        { duration: 60, expectedSlots: 12 },
      ];

      for (const { duration, expectedSlots } of edgeCases) {
        const slots = duration / SLOT_DURATION;
        expect(slots).toBe(expectedSlots);
      }
    });
  });
});
