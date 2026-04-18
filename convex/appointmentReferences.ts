import type { GenericDatabaseReader } from "convex/server";

import type { DataModel, Id } from "./_generated/dataModel";

import {
  type AppointmentTypeId,
  type AppointmentTypeLineageKey,
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationId,
  type LocationLineageKey,
  type PractitionerId,
  type PractitionerLineageKey,
} from "./identity";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";

export interface OccupancyReferenceLineageKeys {
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
}

export interface StoredAppointmentReferences extends OccupancyReferenceLineageKeys {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
}

type DatabaseReader = GenericDatabaseReader<DataModel>;

export async function resolveAppointmentTypeIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: AppointmentTypeLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<AppointmentTypeId> {
  const direct = await db.get("appointmentTypes", args.lineageKey);
  const effectiveLineageKey = direct?.lineageKey
    ? asAppointmentTypeLineageKey(direct.lineageKey)
    : direct?._id
      ? asAppointmentTypeLineageKey(direct._id)
      : args.lineageKey;
  const entity = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asAppointmentTypeId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asAppointmentTypeId(direct._id);
  }

  throw new Error(
    `Terminart mit Lineage-Key ${effectiveLineageKey} im Regelset ${args.ruleSetId} nicht gefunden.`,
  );
}

export async function resolveAppointmentTypeLineageKey(
  db: DatabaseReader,
  appointmentTypeId: AppointmentTypeId,
): Promise<AppointmentTypeLineageKey> {
  const appointmentType = await requireAppointmentType(db, appointmentTypeId);
  return appointmentType.lineageKey
    ? asAppointmentTypeLineageKey(appointmentType.lineageKey)
    : asAppointmentTypeLineageKey(appointmentType._id);
}

export async function resolveLocationIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: LocationLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<LocationId> {
  const direct = await db.get("locations", args.lineageKey);
  const effectiveLineageKey = direct?.lineageKey
    ? asLocationLineageKey(direct.lineageKey)
    : direct?._id
      ? asLocationLineageKey(direct._id)
      : args.lineageKey;
  const entity = await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asLocationId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asLocationId(direct._id);
  }

  throw new Error(
    `Standort mit Lineage-Key ${effectiveLineageKey} im Regelset ${args.ruleSetId} nicht gefunden.`,
  );
}

export async function resolveLocationLineageKey(
  db: DatabaseReader,
  locationId: LocationId,
): Promise<LocationLineageKey> {
  const location = await requireLocation(db, locationId);
  return location.lineageKey
    ? asLocationLineageKey(location.lineageKey)
    : asLocationLineageKey(location._id);
}

export async function resolveOccupancyReferenceLineageKeys(
  db: DatabaseReader,
  args: {
    locationId: LocationId;
    practitionerId?: PractitionerId;
  },
): Promise<OccupancyReferenceLineageKeys> {
  return {
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

export async function resolvePractitionerIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: PractitionerLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<PractitionerId> {
  const direct = await db.get("practitioners", args.lineageKey);
  const effectiveLineageKey = direct?.lineageKey
    ? asPractitionerLineageKey(direct.lineageKey)
    : direct?._id
      ? asPractitionerLineageKey(direct._id)
      : args.lineageKey;
  const entity = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asPractitionerId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asPractitionerId(direct._id);
  }

  throw new Error(
    `Behandler mit Lineage-Key ${effectiveLineageKey} im Regelset ${args.ruleSetId} nicht gefunden.`,
  );
}

export async function resolvePractitionerLineageKey(
  db: DatabaseReader,
  practitionerId: PractitionerId,
): Promise<PractitionerLineageKey> {
  const practitioner = await requirePractitioner(db, practitionerId);
  return practitioner.lineageKey
    ? asPractitionerLineageKey(practitioner.lineageKey)
    : asPractitionerLineageKey(practitioner._id);
}

export async function resolveStoredAppointmentReferencesForWrite(
  db: DatabaseReader,
  args: {
    appointmentTypeId: AppointmentTypeId;
    locationId: LocationId;
    practitionerId?: PractitionerId;
  },
): Promise<StoredAppointmentReferences> {
  return {
    appointmentTypeLineageKey: await resolveAppointmentTypeLineageKey(
      db,
      args.appointmentTypeId,
    ),
    ...(await resolveOccupancyReferenceLineageKeys(db, {
      locationId: args.locationId,
      ...(args.practitionerId ? { practitionerId: args.practitionerId } : {}),
    })),
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
  if (isRuleSetEntityDeleted(appointmentType)) {
    throw new Error(
      `Terminart ${appointmentTypeId} wurde im aktuellen Regelset gelöscht und kann nicht mehr neu referenziert werden.`,
    );
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
  if (isRuleSetEntityDeleted(location)) {
    throw new Error(
      `Standort ${locationId} wurde im aktuellen Regelset gelöscht und kann nicht mehr neu referenziert werden.`,
    );
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
  if (isRuleSetEntityDeleted(practitioner)) {
    throw new Error(
      `Behandler ${practitionerId} wurde im aktuellen Regelset gelöscht und kann nicht mehr neu referenziert werden.`,
    );
  }
  return practitioner;
}
