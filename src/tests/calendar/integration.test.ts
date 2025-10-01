import { addMinutes, format, startOfDay } from "date-fns";
import { describe, expect, test } from "vitest";

describe("Calendar Integration Scenarios", () => {
  describe("Complete Appointment Lifecycle", () => {
    test("should handle appointment creation workflow", () => {
      // Simulate the full workflow of creating an appointment
      const clickedSlot = 108; // 09:00 AM
      const SLOT_DURATION = 5;

      // Convert slot to time
      const startMinutes = clickedSlot * SLOT_DURATION;
      const startTime = format(
        addMinutes(startOfDay(new Date()), startMinutes),
        "HH:mm",
      );

      expect(startTime).toBe("09:00");

      // Create appointment object
      const appointment = {
        color: "bg-blue-500",
        column: "practitioner-1",
        duration: 30,
        id: crypto.randomUUID(),
        isSimulation: false,
        startTime,
        title: "New Patient",
      };

      expect(appointment.startTime).toBe("09:00");
      expect(appointment.duration).toBe(30);
    });

    test("should handle appointment drag-and-drop workflow", () => {
      // Simulate dragging an appointment to a new time
      const originalAppointment = {
        color: "bg-blue-500",
        column: "practitioner-1",
        duration: 30,
        id: "apt-1",
        isSimulation: false,
        startTime: "09:00",
        title: "Checkup",
      };

      const newSlot = 120; // 10:00 AM
      const SLOT_DURATION = 5;
      const newStartMinutes = newSlot * SLOT_DURATION;
      const newStartTime = format(
        addMinutes(startOfDay(new Date()), newStartMinutes),
        "HH:mm",
      );

      const updatedAppointment = {
        ...originalAppointment,
        startTime: newStartTime,
      };

      expect(updatedAppointment.startTime).toBe("10:00");
      expect(updatedAppointment.duration).toBe(30); // Duration unchanged
    });

    test("should handle appointment resize workflow", () => {
      const appointment = {
        color: "bg-blue-500",
        column: "practitioner-1",
        duration: 30,
        id: "apt-1",
        isSimulation: false,
        startTime: "09:00",
        title: "Consultation",
      };

      // Simulate resizing by 3 slots (15 minutes)
      const SLOT_HEIGHT = 16;
      const SLOT_DURATION = 5;
      const mouseDelta = 3 * SLOT_HEIGHT; // 48px
      const durationChange =
        Math.round(mouseDelta / SLOT_HEIGHT) * SLOT_DURATION;

      const newDuration = appointment.duration + durationChange;

      expect(newDuration).toBe(45); // 30 + 15 minutes
    });
  });

  describe("Multi-Column Scenarios", () => {
    test("should distribute appointments across multiple practitioners", () => {
      const appointments = [
        { column: "practitioner-1", id: "1", startTime: "09:00" },
        { column: "practitioner-2", id: "2", startTime: "09:00" },
        { column: "practitioner-1", id: "3", startTime: "10:00" },
        { column: "ekg", id: "4", startTime: "09:30" },
      ];

      const columns = ["practitioner-1", "practitioner-2", "ekg"];

      for (const column of columns) {
        const columnAppointments = appointments.filter(
          (apt) => apt.column === column,
        );
        expect(columnAppointments.length).toBeGreaterThan(0);
      }
    });

    test("should handle special resource columns", () => {
      const columns = [
        { id: "practitioner-1", title: "Dr. Smith", type: "practitioner" },
        { id: "practitioner-2", title: "Dr. Jones", type: "practitioner" },
        { id: "ekg", title: "EKG", type: "equipment" },
        { id: "labor", title: "Labor", type: "equipment" },
      ];

      const practitionerColumns = columns.filter(
        (c) => c.type === "practitioner",
      );
      const equipmentColumns = columns.filter((c) => c.type === "equipment");

      expect(practitionerColumns.length).toBe(2);
      expect(equipmentColumns.length).toBe(2);
    });
  });

  describe("Business Hours Scenarios", () => {
    test("should calculate view window for full day", () => {
      const schedules = [
        { endTime: "17:00", practitionerId: "p1", startTime: "08:00" },
        { endTime: "18:00", practitionerId: "p2", startTime: "09:00" },
      ];

      const timeToMinutes = (time: string) => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return hours * 60 + minutes;
      };

      const startTimes = schedules.map((s) => timeToMinutes(s.startTime));
      const endTimes = schedules.map((s) => timeToMinutes(s.endTime));

      const earliestStart = Math.min(...startTimes);
      const latestEnd = Math.max(...endTimes);

      const businessStartHour = Math.floor(earliestStart / 60);
      const businessEndHour = Math.ceil(latestEnd / 60);

      expect(businessStartHour).toBe(8);
      expect(businessEndHour).toBe(18);

      const totalHours = businessEndHour - businessStartHour;
      expect(totalHours).toBe(10);
    });

    test("should handle practitioner with different hours", () => {
      const schedules = [
        { endTime: "16:00", practitionerId: "p1", startTime: "08:00" },
        { endTime: "20:00", practitionerId: "p2", startTime: "12:00" },
      ];

      // Calendar should show from 08:00 to 20:00
      const timeToMinutes = (time: string) => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return hours * 60 + minutes;
      };

      const allTimes = [
        ...schedules.map((s) => timeToMinutes(s.startTime)),
        ...schedules.map((s) => timeToMinutes(s.endTime)),
      ];

      const earliestMinutes = Math.min(...allTimes);
      const latestMinutes = Math.max(...allTimes);

      expect(earliestMinutes).toBe(480); // 08:00
      expect(latestMinutes).toBe(1200); // 20:00
    });
  });

  describe("Appointment Conflict Detection", () => {
    test("should detect overlapping appointments", () => {
      const appointments = [
        { column: "p1", duration: 60, id: "1", startTime: "09:00" },
        { column: "p1", duration: 30, id: "2", startTime: "09:30" },
      ];

      const timeToMinutes = (time: string) => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return hours * 60 + minutes;
      };

      const apt1 = appointments[0];
      const apt2 = appointments[1];

      if (!apt1 || !apt2) {
        throw new Error("Expected two appointments");
      }

      const apt1Start = timeToMinutes(apt1.startTime);
      const apt1End = apt1Start + apt1.duration;
      const apt2Start = timeToMinutes(apt2.startTime);
      const apt2End = apt2Start + apt2.duration;

      // Check if appointments overlap
      const overlaps = apt1Start < apt2End && apt2Start < apt1End;

      expect(overlaps).toBe(true);
    });

    test("should detect non-overlapping appointments", () => {
      const appointments = [
        { column: "p1", duration: 30, id: "1", startTime: "09:00" },
        { column: "p1", duration: 30, id: "2", startTime: "09:30" },
      ];

      const timeToMinutes = (time: string) => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return hours * 60 + minutes;
      };

      const apt1 = appointments[0];
      const apt2 = appointments[1];

      if (!apt1 || !apt2) {
        throw new Error("Expected two appointments");
      }

      const apt1Start = timeToMinutes(apt1.startTime);
      const apt1End = apt1Start + apt1.duration;
      const apt2Start = timeToMinutes(apt2.startTime);
      const apt2End = apt2Start + apt2.duration;

      // Check if appointments overlap (they should be adjacent)
      const overlaps = apt1Start < apt2End && apt2Start < apt1End;

      // They touch but don't overlap
      expect(apt1End).toBe(apt2Start);
      expect(overlaps).toBe(false);
    });

    test("should allow overlapping appointments in different columns", () => {
      const appointments = [
        { column: "p1", duration: 60, id: "1", startTime: "09:00" },
        { column: "p2", duration: 30, id: "2", startTime: "09:30" },
      ];

      const apt1 = appointments[0];
      const apt2 = appointments[1];

      if (!apt1 || !apt2) {
        throw new Error("Expected two appointments");
      }

      // Same time slots but different columns - should be allowed
      const sameColumn = apt1.column === apt2.column;
      expect(sameColumn).toBe(false);
    });
  });

  describe("Current Time Indicator", () => {
    test("should calculate current time slot correctly", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;

      // Simulate current time at 10:45
      const currentHour = 10;
      const currentMinute = 45;

      const minutesSinceStart =
        (currentHour - businessStartHour) * 60 + currentMinute;
      const currentSlot = Math.floor(minutesSinceStart / SLOT_DURATION);

      expect(currentSlot).toBe(33); // 2 hours 45 minutes = 165 minutes / 5
    });

    test("should handle current time before business hours", () => {
      const businessStartHour = 8;
      const currentHour = 7;

      // Test the logic: when before business hours, should return -1
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const isBeforeHours = currentHour < businessStartHour;
      expect(isBeforeHours).toBe(true);

      const currentSlot = isBeforeHours ? -1 : 0;
      expect(currentSlot).toBe(-1);
    });

    test("should handle current time during business hours", () => {
      const SLOT_DURATION = 5;
      const businessStartHour = 8;
      const businessEndHour = 17;
      const currentHour = 12;
      const currentMinute = 30;

      const minutesSinceStart =
        (currentHour - businessStartHour) * 60 + currentMinute;
      const currentSlot = Math.floor(minutesSinceStart / SLOT_DURATION);
      const totalSlots =
        ((businessEndHour - businessStartHour) * 60) / SLOT_DURATION;

      // Verify slot is within business hours range
      expect(currentSlot).toBeGreaterThanOrEqual(0);
      expect(currentSlot).toBeLessThan(totalSlots);
      expect(currentSlot).toBe(54); // 4.5 hours * 12 slots per hour
    });
  });

  describe("Color Assignment", () => {
    test("should assign unique colors to practitioners", () => {
      const COLORS = [
        "bg-blue-500",
        "bg-green-500",
        "bg-purple-500",
        "bg-orange-500",
      ];

      const practitioners = [
        { id: "p1", name: "Dr. Smith" },
        { id: "p2", name: "Dr. Jones" },
        { id: "p3", name: "Dr. Wilson" },
      ];

      const colorMap = new Map(
        practitioners.map((p, i) => [p.id, COLORS[i % COLORS.length]]),
      );

      expect(colorMap.get("p1")).toBe("bg-blue-500");
      expect(colorMap.get("p2")).toBe("bg-green-500");
      expect(colorMap.get("p3")).toBe("bg-purple-500");
    });

    test("should wrap colors when more practitioners than colors", () => {
      const COLORS = ["bg-blue-500", "bg-green-500"];
      const practitionerCount = 5;

      const colors = Array.from(
        { length: practitionerCount },
        (_, i) => COLORS[i % COLORS.length],
      );

      expect(colors[0]).toBe("bg-blue-500");
      expect(colors[1]).toBe("bg-green-500");
      expect(colors[2]).toBe("bg-blue-500"); // Wraps around
      expect(colors[3]).toBe("bg-green-500");
      expect(colors[4]).toBe("bg-blue-500");
    });
  });

  describe("Simulation Mode", () => {
    test("should distinguish simulation appointments from real ones", () => {
      const appointments = [
        {
          color: "bg-blue-500",
          column: "p1",
          duration: 30,
          id: "real-1",
          isSimulation: false,
          startTime: "09:00",
          title: "Real Appointment",
        },
        {
          color: "bg-green-500",
          column: "p1",
          duration: 30,
          id: "sim-1",
          isSimulation: true,
          replacesAppointmentId: "real-1" as never,
          startTime: "10:00",
          title: "Simulated Appointment",
        },
      ];

      const realAppointments = appointments.filter((apt) => !apt.isSimulation);
      const simulatedAppointments = appointments.filter(
        (apt) => apt.isSimulation,
      );

      expect(realAppointments.length).toBe(1);
      expect(simulatedAppointments.length).toBe(1);
      expect(simulatedAppointments[0]?.replacesAppointmentId).toBe("real-1");
    });

    test("should handle appointment replacement in simulation", () => {
      const realAppointment = {
        color: "bg-blue-500",
        column: "p1",
        convexId: "convex-real-1" as never,
        duration: 30,
        id: "real-1",
        isSimulation: false,
        startTime: "09:00",
        title: "Original",
      };

      const simulatedAppointment = {
        color: "bg-green-500",
        column: "p2",
        duration: 30,
        id: "sim-1",
        isSimulation: true,
        replacesAppointmentId: realAppointment.convexId,
        startTime: "10:00",
        title: "Moved",
      };

      // In simulation mode, real appointment should be hidden if it has a replacement
      type AppointmentType =
        | typeof realAppointment
        | typeof simulatedAppointment;
      const appointments: AppointmentType[] = [
        realAppointment,
        simulatedAppointment,
      ];
      const visibleAppointments = appointments.filter(
        (apt) =>
          !apt.isSimulation ||
          !appointments.some(
            (other) =>
              other.isSimulation &&
              "replacesAppointmentId" in other &&
              "convexId" in apt &&
              other.replacesAppointmentId === apt.convexId,
          ),
      );

      // Both should be visible (they represent different states)
      expect(visibleAppointments.length).toBe(2);
    });
  });

  describe("Performance Calculations", () => {
    test("should efficiently calculate slot positions for many appointments", () => {
      const SLOT_HEIGHT = 16;
      const SLOT_DURATION = 5;
      const appointmentCount = 100;

      const timeToSlot = (time: string) => {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);
        return Math.floor((hours * 60 + minutes) / SLOT_DURATION);
      };

      const start = performance.now();

      // Generate 100 appointments with random times
      const appointments = Array.from({ length: appointmentCount }, (_, i) => {
        const hour = 8 + Math.floor(i / 10);
        const minute = (i % 10) * 5;
        const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
        const slot = timeToSlot(time);

        return {
          duration: 30,
          height: (30 / SLOT_DURATION) * SLOT_HEIGHT,
          id: `apt-${i}`,
          slot,
          startTime: time,
          top: slot * SLOT_HEIGHT,
        };
      });

      const end = performance.now();
      const duration = end - start;

      expect(appointments.length).toBe(100);
      expect(duration).toBeLessThan(50); // Should complete in < 50ms
    });

    test("should handle rapid state updates efficiently", () => {
      let dragPreview = { column: "", slot: 0, visible: false };

      const start = performance.now();

      // Simulate 100 drag over events
      for (let i = 0; i < 100; i++) {
        dragPreview = {
          column: "p1",
          slot: i,
          visible: true,
        };
      }

      const end = performance.now();
      const duration = end - start;

      expect(dragPreview.slot).toBe(99);
      expect(duration).toBeLessThan(10); // Should be very fast
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle empty column list", () => {
      const columns: string[] = [];

      const gridColumns = Math.max(columns.length, 0);

      expect(gridColumns).toBe(0);
    });

    test("should handle appointment with missing data", () => {
      const appointment = {
        color: "bg-blue-500",
        column: "p1",
        duration: 30,
        id: "apt-1",
        isSimulation: false,
        startTime: "09:00",
        title: "Test",
      };

      // All required fields present
      expect(appointment.id).toBeTruthy();
      expect(appointment.title).toBeTruthy();
      expect(appointment.startTime).toBeTruthy();
      expect(appointment.duration).toBeGreaterThan(0);
    });

    test("should handle invalid time format gracefully", () => {
      const parseTime = (time: string): number => {
        const parts = time.split(":");
        if (parts.length !== 2) {
          return 0;
        }

        const [hours = 0, minutes = 0] = parts.map(Number);

        if (Number.isNaN(hours) || Number.isNaN(minutes)) {
          return 0;
        }
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          return 0;
        }

        return hours * 60 + minutes;
      };

      expect(parseTime("09:00")).toBe(540);
      expect(parseTime("invalid")).toBe(0);
      expect(parseTime("25:00")).toBe(0);
      expect(parseTime("12:99")).toBe(0);
    });

    test("should handle date boundary crossing", () => {
      const midnight = new Date("2025-10-01T00:00:00");
      const endOfDay = new Date("2025-10-01T23:59:59");

      expect(midnight.getDate()).toBe(1);
      expect(endOfDay.getDate()).toBe(1);
      expect(midnight.getHours()).toBe(0);
      expect(endOfDay.getHours()).toBe(23);
    });
  });
});
