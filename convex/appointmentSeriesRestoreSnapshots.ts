import { v } from "convex/values";

import { appointmentOccupancyScopeValidator } from "./appointmentOccupancy";
import { appointmentPlanStepValidator } from "./appointmentPlans";
import { appointmentSimulationKindValidator } from "./appointmentSimulation";

const appointmentSmileyValidator = v.string();

export const appointmentSeriesRestoreAppointmentSnapshotValidator = v.object({
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  appointmentTypeTitle: v.string(),
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  cancelledAt: v.optional(v.int64()),
  cancelledByPhoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
  cancelledByUserId: v.optional(v.id("users")),
  createdAt: v.int64(),
  end: v.string(),
  isSimulation: v.optional(v.boolean()),
  lastModified: v.int64(),
  locationLineageKey: v.id("locations"),
  occupancyScope: appointmentOccupancyScopeValidator,
  originalAppointmentId: v.id("appointments"),
  patientId: v.optional(v.id("patients")),
  phoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
  practiceId: v.id("practices"),
  reassignmentSourceVacationLineageKey: v.optional(v.id("vacations")),
  replacesAppointmentId: v.optional(v.id("appointments")),
  seriesStepId: v.optional(v.string()),
  seriesStepIndex: v.optional(v.int64()),
  simulationKind: v.optional(appointmentSimulationKindValidator),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  simulationValidatedAt: v.optional(v.int64()),
  smiley: v.optional(appointmentSmileyValidator),
  start: v.string(),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

export const appointmentSeriesRestoreSnapshotValidator = v.object({
  appointments: v.array(appointmentSeriesRestoreAppointmentSnapshotValidator),
  series: v.object({
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
  }),
});
