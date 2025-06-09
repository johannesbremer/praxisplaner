// lib/convex-client.ts

/**
 * Client-side utilities for working with the Rules Engine via Convex
 * This provides a bridge between the UI components and the Convex backend
 */

import type { DbRule, DbRuleConfiguration, PatientContext, Rule, RuleConfigurationVersion } from "./types";

/* eslint-disable jsdoc/match-description, jsdoc/informative-docs */
// Conversion utilities to transform between UI types and Convex types

/**
 * Converts a Convex rule document to the UI Rule type.
 * @param dbRule The database rule document from Convex
 * @returns Converted Rule object for UI consumption
 */
export function convertDbRuleToRule(dbRule: DbRule): Rule {
  return {
    actions: dbRule.actions,
    active: dbRule.active,
    conditions: dbRule.conditions,
    id: dbRule._id,
    name: dbRule.name,
    priority: dbRule.priority,
    type: dbRule.type,
  };
}

/**
 * Convert UI Rule to Convex-compatible format
 */
export function convertRuleToDbRule(rule: Rule) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...ruleData } = rule;
  return ruleData;
}

/**
 * Convert Convex rule configuration to UI type
 */
export function convertDbConfigToConfig(
  dbConfig: DbRuleConfiguration,
  ruleCount = 0,
): RuleConfigurationVersion {
  return {
    createdAt: new Date(Number(dbConfig.createdAt)),
    createdBy: dbConfig.createdBy,
    description: dbConfig.description,
    id: dbConfig._id,
    isActive: dbConfig.isActive,
    ruleCount,
    version: dbConfig.version,
  };
}

/**
 * Generate sample patient contexts for testing/debugging
 */
export function generateSamplePatientContexts(): PatientContext[] {
  return [
    {
      assignedDoctor: null,
      isNewPatient: true,
      lastVisit: null,
      medicalHistory: [],
    },
    {
      assignedDoctor: "Dr. Schmidt",
      isNewPatient: false,
      lastVisit: "2024-01-15",
      medicalHistory: ["Hypertension", "Diabetes"],
    },
    {
      assignedDoctor: "Dr. Müller",
      isNewPatient: false,
      lastVisit: "2024-01-20",
      medicalHistory: ["Asthma"],
    },
    {
      assignedDoctor: "Dr. Schmidt",
      isNewPatient: true,
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
export function generateDateRange(days = 7): {
  end: string;
  start: string;
} {
  const start = new Date();
  const end = new Date();
  end.setDate(start.getDate() + days);

  return {
    end: end.toISOString().split("T")[0] ?? "",
    start: start.toISOString().split("T")[0] ?? "",
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
    conditions.push(
      `Date: ${rule.conditions.dateRange.start} - ${rule.conditions.dateRange.end}`,
    );
  }
  if (rule.conditions.dayOfWeek && rule.conditions.dayOfWeek.length > 0) {
    const days = rule.conditions.dayOfWeek
      .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
      .join(", ");
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
    actions.push(`Block: ${rule.actions.blockTimeSlots.join(", ")}`);
  }
  if (rule.actions.requireSpecificDoctor) {
    actions.push(`Doctor: ${rule.actions.requireSpecificDoctor}`);
  }

  const conditionsStr =
    conditions.length > 0 ? `When: ${conditions.join(", ")}` : "";
  const actionsStr = actions.length > 0 ? `Then: ${actions.join(", ")}` : "";

  return [conditionsStr, actionsStr].filter(Boolean).join(" | ");
}

/**
 * Validate rule configuration
 */
export function validateRule(rule: Partial<Rule>): {
  errors: string[];
  valid: boolean;
} {
  const errors: string[] = [];

  if (!rule.name || rule.name.trim() === "") {
    errors.push("Rule name is required");
  }

  if (!rule.type) {
    errors.push("Rule type is required");
  }

  if (typeof rule.priority !== "number" || rule.priority < 1) {
    errors.push("Priority must be a positive number");
  }

  // Validate conditions
  if (rule.conditions) {
    if (rule.conditions.dateRange) {
      const { end, start } = rule.conditions.dateRange;
      if (start && end && new Date(start) >= new Date(end)) {
        errors.push("Start date must be before end date");
      }
    }

    if (rule.conditions.timeRange) {
      const { end, start } = rule.conditions.timeRange;
      if (start && end && start >= end) {
        errors.push("Start time must be before end time");
      }
    }
  }

  // Validate actions
  if (rule.actions) {
    if (rule.actions.extraMinutes && rule.actions.extraMinutes < 0) {
      errors.push("Extra minutes cannot be negative");
    }

    if (rule.actions.limitPerDay && rule.actions.limitPerDay < 1) {
      errors.push("Limit per day must be at least 1");
    }

    if (rule.actions.batchSize && rule.actions.batchSize < 1) {
      errors.push("Batch size must be at least 1");
    }
  }

  return {
    errors,
    valid: errors.length === 0,
  };
}
/* eslint-enable jsdoc/match-description, jsdoc/informative-docs */
