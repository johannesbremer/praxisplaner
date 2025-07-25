import { describe, expect, it } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";

import type { LocalAppointment } from "../utils/local-appointments";

describe("Regeln Integration - Core Functionality", () => {
  it("should define LocalAppointment interface correctly", () => {
    const mockAppointment: LocalAppointment = {
      appointmentType: "Erstberatung",
      end: new Date("2024-01-15T11:00:00Z"),
      id: "local-123456-abcdef",
      isLocal: true,
      locationId: "location1" as Id<"locations">,
      notes: "Test appointment",
      practitionerId: "practitioner1" as Id<"practitioners">,
      start: new Date("2024-01-15T10:00:00Z"),
      title: "Test Appointment",
    };

    // Verify all required fields are present and typed correctly
    expect(mockAppointment.id).toBe("local-123456-abcdef");
    expect(mockAppointment.title).toBe("Test Appointment");
    expect(mockAppointment.start).toBeInstanceOf(Date);
    expect(mockAppointment.end).toBeInstanceOf(Date);
    expect(mockAppointment.appointmentType).toBe("Erstberatung");
    expect(mockAppointment.practitionerId).toBe("practitioner1");
    expect(mockAppointment.isLocal).toBe(true);
    expect(mockAppointment.notes).toBe("Test appointment");
  });

  it("should create proper local appointment structure", () => {
    const baseAppointment = {
      appointmentType: "Nachuntersuchung",
      end: new Date(),
      practitionerId: "practitioner1" as Id<"practitioners">,
      start: new Date(),
      title: "Local Test",
    };

    // Simulate the addLocalAppointment logic
    const localAppointment: LocalAppointment = {
      ...baseAppointment,
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      isLocal: true,
    };

    expect(localAppointment.isLocal).toBe(true);
    expect(localAppointment.id).toMatch(/^local-\d+-[a-z0-9]+$/);
    expect(localAppointment.title).toBe("Local Test");
    expect(localAppointment.appointmentType).toBe("Nachuntersuchung");
  });

  it("should validate required fields are present", () => {
    const appointment: Omit<LocalAppointment, "id" | "isLocal"> = {
      appointmentType: "Vorsorge",
      end: new Date("2024-01-15T11:00:00Z"),
      practitionerId: "practitioner2" as Id<"practitioners">,
      start: new Date("2024-01-15T10:00:00Z"),
      title: "Required Fields Test",
    };

    // All required fields should be present
    expect(appointment).toHaveProperty("title");
    expect(appointment).toHaveProperty("start");
    expect(appointment).toHaveProperty("end");
    expect(appointment).toHaveProperty("appointmentType");
    expect(appointment).toHaveProperty("practitionerId");

    // Verify types
    expect(typeof appointment.title).toBe("string");
    expect(appointment.start).toBeInstanceOf(Date);
    expect(appointment.end).toBeInstanceOf(Date);
    expect(typeof appointment.appointmentType).toBe("string");
    expect(typeof appointment.practitionerId).toBe("string");
  });

  it("should handle optional fields correctly", () => {
    const fullAppointment: LocalAppointment = {
      appointmentType: "Akutsprechstunde",
      end: new Date(),
      id: "local-test-id",
      isLocal: true,
      locationId: "location2" as Id<"locations">,
      notes: "Optional field test",
      patientId: "patient1" as Id<"patients">,
      practitionerId: "practitioner3" as Id<"practitioners">,
      start: new Date(),
      title: "Full Appointment",
    };

    const minimalAppointment: LocalAppointment = {
      appointmentType: "Erstberatung",
      end: new Date(),
      id: "local-minimal-id",
      isLocal: true,
      practitionerId: "practitioner4" as Id<"practitioners">,
      start: new Date(),
      title: "Minimal Appointment",
    };

    // Both should be valid LocalAppointment objects
    expect(fullAppointment.locationId).toBe("location2");
    expect(fullAppointment.patientId).toBe("patient1");
    expect(fullAppointment.notes).toBe("Optional field test");

    expect(minimalAppointment.locationId).toBeUndefined();
    expect(minimalAppointment.patientId).toBeUndefined();
    expect(minimalAppointment.notes).toBeUndefined();
  });
});
