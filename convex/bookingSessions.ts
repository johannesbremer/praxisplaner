import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import { internalMutation, mutation, query } from "./_generated/server";
import {
  beihilfeStatusValidator,
  bookingSessionStepValidator,
  emergencyContactValidator,
  hzvStatusValidator,
  insuranceTypeValidator,
  medicalHistoryValidator,
  personalDataValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
  selectedSlotValidator,
} from "./schema";

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// TYPE HELPERS
// ============================================================================

type BookingSessionState = Doc<"bookingSessions">["state"];

// Helper to narrow state to a specific step
type StateAtStep<S extends BookingSessionState["step"]> = Extract<
  BookingSessionState,
  { step: S }
>;

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get a booking session by ID.
 * Returns null if the session doesn't exist or has expired.
 */
export const get = query({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      return null;
    }

    // Check if session has expired
    const now = BigInt(Date.now());
    if (session.expiresAt < now) {
      return null;
    }

    return session;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("bookingSessions"),
      createdAt: v.int64(),
      expiresAt: v.int64(),
      lastModified: v.int64(),
      practiceId: v.id("practices"),
      ruleSetId: v.id("ruleSets"),
      state: bookingSessionStepValidator,
    }),
    v.null(),
  ),
});

// ============================================================================
// SESSION LIFECYCLE
// ============================================================================

/**
 * Create a new booking session starting at the privacy step.
 */
export const create = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    const sessionId = await ctx.db.insert("bookingSessions", {
      createdAt: now,
      expiresAt: now + BigInt(SESSION_TTL_MS),
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      state: {
        step: "privacy" as const,
      },
    });

    return sessionId;
  },
  returns: v.id("bookingSessions"),
});

/**
 * Delete a booking session (e.g., after completion or abandonment).
 */
export const remove = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    await ctx.db.delete("bookingSessions", args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Internal mutation to clean up expired sessions.
 */
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = BigInt(Date.now());
    const expiredSessions = await ctx.db
      .query("bookingSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();

    for (const session of expiredSessions) {
      await ctx.db.delete("bookingSessions", session._id);
    }

    return expiredSessions.length;
  },
  returns: v.number(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Refresh session expiry on any update.
 */
async function refreshSession(
  ctx: {
    db: {
      patch: (
        tableName: "bookingSessions",
        id: Id<"bookingSessions">,
        data: { expiresAt: bigint; lastModified: bigint },
      ) => Promise<void>;
    };
  },
  sessionId: Id<"bookingSessions">,
) {
  const now = BigInt(Date.now());
  await ctx.db.patch("bookingSessions", sessionId, {
    expiresAt: now + BigInt(SESSION_TTL_MS),
    lastModified: now,
  });
}

/**
 * Assert that the session is at the expected step.
 * Returns the narrowed state type.
 */
function assertStep<S extends BookingSessionState["step"]>(
  state: BookingSessionState,
  expected: S,
): StateAtStep<S> {
  if (state.step !== expected) {
    throw new Error(
      `Invalid step: expected '${expected}', got '${state.step}'`,
    );
  }
  return state as StateAtStep<S>;
}

/**
 * Calculate end time from start time and duration.
 */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const start = new Date(startTime);
  start.setMinutes(start.getMinutes() + durationMinutes);
  return start.toISOString();
}

// ============================================================================
// NAVIGATION GRAPH
// ============================================================================

/**
 * Step navigation graph - defines valid back transitions for each step.
 * This is a single source of truth for navigation logic.
 */
type StepName = BookingSessionState["step"];

interface StepNavNode {
  /** Whether back navigation is allowed from this step */
  canGoBack: boolean;
  /** The previous step (or null for root/no-back steps) */
  prev: null | StepName;
  /** For steps with dynamic predecessors, a function to compute the previous step */
  computePrev?: (state: BookingSessionState) => null | StepName;
}

const STEP_NAV_GRAPH: Record<StepName, StepNavNode> = {
  // Root step - cannot go back
  privacy: { canGoBack: false, prev: null },

  // Main flow
  location: { canGoBack: true, prev: "privacy" },
  "patient-status": { canGoBack: true, prev: "location" },

  // PATH A: New patient
  "new-age-check": { canGoBack: true, prev: "patient-status" },
  "new-appointment-type": {
    canGoBack: true,
    computePrev: (state) => {
      if ("insuranceType" in state) {
        return state.insuranceType === "gkv"
          ? "new-gkv-details"
          : "new-pkv-details";
      }
      return "new-gkv-details";
    },
    prev: "new-gkv-details", // Default, but computed dynamically
  },
  "new-calendar-selection": { canGoBack: true, prev: "new-data-input" },
  "new-confirmation": { canGoBack: false, prev: null }, // Final step - no back
  "new-data-input": { canGoBack: true, prev: "new-appointment-type" },
  "new-gkv-details": { canGoBack: true, prev: "new-insurance-type" },
  "new-insurance-type": { canGoBack: true, prev: "new-age-check" },
  "new-pkv-details": { canGoBack: true, prev: "new-pvs-consent" },
  "new-pvs-consent": { canGoBack: true, prev: "new-insurance-type" },

  // PATH B: Existing patient (no back after doctor selection)
  "existing-appointment-type": { canGoBack: false, prev: null },
  "existing-calendar-selection": { canGoBack: false, prev: null },
  "existing-confirmation": { canGoBack: false, prev: null },
  "existing-data-input": { canGoBack: false, prev: null },
  "existing-doctor-selection": { canGoBack: true, prev: "patient-status" },
};

/**
 * Compute the previous state based on current state.
 * Returns the new state to transition to, or null if back is not allowed.
 */
function computePreviousState(
  state: BookingSessionState,
): BookingSessionState | null {
  const currentStep = state.step;
  const navNode = STEP_NAV_GRAPH[currentStep];

  if (!navNode.canGoBack) {
    return null;
  }

  // Compute the previous step
  const prevStep = navNode.computePrev
    ? navNode.computePrev(state)
    : navNode.prev;

  if (!prevStep) {
    return null;
  }

  // Build the previous state based on what step we're going back to
  switch (prevStep) {
    case "location": {
      return { step: "location" };
    }

    case "new-age-check": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing locationId");
      }
      return {
        isNewPatient: true,
        locationId: state.locationId,
        step: "new-age-check",
      };
    }

    case "new-gkv-details": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "gkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-gkv-details",
      };
    }

    case "new-insurance-type": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-insurance-type",
      };
    }

    case "new-pkv-details": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-pkv-details",
      };
    }

    case "new-pvs-consent": {
      if (!("locationId" in state) || !("isOver40" in state)) {
        throw new Error("Cannot go back: missing required fields");
      }
      return {
        insuranceType: "pkv",
        isNewPatient: true,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-pvs-consent",
      };
    }

    case "patient-status": {
      if (!("locationId" in state)) {
        throw new Error("Cannot go back: missing locationId");
      }
      return { locationId: state.locationId, step: "patient-status" };
    }

    case "privacy": {
      return { step: "privacy" };
    }

    case "new-appointment-type": {
      if (
        !("locationId" in state) ||
        !("isOver40" in state) ||
        !("insuranceType" in state)
      ) {
        throw new Error("Cannot go back: missing required fields");
      }

      if (state.insuranceType === "gkv") {
        if (!("hzvStatus" in state)) {
          throw new Error("Cannot go back: missing hzvStatus");
        }
        return {
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv",
          isNewPatient: true,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-appointment-type",
        };
      } else {
        // PKV path - preserve optional fields
        // At this point, state has been narrowed to a PKV type that may have these optional fields
        // Use spread to only include defined optional properties
        return {
          ...("beihilfeStatus" in state
            ? { beihilfeStatus: state.beihilfeStatus }
            : {}),
          ...("pkvInsuranceType" in state
            ? { pkvInsuranceType: state.pkvInsuranceType }
            : {}),
          ...("pkvTariff" in state ? { pkvTariff: state.pkvTariff } : {}),
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          pvsConsent: true as const,
          step: "new-appointment-type" as const,
        };
      }
    }

    case "new-data-input": {
      // Going back from new-calendar-selection to new-data-input
      // Note: new-data-input step doesn't store personalData/medicalHistory/emergencyContacts
      // Those are submitted when transitioning to new-calendar-selection
      // So we only need the base state for new-data-input
      if (
        !("locationId" in state) ||
        !("isOver40" in state) ||
        !("insuranceType" in state) ||
        !("appointmentTypeId" in state)
      ) {
        throw new Error("Cannot go back: missing required fields");
      }

      if (state.insuranceType === "gkv") {
        if (!("hzvStatus" in state)) {
          throw new Error("Cannot go back: missing hzvStatus");
        }
        return {
          appointmentTypeId: state.appointmentTypeId,
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-data-input" as const,
        };
      } else {
        // PKV path - preserve optional fields from the insurance step
        // Use spread to only include defined optional properties
        return {
          ...("beihilfeStatus" in state
            ? { beihilfeStatus: state.beihilfeStatus }
            : {}),
          ...("pkvInsuranceType" in state
            ? { pkvInsuranceType: state.pkvInsuranceType }
            : {}),
          ...("pkvTariff" in state ? { pkvTariff: state.pkvTariff } : {}),
          appointmentTypeId: state.appointmentTypeId,
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          pvsConsent: true as const,
          step: "new-data-input" as const,
        };
      }
    }

    default: {
      return null;
    }
  }
}

// ============================================================================
// UNIFIED BACK NAVIGATION
// ============================================================================

/**
 * Unified back navigation mutation.
 *
 * This replaces the individual goBackTo* mutations with a single mutation
 * that uses the step navigation graph to determine the previous step and
 * compute the correct state to transition to.
 *
 * Benefits:
 * - Single source of truth for back navigation logic
 * - Easier to maintain and extend
 * - Fewer mutations to import and manage on the frontend
 */
export const goBack = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const previousState = computePreviousState(session.state);
    if (!previousState) {
      throw new Error(
        `Cannot go back from step '${session.state.step}': back navigation not allowed`,
      );
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: previousState,
    });

    await refreshSession(ctx, args.sessionId);
    return previousState.step;
  },
  returns: v.string(),
});

// ============================================================================
// STEP TRANSITIONS - MAIN FLOW
// ============================================================================

/**
 * Step 1 → 2: Accept privacy and proceed to location selection.
 */
export const acceptPrivacy = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    assertStep(session.state, "privacy");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: { step: "location" as const },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 2 → 3: Select a location and proceed to patient status.
 */
export const selectLocation = mutation({
  args: {
    locationId: v.id("locations"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    assertStep(session.state, "location");

    // Verify location exists and belongs to this practice
    const location = await ctx.db.get("locations", args.locationId);
    if (location?.practiceId !== session.practiceId) {
      throw new Error("Invalid location");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        locationId: args.locationId,
        step: "patient-status" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 3 → A1: Select "new patient" path - proceed to age check.
 */
export const selectNewPatient = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "patient-status");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        locationId: state.locationId,
        step: "new-age-check" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Step 3 → B1: Select "existing patient" path - proceed to doctor selection.
 * NOTE: After selecting a doctor, going back to this step is NOT allowed!
 */
export const selectExistingPatient = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "patient-status");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: false as const,
        locationId: state.locationId,
        step: "existing-doctor-selection" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

// ============================================================================
// PATH A: NEW PATIENT
// ============================================================================

/**
 * A1 → A2: Confirm age check and proceed to insurance type.
 */
export const confirmAgeCheck = mutation({
  args: {
    isOver40: v.boolean(),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-age-check");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        isOver40: args.isOver40,
        locationId: state.locationId,
        step: "new-insurance-type" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A2 → A3a/A3b: Select insurance type and proceed to GKV or PKV details.
 */
export const selectInsuranceType = mutation({
  args: {
    insuranceType: insuranceTypeValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-insurance-type");

    if (args.insuranceType === "gkv") {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-gkv-details" as const,
        },
      });
    } else {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-pvs-consent" as const,
        },
      });
    }

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3a → A4: Confirm HZV status (GKV) and proceed to appointment type selection.
 */
export const confirmGkvDetails = mutation({
  args: {
    hzvStatus: hzvStatusValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-gkv-details");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        hzvStatus: args.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-appointment-type" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3b-1 → A3b-2: Accept PVS consent and proceed to PKV details input.
 */
export const acceptPvsConsent = mutation({
  args: {
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-pvs-consent");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-pkv-details" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A3b → A4: Confirm PKV details and proceed to appointment type selection.
 */
export const confirmPkvDetails = mutation({
  args: {
    beihilfeStatus: v.optional(beihilfeStatusValidator),
    pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
    pkvTariff: v.optional(pkvTariffValidator),
    pvsConsent: v.literal(true),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-pkv-details");

    // Build state object - include optional fields only if defined
    type PkvAppointmentType = StateAtStep<"new-appointment-type"> & {
      insuranceType: "pkv";
    };
    const newState: PkvAppointmentType = {
      insuranceType: "pkv" as const,
      isNewPatient: true as const,
      isOver40: state.isOver40,
      locationId: state.locationId,
      pvsConsent: true as const,
      step: "new-appointment-type" as const,
    };

    if (args.pkvTariff !== undefined) {
      newState.pkvTariff = args.pkvTariff;
    }
    if (args.pkvInsuranceType !== undefined) {
      newState.pkvInsuranceType = args.pkvInsuranceType;
    }
    if (args.beihilfeStatus !== undefined) {
      newState.beihilfeStatus = args.beihilfeStatus;
    }

    await ctx.db.patch("bookingSessions", args.sessionId, { state: newState });
    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A4 → A5: Select appointment type and proceed to data input.
 */
export const selectNewPatientAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // new-appointment-type has two variants: GKV (with hzvStatus) and PKV (with pvsConsent)
    if (session.state.step !== "new-appointment-type") {
      throw new Error(
        `Invalid step: expected 'new-appointment-type', got '${session.state.step}'`,
      );
    }

    // Verify appointment type exists and belongs to this rule set
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (appointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }

    const state = session.state;

    // Discriminate by checking for hzvStatus (GKV) vs pvsConsent (PKV)
    if (state.insuranceType === "gkv") {
      // GKV path
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          appointmentTypeId: args.appointmentTypeId,
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-data-input" as const,
        },
      });
    } else {
      // PKV path - build state including optional fields only if defined
      type PkvDataInput = StateAtStep<"new-data-input"> & {
        insuranceType: "pkv";
      };
      const newState: PkvDataInput = {
        appointmentTypeId: args.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true as const,
        step: "new-data-input" as const,
      };

      if (state.pkvTariff !== undefined) {
        newState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        newState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        newState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    }

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A5 → A6: Submit personal data and proceed to calendar selection.
 */
export const submitNewPatientData = mutation({
  args: {
    emergencyContacts: v.optional(v.array(emergencyContactValidator)),
    medicalHistory: v.optional(medicalHistoryValidator),
    personalData: personalDataValidator,
    reasonDescription: v.string(),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "new-data-input") {
      throw new Error(
        `Invalid step: expected 'new-data-input', got '${session.state.step}'`,
      );
    }

    const state = session.state;

    // Build calendar state based on insurance type
    if (state.insuranceType === "gkv") {
      type GkvCalendar = StateAtStep<"new-calendar-selection"> & {
        insuranceType: "gkv";
      };
      const newState: GkvCalendar = {
        appointmentTypeId: state.appointmentTypeId,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: args.personalData,
        reasonDescription: args.reasonDescription,
        step: "new-calendar-selection" as const,
      };

      if (args.medicalHistory !== undefined) {
        newState.medicalHistory = args.medicalHistory;
      }
      if (args.emergencyContacts !== undefined) {
        newState.emergencyContacts = args.emergencyContacts;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    } else {
      // PKV path
      type PkvCalendar = StateAtStep<"new-calendar-selection"> & {
        insuranceType: "pkv";
      };
      const newState: PkvCalendar = {
        appointmentTypeId: state.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: args.personalData,
        pvsConsent: true as const,
        reasonDescription: args.reasonDescription,
        step: "new-calendar-selection" as const,
      };

      if (args.medicalHistory !== undefined) {
        newState.medicalHistory = args.medicalHistory;
      }
      if (args.emergencyContacts !== undefined) {
        newState.emergencyContacts = args.emergencyContacts;
      }
      if (state.pkvTariff !== undefined) {
        newState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        newState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        newState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    }

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * A6 → A7: Select slot and create appointment (new patient).
 */
export const selectNewPatientSlot = mutation({
  args: {
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "new-calendar-selection") {
      throw new Error(
        `Invalid step: expected 'new-calendar-selection', got '${session.state.step}'`,
      );
    }

    const state = session.state;
    const now = BigInt(Date.now());

    // Get the appointment type for the title
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      state.appointmentTypeId,
    );
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Create temporary patient
    const temporaryPatientId = await ctx.db.insert("temporaryPatients", {
      createdAt: now,
      firstName: state.personalData.firstName,
      lastName: state.personalData.lastName,
      phoneNumber: state.personalData.phoneNumber,
      practiceId: session.practiceId,
    });

    // Create the appointment
    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId: state.appointmentTypeId,
      appointmentTypeTitle: appointmentType.name,
      createdAt: now,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      lastModified: now,
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: args.selectedSlot.practitionerId,
      start: args.selectedSlot.startTime,
      temporaryPatientId,
      title: `Online-Termin: ${appointmentType.name}`,
    });

    // Build confirmation state based on insurance type
    if (state.insuranceType === "gkv") {
      type GkvConfirm = StateAtStep<"new-confirmation"> & {
        insuranceType: "gkv";
      };
      const confirmState: GkvConfirm = {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        hzvStatus: state.hzvStatus,
        insuranceType: "gkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "new-confirmation" as const,
        temporaryPatientId,
      };

      if (state.medicalHistory !== undefined) {
        confirmState.medicalHistory = state.medicalHistory;
      }
      if (state.emergencyContacts !== undefined) {
        confirmState.emergencyContacts = state.emergencyContacts;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: confirmState,
      });
    } else {
      // PKV path
      type PkvConfirm = StateAtStep<"new-confirmation"> & {
        insuranceType: "pkv";
      };
      const confirmState: PkvConfirm = {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        personalData: state.personalData,
        pvsConsent: true as const,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "new-confirmation" as const,
        temporaryPatientId,
      };

      if (state.medicalHistory !== undefined) {
        confirmState.medicalHistory = state.medicalHistory;
      }
      if (state.emergencyContacts !== undefined) {
        confirmState.emergencyContacts = state.emergencyContacts;
      }
      if (state.pkvTariff !== undefined) {
        confirmState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        confirmState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        confirmState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: confirmState,
      });
    }

    await refreshSession(ctx, args.sessionId);

    return { appointmentId, temporaryPatientId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
    temporaryPatientId: v.id("temporaryPatients"),
  }),
});

// ============================================================================
// PATH B: EXISTING PATIENT
// ============================================================================

/**
 * B1 → B2: Select doctor.
 * ⚠️ WARNING: After this step, going back to doctor selection is NOT allowed!
 */
export const selectDoctor = mutation({
  args: {
    practitionerId: v.id("practitioners"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "existing-doctor-selection");

    // Verify practitioner exists
    const practitioner = await ctx.db.get("practitioners", args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: false as const,
        locationId: state.locationId,
        practitionerId: args.practitionerId,
        step: "existing-appointment-type" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B2 → B3: Select appointment type and proceed to data input.
 */
export const selectExistingPatientAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "existing-appointment-type");

    // Verify appointment type exists and belongs to this rule set
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    if (appointmentType?.ruleSetId !== session.ruleSetId) {
      throw new Error("Invalid appointment type");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentTypeId: args.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        practitionerId: state.practitionerId,
        step: "existing-data-input" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B3 → B4: Submit personal data and proceed to calendar selection.
 */
export const submitExistingPatientData = mutation({
  args: {
    personalData: personalDataValidator,
    reasonDescription: v.string(),
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "existing-data-input");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentTypeId: state.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        personalData: args.personalData,
        practitionerId: state.practitionerId,
        reasonDescription: args.reasonDescription,
        step: "existing-calendar-selection" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * B4 → B5: Select slot and create appointment (existing patient).
 */
export const selectExistingPatientSlot = mutation({
  args: {
    selectedSlot: selectedSlotValidator,
    sessionId: v.id("bookingSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "existing-calendar-selection");

    const now = BigInt(Date.now());

    // Get the appointment type for the title
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      state.appointmentTypeId,
    );
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Create temporary patient
    const temporaryPatientId = await ctx.db.insert("temporaryPatients", {
      createdAt: now,
      firstName: state.personalData.firstName,
      lastName: state.personalData.lastName,
      phoneNumber: state.personalData.phoneNumber,
      practiceId: session.practiceId,
    });

    // Create the appointment
    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId: state.appointmentTypeId,
      appointmentTypeTitle: appointmentType.name,
      createdAt: now,
      end: calculateEndTime(
        args.selectedSlot.startTime,
        args.selectedSlot.duration,
      ),
      lastModified: now,
      locationId: state.locationId,
      practiceId: session.practiceId,
      practitionerId: state.practitionerId,
      start: args.selectedSlot.startTime,
      temporaryPatientId,
      title: `Online-Termin: ${appointmentType.name}`,
    });

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        appointmentId,
        appointmentTypeId: state.appointmentTypeId,
        isNewPatient: false as const,
        locationId: state.locationId,
        personalData: state.personalData,
        practitionerId: state.practitionerId,
        reasonDescription: state.reasonDescription,
        selectedSlot: args.selectedSlot,
        step: "existing-confirmation" as const,
        temporaryPatientId,
      },
    });

    await refreshSession(ctx, args.sessionId);

    return { appointmentId, temporaryPatientId };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
    temporaryPatientId: v.id("temporaryPatients"),
  }),
});

// ============================================================================
// NAVIGATION (GOING BACK)
// ============================================================================

/**
 * Go back from location to privacy.
 */
export const goBackToPrivacy = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "location") {
      throw new Error(
        `Cannot go back from '${session.state.step}' to 'privacy'`,
      );
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: { step: "privacy" as const },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from patient-status to location.
 */
export const goBackToLocation = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "patient-status") {
      throw new Error(
        `Cannot go back from '${session.state.step}' to 'location'`,
      );
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: { step: "location" as const },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from new-age-check or existing-doctor-selection to patient-status.
 */
export const goBackToPatientStatus = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const validSteps = ["new-age-check", "existing-doctor-selection"];
    if (!validSteps.includes(session.state.step)) {
      throw new Error(
        `Cannot go back from '${session.state.step}' to 'patient-status'`,
      );
    }

    // We need the locationId from the current state
    const state = session.state;
    if (!("locationId" in state)) {
      throw new Error("Cannot go back: missing locationId");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        locationId: state.locationId,
        step: "patient-status" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from new-insurance-type to new-age-check.
 */
export const goBackToAgeCheck = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "new-insurance-type");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        locationId: state.locationId,
        step: "new-age-check" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from new-gkv-details or new-pkv-details to new-insurance-type.
 */
export const goBackToInsuranceType = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const validSteps = ["new-gkv-details", "new-pkv-details"];
    if (!validSteps.includes(session.state.step)) {
      throw new Error(
        `Cannot go back from '${session.state.step}' to 'new-insurance-type'`,
      );
    }

    const state = session.state;
    if (!("isOver40" in state) || !("locationId" in state)) {
      throw new Error("Cannot go back: missing required fields");
    }

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        step: "new-insurance-type" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from new-appointment-type to GKV or PKV details.
 */
export const goBackToInsuranceDetails = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "new-appointment-type") {
      throw new Error(
        `Cannot go back from '${session.state.step}' to insurance details`,
      );
    }

    const state = session.state;

    if (state.insuranceType === "gkv") {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-gkv-details" as const,
        },
      });
    } else {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          insuranceType: "pkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-pkv-details" as const,
        },
      });
    }

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from new-data-input to new-appointment-type.
 */
export const goBackToNewAppointmentType = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state.step !== "new-data-input") {
      throw new Error(
        `Cannot go back from '${session.state.step}' to 'new-appointment-type'`,
      );
    }

    const state = session.state;

    if (state.insuranceType === "gkv") {
      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: {
          hzvStatus: state.hzvStatus,
          insuranceType: "gkv" as const,
          isNewPatient: true as const,
          isOver40: state.isOver40,
          locationId: state.locationId,
          step: "new-appointment-type" as const,
        },
      });
    } else {
      // PKV path - preserve optional fields
      type PkvAppointmentType = StateAtStep<"new-appointment-type"> & {
        insuranceType: "pkv";
      };
      const newState: PkvAppointmentType = {
        insuranceType: "pkv" as const,
        isNewPatient: true as const,
        isOver40: state.isOver40,
        locationId: state.locationId,
        pvsConsent: true as const,
        step: "new-appointment-type" as const,
      };

      if (state.pkvTariff !== undefined) {
        newState.pkvTariff = state.pkvTariff;
      }
      if (state.pkvInsuranceType !== undefined) {
        newState.pkvInsuranceType = state.pkvInsuranceType;
      }
      if (state.beihilfeStatus !== undefined) {
        newState.beihilfeStatus = state.beihilfeStatus;
      }

      await ctx.db.patch("bookingSessions", args.sessionId, {
        state: newState,
      });
    }

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

/**
 * Go back from existing-data-input to existing-appointment-type.
 */
export const goBackToExistingAppointmentType = mutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("bookingSessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const state = assertStep(session.state, "existing-data-input");

    await ctx.db.patch("bookingSessions", args.sessionId, {
      state: {
        isNewPatient: false as const,
        locationId: state.locationId,
        practitionerId: state.practitionerId,
        step: "existing-appointment-type" as const,
      },
    });

    await refreshSession(ctx, args.sessionId);
    return null;
  },
  returns: v.null(),
});

// NOTE: Going back from steps AFTER existing-doctor-selection (B1)
// to existing-doctor-selection is NOT allowed per requirements.
// Users must start over if they need to change their doctor selection.
