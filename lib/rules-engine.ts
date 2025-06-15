// lib/rules-engine.ts
import { isWithinInterval, parseISO } from "date-fns";

import type { AvailableSlot, PatientContext, Rule } from "./types";

export class RulesEngine {
  private rules: Rule[] = [
    {
      actions: {
        extraMinutes: 15,
        limitPerDay: 3,
        requireExtraTime: true,
      },
      active: true,
      conditions: {
        appointmentType: "Erstberatung",
        patientType: "new",
      },
      id: "1",
      name: "Neue Patienten - Ersttermin",
      priority: 1,
      type: "CONDITIONAL_AVAILABILITY",
    },
    {
      actions: {
        batchDuration: 60,
        batchSize: 4,
        enableBatchAppointments: true,
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
      name: "Grippeimpfung - Saisonale Verfügbarkeit",
      priority: 2,
      type: "SEASONAL_AVAILABILITY",
    },
    // Add more predefined rules or load them from a configuration
  ];

  // Constructor to potentially load rules from an external source
  constructor(initialRules?: Rule[]) {
    if (initialRules) {
      this.rules = initialRules;
    }
  }

  public generateAvailableSlots(
    date: Date,
    appointmentType: string,
    patientContext: PatientContext,
  ): { appliedRules: string[]; slots: AvailableSlot[] } {
    const baseSlots = this.getBaseAvailability(date);
    const applicableRules = this.getApplicableRules(
      appointmentType,
      patientContext,
      date,
    );

    const appliedRuleMessages: string[] = [];
    let modifiedSlots = [...baseSlots];

    applicableRules.sort((a, b) => a.priority - b.priority);

    for (const rule of applicableRules) {
      // Now applyRule accepts the additional arguments
      const result = this.applyRule(rule, modifiedSlots);
      modifiedSlots = result.slots;
      if (result.applied) {
        appliedRuleMessages.push(
          `${rule.name}${result.message ? `: ${result.message}` : ""}`,
        );
      }
    }

    return { appliedRules: appliedRuleMessages, slots: modifiedSlots };
  }

  // Modified applyRule to accept (but not necessarily use yet) appointmentType and patientContext
  private applyRule(
    rule: Rule,
    slots: AvailableSlot[],
  ): { applied: boolean; message: string; slots: AvailableSlot[] } {
    let currentSlots = [...slots]; // Work on a copy
    let message = "";
    let applied = false;

    // Example: Rule type specific logic (not fully implemented, just showing structure)
    // if (rule.type === "CONDITIONAL_AVAILABILITY") {
    //   // Use appointmentType or patientContext if needed for this rule type's actions
    // }

    if (
      rule.actions.requireExtraTime &&
      typeof rule.actions.extraMinutes === "number" &&
      rule.actions.extraMinutes > 0
    ) {
      const extraMinutesValue = rule.actions.extraMinutes;
      currentSlots = currentSlots.map((slot) => ({
        ...slot,
        duration: slot.duration + extraMinutesValue,
        notes:
          `${slot.notes || ""} (Zusätzliche ${extraMinutesValue} Min. durch Regel: ${rule.name})`.trim(),
      }));
      message += `Zusätzliche ${extraMinutesValue} Minuten hinzugefügt. `;
      applied = true;
    }

    if (
      typeof rule.actions.limitPerDay === "number" &&
      rule.actions.limitPerDay > 0
    ) {
      const limit = rule.actions.limitPerDay;
      const slotsPerDoctorToday = new Map<string, number>(); // This should ideally count existing appointments too

      // This filtering is a bit simplistic as it only considers the current batch of *available* slots.
      // A real implementation would need to know about *already booked* appointments for the day.
      const limitedSlots: AvailableSlot[] = [];
      for (const slot of currentSlots) {
        const count = slotsPerDoctorToday.get(slot.doctor) || 0;
        if (count < limit) {
          limitedSlots.push(slot);
          slotsPerDoctorToday.set(slot.doctor, count + 1);
        }
      }
      if (currentSlots.length !== limitedSlots.length) {
        message += `Maximal ${limit} Termine pro Tag/Arzt angewendet. `;
        applied = true;
      }
      currentSlots = limitedSlots;
    }

    if (
      rule.actions.enableBatchAppointments &&
      typeof rule.actions.batchSize === "number" &&
      rule.actions.batchSize > 0
    ) {
      // Logic for batch appointments would be more complex, involving grouping slots
      // For now, just a message.
      message += `Gruppentermine mit ${rule.actions.batchSize} Patienten berücksichtigt. `;
      applied = true;
    }

    if (rule.actions.blockTimeSlots && rule.actions.blockTimeSlots.length > 0) {
      const slotsToBlock = new Set(rule.actions.blockTimeSlots); // e.g., ["10:00", "10:30"]
      const originalLength = currentSlots.length;
      currentSlots = currentSlots.filter(
        (slot) => !slotsToBlock.has(slot.time),
      );
      if (currentSlots.length < originalLength) {
        message += `Bestimmte Zeiten blockiert. `;
        applied = true;
      }
    }

    return { applied, message: message.trim(), slots: currentSlots };
  }

  private getApplicableRules(
    appointmentType: string,
    patientContext: PatientContext,
    date: Date,
  ): Rule[] {
    return this.rules.filter((rule) => {
      if (!rule.active) {
        return false;
      }

      let conditionsMet = true; // Start assuming conditions are met

      if (
        rule.conditions.appointmentType &&
        rule.conditions.appointmentType.trim() !== ""
       && rule.conditions.appointmentType !== appointmentType) {
          conditionsMet = false;
        }

      if (conditionsMet && rule.conditions.patientType) {
        const isNew = patientContext.isNewPatient;
        if (rule.conditions.patientType === "new" && !isNew) {
          conditionsMet = false;
        }
        if (rule.conditions.patientType === "existing" && isNew) {
          conditionsMet = false;
        }
      }

      if (conditionsMet && rule.conditions.dateRange) {
        try {
          const start = parseISO(rule.conditions.dateRange.start);
          const end = parseISO(rule.conditions.dateRange.end);
          if (!isWithinInterval(date, { end, start })) {
            // Corrected order for isWithinInterval
            conditionsMet = false;
          }
        } catch (error) {
          console.error("Error parsing dateRange for rule:", rule.name, error);
          conditionsMet = false; // Invalid date range means condition not met
        }
      }

      // Add more condition checks here
      // e.g., rule.conditions.specificDoctor === patientContext.assignedDoctor

      return conditionsMet;
    });
  }

  private getBaseAvailability(date: Date): AvailableSlot[] {
    const slots: AvailableSlot[] = [];
    const doctors = ["Dr. Müller", "Dr. Schmidt", "Dr. Weber"];
    const today = new Date(date); // Work with a copy to avoid modifying original 'date'
    today.setHours(0, 0, 0, 0); // Normalize to start of day for consistent date comparisons

    for (const doctor of doctors) {
      for (let hour = 8; hour < 12; hour++) {
        // Morning
        for (let minute = 0; minute < 60; minute += 30) {
          const slotDate = new Date(today);
          slotDate.setHours(hour, minute);
          slots.push({
            appointmentType: "", // Can be filled by booking
            date: slotDate,
            doctor,
            duration: 30, // default duration
            id: `${doctor}-${hour}-${minute}-${date.getTime()}`, // More unique ID
            time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
          });
        }
      }
      for (let hour = 14; hour < 18; hour++) {
        // Afternoon
        for (let minute = 0; minute < 60; minute += 30) {
          const slotDate = new Date(today);
          slotDate.setHours(hour, minute);
          slots.push({
            appointmentType: "",
            date: slotDate,
            doctor,
            duration: 30,
            id: `${doctor}-${hour}-${minute}-${date.getTime()}`,
            time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
          });
        }
      }
    }
    return slots;
  }
}
