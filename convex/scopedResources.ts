import type { GenericDatabaseReader } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type {
  ManagerPracticeScope,
  ManagerRuleSetScope,
  PatientBookingScope,
  StaffPracticeScope,
  StaffRuleSetScope,
  TrustedPracticeScope,
  TrustedRuleSetScope,
} from "./practiceAccess";

type PracticeScope =
  | ManagerPracticeScope
  | PatientBookingScope
  | StaffPracticeScope
  | TrustedPracticeScope
  | TrustedRuleSetScope;
type Reader = GenericDatabaseReader<DataModel>;
type RuleSetScope =
  | ManagerRuleSetScope
  | PatientBookingScope
  | StaffRuleSetScope
  | TrustedRuleSetScope;

export async function requireAppointmentTypeInPracticeRuleSet(
  db: Reader,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    scope: RuleSetScope;
  },
): Promise<Doc<"appointmentTypes">> {
  const appointmentType = await db.get(
    "appointmentTypes",
    args.appointmentTypeId,
  );
  if (
    appointmentType?.practiceId !== args.scope.practiceId ||
    appointmentType.ruleSetId !== args.scope.ruleSetId
  ) {
    throw new Error("Terminart nicht in dieser Praxis und diesem Regelset.");
  }
  return appointmentType;
}

export async function requireBookingIdentityInPractice(
  db: Reader,
  args: {
    bookingIdentityId: Id<"bookingIdentities">;
    scope: PracticeScope;
  },
): Promise<Doc<"bookingIdentities">> {
  const bookingIdentity = await db.get(
    "bookingIdentities",
    args.bookingIdentityId,
  );
  if (bookingIdentity?.practiceId !== args.scope.practiceId) {
    throw new Error("Booking identity does not belong to this practice.");
  }
  return bookingIdentity;
}

export async function requireLocationInPractice(
  db: Reader,
  args: {
    locationId: Id<"locations">;
    scope: PracticeScope;
  },
): Promise<Doc<"locations">> {
  const location = await db.get("locations", args.locationId);
  if (location?.practiceId !== args.scope.practiceId) {
    throw new Error("Standort nicht in dieser Praxis.");
  }
  return location;
}

export async function requireLocationInPracticeRuleSet(
  db: Reader,
  args: {
    locationId: Id<"locations">;
    scope: RuleSetScope;
  },
): Promise<Doc<"locations">> {
  const location = await db.get("locations", args.locationId);
  if (
    location?.practiceId !== args.scope.practiceId ||
    location.ruleSetId !== args.scope.ruleSetId
  ) {
    throw new Error("Standort nicht in dieser Praxis und diesem Regelset.");
  }
  return location;
}

export async function requirePatientInPractice(
  db: Reader,
  args: {
    patientId: Id<"patients">;
    scope: PracticeScope;
  },
): Promise<Doc<"patients">> {
  const patient = await db.get("patients", args.patientId);
  if (patient?.practiceId !== args.scope.practiceId) {
    throw new Error("Patient does not belong to this practice.");
  }
  return patient;
}

export async function requirePhoneBookingIdentityInPractice(
  db: Reader,
  args: {
    phoneBookingIdentityId: Id<"phoneBookingIdentities">;
    scope: PracticeScope;
  },
): Promise<Doc<"phoneBookingIdentities">> {
  const phoneBookingIdentity = await db.get(
    "phoneBookingIdentities",
    args.phoneBookingIdentityId,
  );
  if (phoneBookingIdentity?.practiceId !== args.scope.practiceId) {
    throw new Error("Phone booking identity does not belong to this practice.");
  }
  return phoneBookingIdentity;
}

export async function requirePractitionerInPractice(
  db: Reader,
  args: {
    practitionerId: Id<"practitioners">;
    scope: PracticeScope;
  },
): Promise<Doc<"practitioners">> {
  const practitioner = await db.get("practitioners", args.practitionerId);
  if (practitioner?.practiceId !== args.scope.practiceId) {
    throw new Error("Behandler nicht in dieser Praxis.");
  }
  return practitioner;
}

export async function requirePractitionerInPracticeRuleSet(
  db: Reader,
  args: {
    practitionerId: Id<"practitioners">;
    scope: RuleSetScope;
  },
): Promise<Doc<"practitioners">> {
  const practitioner = await db.get("practitioners", args.practitionerId);
  if (
    practitioner?.practiceId !== args.scope.practiceId ||
    practitioner.ruleSetId !== args.scope.ruleSetId
  ) {
    throw new Error("Behandler nicht in dieser Praxis und diesem Regelset.");
  }
  return practitioner;
}

export async function userHasPracticeRelation(
  db: Reader,
  args: {
    scope: PracticeScope;
    userId: Id<"users">;
  },
): Promise<boolean> {
  const membership = await db
    .query("organizationMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", args.scope.practiceId).eq("userId", args.userId),
    )
    .first();
  if (membership) {
    return true;
  }

  const appointments = await db
    .query("appointments")
    .withIndex("by_userId", (q) => q.eq("userId", args.userId))
    .collect();
  return appointments.some(
    (appointment) => appointment.practiceId === args.scope.practiceId,
  );
}
