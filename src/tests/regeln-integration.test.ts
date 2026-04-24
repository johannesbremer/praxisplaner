import { describe, expect, it } from "vitest";

import type { AppointmentResult } from "@/convex/appointments";

import type { SchedulingSimulatedContext } from "../types";

import { toTableId } from "../../convex/identity";

const baseAppointment: AppointmentResult = {
  _creationTime: 0,
  _id: toTableId<"appointments">("appointment-base"),
  appointmentTypeId: toTableId<"appointmentTypes">("appointmentType1"),
  appointmentTypeLineageKey: toTableId<"appointmentTypes">(
    "appointment_type_lineage_1",
  ),
  appointmentTypeTitle: "Erstgespräch",
  createdAt: 0n,
  end: "2024-01-15T11:00:00Z",
  lastModified: 0n,
  locationId: toTableId<"locations">("location1"),
  locationLineageKey: toTableId<"locations">("location_lineage_1"),
  practiceId: toTableId<"practices">("practice1"),
  start: "2024-01-15T10:00:00Z",
  title: "Initial Consultation",
};

const createAppointment = (
  overrides: Partial<AppointmentResult> = {},
): AppointmentResult => ({
  ...baseAppointment,
  ...overrides,
});

describe("Regeln Integration - Simulation Metadata", () => {
  it("marks calendar events as simulation when flag is set", () => {
    const practitionerId = toTableId<"practitioners">("practitioner1");
    const appointmentTypeId = toTableId<"appointmentTypes">("appointmentType2");
    const event = createAppointment({
      _id: toTableId<"appointments">("sim-appointment-123"),
      appointmentTypeId,
      appointmentTypeLineageKey: toTableId<"appointmentTypes">(
        "appointment_type_lineage_2",
      ),
      isSimulation: true,
      practitionerId,
      practitionerLineageKey: practitionerId,
    });

    expect(event.isSimulation).toBe(true);
    expect(event.appointmentTypeId).toBe(appointmentTypeId);
    expect(event.locationId).toBe("location1");
    expect(event.practitionerLineageKey).toBe(practitionerId);
  });

  it("defaults to real appointments when simulation flag is absent", () => {
    const event = createAppointment({
      _id: toTableId<"appointments">("real-appointment-001"),
    });

    expect(event.isSimulation).toBeUndefined();
  });

  it("allows updating simulated context dynamically", () => {
    const appointmentTypeId = toTableId<"appointmentTypes">("appointmentType3");
    const context: SchedulingSimulatedContext = {
      appointmentTypeLineageKey: appointmentTypeId,
      patient: { isNew: true },
    };

    const updatedContext: SchedulingSimulatedContext = {
      ...context,
      locationLineageKey: toTableId<"locations">("location2"),
      patient: { isNew: false },
    };

    expect(updatedContext.appointmentTypeLineageKey).toBe(appointmentTypeId);
    expect(updatedContext.patient.isNew).toBe(false);
    expect(updatedContext.locationLineageKey).toBe("location2");
  });

  it("preserves practitioner metadata for simulation events", () => {
    const practitionerId = toTableId<"practitioners">("practitionerX");

    const event = createAppointment({
      _id: toTableId<"appointments">("sim-appointment-practitioner"),
      isSimulation: true,
      practitionerId,
      practitionerLineageKey: practitionerId,
    });

    expect(event.practitionerLineageKey).toBe(practitionerId);
    expect(event.isSimulation).toBe(true);
  });
});
