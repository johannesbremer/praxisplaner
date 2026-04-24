import { describe, expect, test } from "vitest";

import { regex } from "@/lib/arkregex";

import { toTableId } from "../../../convex/identity";
import {
  APPOINTMENT_COLORS,
  type CalendarAppointmentLayout,
  type CalendarAppointmentView,
  SLOT_DURATION,
} from "../../../src/components/calendar/types";

const TAILWIND_BG_COLOR_REGEX = regex.as(String.raw`^bg-\w+-\d{3}$`);

describe("Calendar Types and Constants", () => {
  const practitioner1 = toTableId<"practitioners">("practitioner_1");
  const practitioner2 = toTableId<"practitioners">("practitioner_2");
  const location1 = toTableId<"locations">("location_1");
  const practice1 = toTableId<"practices">("practice_1");
  const appointmentType1 = toTableId<"appointmentTypes">("appointment_type_1");

  const createLayout = (args: {
    column?: CalendarAppointmentLayout["column"];
    duration?: number;
    id: string;
    isSimulation?: boolean;
    patientId?: CalendarAppointmentLayout["record"]["patientId"];
    practitionerLineageKey?: CalendarAppointmentLayout["record"]["practitionerLineageKey"];
    startTime?: string;
    userId?: CalendarAppointmentLayout["record"]["userId"];
  }): CalendarAppointmentLayout => ({
    column: args.column ?? practitioner1,
    duration: args.duration ?? 30,
    id: args.id,
    record: {
      _creationTime: 0,
      _id: toTableId<"appointments">(args.id),
      appointmentTypeLineageKey: appointmentType1,
      appointmentTypeTitle: "Test Appointment Type",
      createdAt: 0n,
      end: "2026-04-24T10:30:00+02:00[Europe/Berlin]",
      ...(args.isSimulation ? { isSimulation: true } : {}),
      lastModified: 0n,
      locationLineageKey: location1,
      ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
      practiceId: practice1,
      ...(args.practitionerLineageKey === undefined
        ? { practitionerLineageKey: practitioner1 }
        : { practitionerLineageKey: args.practitionerLineageKey }),
      start: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
      title: "Test Appointment",
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    },
    startTime: args.startTime ?? "10:00",
  });

  const createView = (args: {
    color?: string;
    layout?: CalendarAppointmentLayout;
    patientName?: string;
  }): CalendarAppointmentView => ({
    color: args.color ?? "bg-blue-500",
    layout: args.layout ?? createLayout({ id: "test-1" }),
    ...(args.patientName === undefined
      ? {}
      : { patientName: args.patientName }),
  });

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
      const appointment = createView({
        layout: createLayout({ id: "test-1" }),
      });

      expect(appointment.layout.id).toBe("test-1");
      expect(appointment.layout.startTime).toBe("10:00");
      expect(appointment.layout.duration).toBe(30);
      expect(appointment.layout.column).toBe(practitioner1);
      expect(appointment.color).toBe("bg-blue-500");
      expect(appointment.layout.record.isSimulation).toBeUndefined();
    });

    test("should accept appointment with domain record metadata", () => {
      const appointment = createView({
        layout: createLayout({
          id: "test-1",
          patientId: toTableId<"patients">("patient_1"),
          userId: toTableId<"users">("user_1"),
        }),
      });

      expect(appointment.layout.record.patientId).toBeDefined();
      expect(appointment.layout.record.userId).toBeDefined();
    });

    test("should accept appointment with patient display metadata", () => {
      const appointment = createView({
        patientName: "Doe, Jane",
      });

      expect(appointment.patientName).toBe("Doe, Jane");
    });

    test("should accept simulated appointment", () => {
      const appointment = createView({
        layout: {
          ...createLayout({ id: "test-1", isSimulation: true }),
          record: {
            ...createLayout({ id: "test-1", isSimulation: true }).record,
            replacesAppointmentId: toTableId<"appointments">("original_apt"),
          },
        },
      });

      expect(appointment.layout.record.isSimulation).toBe(true);
      expect(appointment.layout.record.replacesAppointmentId).toBeDefined();
    });

    test("should accept appointments with different durations", () => {
      const durations = [5, 15, 30, 45, 60, 90, 120];

      for (const duration of durations) {
        const appointment = createView({
          layout: createLayout({ duration, id: `test-${duration}` }),
        });

        expect(appointment.layout.duration).toBe(duration);
      }
    });

    test("should accept appointments with different start times", () => {
      const times = ["08:00", "09:30", "12:45", "15:00", "17:30"];

      for (const startTime of times) {
        const appointment = createView({
          layout: createLayout({ id: `test-${startTime}`, startTime }),
        });

        expect(appointment.layout.startTime).toBe(startTime);
      }
    });

    test("should accept appointments for different column types", () => {
      const columns = [practitioner1, practitioner2, "ekg", "labor"] as const;

      for (const column of columns) {
        const appointment = createView({
          layout: createLayout({ column, id: `test-${column}` }),
        });

        expect(appointment.layout.column).toBe(column);
      }
    });
  });

  describe("Color Assignment Logic", () => {
    test("should be able to cycle through all colors", () => {
      const appointments: CalendarAppointmentView[] = APPOINTMENT_COLORS.map(
        (color, index) =>
          createView({
            color,
            layout: createLayout({
              column: index % 2 === 0 ? practitioner1 : practitioner2,
              id: `apt-${index}`,
            }),
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
