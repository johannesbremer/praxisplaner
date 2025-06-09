// test/rules-engine.test.ts
import { describe, expect, it } from "vitest";

import type { AvailableSlot, PatientContext, Rule } from "../lib/types";

import { RulesEngine } from "../lib/rules-engine";

describe("RulesEngine", () => {
  const sampleRules: Rule[] = [
    {
      actions: {
        extraMinutes: 15,
        requireExtraTime: true,
      },
      active: true,
      conditions: {
        appointmentType: "Erstberatung",
        patientType: "new",
      },
      id: "1",
      name: "New Patient Extra Time",
      priority: 1,
      type: "CONDITIONAL_AVAILABILITY",
    },
    {
      actions: {
        limitPerDay: 5,
      },
      active: true,
      conditions: {
        appointmentType: "Grippeimpfung",
        dateRange: {
          end: "2024-12-31",
          start: "2024-10-01",
        },
      },
      id: "2",
      name: "Limit Flu Shots",
      priority: 2,
      type: "SEASONAL_AVAILABILITY",
    },
  ];

  const sampleSlots: AvailableSlot[] = [
    {
      appointmentType: "default",
      date: "2024-11-15",
      doctor: "Dr. Schmidt",
      duration: 30,
      id: "slot1",
      time: "09:00",
    },
    {
      appointmentType: "default",
      date: "2024-11-15",
      doctor: "Dr. Schmidt",
      duration: 30,
      id: "slot2",
      time: "09:30",
    },
    {
      appointmentType: "default",
      date: "2024-11-15",
      doctor: "Dr. Müller",
      duration: 30,
      id: "slot3",
      time: "10:00",
    },
  ];

  it("should create an instance with rules", () => {
    const engine = new RulesEngine(sampleRules);
    expect(engine.getRules()).toHaveLength(2);
  });

  it("should apply extra time rule for new patients", () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      assignedDoctor: null,
      isNewPatient: true,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      "Erstberatung",
      patientContext,
      new Date("2024-11-15"),
    );

    // Should apply the "New Patient Extra Time" rule
    expect(result.appliedRules).toContain("New Patient Extra Time");
    expect(result.slots[0].duration).toBe(45); // 30 + 15 minutes
  });

  it("should not apply rules when conditions are not met", () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      assignedDoctor: "Dr. Schmidt",
      isNewPatient: false, // Not a new patient
      lastVisit: "2024-01-01",
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      "Erstberatung",
      patientContext,
      new Date("2024-11-15"),
    );

    // Should not apply the "New Patient Extra Time" rule
    expect(result.appliedRules).not.toContain("New Patient Extra Time");
    expect(result.slots[0].duration).toBe(30); // Original duration
  });

  it("should apply date range rules correctly", () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      assignedDoctor: null,
      isNewPatient: false,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      "Grippeimpfung",
      patientContext,
      new Date("2024-11-15"), // Within the date range
    );

    // Should apply the "Limit Flu Shots" rule
    expect(result.appliedRules).toContain("Limit Flu Shots");
  });

  it("should not apply date range rules outside the range", () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      assignedDoctor: null,
      isNewPatient: false,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      "Grippeimpfung",
      patientContext,
      new Date("2024-09-15"), // Outside the date range
    );

    // Should not apply the "Limit Flu Shots" rule
    expect(result.appliedRules).not.toContain("Limit Flu Shots");
  });

  it("should update rules correctly", () => {
    const engine = new RulesEngine(sampleRules);
    expect(engine.getRules()).toHaveLength(2);

    const newRules: Rule[] = [sampleRules[0]]; // Only one rule
    engine.updateRules(newRules);
    expect(engine.getRules()).toHaveLength(1);
  });

  it("should generate base slots correctly", () => {
    const engine = new RulesEngine();
    const date = new Date("2024-11-15"); // Friday
    const slots = engine.generateBaseSlots(date);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toHaveProperty("id");
    expect(slots[0]).toHaveProperty("time");
    expect(slots[0]).toHaveProperty("doctor");
  });

  it("should not generate base slots for weekends", () => {
    const engine = new RulesEngine();
    const sunday = new Date("2024-11-17"); // Sunday
    const slots = engine.generateBaseSlots(sunday);

    expect(slots).toHaveLength(0);
  });

  it("should provide rule trace for debugging", () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      assignedDoctor: null,
      isNewPatient: true,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      "Erstberatung",
      patientContext,
      new Date("2024-11-15"),
    );

    expect(result.ruleTrace).toBeDefined();
    expect(result.ruleTrace.length).toBe(2); // Both rules should be in the trace
    expect(result.ruleTrace[0]).toHaveProperty("ruleName");
    expect(result.ruleTrace[0]).toHaveProperty("applied");
    expect(result.ruleTrace[0]).toHaveProperty("reason");
  });
});
