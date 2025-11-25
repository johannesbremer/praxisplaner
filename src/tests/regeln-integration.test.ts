import { describe, expect, it } from "vitest";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import type { SchedulingSimulatedContext } from "../types";

const baseAppointment: Doc<"appointments"> = {
  _creationTime: 0,
  _id: "appointment-base" as Id<"appointments">,
  appointmentTypeId: "appointmentType1" as Id<"appointmentTypes">,
  createdAt: 0n,
  end: "2024-01-15T11:00:00Z",
  lastModified: 0n,
  locationId: "location1" as Id<"locations">,
  practiceId: "practice1" as Id<"practices">,
  start: "2024-01-15T10:00:00Z",
  title: "Initial Consultation", // Snapshot of appointment type name at booking time
};

const createAppointment = (
  overrides: Partial<Doc<"appointments">> = {},
): Doc<"appointments"> => ({
  ...baseAppointment,
  ...overrides,
});

describe("Regeln Integration - Simulation Metadata", () => {
  it("marks calendar events as simulation when flag is set", () => {
    const practitionerId = "practitioner1" as Id<"practitioners">;
    const appointmentTypeId = "appointmentType2" as Id<"appointmentTypes">;
    const event = createAppointment({
      _id: "sim-appointment-123" as Id<"appointments">,
      appointmentTypeId,
      isSimulation: true,
      practitionerId,
    });

    expect(event.isSimulation).toBe(true);
    expect(event.appointmentTypeId).toBe(appointmentTypeId);
    expect(event.locationId).toBe("location1");
    expect(event.practitionerId).toBe(practitionerId);
  });

  it("defaults to real appointments when simulation flag is absent", () => {
    const event = createAppointment({
      _id: "real-appointment-001" as Id<"appointments">,
    });

    expect(event.isSimulation).toBeUndefined();
  });

  it("allows updating simulated context dynamically", () => {
    const appointmentTypeId = "appointmentType3" as Id<"appointmentTypes">;
    const context: SchedulingSimulatedContext = {
      appointmentTypeId,
      patient: { isNew: true },
    };

    const updatedContext: SchedulingSimulatedContext = {
      ...context,
      locationId: "location2" as Id<"locations">,
      patient: { isNew: false },
    };

    expect(updatedContext.appointmentTypeId).toBe(appointmentTypeId);
    expect(updatedContext.patient.isNew).toBe(false);
    expect(updatedContext.locationId).toBe("location2");
  });

  it("preserves practitioner metadata for simulation events", () => {
    const practitionerId = "practitionerX" as Id<"practitioners">;

    const event = createAppointment({
      _id: "sim-appointment-practitioner" as Id<"appointments">,
      isSimulation: true,
      practitionerId,
    });

    expect(event.practitionerId).toBe(practitionerId);
    expect(event.isSimulation).toBe(true);
  });
});
