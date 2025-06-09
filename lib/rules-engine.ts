// lib/rules-engine.ts
import { isWithinInterval, parseISO } from "date-fns";

import type {
  AvailableSlot,
  PatientContext,
  Rule,
  RuleApplicationResult,
} from "./types";

/**
 * RulesEngine class for generating available appointment slots based on rules
 * This version works with database-stored rules instead of hardcoded ones
 */
export class RulesEngine {
  private rules: Rule[];

  constructor(rules: Rule[] = []) {
    this.rules = rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Update the rules used by this engine instance
   */
  public updateRules(rules: Rule[]): void {
    this.rules = rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Generate available slots based on base availability and active rules
   */
  public generateAvailableSlots(
    baseSlots: AvailableSlot[],
    appointmentType: string,
    patientContext: PatientContext,
    date: Date,
  ): RuleApplicationResult {
    let slots = [...baseSlots];
    const appliedRules: string[] = [];
    const ruleTrace: { applied: boolean; reason: string; ruleName: string }[] =
      [];

    // Apply each rule in priority order
    for (const rule of this.rules) {
      if (!rule.active) {
        ruleTrace.push({
          applied: false,
          reason: "Rule is inactive",
          ruleName: rule.name,
        });
        continue;
      }

      if (this.isRuleApplicable(rule, appointmentType, patientContext, date)) {
        const result = this.applyRule(rule, slots);

        ruleTrace.push({
          applied: result.applied,
          reason: result.message || "Rule applied successfully",
          ruleName: rule.name,
        });

        if (result.applied) {
          slots = result.slots;
          appliedRules.push(rule.name);
        }
      } else {
        ruleTrace.push({
          applied: false,
          reason: "Rule conditions not met",
          ruleName: rule.name,
        });
      }
    }

    return {
      appliedRules,
      ruleTrace,
      slots,
    };
  }

  /**
   * Check if a rule is applicable based on current conditions
   */
  private isRuleApplicable(
    rule: Rule,
    appointmentType: string,
    patientContext: PatientContext,
    date: Date,
  ): boolean {
    // Check appointment type condition
    if (
      rule.conditions.appointmentType &&
      rule.conditions.appointmentType !== appointmentType
    ) {
      return false;
    }

    // Check patient type condition
    if (rule.conditions.patientType) {
      if (
        rule.conditions.patientType === "new" &&
        !patientContext.isNewPatient
      ) {
        return false;
      }
      if (
        rule.conditions.patientType === "existing" &&
        patientContext.isNewPatient
      ) {
        return false;
      }
    }

    // Check date range condition
    if (rule.conditions.dateRange) {
      try {
        const startDate = parseISO(rule.conditions.dateRange.start);
        const endDate = parseISO(rule.conditions.dateRange.end);
        if (!isWithinInterval(date, { end: endDate, start: startDate })) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // Check day of week condition
    if (rule.conditions.dayOfWeek && rule.conditions.dayOfWeek.length > 0) {
      if (!rule.conditions.dayOfWeek.includes(date.getDay())) {
        return false;
      }
    }

    // Check time range condition (if slots have time information)
    if (rule.conditions.timeRange) {
      // This would need to be implemented based on how time ranges work with slots
      // For now, we'll skip this check
    }

    return true;
  }

  /**
   * Apply a rule to a set of slots
   */
  private applyRule(
    rule: Rule,
    slots: AvailableSlot[],
  ): { applied: boolean; message: string; slots: AvailableSlot[] } {
    let currentSlots = [...slots];
    let message = "";
    let applied = false;

    // Apply extra time rule
    if (
      rule.actions.requireExtraTime &&
      rule.actions.extraMinutes &&
      rule.actions.extraMinutes > 0
    ) {
      const extraMinutesValue = rule.actions.extraMinutes;
      currentSlots = currentSlots.map((slot) => ({
        ...slot,
        duration: slot.duration + extraMinutesValue,
        notes:
          `${slot.notes || ""} (Extra ${extraMinutesValue} min by ${rule.name})`.trim(),
      }));
      message += `Added ${extraMinutesValue} extra minutes. `;
      applied = true;
    }

    // Apply limit per day rule
    if (rule.actions.limitPerDay && rule.actions.limitPerDay > 0) {
      const limit = rule.actions.limitPerDay;
      const slotsPerDoctor = new Map<string, number>();
      const limitedSlots: AvailableSlot[] = [];

      for (const slot of currentSlots) {
        const count = slotsPerDoctor.get(slot.doctor) || 0;
        if (count < limit) {
          limitedSlots.push(slot);
          slotsPerDoctor.set(slot.doctor, count + 1);
        }
      }

      if (currentSlots.length !== limitedSlots.length) {
        message += `Limited to ${limit} appointments per day per doctor. `;
        applied = true;
      }
      currentSlots = limitedSlots;
    }

    // Apply batch appointments rule
    if (
      rule.actions.enableBatchAppointments &&
      rule.actions.batchSize &&
      rule.actions.batchSize > 0
    ) {
      // Logic for batch appointments would be more complex
      // For now, just add a note that batch appointments are enabled
      message += `Batch appointments enabled (${rule.actions.batchSize} patients). `;
      applied = true;
    }

    // Apply block time slots rule
    if (rule.actions.blockTimeSlots && rule.actions.blockTimeSlots.length > 0) {
      const slotsToBlock = new Set(rule.actions.blockTimeSlots);
      const originalLength = currentSlots.length;
      currentSlots = currentSlots.filter(
        (slot) => !slotsToBlock.has(slot.time),
      );

      if (currentSlots.length < originalLength) {
        message += `Blocked specific time slots. `;
        applied = true;
      }
    }

    // Apply specific doctor requirement
    if (rule.actions.requireSpecificDoctor) {
      const requiredDoctor = rule.actions.requireSpecificDoctor;
      const originalLength = currentSlots.length;
      currentSlots = currentSlots.filter(
        (slot) => slot.doctor === requiredDoctor,
      );

      if (currentSlots.length < originalLength) {
        message += `Filtered to specific doctor: ${requiredDoctor}. `;
        applied = true;
      }
    }

    return { applied, message, slots: currentSlots };
  }

  /**
   * Get the rules currently loaded in this engine
   */
  public getRules(): Rule[] {
    return [...this.rules];
  }

  /**
   * Get only active rules
   */
  public getActiveRules(): Rule[] {
    return this.rules.filter((rule) => rule.active);
  }

  /**
   * Generate base availability slots for a given date
   * This is a mock implementation - in real usage, this would come from the database
   */
  public generateBaseSlots(
    date: Date,
    doctors: string[] = ["Dr. Schmidt", "Dr. Müller"],
  ): AvailableSlot[] {
    const slots: AvailableSlot[] = [];
    const dayOfWeek = date.getDay();

    // Skip weekends for this example
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return slots;
    }

    for (const doctor of doctors) {
      // Morning slots: 8:00 - 12:00
      for (let hour = 8; hour < 12; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          slots.push({
            appointmentType: "default",
            date:
              typeof date === "string"
                ? date
                : (date.toISOString().split("T")[0] ?? ""),
            doctor,
            duration: 30,
            id: `${doctor}_${typeof date === "string" ? date : (date.toISOString().split("T")[0] ?? "")}_${hour.toString().padStart(2, "0")}${minute.toString().padStart(2, "0")}`,
            time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
          });
        }
      }

      // Afternoon slots: 14:00 - 18:00
      for (let hour = 14; hour < 18; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          slots.push({
            appointmentType: "default",
            date:
              typeof date === "string"
                ? date
                : (date.toISOString().split("T")[0] ?? ""),
            doctor,
            duration: 30,
            id: `${doctor}_${typeof date === "string" ? date : (date.toISOString().split("T")[0] ?? "")}_${hour.toString().padStart(2, "0")}${minute.toString().padStart(2, "0")}`,
            time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
          });
        }
      }
    }

    return slots;
  }
}
