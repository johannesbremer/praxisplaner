import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { mutation, query } from "./_generated/server";
import { insertSelfLineageEntity } from "./lineage";

function assertMigrationRehearsalEnabled(): void {
  if (process.env["MIGRATION_REHEARSAL_ENABLED"] !== "true") {
    throw new Error(
      "Migration rehearsal mutations are disabled. Set MIGRATION_REHEARSAL_ENABLED=true on a local deployment.",
    );
  }
}

const SEARCH_WHITESPACE_REGEX = regex.as(String.raw`\s+`, "gu");

export const replaceReferenceTables = mutation({
  args: {
    appointmentTypes: v.array(
      v.object({
        duration: v.number(),
        name: v.string(),
      }),
    ),
    locations: v.array(v.string()),
    practiceId: v.id("practices"),
    practitioners: v.array(v.string()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const [appointmentTypes, baseSchedules, locations, practitioners] =
      await Promise.all([
        ctx.db
          .query("appointmentTypes")
          .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
          .collect(),
        ctx.db
          .query("baseSchedules")
          .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
          .collect(),
        ctx.db
          .query("locations")
          .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
          .collect(),
        ctx.db
          .query("practitioners")
          .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
          .collect(),
      ]);

    await Promise.all([
      ...baseSchedules.map((row) => ctx.db.delete("baseSchedules", row._id)),
      ...appointmentTypes.map((row) =>
        ctx.db.delete("appointmentTypes", row._id),
      ),
      ...locations.map((row) => ctx.db.delete("locations", row._id)),
      ...practitioners.map((row) => ctx.db.delete("practitioners", row._id)),
    ]);

    const practitionerLineageKeys: Id<"practitioners">[] = [];
    for (const name of args.practitioners) {
      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        },
      );
      await ctx.db.patch("practitioners", practitionerId, {
        parentId: practitionerId,
      });
      practitionerLineageKeys.push(practitionerId);
    }

    const locationIds: Id<"locations">[] = [];
    for (const name of args.locations) {
      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      });
      await ctx.db.patch("locations", locationId, { parentId: locationId });
      locationIds.push(locationId);
    }

    const now = BigInt(Date.now());
    const appointmentTypeIds: Id<"appointmentTypes">[] = [];
    for (const appointmentType of args.appointmentTypes) {
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: practitionerLineageKeys,
          createdAt: now,
          duration: appointmentType.duration,
          lastModified: now,
          name: appointmentType.name,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        },
      );
      await ctx.db.patch("appointmentTypes", appointmentTypeId, {
        parentId: appointmentTypeId,
      });
      appointmentTypeIds.push(appointmentTypeId);
    }

    return {
      appointmentTypes: appointmentTypeIds.length,
      locations: locationIds.length,
      practitioners: practitionerLineageKeys.length,
    };
  },
  returns: v.object({
    appointmentTypes: v.number(),
    locations: v.number(),
    practitioners: v.number(),
  }),
});

export const listPatientMappingsByPatientIdRange = query({
  args: {
    fromInclusive: v.number(),
    practiceId: v.id("practices"),
    toExclusive: v.number(),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const patients = await ctx.db
      .query("patients")
      .withIndex("by_practiceId_patientId", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("patientId", args.fromInclusive)
          .lt("patientId", args.toExclusive),
      )
      .collect();

    return patients.flatMap((patient) =>
      patient.patientId === undefined
        ? []
        : [{ convexId: patient._id, patientId: patient.patientId }],
    );
  },
  returns: v.array(
    v.object({
      convexId: v.id("patients"),
      patientId: v.number(),
    }),
  ),
});

const bookingIdentityImportRowValidator = v.object({
  dateOfBirth: v.optional(v.string()),
  firstName: v.optional(v.string()),
  kind: v.union(v.literal("online"), v.literal("telefonki")),
  lastName: v.optional(v.string()),
  sourceIdentityId: v.string(),
  sourceKey: v.string(),
  sourceSystem: v.union(v.literal("legacy-pocketbase"), v.literal("telefonki")),
  userEmail: v.optional(v.string()),
  userSourceId: v.optional(v.string()),
});

const legacyUserImportRowValidator = v.object({
  authId: v.string(),
  email: v.string(),
  sourceUserId: v.string(),
  username: v.string(),
  verified: v.boolean(),
});

const bookingIdentityAssociationImportRowValidator = v.object({
  associationKey: v.string(),
  bookingIdentitySourceKey: v.string(),
  confidence: v.literal("exact"),
  evidence: v.object({
    legacyAppointmentId: v.string(),
    legacyIdentityId: v.string(),
    matchedAppointmentStart: v.string(),
    matchedFirstName: v.string(),
    matchedLastName: v.string(),
    pvsAppointmentSourceKey: v.string(),
    pvsPatientNumber: v.number(),
  }),
  evidenceCount: v.number(),
  method: v.literal("migration-exact-appointment-name"),
  pvsPatientNumber: v.number(),
  status: v.literal("active"),
});

export const importBookingIdentityAssociations = mutation({
  args: {
    associations: v.array(bookingIdentityAssociationImportRowValidator),
    identities: v.array(bookingIdentityImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    const identityIdBySourceKey = new Map<string, Id<"bookingIdentities">>();
    let insertedIdentities = 0;
    let reusedIdentities = 0;

    for (const identity of args.identities) {
      const existingIdentities = await ctx.db
        .query("bookingIdentities")
        .withIndex("by_sourceIdentity", (q) =>
          q
            .eq("sourceSystem", identity.sourceSystem)
            .eq("sourceIdentityId", identity.sourceIdentityId),
        )
        .collect();
      const existing = existingIdentities.find(
        (row) => row.practiceId === args.practiceId,
      );

      if (existing) {
        identityIdBySourceKey.set(identity.sourceKey, existing._id);
        reusedIdentities += 1;
        continue;
      }

      const user =
        identity.userSourceId === undefined
          ? null
          : await ctx.db
              .query("users")
              .withIndex("by_authId", (q) =>
                q.eq("authId", `legacy-pocketbase:${identity.userSourceId}`),
              )
              .first();

      const bookingIdentityId = await ctx.db.insert("bookingIdentities", {
        ...(identity.dateOfBirth ? { dateOfBirth: identity.dateOfBirth } : {}),
        ...(identity.userEmail ? { email: identity.userEmail } : {}),
        ...(identity.firstName ? { firstName: identity.firstName } : {}),
        kind: identity.kind,
        lastModified: now,
        ...(identity.lastName ? { lastName: identity.lastName } : {}),
        createdAt: now,
        practiceId: args.practiceId,
        searchFirstName: normalizeSearch(identity.firstName, identity.lastName),
        searchLastName: normalizeSearch(identity.lastName, identity.firstName),
        sourceIdentityId: identity.sourceIdentityId,
        sourceSystem: identity.sourceSystem,
        ...(user ? { userId: user._id } : {}),
      });
      identityIdBySourceKey.set(identity.sourceKey, bookingIdentityId);
      insertedIdentities += 1;
    }

    let insertedAssociations = 0;
    let reusedAssociations = 0;
    let skippedMissingIdentity = 0;
    let skippedMissingPatient = 0;

    for (const association of args.associations) {
      const bookingIdentityId = identityIdBySourceKey.get(
        association.bookingIdentitySourceKey,
      );
      if (!bookingIdentityId) {
        skippedMissingIdentity += 1;
        continue;
      }

      const patient = await ctx.db
        .query("patients")
        .withIndex("by_practiceId_patientId", (q) =>
          q
            .eq("practiceId", args.practiceId)
            .eq("patientId", association.pvsPatientNumber),
        )
        .first();

      if (patient?.recordType !== "pvs") {
        skippedMissingPatient += 1;
        continue;
      }

      const activeAssociations = await ctx.db
        .query("bookingIdentityPatientAssociations")
        .withIndex("by_bookingIdentityId_status", (q) =>
          q.eq("bookingIdentityId", bookingIdentityId).eq("status", "active"),
        )
        .collect();
      const existingAssociation = activeAssociations.find(
        (row) => row.patientId === patient._id,
      );

      if (existingAssociation) {
        reusedAssociations += 1;
        continue;
      }

      for (const existing of activeAssociations) {
        await ctx.db.patch("bookingIdentityPatientAssociations", existing._id, {
          status: "superseded",
          supersededAt: now,
        });
      }

      await ctx.db.insert("bookingIdentityPatientAssociations", {
        bookingIdentityId,
        confidence: association.confidence,
        createdAt: now,
        evidence: association.evidence,
        method: association.method,
        patientId: patient._id,
        practiceId: args.practiceId,
        status: "active",
      });
      insertedAssociations += 1;
    }

    return {
      insertedAssociations,
      insertedIdentities,
      reusedAssociations,
      reusedIdentities,
      skippedMissingIdentity,
      skippedMissingPatient,
    };
  },
  returns: v.object({
    insertedAssociations: v.number(),
    insertedIdentities: v.number(),
    reusedAssociations: v.number(),
    reusedIdentities: v.number(),
    skippedMissingIdentity: v.number(),
    skippedMissingPatient: v.number(),
  }),
});

export const importLegacyUsers = mutation({
  args: {
    users: v.array(legacyUserImportRowValidator),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    let insertedUsers = 0;
    let reusedUsers = 0;

    for (const user of args.users) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", user.authId))
        .first();

      if (existing) {
        reusedUsers += 1;
        continue;
      }

      await ctx.db.insert("users", {
        authId: user.authId,
        createdAt: now,
        email: user.email,
      });
      insertedUsers += 1;
    }

    return { insertedUsers, reusedUsers };
  },
  returns: v.object({
    insertedUsers: v.number(),
    reusedUsers: v.number(),
  }),
});

export const countBookingIdentityAssociationImport = query({
  args: {},
  handler: async (ctx) => {
    assertMigrationRehearsalEnabled();

    const [bookingIdentities, associations] = await Promise.all([
      ctx.db.query("bookingIdentities").collect(),
      ctx.db.query("bookingIdentityPatientAssociations").collect(),
    ]);
    const legacyUsers = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) =>
        q
          .gte("authId", "legacy-pocketbase:")
          .lt("authId", "legacy-pocketbase;"),
      )
      .collect();

    const activeAssociations = associations.filter(
      (association) => association.status === "active",
    );

    return {
      activeAssociations: activeAssociations.length,
      associations: associations.length,
      bookingIdentities: bookingIdentities.length,
      legacyUsers: legacyUsers.length,
    };
  },
  returns: v.object({
    activeAssociations: v.number(),
    associations: v.number(),
    bookingIdentities: v.number(),
    legacyUsers: v.number(),
  }),
});

function normalizeSearch(
  firstPart: string | undefined,
  secondPart: string | undefined,
): string {
  const parts = [];
  for (const part of [firstPart, secondPart]) {
    const compactPart = part?.trim().replace(SEARCH_WHITESPACE_REGEX, " ");
    if (compactPart) {
      parts.push(compactPart);
    }
  }
  return parts.join(" ").toLocaleLowerCase();
}
