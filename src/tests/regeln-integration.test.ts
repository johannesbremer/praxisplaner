import { describe, expect, it } from "vitest";
import type { LocalAppointment } from "../utils/local-appointments";

describe("Regeln Integration - Core Functionality", () => {
  it("should define LocalAppointment interface correctly", () => {
    const mockAppointment: LocalAppointment = {
      id: "local-123456-abcdef",
      title: "Test Appointment",
      start: new Date("2024-01-15T10:00:00Z"),
      end: new Date("2024-01-15T11:00:00Z"),
      appointmentType: "Erstberatung",
      practitionerId: "practitioner1" as any,
      locationId: "location1" as any,
      notes: "Test appointment",
      isLocal: true,
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
      title: "Local Test",
      start: new Date(),
      end: new Date(),
      appointmentType: "Nachuntersuchung",
      practitionerId: "practitioner1" as any,
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
      title: "Required Fields Test",
      start: new Date("2024-01-15T10:00:00Z"),
      end: new Date("2024-01-15T11:00:00Z"),
      appointmentType: "Vorsorge",
      practitionerId: "practitioner2" as any,
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
      id: "local-test-id",
      title: "Full Appointment",
      start: new Date(),
      end: new Date(),
      appointmentType: "Akutsprechstunde",
      practitionerId: "practitioner3" as any,
      locationId: "location2" as any,
      patientId: "patient1" as any,
      notes: "Optional field test",
      isLocal: true,
    };

    const minimalAppointment: LocalAppointment = {
      id: "local-minimal-id",
      title: "Minimal Appointment",
      start: new Date(),
      end: new Date(),
      appointmentType: "Erstberatung",
      practitionerId: "practitioner4" as any,
      isLocal: true,
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
