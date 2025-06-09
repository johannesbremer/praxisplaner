// test/rules-engine.test.ts
import { describe, it, expect } from 'vitest';
import { RulesEngine } from '../lib/rules-engine';
import type { Rule, PatientContext, AvailableSlot } from '../lib/types';

describe('RulesEngine', () => {
  const sampleRules: Rule[] = [
    {
      id: '1',
      name: 'New Patient Extra Time',
      type: 'CONDITIONAL_AVAILABILITY',
      priority: 1,
      active: true,
      conditions: {
        patientType: 'new',
        appointmentType: 'Erstberatung',
      },
      actions: {
        requireExtraTime: true,
        extraMinutes: 15,
      },
    },
    {
      id: '2',
      name: 'Limit Flu Shots',
      type: 'SEASONAL_AVAILABILITY',
      priority: 2,
      active: true,
      conditions: {
        appointmentType: 'Grippeimpfung',
        dateRange: {
          start: '2024-10-01',
          end: '2024-12-31',
        },
      },
      actions: {
        limitPerDay: 5,
      },
    },
  ];

  const sampleSlots: AvailableSlot[] = [
    {
      id: 'slot1',
      time: '09:00',
      duration: 30,
      doctor: 'Dr. Schmidt',
      appointmentType: 'default',
      date: '2024-11-15',
    },
    {
      id: 'slot2',
      time: '09:30',
      duration: 30,
      doctor: 'Dr. Schmidt',
      appointmentType: 'default',
      date: '2024-11-15',
    },
    {
      id: 'slot3',
      time: '10:00',
      duration: 30,
      doctor: 'Dr. Müller',
      appointmentType: 'default',
      date: '2024-11-15',
    },
  ];

  it('should create an instance with rules', () => {
    const engine = new RulesEngine(sampleRules);
    expect(engine.getRules()).toHaveLength(2);
  });

  it('should apply extra time rule for new patients', () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      isNewPatient: true,
      assignedDoctor: null,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      'Erstberatung',
      patientContext,
      new Date('2024-11-15')
    );

    // Should apply the "New Patient Extra Time" rule
    expect(result.appliedRules).toContain('New Patient Extra Time');
    expect(result.slots[0].duration).toBe(45); // 30 + 15 minutes
  });

  it('should not apply rules when conditions are not met', () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      isNewPatient: false, // Not a new patient
      assignedDoctor: 'Dr. Schmidt',
      lastVisit: '2024-01-01',
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      'Erstberatung',
      patientContext,
      new Date('2024-11-15')
    );

    // Should not apply the "New Patient Extra Time" rule
    expect(result.appliedRules).not.toContain('New Patient Extra Time');
    expect(result.slots[0].duration).toBe(30); // Original duration
  });

  it('should apply date range rules correctly', () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      isNewPatient: false,
      assignedDoctor: null,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      'Grippeimpfung',
      patientContext,
      new Date('2024-11-15') // Within the date range
    );

    // Should apply the "Limit Flu Shots" rule
    expect(result.appliedRules).toContain('Limit Flu Shots');
  });

  it('should not apply date range rules outside the range', () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      isNewPatient: false,
      assignedDoctor: null,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      'Grippeimpfung',
      patientContext,
      new Date('2024-09-15') // Outside the date range
    );

    // Should not apply the "Limit Flu Shots" rule
    expect(result.appliedRules).not.toContain('Limit Flu Shots');
  });

  it('should update rules correctly', () => {
    const engine = new RulesEngine(sampleRules);
    expect(engine.getRules()).toHaveLength(2);

    const newRules: Rule[] = [sampleRules[0]]; // Only one rule
    engine.updateRules(newRules);
    expect(engine.getRules()).toHaveLength(1);
  });

  it('should generate base slots correctly', () => {
    const engine = new RulesEngine();
    const date = new Date('2024-11-15'); // Friday
    const slots = engine.generateBaseSlots(date);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toHaveProperty('id');
    expect(slots[0]).toHaveProperty('time');
    expect(slots[0]).toHaveProperty('doctor');
  });

  it('should not generate base slots for weekends', () => {
    const engine = new RulesEngine();
    const sunday = new Date('2024-11-17'); // Sunday
    const slots = engine.generateBaseSlots(sunday);

    expect(slots).toHaveLength(0);
  });

  it('should provide rule trace for debugging', () => {
    const engine = new RulesEngine(sampleRules);
    const patientContext: PatientContext = {
      isNewPatient: true,
      assignedDoctor: null,
      lastVisit: null,
      medicalHistory: [],
    };

    const result = engine.generateAvailableSlots(
      sampleSlots,
      'Erstberatung',
      patientContext,
      new Date('2024-11-15')
    );

    expect(result.ruleTrace).toBeDefined();
    expect(result.ruleTrace.length).toBe(2); // Both rules should be in the trace
    expect(result.ruleTrace[0]).toHaveProperty('ruleName');
    expect(result.ruleTrace[0]).toHaveProperty('applied');
    expect(result.ruleTrace[0]).toHaveProperty('reason');
  });
});