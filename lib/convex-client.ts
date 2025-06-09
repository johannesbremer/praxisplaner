// lib/convex-client.ts
/**
 * Client-side utilities for working with the Rules Engine via Convex
 * This provides a bridge between the UI components and the Convex backend
 */

import type { Rule, RuleConfigurationVersion, PatientContext, AvailableSlot } from "./types";

// Conversion utilities to transform between UI types and Convex types

/**
 * Convert a Convex rule to UI Rule type
 */
export function convertDbRuleToRule(dbRule: any): Rule {
  return {
    id: dbRule._id,
    name: dbRule.name,
    type: dbRule.type,
    priority: dbRule.priority,
    active: dbRule.active,
    conditions: dbRule.conditions,
    actions: dbRule.actions,
  };
}

/**
 * Convert UI Rule to Convex-compatible format
 */
export function convertRuleToDbRule(rule: Rule) {
  const { id, ...ruleData } = rule;
  return ruleData;
}

/**
 * Convert Convex rule configuration to UI type
 */
export function convertDbConfigToConfig(dbConfig: any): RuleConfigurationVersion {
  return {
    id: dbConfig._id,
    version: dbConfig.version,
    description: dbConfig.description,
    createdBy: dbConfig.createdBy,
    createdAt: new Date(Number(dbConfig.createdAt)),
    isActive: dbConfig.isActive,
    ruleCount: dbConfig.ruleCount || 0,
  };
}

/**
 * Generate sample patient contexts for testing/debugging
 */
export function generateSamplePatientContexts(): PatientContext[] {
  return [
    {
      isNewPatient: true,
      assignedDoctor: null,
      lastVisit: null,
      medicalHistory: [],
    },
    {
      isNewPatient: false,
      assignedDoctor: "Dr. Schmidt",
      lastVisit: "2024-01-15",
      medicalHistory: ["Hypertension", "Diabetes"],
    },
    {
      isNewPatient: false,
      assignedDoctor: "Dr. Müller",
      lastVisit: "2024-01-20",
      medicalHistory: ["Asthma"],
    },
    {
      isNewPatient: true,
      assignedDoctor: "Dr. Schmidt",
      lastVisit: null,
      medicalHistory: [],
    },
  ];
}

/**
 * Generate sample appointment types
 */
export function generateSampleAppointmentTypes(): string[] {
  return [
    "Erstberatung",
    "Kontrolltermin",
    "Akutsprechstunde",
    "Grippeimpfung",
    "Gesundheitscheck",
    "Nachsorge",
  ];
}

/**
 * Generate date range for testing
 */
export function generateDateRange(days: number = 7): { start: string; end: string } {
  const start = new Date();
  const end = new Date();
  end.setDate(start.getDate() + days);
  
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/**
 * Format rule for display
 */
export function formatRuleForDisplay(rule: Rule): string {
  const conditions = [];
  const actions = [];

  // Format conditions
  if (rule.conditions.appointmentType) {
    conditions.push(`Appointment: ${rule.conditions.appointmentType}`);
  }
  if (rule.conditions.patientType) {
    conditions.push(`Patient: ${rule.conditions.patientType}`);
  }
  if (rule.conditions.dateRange) {
    conditions.push(`Date: ${rule.conditions.dateRange.start} - ${rule.conditions.dateRange.end}`);
  }
  if (rule.conditions.dayOfWeek && rule.conditions.dayOfWeek.length > 0) {
    const days = rule.conditions.dayOfWeek.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
    conditions.push(`Days: ${days}`);
  }

  // Format actions
  if (rule.actions.extraMinutes) {
    actions.push(`+${rule.actions.extraMinutes} minutes`);
  }
  if (rule.actions.limitPerDay) {
    actions.push(`Max ${rule.actions.limitPerDay}/day`);
  }
  if (rule.actions.enableBatchAppointments && rule.actions.batchSize) {
    actions.push(`Batch: ${rule.actions.batchSize} patients`);
  }
  if (rule.actions.blockTimeSlots && rule.actions.blockTimeSlots.length > 0) {
    actions.push(`Block: ${rule.actions.blockTimeSlots.join(', ')}`);
  }
  if (rule.actions.requireSpecificDoctor) {
    actions.push(`Doctor: ${rule.actions.requireSpecificDoctor}`);
  }

  const conditionsStr = conditions.length > 0 ? `When: ${conditions.join(', ')}` : '';
  const actionsStr = actions.length > 0 ? `Then: ${actions.join(', ')}` : '';

  return [conditionsStr, actionsStr].filter(Boolean).join(' | ');
}

/**
 * Validate rule configuration
 */
export function validateRule(rule: Partial<Rule>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rule.name || rule.name.trim() === '') {
    errors.push('Rule name is required');
  }

  if (!rule.type) {
    errors.push('Rule type is required');
  }

  if (typeof rule.priority !== 'number' || rule.priority < 1) {
    errors.push('Priority must be a positive number');
  }

  // Validate conditions
  if (rule.conditions) {
    if (rule.conditions.dateRange) {
      const { start, end } = rule.conditions.dateRange;
      if (start && end && new Date(start) >= new Date(end)) {
        errors.push('Start date must be before end date');
      }
    }

    if (rule.conditions.timeRange) {
      const { start, end } = rule.conditions.timeRange;
      if (start && end && start >= end) {
        errors.push('Start time must be before end time');
      }
    }
  }

  // Validate actions
  if (rule.actions) {
    if (rule.actions.extraMinutes && rule.actions.extraMinutes < 0) {
      errors.push('Extra minutes cannot be negative');
    }

    if (rule.actions.limitPerDay && rule.actions.limitPerDay < 1) {
      errors.push('Limit per day must be at least 1');
    }

    if (rule.actions.batchSize && rule.actions.batchSize < 1) {
      errors.push('Batch size must be at least 1');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}