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

  // A1: Age check (patient status: new)
  v.object({
    isNewPatient: v.literal(true),
    locationId: v.id("locations"),
    step: v.literal("new-age-check"),
  }),

  // A2: Insurance type selection (age confirmed)
  v.object({
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-insurance-type"),
  }),

  // A3a: GKV details - HZV status (insurance type: GKV)
  v.object({
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-gkv-details"),
  }),

  // A3b: PKV PVS consent step (insurance type: PKV, before details input)
  v.object({
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-pvs-consent"),
  }),

  // A3c: PKV details - optional additional info (after PVS consent)
  v.object({
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-pkv-details"),
  }),

  // A4: Appointment type selection (insurance details completed)
  // GKV path - has hzvStatus
  v.object({
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-appointment-type"),
  }),

  // A4: Appointment type selection (insurance details completed)
  // PKV path - has pvsConsent and optional PKV details
  v.object({
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-appointment-type"),
  }),

  // A5: Personal data input (appointment type selected)
  // GKV path
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    step: v.literal("new-data-input"),
  }),

  // A5: Personal data input (appointment type selected)
  // PKV path
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    step: v.literal("new-data-input"),
  }),

  // A6: Calendar selection (personal data submitted)
  // GKV path
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    hzvStatus: hzvStatusValidator,
    insuranceType: v.literal("gkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    reasonDescription: v.string(),
    step: v.literal("new-calendar-selection"),
  }),

  // A6: Calendar selection (personal data submitted)
  // PKV path
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    insuranceType: v.literal("pkv"),
    isNewPatient: v.literal(true),
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    reasonDescription: v.string(),
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
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("new-confirmation"),
    temporaryPatientId: v.id("temporaryPatients"),
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
    isOver40: v.boolean(),
    locationId: v.id("locations"),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("new-confirmation"),
    temporaryPatientId: v.id("temporaryPatients"),
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

  // B2: Appointment type selection (doctor selected)
  v.object({
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    practitionerId: v.id("practitioners"),
    step: v.literal("existing-appointment-type"),
  }),

  // B3: Personal data input (appointment type selected)
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    practitionerId: v.id("practitioners"),
    step: v.literal("existing-data-input"),
  }),

  // B4: Calendar selection (personal data submitted)
  v.object({
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practitionerId: v.id("practitioners"),
    reasonDescription: v.string(),
    step: v.literal("existing-calendar-selection"),
  }),

  // B5: Confirmation (slot selected, appointment created)
  v.object({
    appointmentId: v.id("appointments"),
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.literal(false),
    locationId: v.id("locations"),
    personalData: personalDataValidator,
    practitionerId: v.id("practitioners"),
    reasonDescription: v.string(),
    selectedSlot: selectedSlotValidator,
    step: v.literal("existing-confirmation"),
    temporaryPatientId: v.id("temporaryPatients"),
  }),
);

export default defineSchema({
  appointments: defineTable({
    // Core appointment fields
    end: v.string(), // ISO datetime string
    start: v.string(), // ISO datetime string
    title: v.string(), // User-provided title for the appointment

    // Additional fields
    appointmentTypeId: v.id("appointmentTypes"), // Required reference to appointment type
    appointmentTypeTitle: v.string(), // Snapshot of appointment type name at booking time
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientId: v.optional(v.id("patients")), // Real patient from PVS
    practiceId: v.id("practices"), // Multi-tenancy support
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    temporaryPatientId: v.optional(v.id("temporaryPatients")), // Walk-in patient without PVS record

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
    .index("by_temporaryPatientId", ["temporaryPatientId"]),

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

  /**
   * Temporary Patients Table
   *
   * Stores temporary patient information for walk-in appointments
   * where a full patient record from the PVS is not available.
   * Only requires name and phone number for quick appointment booking.
   */
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

  temporaryPatients: defineTable({
    firstName: v.string(), // Vorname - Required
    lastName: v.string(), // Nachname - Required
    phoneNumber: v.string(), // Telefonnummer - Required
    practiceId: v.id("practices"), // Multi-tenancy support

    // Metadata
    createdAt: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_lastName", ["lastName"]),

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
   */
  bookingSessions: defineTable({
    // Multi-tenancy
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),

    // The discriminated union state - contains step + all data for that step
    state: bookingSessionStepValidator,

    // Metadata
    createdAt: v.int64(),
    expiresAt: v.int64(), // Auto-expire after 30 minutes
    lastModified: v.int64(),
  })
    .index("by_practiceId", ["practiceId"])
    .index("by_expiresAt", ["expiresAt"]),
});
