import type { GenericDatabaseReader } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

type Reader = GenericDatabaseReader<DataModel>;

export async function requireAppointmentTypeInPracticeRuleSet(
  db: Reader,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"appointmentTypes">> {
  const appointmentType = await db.get(
    "appointmentTypes",
    args.appointmentTypeId,
  );
  if (
    appointmentType?.practiceId !== args.practiceId ||
    appointmentType.ruleSetId !== args.ruleSetId
  ) {
    throw new Error("Terminart nicht in dieser Praxis und diesem Regelset.");
  }
  return appointmentType;
}

export async function requireBookingIdentityInPractice(
  db: Reader,
  args: {
    bookingIdentityId: Id<"bookingIdentities">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"bookingIdentities">> {
  const bookingIdentity = await db.get(
    "bookingIdentities",
    args.bookingIdentityId,
  );
  if (bookingIdentity?.practiceId !== args.practiceId) {
    throw new Error("Booking identity does not belong to this practice.");
  }
  return bookingIdentity;
}

export async function requireLocationInPractice(
  db: Reader,
  args: {
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"locations">> {
  const location = await db.get("locations", args.locationId);
  if (location?.practiceId !== args.practiceId) {
    throw new Error("Standort nicht in dieser Praxis.");
  }
  return location;
}

export async function requireLocationInPracticeRuleSet(
  db: Reader,
  args: {
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"locations">> {
  const location = await db.get("locations", args.locationId);
  if (
    location?.practiceId !== args.practiceId ||
    location.ruleSetId !== args.ruleSetId
  ) {
    throw new Error("Standort nicht in dieser Praxis und diesem Regelset.");
  }
  return location;
}

export async function requirePatientInPractice(
  db: Reader,
  args: {
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"patients">> {
  const patient = await db.get("patients", args.patientId);
  if (patient?.practiceId !== args.practiceId) {
    throw new Error("Patient does not belong to this practice.");
  }
  return patient;
}

export async function requirePhoneBookingIdentityInPractice(
  db: Reader,
  args: {
    phoneBookingIdentityId: Id<"phoneBookingIdentities">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"phoneBookingIdentities">> {
  const phoneBookingIdentity = await db.get(
    "phoneBookingIdentities",
    args.phoneBookingIdentityId,
  );
  if (phoneBookingIdentity?.practiceId !== args.practiceId) {
    throw new Error("Phone booking identity does not belong to this practice.");
  }
  return phoneBookingIdentity;
}

export async function requirePractitionerInPractice(
  db: Reader,
  args: {
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
  },
): Promise<Doc<"practitioners">> {
  const practitioner = await db.get("practitioners", args.practitionerId);
  if (practitioner?.practiceId !== args.practiceId) {
    throw new Error("Behandler nicht in dieser Praxis.");
  }
  return practitioner;
}

export async function requirePractitionerInPracticeRuleSet(
  db: Reader,
  args: {
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"practitioners">> {
  const practitioner = await db.get("practitioners", args.practitionerId);
  if (
    practitioner?.practiceId !== args.practiceId ||
    practitioner.ruleSetId !== args.ruleSetId
  ) {
    throw new Error("Behandler nicht in dieser Praxis und diesem Regelset.");
  }
  return practitioner;
}

export async function userHasPracticeRelation(
  db: Reader,
  args: {
    practiceId: Id<"practices">;
    userId: Id<"users">;
  },
): Promise<boolean> {
  const membership = await db
    .query("practiceMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", args.practiceId).eq("userId", args.userId),
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
    (appointment) => appointment.practiceId === args.practiceId,
  );
}
