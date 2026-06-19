import type { Infer } from "convex/values";

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  appointmentOccupancyScopeValidator,
  blockedSlotOccupancyScopeValidator,
} from "./appointmentOccupancy";
import {
  appointmentPlanStepValidator,
  appointmentPlanValidator,
  appointmentTypeDefaultOccupancyValidator,
} from "./appointmentPlans";
import { appointmentSeriesRestoreSnapshotValidator } from "./appointmentSeriesRestoreSnapshots";
import {
  beihilfeStatusValidator,
  dataSharingContactInputValidator,
  genderValidator,
  hzvStatusValidator,
  insuranceTypeValidator,
  medicalHistoryValidator,
  personalDataValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
} from "./bookingValidators";

export const appointmentSmileyValidator = v.string();
export const appointmentColorValidator = v.union(
  v.literal("blue"),
  v.literal("teal"),
  v.literal("green"),
  v.literal("lime"),
  v.literal("yellow"),
  v.literal("orange"),
  v.literal("red"),
  v.literal("rose"),
  v.literal("fuchsia"),
  v.literal("violet"),
  v.literal("indigo"),
  v.literal("slate"),
);
export type AppointmentColor = Infer<typeof appointmentColorValidator>;
export const appointmentSmileyOptionValidator = v.object({
  emoji: appointmentSmileyValidator,
  id: v.string(),
  name: v.string(),
});
export type AppointmentSmiley = Infer<typeof appointmentSmileyValidator>;
export type AppointmentSmileyOption = Infer<
  typeof appointmentSmileyOptionValidator
>;

export {
  beihilfeStatusValidator,
  dataSharingContactInputValidator,
  genderValidator,
  gkvDetailsValidator,
  hzvStatusValidator,
  insuranceDetailsValidator,
  insuranceTypeValidator,
  legacyMedicalHistorySnapshotValidator,
  medicalHistoryValidator,
  personalDataValidator,
  pkvDetailsValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
  selectedSlotStorageValidator,
  selectedSlotValidator,
} from "./bookingValidators";

// ================================
// BOOKING SESSION VALIDATORS
// ================================

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
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("patient-status"),
  }),

  // ================================
  // PATH A: NEW PATIENT
  // ================================

  // A1: Insurance type selection
  v.object({
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("new-insurance-type"),
  }),

  // A3a: GKV details (insurance type: GKV, pending)
  v.object({
    hzvStatus: v.optional(hzvStatusValidator),
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("new-gkv-details"),
  }),

  // A3a: GKV details completed
  v.object({
    dataSharingContacts: v.optional(v.array(dataSharingContactInputValidator)),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("new-gkv-details-complete"),
  }),

  // A3b: PKV PVS consent step (insurance type: PKV, before details input)
  v.object({
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("new-pvs-consent"),
  }),

  // A3c: PKV details (after PVS consent, pending)
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-pkv-details"),
  }),

  // A3c: PKV details completed
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    dataSharingContacts: v.optional(v.array(dataSharingContactInputValidator)),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
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
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: v.optional(personalDataValidator),
    step: v.literal("new-data-input"),
  }),

  // A4: Personal data input completed
  // GKV path
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
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
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: v.optional(personalDataValidator),
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
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-data-input-complete"),
  }),

  // A5: Datenweitergabe (personal data submitted)
  // GKV path
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    step: v.literal("new-data-sharing"),
  }),

  // A5: Datenweitergabe (personal data submitted)
  // PKV path
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-data-sharing"),
  }),

  // A6: Calendar selection (Datenweitergabe submitted)
  // GKV path
  v.object({
    dataSharingContacts: v.array(dataSharingContactInputValidator),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    step: v.literal("new-calendar-selection"),
  }),

  // A6: Calendar selection (personal data submitted)
  // PKV path
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    dataSharingContacts: v.array(dataSharingContactInputValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-calendar-selection"),
  }),

  // ================================
  // PATH B: EXISTING PATIENT
  // ================================

  // B1: Doctor selection (patient status: existing)
  v.object({
    isNewPatient: v.literal(false),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    step: v.literal("existing-doctor-selection"),
  }),

  // B2: Personal data input (doctor selected, pending)
  v.object({
    isNewPatient: v.literal(false),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    personalData: v.optional(personalDataValidator),
    practitionerLineageKey: v.id("practitioners"),
    practitionerName: v.string(),
    step: v.literal("existing-data-input"),
  }),

  // B3: Personal data input completed
  v.object({
    isNewPatient: v.literal(false),
    locationLineageKey: v.id("locations"),
    locationName: v.string(),
    personalData: personalDataValidator,
    practitionerLineageKey: v.id("practitioners"),
    practitionerName: v.string(),
    step: v.literal("existing-calendar-selection"),
  }),
);

export type BookingSessionStep = Infer<typeof bookingSessionStepValidator>;

export const bookingSessionStepNameValidator = v.union(
  v.literal("existing-calendar-selection"),
  v.literal("existing-data-input"),
  v.literal("existing-doctor-selection"),
  v.literal("location"),
  v.literal("new-calendar-selection"),
  v.literal("new-data-input"),
  v.literal("new-data-input-complete"),
  v.literal("new-data-sharing"),
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
  appointmentRestoreSnapshots: defineTable({
    appointmentTypeId: v.id("appointmentTypes"),
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    calendarResourceColumn: v.optional(
      v.union(v.literal("ekg"), v.literal("labor")),
    ),
    color: v.optional(appointmentColorValidator),
    deletedAt: v.int64(),
    end: v.optional(v.string()),
    isNewPatient: v.optional(v.boolean()),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    originalAppointmentId: v.id("appointments"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    phoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    simulationKind: v.optional(
      v.union(v.literal("draft"), v.literal("activation-reassignment")),
    ),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    smiley: v.optional(appointmentSmileyValidator),
    start: v.string(),
    title: v.string(),
    userId: v.optional(v.id("users")),
  }).index("by_originalAppointmentId", ["originalAppointmentId"]),

  appointments: defineTable({
    // Core appointment fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(), // User-provided title for the appointment

    // Additional fields
    appointmentTypeLineageKey: v.id("appointmentTypes"), // Stable reference across rule set versions
    appointmentTypeTitle: v.string(), // Snapshot of appointment type name at booking time
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    cancelledAt: v.optional(v.int64()),
    cancelledByPhoneBookingIdentityId: v.optional(
      v.id("phoneBookingIdentities"),
    ),
    cancelledByUserId: v.optional(v.id("users")),
    color: v.optional(appointmentColorValidator),
    isSimulation: v.optional(v.boolean()),
    locationLineageKey: v.id("locations"), // Stable reference across rule set versions
    occupancyScope: appointmentOccupancyScopeValidator,
    patientId: v.optional(v.id("patients")), // Real patient from PVS
    phoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
    practiceId: v.id("practices"), // Multi-tenancy support
    reassignmentSourceVacationLineageKey: v.optional(v.id("vacations")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    seriesId: v.optional(v.string()),
    seriesStepId: v.optional(v.string()),
    seriesStepIndex: v.optional(v.int64()),
    simulationKind: v.optional(
      v.union(v.literal("draft"), v.literal("activation-reassignment")),
    ),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    simulationValidatedAt: v.optional(v.int64()),
    smiley: v.optional(appointmentSmileyValidator),
    userId: v.optional(v.id("users")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_start", ["start"])
    .index("by_bookingIdentityId", ["bookingIdentityId"])
    .index("by_bookingIdentityId_start", ["bookingIdentityId", "start"])
    .index("by_patientId", ["patientId"])
    .index("by_isSimulation", ["isSimulation"])
    .index("by_practiceId_isSimulation", ["practiceId", "isSimulation"])
    .index("by_replacesAppointmentId", ["replacesAppointmentId"])
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_start", ["practiceId", "start"])
    .index("by_simulationRuleSetId_reassignmentSourceVacationLineageKey", [
      "simulationRuleSetId",
      "reassignmentSourceVacationLineageKey",
    ])
    .index("by_simulationRuleSetId", ["simulationRuleSetId"])
    .index("by_appointmentTypeLineageKey", ["appointmentTypeLineageKey"])
    .index("by_seriesId", ["seriesId"])
    .index("by_userId", ["userId"])
    .index("by_userId_start", ["userId", "start"])
    .index("by_phoneBookingIdentityId_start", [
      "phoneBookingIdentityId",
      "start",
    ]),

  appointmentSeries: defineTable({
    appointmentPlanSnapshot: v.array(appointmentPlanStepValidator),
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    createdAt: v.int64(),
    lastModified: v.int64(),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    rootAppointmentId: v.id("appointments"),
    rootAppointmentTypeId: v.id("appointmentTypes"),
    rootAppointmentTypeLineageKey: v.id("appointmentTypes"),
    rootDurationMinutes: v.number(),
    ruleSetIdAtBooking: v.id("ruleSets"),
    scope: v.union(v.literal("real"), v.literal("simulation")),
    seriesId: v.string(),
    userId: v.optional(v.id("users")),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_rootAppointmentId", ["rootAppointmentId"])
    .index("by_seriesId", ["seriesId"]),

  appointmentSeriesRestoreSnapshots: defineTable({
    deletedAt: v.int64(),
    originalSeriesId: v.string(),
    practiceId: v.id("practices"),
    snapshot: appointmentSeriesRestoreSnapshotValidator,
  }).index("by_originalSeriesId", ["originalSeriesId"]),

  bookingIdentities: defineTable({
    createdAt: v.int64(),
    kind: v.union(
      v.literal("online"),
      v.literal("telefonki"),
      v.literal("temporary"),
    ),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    sourceIdentityId: v.optional(v.string()),
    sourceSystem: v.optional(
      v.union(
        v.literal("legacy-online"),
        v.literal("legacy-telefonki"),
        v.literal("online"),
        v.literal("telefonki"),
      ),
    ),
    userId: v.optional(v.id("users")),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_userId", ["userId"])
    .index("by_sourceIdentity", ["sourceSystem", "sourceIdentityId"]),

  bookingIdentityPatientAssociations: defineTable({
    bookingIdentityId: v.id("bookingIdentities"),
    createdAt: v.int64(),
    legacyAppointmentId: v.optional(v.string()),
    legacyIdentityId: v.optional(v.string()),
    method: v.union(
      v.literal("automatic"),
      v.literal("manual"),
      v.literal("migration-exact-appointment-name"),
      v.literal("staff-confirmed"),
      v.literal("staff-corrected"),
    ),
    patientId: v.id("patients"),
    practiceId: v.id("practices"),
    pvsAppointmentSourceKey: v.optional(v.string()),
    pvsPatientNumber: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("superseded"),
      v.literal("rejected"),
    ),
    supersededAt: v.optional(v.int64()),
  })
    .index("by_bookingIdentityId_status", ["bookingIdentityId", "status"])
    .index("by_patientId_status", ["patientId", "status"])
    .index("by_practiceId_status", ["practiceId", "status"]),

  // ================================================================
  // BOOKING WIZARD PERSISTENCE (per-step tables)
  // Each step stores the fully validated payload for that step.
  // ================================================================

  appointmentTypeFolders: defineTable({
    color: v.optional(appointmentColorValidator),
    createdAt: v.int64(),
    deleted: v.optional(v.boolean()),
    lastModified: v.int64(),
    lineageKey: v.optional(v.id("appointmentTypeFolders")),
    name: v.string(),
    parentFolderId: v.optional(v.id("appointmentTypeFolders")),
    parentId: v.optional(v.id("appointmentTypeFolders")),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_parentFolderId", ["parentFolderId"])
    .index("by_ruleSetId_parentFolderId", ["ruleSetId", "parentFolderId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

  appointmentTypes: defineTable({
    allowedPractitionerLineageKeys: v.array(v.id("practitioners")),
    color: v.optional(appointmentColorValidator),
    appointmentPlan: appointmentPlanValidator,
    createdAt: v.int64(),
    defaultOccupancy: v.optional(appointmentTypeDefaultOccupancyValidator),
    deleted: v.optional(v.boolean()),
    duration: v.number(), // duration in minutes (simplified - no more separate durations table)
    lastModified: v.int64(),
    lineageKey: v.optional(v.id("appointmentTypes")), // Stable identity across copied rule sets
    name: v.string(),
    parentId: v.optional(v.id("appointmentTypes")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: appointment types are versioned per rule set
    treeFolderId: v.optional(v.id("appointmentTypeFolders")),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .index("by_treeFolderId", ["treeFolderId"])
    .index("by_ruleSetId_treeFolderId", ["ruleSetId", "treeFolderId"])
    .index("by_lineageKey", ["lineageKey"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

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
    lineageKey: v.optional(v.id("baseSchedules")), // Stable identity across copied rule sets
    locationLineageKey: v.id("locations"), // Stable reference across rule sets
    parentId: v.optional(v.id("baseSchedules")), // Reference to the entity this was copied from
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerLineageKey: v.id("practitioners"), // Stable reference across rule sets
    ruleSetId: v.id("ruleSets"), // Required: base schedules are versioned per rule set
    startTime: v.string(), // "08:00"
  })
    .index("by_practitionerLineageKey", ["practitionerLineageKey"])
    .index("by_locationLineageKey", ["locationLineageKey"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_practitionerLineageKey", [
      "ruleSetId",
      "practitionerLineageKey",
    ])
    .index("by_practiceId", ["practiceId"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .index("by_lineageKey", ["lineageKey"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

  blockedSlots: defineTable({
    // Core blocked slot fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(), // Required title for the blocked slot

    // Additional fields
    isSimulation: v.optional(v.boolean()),
    locationLineageKey: v.id("locations"),
    occupancyScope: blockedSlotOccupancyScopeValidator,
    practiceId: v.id("practices"), // Multi-tenancy support
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practiceId_start", ["practiceId", "start"])
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_isSimulation", ["practiceId", "isSimulation"])
    .index("by_start", ["start"])
    .index("by_isSimulation", ["isSimulation"])
    .index("by_replacesBlockedSlotId", ["replacesBlockedSlotId"]),

  bookingCalendarReachedSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingExistingDoctorSelectionSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    practitionerLineageKey: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingLocationSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    locationLineageKey: v.id("locations"),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingMedicalHistoryEntries: defineTable({
    allergyNotes: v.optional(v.string()),
    createdAt: v.int64(),
    hasAllergies: v.boolean(),
    hasCancer: v.boolean(),
    hasCirculationDisorder: v.boolean(),
    hasDepression: v.boolean(),
    hasDiabetes: v.boolean(),
    hasGout: v.boolean(),
    hasHeartCondition: v.boolean(),
    hasHypertension: v.boolean(),
    hasIntolerance: v.boolean(),
    hasKidneyCondition: v.boolean(),
    hasLipidDisorder: v.boolean(),
    hasLiverCondition: v.boolean(),
    hasLungCondition: v.boolean(),
    hasOperations: v.boolean(),
    hasSymptoms: v.boolean(),
    hasThyroidCondition: v.boolean(),
    hasVaricoseVeins: v.boolean(),
    intoleranceNotes: v.optional(v.string()),
    isComplete: v.boolean(),
    lastModified: v.int64(),
    medicationNotes: v.optional(v.string()),
    noAdditionalDetails: v.boolean(),
    noKnownConditions: v.boolean(),
    operationNotes: v.optional(v.string()),
    otherConditionNotes: v.optional(v.string()),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    smokes: v.boolean(),
    symptomNotes: v.optional(v.string()),
    takesMedication: v.boolean(),
    userId: v.id("users"),
  }).index("by_userId_practiceId_ruleSetId", [
    "userId",
    "practiceId",
    "ruleSetId",
  ]),

  bookingNewDataSharingContactRows: defineTable({
    city: v.string(),
    createdAt: v.int64(),
    dateOfBirth: v.string(),
    firstName: v.string(),
    gender: genderValidator,
    index: v.number(),
    lastModified: v.int64(),
    lastName: v.string(),
    phoneNumber: v.string(),
    postalCode: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    street: v.string(),
    title: v.optional(v.string()),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId_index", [
      "userId",
      "practiceId",
      "ruleSetId",
      "index",
    ])
    .index("by_userId", ["userId"]),

  bookingNewDataSharingSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingNewGkvDetailSteps: defineTable({
    createdAt: v.int64(),
    hzvStatus: hzvStatusValidator,
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingNewInsuranceTypeSteps: defineTable({
    createdAt: v.int64(),
    insuranceType: insuranceTypeValidator,
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingNewPkvConsentSteps: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingNewPkvDetailSteps: defineTable({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    createdAt: v.int64(),
    lastModified: v.int64(),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingPatientStatusSteps: defineTable({
    createdAt: v.int64(),
    isNewPatient: v.boolean(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingPersonalDataSteps: defineTable({
    city: v.string(),
    createdAt: v.int64(),
    dateOfBirth: v.string(),
    email: v.string(),
    firstName: v.string(),
    gender: genderValidator,
    lastModified: v.int64(),
    lastName: v.string(),
    phoneNumber: v.string(),
    postalCode: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    street: v.string(),
    title: v.optional(v.string()),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  bookingPrivacySteps: defineTable({
    consent: v.boolean(),
    createdAt: v.int64(),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId_ruleSetId", [
      "userId",
      "practiceId",
      "ruleSetId",
    ])
    .index("by_userId", ["userId"]),

  locations: defineTable({
    deleted: v.optional(v.boolean()),
    lineageKey: v.optional(v.id("locations")), // Stable identity across copied rule sets
    name: v.string(),
    parentId: v.optional(v.id("locations")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: locations are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .index("by_lineageKey", ["lineageKey"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

  mfas: defineTable({
    createdAt: v.int64(),
    lineageKey: v.optional(v.id("mfas")),
    name: v.string(),
    parentId: v.optional(v.id("mfas")),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_lineageKey", ["lineageKey"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

  patients: defineTable({
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    // Patient identification fields (from GDT file)
    city: v.optional(v.string()), // FK 3106 - City
    dateOfBirth: v.optional(v.string()), // FK 3103, must already be YYYY-MM-DD
    firstName: v.optional(v.string()), // FK 3102
    lastName: v.optional(v.string()), // FK 3101
    name: v.optional(v.string()), // Temporary patients use a single display name
    patientId: v.optional(v.number()), // FK 3000 - Present for PVS patients
    phoneNumber: v.optional(v.string()),
    practiceId: v.id("practices"), // Multi-tenancy support
    recordType: v.union(v.literal("pvs"), v.literal("temporary")),
    searchFirstName: v.string(),
    searchLastName: v.string(),
    street: v.optional(v.string()), // FK 3107 - Street address

    // Metadata and tracking fields
    createdAt: v.int64(),
    lastModified: v.int64(),
    sourceGdtFileName: v.optional(v.string()), // Original GDT filename for reference
  })
    .index("by_patientId", ["patientId"])
    .index("by_practiceId_patientId", ["practiceId", "patientId"])
    .index("by_lastModified", ["lastModified"])
    .index("by_createdAt", ["createdAt"])
    .index("by_practiceId", ["practiceId"])
    .index("by_bookingIdentityId", ["bookingIdentityId"])
    .searchIndex("search_by_searchFirstName", {
      filterFields: ["practiceId"],
      searchField: "searchFirstName",
    })
    .searchIndex("search_by_searchLastName", {
      filterFields: ["practiceId"],
      searchField: "searchLastName",
    }),

  phoneBookingIdentities: defineTable({
    appointmentId: v.optional(v.id("appointments")),
    callerPhoneNumber: v.optional(v.string()),
    callId: v.string(),
    createdAt: v.int64(),
    dialedPracticePhoneNumber: v.optional(v.string()),
    integrationActor: v.optional(v.string()),
    lastModified: v.int64(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  })
    .index("by_callId", ["callId"])
    .index("by_practiceId_callId", ["practiceId", "callId"])
    .index("by_appointmentId", ["appointmentId"]),

  practicePhoneNumbers: defineTable({
    createdAt: v.int64(),
    lastModified: v.int64(),
    phoneNumber: v.string(),
    practiceId: v.id("practices"),
  })
    .index("by_phoneNumber", ["phoneNumber"])
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_phoneNumber", ["practiceId", "phoneNumber"]),

  practices: defineTable({
    appointmentSmileyOptions: v.optional(
      v.array(appointmentSmileyOptionValidator),
    ),
    currentActiveRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
    slug: v.optional(v.string()),
    telefonkiIntegrationSecretHash: v.optional(v.string()),
    workOSOrganizationId: v.optional(v.string()),
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"])
    .index("by_workOSOrganizationId", ["workOSOrganizationId"]),

  practitionerAssociations: defineTable({
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    createdAt: v.int64(),
    createdByUserId: v.optional(v.id("users")),
    lastModified: v.int64(),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerLineageKey: v.id("practitioners"),
    source: v.union(
      v.literal("legacy-baumdiagramm"),
      v.literal("appointment-history"),
      v.literal("manual"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("superseded"),
      v.literal("rejected"),
    ),
    supersededAt: v.optional(v.int64()),
    supersededByUserId: v.optional(v.id("users")),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_status", ["practiceId", "status"])
    .index("by_patientId", ["patientId"])
    .index("by_patientId_status", ["patientId", "status"])
    .index("by_bookingIdentityId", ["bookingIdentityId"])
    .index("by_bookingIdentityId_status", ["bookingIdentityId", "status"]),
  vacations: defineTable({
    createdAt: v.int64(),
    date: v.string(), // YYYY-MM-DD
    lineageKey: v.optional(v.id("vacations")),
    mfaLineageKey: v.optional(v.id("mfas")),
    portion: v.union(
      v.literal("full"),
      v.literal("morning"),
      v.literal("afternoon"),
    ),
    practiceId: v.id("practices"),
    practitionerLineageKey: v.optional(v.id("practitioners")),
    ruleSetId: v.id("ruleSets"),
    staffType: v.union(v.literal("mfa"), v.literal("practitioner")),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_date", ["ruleSetId", "date"])
    .index("by_ruleSetId_date_staffType_portion_mfaLineageKey", [
      "ruleSetId",
      "date",
      "staffType",
      "portion",
      "mfaLineageKey",
    ])
    .index("by_ruleSetId_date_staffType_portion_practitionerLineageKey", [
      "ruleSetId",
      "date",
      "staffType",
      "portion",
      "practitionerLineageKey",
    ])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"])
    .index("by_ruleSetId_practitionerLineageKey", [
      "ruleSetId",
      "practitionerLineageKey",
    ])
    .index("by_ruleSetId_mfaLineageKey", ["ruleSetId", "mfaLineageKey"]),

  /**
   * WorkOS organization membership and role assignments for a practice.
   * Roles are ordered by privilege: owner > admin > staff > patient.
   */
  organizationMembers: defineTable({
    createdAt: v.int64(),
    practiceId: v.id("practices"),
    role: v.union(
      v.literal("patient"),
      v.literal("staff"),
      v.literal("admin"),
      v.literal("owner"),
    ),
    userId: v.id("users"),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_practiceId_userId", ["practiceId", "userId"])
    .index("by_userId", ["userId"]),

  practitioners: defineTable({
    deleted: v.optional(v.boolean()),
    lineageKey: v.optional(v.id("practitioners")), // Stable identity across copied rule sets
    name: v.string(),
    parentId: v.optional(v.id("practitioners")), // Reference to the entity this was copied from
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"), // Required: practitioners are versioned per rule set
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_name", ["ruleSetId", "name"])
    .index("by_parentId", ["parentId"])
    .index("by_parentId_ruleSetId", ["parentId", "ruleSetId"])
    .index("by_lineageKey", ["lineageKey"])
    .index("by_ruleSetId_lineageKey", ["ruleSetId", "lineageKey"]),

  ruleSets: defineTable({
    appointmentSmileyOptions: v.optional(
      v.array(appointmentSmileyOptionValidator),
    ),
    createdAt: v.number(),
    description: v.string(),
    draftRevision: v.number(), // 0 for saved rule sets; monotonic for unsaved drafts
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
  onlineAccountBlocks: defineTable({
    createdAt: v.int64(),
    legacyUserId: v.string(),
    practiceId: v.id("practices"),
    reason: v.string(),
    sourceSystem: v.literal("legacy-online"),
    userId: v.id("users"),
  })
    .index("by_userId_practiceId", ["userId", "practiceId"])
    .index("by_legacyUserId", ["legacyUserId"]),

  ruleConditions: defineTable({
    // Metadata - required for ALL nodes (root and children) for security and querying
    copyFromId: v.optional(v.id("ruleConditions")), // Copy-on-write reference
    practiceId: v.id("practices"), // Multi-tenancy security
    ruleSetId: v.id("ruleSets"), // Easy querying of all conditions in a rule set

    // Tree structure - recursive parent reference
    childOrder: v.number(), // Order among siblings (for UI consistency and evaluation order)
    parentConditionId: v.optional(v.id("ruleConditions")), // null for root nodes (rules)

    // Root node (rule) metadata
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

        // Time-based
        v.literal("DATE_RANGE"), // Test if date is in range
        v.literal("TIME_RANGE"), // Test if time is in range
        v.literal("DAYS_AHEAD"), // Test booking advance time
        v.literal("HOURS_AHEAD"), // Test booking advance time in hours
        v.literal("MINIMUM_ADVANCE_TIME"), // Test booking is at least N minutes/hours/days in the future
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
        v.literal("GREATER_THAN"), // > (numeric)
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
    valueIds: v.optional(v.array(v.string())), // For lineage-key or string arrays (stored as strings)
    valueNumber: v.optional(v.number()), // For single numeric values

    // Metadata
    createdAt: v.int64(),
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_ruleSetId", ["ruleSetId"])
    .index("by_ruleSetId_conditionType", ["ruleSetId", "conditionType"])
    .index("by_ruleSetId_isRoot", ["ruleSetId", "isRoot"]) // Get all rules (roots) for a rule set
    .index("by_parentConditionId", ["parentConditionId"]) // Get children of a node
    .index("by_parentConditionId_childOrder", [
      "parentConditionId",
      "childOrder",
    ]) // Ordered children
    .index("by_copyFromId", ["copyFromId"])
    .index("by_copyFromId_ruleSetId", ["copyFromId", "ruleSetId"]),

  // Temporary migration-only patient-facing holds for unmatched future online
  // bookings. These are deliberately kept out of the scheduling model.
  legacyUnmatchedFutureBookingHolds: defineTable({
    createdAt: v.int64(),
    end: v.string(),
    lastModified: v.int64(),
    legacyAppointmentId: v.string(),
    legacyType: v.optional(v.string()),
    locationName: v.optional(v.string()),
    practiceId: v.id("practices"),
    practitionerName: v.optional(v.string()),
    start: v.string(),
    userId: v.id("users"),
  })
    .index("by_userId_start", ["userId", "start"])
    .index("by_userId_practiceId_start", ["userId", "practiceId", "start"])
    .index("by_practiceId_legacyAppointmentId", [
      "practiceId",
      "legacyAppointmentId",
    ]),
});
