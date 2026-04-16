import type { GenericDatabaseReader } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

export type StoredAppointmentReferences = Pick<
  Doc<"appointments">,
  "appointmentTypeLineageKey" | "locationLineageKey" | "practitionerLineageKey"
>;

type DatabaseReader = GenericDatabaseReader<DataModel>;

export async function resolveAppointmentTypeIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: Id<"appointmentTypes">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"appointmentTypes">> {
  const direct = await db.get("appointmentTypes", args.lineageKey);
  const effectiveLineageKey =
    direct?.lineageKey ?? direct?._id ?? args.lineageKey;
  const entity = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return entity._id;
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return direct._id;
  }

  return effectiveLineageKey;
}

export async function resolveAppointmentTypeLineageKey(
  db: DatabaseReader,
  appointmentTypeId: Id<"appointmentTypes">,
): Promise<Id<"appointmentTypes">> {
  const appointmentType = await requireAppointmentType(db, appointmentTypeId);
  return appointmentType.lineageKey ?? appointmentType._id;
}

export async function resolveLocationIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: Id<"locations">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"locations">> {
  const direct = await db.get("locations", args.lineageKey);
  const effectiveLineageKey =
    direct?.lineageKey ?? direct?._id ?? args.lineageKey;
  const entity = await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return entity._id;
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return direct._id;
  }

  return effectiveLineageKey;
}

export async function resolveLocationLineageKey(
  db: DatabaseReader,
  locationId: Id<"locations">,
): Promise<Id<"locations">> {
  const location = await requireLocation(db, locationId);
  return location.lineageKey ?? location._id;
}

export async function resolvePractitionerIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"practitioners">> {
  const direct = await db.get("practitioners", args.lineageKey);
  const effectiveLineageKey =
    direct?.lineageKey ?? direct?._id ?? args.lineageKey;
  const entity = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return entity._id;
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return direct._id;
  }

  return effectiveLineageKey;
}

export async function resolvePractitionerLineageKey(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
): Promise<Id<"practitioners">> {
  const practitioner = await requirePractitioner(db, practitionerId);
  return practitioner.lineageKey ?? practitioner._id;
}

export async function resolveStoredAppointmentReferencesForWrite(
  db: DatabaseReader,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    practitionerId?: Id<"practitioners">;
  },
): Promise<StoredAppointmentReferences> {
  return {
    appointmentTypeLineageKey: await resolveAppointmentTypeLineageKey(
      db,
      args.appointmentTypeId,
    ),
    locationLineageKey: await resolveLocationLineageKey(db, args.locationId),
    ...(args.practitionerId
      ? {
          practitionerLineageKey: await resolvePractitionerLineageKey(
            db,
            args.practitionerId,
          ),
        }
      : {}),
  };
}

async function requireAppointmentType(
  db: DatabaseReader,
  appointmentTypeId: Id<"appointmentTypes">,
) {
  const appointmentType = await db.get("appointmentTypes", appointmentTypeId);
  if (!appointmentType) {
    throw new Error(`Terminart ${appointmentTypeId} nicht gefunden.`);
  }
  return appointmentType;
}

async function requireLocation(
  db: DatabaseReader,
  locationId: Id<"locations">,
) {
  const location = await db.get("locations", locationId);
  if (!location) {
    throw new Error(`Standort ${locationId} nicht gefunden.`);
  }
  return location;
}

async function requirePractitioner(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
) {
  const practitioner = await db.get("practitioners", practitionerId);
  if (!practitioner) {
    throw new Error(`Behandler ${practitionerId} nicht gefunden.`);
  }
  return practitioner;
}
