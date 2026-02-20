import type { Infer } from "convex/values";

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ================================
// BOOKING SESSION VALIDATORS
// ================================

/**
 * Shared validators for booking session data.
 * Each step's data is uploaded atomically when the form is validated with zod.
 * All fields are required (non-optional) - upload complete data per step.
 * Exported so they can be used in convex functions for argument validation.
 */

export const insuranceTypeValidator = v.union(
  v.literal("gkv"),
  v.literal("pkv"),
);

export const hzvStatusValidator = v.union(
  v.literal("has-contract"),
  v.literal("interested"),
  v.literal("no-interest"),
);

export const beihilfeStatusValidator = v.union(
  v.literal("yes"),
  v.literal("no"),
);

export const pkvTariffValidator = v.union(
  v.literal("basis"),
  v.literal("standard"),
  v.literal("premium"),
);

export const pkvInsuranceTypeValidator = v.union(
  v.literal("postb"),
  v.literal("kvb"),
  v.literal("other"),
);

export const genderValidator = v.union(
  v.literal("male"),
  v.literal("female"),
  v.literal("diverse"),
);

export const personalDataValidator = v.object({
  city: v.optional(v.string()),
  dateOfBirth: v.string(),
  email: v.optional(v.string()),
  firstName: v.string(),
  gender: v.optional(genderValidator),
  lastName: v.string(),
  phoneNumber: v.string(),
  postalCode: v.optional(v.string()),
  street: v.optional(v.string()),
  title: v.optional(v.string()),
});

export const medicalHistoryValidator = v.object({
  allergiesDescription: v.optional(v.string()),
  currentMedications: v.optional(v.string()),
  hasAllergies: v.boolean(),
  hasDiabetes: v.boolean(),
  hasHeartCondition: v.boolean(),
  hasLungCondition: v.boolean(),
  otherConditions: v.optional(v.string()),
});

export const emergencyContactValidator = v.object({
  name: v.string(),
  phoneNumber: v.string(),
  relationship: v.string(),
});

export const selectedSlotValidator = v.object({
  duration: v.number(),
  practitionerId: v.id("practitioners"),
  practitionerName: v.string(),
  startTime: v.string(),
});

/**
 * GKV (Gesetzliche Krankenversicherung) details - all required
 */
export const gkvDetailsValidator = v.object({
  hzvStatus: hzvStatusValidator,
  insuranceType: v.literal("gkv"),
});

/**
 * PKV (Private Krankenversicherung) details - all required
 * beihilfeStatus, pkvTariff, pkvInsuranceType are optional info but pvsConsent is required
 */
export const pkvDetailsValidator = v.object({
  beihilfeStatus: v.optional(beihilfeStatusValidator),
  insuranceType: v.literal("pkv"),
  pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
  pkvTariff: v.optional(pkvTariffValidator),
  pvsConsent: v.literal(true), // Required: must consent to private billing
});

/**
 * Combined insurance details - discriminated by insuranceType
 */
export const insuranceDetailsValidator = v.union(
  gkvDetailsValidator,
  pkvDetailsValidator,
);

/**
 * Discriminated union for booking session steps.
 * Each step contains ALL required data for that step (validated atomically with zod).
 * The `step` field acts as the discriminant for type narrowing.
 *
 * Data flow:
 * - Client validates form with zod
 * - On success, uploads complete step data atomically
 * - Convex validates with these validators (e2e type safety)
 */
export const bookingSessionStepValidator = v.union(
  // Step 1: Privacy consent (initial state, no data yet)
  v.object({
    step: v.literal("privacy"),
  }),

  // Step 2: Location selection (privacy accepted)
  v.object({
    step: v.literal("location"),
  }),

  // Step 3: Patient status selection (location selected)
  v.object({
    locationId: v.id("locations"),
    step: v.literal("patient-status"),
  }),

  // ================================
  // PATH A: NEW PATIENT
  // ================================

  // A1: Insurance type selection
  v.object({
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-insurance-type"),
  }),

  // A3a: GKV details (insurance type: GKV, pending)
  v.object({
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-gkv-details"),
  }),

  // A3a: GKV details completed
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-gkv-details-complete"),
  }),

  // A3b: PKV PVS consent step (insurance type: PKV, before details input)
  v.object({
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-pvs-consent"),
  }),

  // A3c: PKV details (after PVS consent, pending)
  v.object({
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    pvsConsent: v.literal(true),
    step: v.literal("new-pkv-details"),
  }),

  // A3c: PKV details completed
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-pkv-details-complete"),
  }),

  // A4: Personal data input (insurance details completed, pending)
  // GKV path
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-data-input"),
  }),

  // A4: Personal data input completed
  // GKV path
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    step: v.literal("new-data-input-complete"),
  }),

  // A4: Personal data input (insurance details completed, pending)
  // PKV path
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-data-input"),
  }),

  // A4: Personal data input completed
  // PKV path
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-data-input-complete"),
  }),

  // A6: Calendar selection (personal data submitted)
  // GKV path
  v.object({
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    step: v.literal("new-calendar-selection"),
  }),

  // A6: Calendar selection (personal data submitted)
  // PKV path
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-calendar-selection"),
  }),

  // A7: Confirmation (slot selected, appointment created)
  // GKV path
  v.object({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    patientId: v.optional(v.id("patients")),
    personalData: personalDataValidator,
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("new-confirmation"),
  }),

  // A7: Confirmation (slot selected, appointment created)
  // PKV path
  v.object({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    patientId: v.optional(v.id("patients")),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("new-confirmation"),
  }),

  // ================================
  // PATH B: EXISTING PATIENT
  // ================================

  // B1: Doctor selection (patient status: existing)
  v.object({
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    step: v.literal("existing-doctor-selection"),
  }),

  // B2: Personal data input (doctor selected, pending)
  v.object({
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    practitionerId: v.id("practitioners"),
    step: v.literal("existing-data-input"),
  }),

  // B3: Personal data input completed
  v.object({
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practitionerId: v.id("practitioners"),
    step: v.literal("existing-data-input-complete"),
  }),

  // B4: Calendar selection (personal data submitted)
  v.object({
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practitionerId: v.id("practitioners"),
    step: v.literal("existing-calendar-selection"),
  }),

  // B5: Confirmation (slot selected, appointment created)
  v.object({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")),
    personalData: personalDataValidator,
    practitionerId: v.id("practitioners"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("existing-confirmation"),
  }),
);

export type BookingSessionStep = Infer<typeof bookingSessionStepValidator>;

export const bookingSessionStepNameValidator = v.union(
  v.literal("existing-calendar-selection"),
  v.literal("existing-confirmation"),
  v.literal("existing-data-input"),
  v.literal("existing-data-input-complete"),
  v.literal("existing-doctor-selection"),
  v.literal("location"),
  v.literal("new-calendar-selection"),
  v.literal("new-confirmation"),
  v.literal("new-data-input"),
  v.literal("new-data-input-complete"),
  v.literal("new-gkv-details"),
  v.literal("new-gkv-details-complete"),
  v.literal("new-insurance-type"),
  v.literal("new-pkv-details"),
  v.literal("new-pkv-details-complete"),
  v.literal("new-pvs-consent"),
  v.literal("patient-status"),
  v.literal("privacy"),
);

export const bookingSessionStorageStateValidator = v.object({
  step: bookingSessionStepNameValidator,
});

export default defineSchema({
  appointments: defineTable({
    // Core appointment fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(), // User-provided title for the appointment

    // Additional fields
    appointmentTypeId: v.id("appointmentTypes"), // Required reference to appointment type
    appointmentTypeTitle: v.string(), // Snapshot of appointment type name at booking time
    cancelledAt: v.optional(v.int64()),
    cancelledByUserId: v.optional(v.id("users")),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")), // Real patient from PVS
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    userId: v.optional(v.id("users")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_start", ["start"])
    .index("by_patientId", ["patientId"])
    .index("by_practitionerId", ["practitionerId"])
    .index("by_isSimulation", ["isSimulation"])
    .index("by_replacesAppointmentId", ["replacesAppointmentId"])
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_start", ["practiceId", "start"])
    .index("by_appointmentTypeId", ["appointmentTypeId"])
    .index("by_userId", ["userId"])
    .index("by_userId_start", ["userId", "start"]),

  // ================================================================
  // BOOKING WIZARD PERSISTENCE (per-step tables)
  // Each step stores the fully validated payload for that step.
  // ================================================================

  appointmentTypes: defineTable({
    allowedPractitionerIds: v.array(v.id("practitioners")), // Required: at least one practitioner
    createdAt: v.int64(),
    duration: v.number(), // duration in minutes (simplified - no more separate durations table)
    lastModified: v.int64(),
    name: v.string(),
    parentId: v.optional(v.id("appointmentTypes")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: appointment types are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  baseSchedules: defineTable({
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.number(), // 0 = Sunday, 1 = Monday, etc.
    endTime: v.string(), // "17:00"
    locationId: v.id("locations"), // Required location for the schedule
    parentId: v.optional(v.id("baseSchedules")), // Reference to the entity this was copied from
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"), // Required: base schedules are versioned per rule set
    startTime: v.string(), // "08:00"
  })
    .index("by_practitionerId", ["practitionerId"])
    .index("by_locationId", ["locationId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_practitionerId", ["ruleSetId", "practitionerId"])
    .index("by_practiceId", ["practiceId"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  blockedSlots: defineTable({
    // Core blocked slot fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(), // Required title for the blocked slot

    // Additional fields
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.optional(v.id("practitioners")),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practiceId_start", ["practiceId", "start"])
    .index("by_start", ["start"])
    .index("by_isSimulation", ["isSimulation"])
    .index("by_replacesBlockedSlotId", ["replacesBlockedSlotId"]),

  bookingExistingCalendarSelectionSteps: defineTable({
    appointmentTypeId: v.id("appointmentTypes"),
    createdAt: v.int64(),
    isNewPatient: v.literal(false),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    reasonDescription: v.string(),
    ruleSetId: v.id("ruleSets"),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingExistingConfirmationSteps: defineTable({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    createdAt: v.int64(),
    isNewPatient: v.literal(false),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")),
    personalData: personalDataValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    reasonDescription: v.string(),
    ruleSetId: v.id("ruleSets"),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingExistingDoctorSelectionSteps: defineTable({
    createdAt: v.int64(),
    isNewPatient: v.literal(false),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingExistingPersonalDataSteps: defineTable({
    createdAt: v.int64(),
    isNewPatient: v.literal(false),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingLocationSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewCalendarSelectionSteps: defineTable({
    appointmentTypeId: v.id("appointmentTypes"),
    createdAt: v.int64(),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: v.optional(hzvStatusValidator),
    insuranceType: insuranceTypeValidator,
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    practiceId: v.id("practices"),
    reasonDescription: v.string(),
    ruleSetId: v.id("ruleSets"),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewConfirmationSteps: defineTable({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    createdAt: v.int64(),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: v.optional(hzvStatusValidator),
    insuranceType: insuranceTypeValidator,
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    patientId: v.optional(v.id("patients")),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    practiceId: v.id("practices"),
    reasonDescription: v.string(),
    ruleSetId: v.id("ruleSets"),
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewGkvDetailSteps: defineTable({
    createdAt: v.int64(),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewInsuranceTypeSteps: defineTable({
    createdAt: v.int64(),
    insuranceType: insuranceTypeValidator,
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewPersonalDataSteps: defineTable({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    createdAt: v.int64(),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: v.optional(hzvStatusValidator),
    insuranceType: insuranceTypeValidator,
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewPkvConsentSteps: defineTable({
    createdAt: v.int64(),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    pvsConsent: v.literal(true),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingNewPkvDetailSteps: defineTable({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    createdAt: v.int64(),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    practiceId: v.id("practices"),
    pvsConsent: v.literal(true),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingPatientStatusSteps: defineTable({
    createdAt: v.int64(),
    isNewPatient: v.boolean(),
    lastModified: v.int64(),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  bookingPrivacySteps: defineTable({
    consent: v.boolean(),
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    sessionId: v.id("bookingSessions"),
    userId: v.id("users"),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  locations: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("locations")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: locations are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  patients: defineTable({
    // Patient identification fields (from GDT file)
    city: v.optional(v.string()), // FK 3106 - City
    dateOfBirth: v.optional(v.string()), // FK 3103, format TTMMJJJJ
    firstName: v.optional(v.string()), // FK 3102
    lastName: v.optional(v.string()), // FK 3101
    patientId: v.number(), // FK 3000 - Required, unique identifier as integer
    practiceId: v.id("practices"), // Multi-tenancy support
    street: v.optional(v.string()), // FK 3107 - Street address

    // Metadata and tracking fields
    createdAt: v.int64(),
    lastModified: v.int64(),
    sourceGdtFileName: v.optional(v.string()), // Original GDT filename for reference
  })
    .index("by_patientId", ["patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"])
    .index("by_practiceId", ["practiceId"]),
  practices: defineTable({
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
  }),

  practitioners: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("practitioners")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: practitioners are versioned per rule set
    tags: v.optional(v.array(v.string())),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"]),

  ruleSets: defineTable({
    createdAt: v.number(),
    description: v.string(),
    parentVersion: v.optional(v.id("ruleSets")), // Single parent (git-like model)
    practiceId: v.id("practices"),
    saved: v.boolean(), // true = saved rule set, false = unsaved/draft rule set
    version: v.number(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_saved", ["practiceId", "saved"]), // For finding unsaved rule sets

  /**
   * Users Table - Synced from WorkOS AuthKit
   *
   * This table stores user data synced from WorkOS via webhooks.
   * The authId field links to the WorkOS user ID for authentication.
   * Users can book appointments and manage their own data.
   */
  users: defineTable({
    authId: v.string(), // WorkOS user ID (from event.data.id)
    email: v.string(), // User's email address
    firstName: v.optional(v.string()), // First name (optional from WorkOS)
    lastName: v.optional(v.string()), // Last name (optional from WorkOS)

    // Metadata
    createdAt: v.int64(),
  })
    .index("by_authId", ["authId"])
    .index("by_email", ["email"]),

  /**
   * Rule Conditions Table - Recursive Tree Structure for Boolean Logic
   *
   * This table stores BOTH the rule metadata AND the condition tree nodes.
   * Each rule is represented by a root condition node (where parentConditionId is null and isRoot is true).
   * Child conditions reference their parent via parentConditionId, creating a recursive tree.
   *
   * Root nodes (rules) have:
   * - isRoot: true
   * - parentConditionId: null
   * - enabled: can disable without deleting
   *
   * Child nodes (conditions) have:
   * - isRoot: false
   * - parentConditionId: reference to parent condition
   * - nodeType: AND/NOT/CONDITION
   *
   * All nodes (root and children) have:
   * - practiceId, ruleSetId: for security and querying
   * - copyFromId: for copy-on-write tracking
   * - createdAt, lastModified: for auditing
   *
   * Example tree for: "(appointmentType IS 'Checkup' AND dayOfWeek IS Monday) AND NOT (location IS 'Dissen')"
   *
   * Root (Rule: "Block certain appointments")
   *  └─ Child (AND)
   *      ├─ Child (AND)
   *      │   ├─ Leaf: appointmentType IS 'Checkup'
   *      │   └─ Leaf: dayOfWeek IS Monday
   *      └─ Child (NOT)
   *          └─ Leaf: location IS 'Dissen'
   */
  ruleConditions: defineTable({
    // Metadata - required for ALL nodes (root and children) for security and querying
    copyFromId: v.optional(v.id("ruleConditions")), // Copy-on-write reference
    practiceId: v.id("practices"), // Multi-tenancy security
    ruleSetId: v.id("ruleSets"), // Easy querying of all conditions in a rule set

    // Tree structure - recursive parent reference
    childOrder: v.number(), // Order among siblings (for UI consistency and evaluation order)
    parentConditionId: v.optional(v.id("ruleConditions")), // null for root nodes (rules)

    // Root node (rule) metadata
    enabled: v.optional(v.boolean()), // Only for root nodes - can disable without deleting
    isRoot: v.boolean(), // true = this is a rule (root of tree), false = this is a condition node

    // Node type: logical operator or leaf condition (for non-root nodes)
    nodeType: v.optional(
      v.union(
        v.literal("AND"), // All children must be true
        v.literal("NOT"), // Negates single child
        v.literal("CONDITION"), // Leaf node with actual test
      ),
    ),

    // For leaf nodes (nodeType === "CONDITION") - what to test
    conditionType: v.optional(
      v.union(
        // Basic filters
        v.literal("APPOINTMENT_TYPE"), // Test appointment type name
        v.literal("DAY_OF_WEEK"), // Test day of week (0-6)
        v.literal("LOCATION"), // Test location ID
        v.literal("PRACTITIONER"), // Test practitioner ID
        v.literal("PRACTITIONER_TAG"), // Test if practitioner has tag

        // Time-based
        v.literal("DATE_RANGE"), // Test if date is in range
        v.literal("TIME_RANGE"), // Test if time is in range
        v.literal("DAYS_AHEAD"), // Test booking advance time
        v.literal("PATIENT_AGE"), // Test patient age on appointment day

        // Capacity-based
        v.literal("DAILY_CAPACITY"), // Test appointments per day
        v.literal("CONCURRENT_COUNT"), // Test concurrent appointments

        // Client source
        v.literal("CLIENT_TYPE"), // Online, MFA, Phone-AI, etc.
      ),
    ),

    // Comparison operator for leaf conditions
    operator: v.optional(
      v.union(
        v.literal("IS"), // Equals (single value)
        v.literal("IS_NOT"), // Not equals (single value)
        v.literal("GREATER_THAN_OR_EQUAL"), // >= (numeric)
        v.literal("LESS_THAN"), // < (numeric)
        v.literal("LESS_THAN_OR_EQUAL"), // <= (numeric)
        v.literal("EQUALS"), // == (numeric)
      ),
    ),

    // Scope for CONCURRENT_COUNT and DAILY_CAPACITY conditions
    // Defines the granularity at which to count/limit appointments
    scope: v.optional(
      v.union(
        v.literal("practice"), // Count across entire practice
        v.literal("location"), // Count within a specific location
        v.literal("practitioner"), // Count per practitioner
      ),
    ),

    // Polymorphic value storage - only populate what's needed
    valueIds: v.optional(v.array(v.string())), // For ID arrays (stored as strings)
    valueNumber: v.optional(v.number()), // For single numeric values

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_isRoot", ["ruleSetId", "isRoot"]) // Get all rules (roots) for a rule set
    .index("by_ruleSetId_isRoot_enabled", ["ruleSetId", "isRoot", "enabled"]) // Get enabled rules
    .index("by_parentConditionId", ["parentConditionId"]) // Get children of a node
    .index("by_parentConditionId_childOrder", [
      "parentConditionId",
      "childOrder",
    ]) // Ordered children
    .index("by_copyFromId", ["copyFromId"])
    .index("by_copyFromId_ruleSetId", ["copyFromId", "ruleSetId"]),

  /**
   * Booking Sessions Table
   *
   * Stores the state of an in-progress online booking session.
   * Uses a discriminated union based on `step` to represent
   * the user's progress through the decision tree.
   *
   * The step field determines which other fields are present,
   * enabling type-safe narrowing in the UI.
   *
   * Sessions expire after 30 minutes of inactivity.
   * Sessions are tied to authenticated users.
   */
  bookingSessions: defineTable({
    // Multi-tenancy
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),

    // User who owns this session (required - no anonymous bookings)
    userId: v.id("users"),

    // Persist only the current step; step payload is stored in per-step tables
    state: bookingSessionStorageStateValidator,

    // Metadata
    createdAt: v.int64(),
    expiresAt: v.int64(), // Auto-expire after 30 minutes
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_userId", ["userId"])
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ]),
});
