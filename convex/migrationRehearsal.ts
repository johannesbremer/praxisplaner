import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { mutation, type MutationCtx, query } from "./_generated/server";
import {
  dataSharingContactInputValidator,
  personalDataValidator,
} from "./bookingValidators";
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

export const listReferenceTableRows = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const [appointmentTypes, locations, practitioners] = await Promise.all([
      ctx.db
        .query("appointmentTypes")
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

    return {
      appointmentTypes: appointmentTypes.flatMap((row) =>
        row.lineageKey === undefined
          ? []
          : [{ lineageKey: row.lineageKey, name: row.name }],
      ),
      locations: locations.flatMap((row) =>
        row.lineageKey === undefined
          ? []
          : [{ lineageKey: row.lineageKey, name: row.name }],
      ),
      practitioners: practitioners.flatMap((row) =>
        row.lineageKey === undefined
          ? []
          : [{ lineageKey: row.lineageKey, name: row.name }],
      ),
    };
  },
  returns: v.object({
    appointmentTypes: v.array(
      v.object({
        lineageKey: v.id("appointmentTypes"),
        name: v.string(),
      }),
    ),
    locations: v.array(
      v.object({
        lineageKey: v.id("locations"),
        name: v.string(),
      }),
    ),
    practitioners: v.array(
      v.object({
        lineageKey: v.id("practitioners"),
        name: v.string(),
      }),
    ),
  }),
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

const legacyBookingBlockImportRowValidator = v.object({
  legacyUserId: v.string(),
  reason: v.string(),
  userAuthId: v.string(),
  userEmail: v.string(),
});

const legacyBookingReplayRowValidator = v.object({
  bookedDurationMinutes: v.number(),
  createdAt: v.number(),
  dataSharingContacts: v.array(dataSharingContactInputValidator),
  legacyAppointmentId: v.string(),
  personalData: personalDataValidator,
  pvsAppointmentStart: v.string(),
  pvsAppointmentTypeTitle: v.string(),
  pvsPatientNumber: v.number(),
  reasonDescription: v.string(),
  source: v.union(v.literal("legacy-pocketbase"), v.literal("telefonki")),
  sourceSessionKey: v.string(),
  userAuthId: v.string(),
  userEmail: v.string(),
});

const bookingIdentityAssociationImportRowValidator = v.object({
  associationKey: v.string(),
  bookingIdentitySourceKey: v.string(),
  evidenceCount: v.number(),
  legacyAppointmentId: v.string(),
  legacyIdentityId: v.string(),
  method: v.literal("automatic"),
  pvsAppointmentSourceKey: v.string(),
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
        createdAt: now,
        evidenceCount: association.evidenceCount,
        legacyAppointmentId: association.legacyAppointmentId,
        legacyIdentityId: association.legacyIdentityId,
        method: association.method,
        patientId: patient._id,
        practiceId: args.practiceId,
        pvsAppointmentSourceKey: association.pvsAppointmentSourceKey,
        pvsPatientNumber: association.pvsPatientNumber,
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

export const importLegacyBookingBlocks = mutation({
  args: {
    blocks: v.array(legacyBookingBlockImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    let insertedBlocks = 0;
    let reusedBlocks = 0;
    let insertedUsers = 0;
    let reusedUsers = 0;

    for (const block of args.blocks) {
      const userResult = await ensureImportedUser(ctx, {
        authId: block.userAuthId,
        email: block.userEmail,
        now,
      });
      if (userResult.inserted) {
        insertedUsers += 1;
      } else {
        reusedUsers += 1;
      }

      const existing = await ctx.db
        .query("legacyBookingBlocks")
        .withIndex("by_userId_practiceId", (q) =>
          q.eq("userId", userResult.userId).eq("practiceId", args.practiceId),
        )
        .first();

      if (existing) {
        reusedBlocks += 1;
        continue;
      }

      await ctx.db.insert("legacyBookingBlocks", {
        createdAt: now,
        legacyUserId: block.legacyUserId,
        practiceId: args.practiceId,
        reason: block.reason,
        sourceSystem: "legacy-pocketbase",
        userId: userResult.userId,
      });
      insertedBlocks += 1;
    }

    return { insertedBlocks, insertedUsers, reusedBlocks, reusedUsers };
  },
  returns: v.object({
    insertedBlocks: v.number(),
    insertedUsers: v.number(),
    reusedBlocks: v.number(),
    reusedUsers: v.number(),
  }),
});

export const importLegacyBookingStepReplay = mutation({
  args: {
    practiceId: v.id("practices"),
    replayRows: v.array(legacyBookingReplayRowValidator),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    let insertedSessions = 0;
    let reusedSessions = 0;
    let insertedUsers = 0;
    let reusedUsers = 0;
    let skippedMissingAppointment = 0;

    for (const replayRow of args.replayRows) {
      const existingSession = await ctx.db
        .query("bookingSessions")
        .withIndex("by_sourceSessionKey", (q) =>
          q.eq("sourceSessionKey", replayRow.sourceSessionKey),
        )
        .first();

      if (existingSession) {
        reusedSessions += 1;
        continue;
      }

      const resolvedReplayRow = await resolveLegacyBookingReplayRow(ctx, {
        practiceId: args.practiceId,
        replayRow,
      });
      if (!resolvedReplayRow) {
        skippedMissingAppointment += 1;
        continue;
      }

      const rowTimestamp = BigInt(resolvedReplayRow.createdAt);
      const userResult = await ensureImportedUser(ctx, {
        authId: resolvedReplayRow.userAuthId,
        email: resolvedReplayRow.userEmail,
        now: rowTimestamp,
      });
      if (userResult.inserted) {
        insertedUsers += 1;
      } else {
        reusedUsers += 1;
      }

      const sessionId = await ctx.db.insert("bookingSessions", {
        createdAt: rowTimestamp,
        expiresAt: rowTimestamp,
        lastModified: rowTimestamp,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
        source: resolvedReplayRow.source,
        sourceSessionKey: resolvedReplayRow.sourceSessionKey,
        state: { step: "existing-confirmation" },
        status: "imported",
        userId: userResult.userId,
      });

      await insertImportedExistingBookingSteps(ctx, {
        practiceId: args.practiceId,
        replayRow: resolvedReplayRow,
        ruleSetId: args.ruleSetId,
        sessionId,
        timestamp: rowTimestamp,
        userId: userResult.userId,
      });
      insertedSessions += 1;
    }

    return {
      insertedSessions,
      insertedUsers,
      reusedSessions,
      reusedUsers,
      skippedMissingAppointment,
    };
  },
  returns: v.object({
    insertedSessions: v.number(),
    insertedUsers: v.number(),
    reusedSessions: v.number(),
    reusedUsers: v.number(),
    skippedMissingAppointment: v.number(),
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
    const [bookingBlocks, importedSessions] = await Promise.all([
      ctx.db.query("legacyBookingBlocks").collect(),
      ctx.db
        .query("bookingSessions")
        .withIndex("by_status_expiresAt", (q) => q.eq("status", "imported"))
        .collect(),
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
      legacyBookingBlocks: bookingBlocks.length,
      legacyBookingSessions: importedSessions.length,
      legacyUsers: legacyUsers.length,
    };
  },
  returns: v.object({
    activeAssociations: v.number(),
    associations: v.number(),
    bookingIdentities: v.number(),
    legacyBookingBlocks: v.number(),
    legacyBookingSessions: v.number(),
    legacyUsers: v.number(),
  }),
});

const rehearsalCountTableNameValidator = v.union(
  v.literal("bookingSessions"),
  v.literal("bookingPrivacySteps"),
  v.literal("bookingLocationSteps"),
  v.literal("bookingPatientStatusSteps"),
  v.literal("bookingExistingDoctorSelectionSteps"),
  v.literal("bookingExistingPersonalDataSteps"),
  v.literal("bookingExistingDataSharingSteps"),
  v.literal("bookingExistingCalendarSelectionSteps"),
  v.literal("bookingExistingConfirmationSteps"),
  v.literal("bookingIdentities"),
  v.literal("bookingIdentityPatientAssociations"),
  v.literal("legacyBookingBlocks"),
);

export const countRehearsalTablePage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tableName: rehearsalCountTableNameValidator,
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    switch (args.tableName) {
      case "bookingExistingCalendarSelectionSteps": {
        const result = await ctx.db
          .query("bookingExistingCalendarSelectionSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingExistingConfirmationSteps": {
        const result = await ctx.db
          .query("bookingExistingConfirmationSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingExistingDataSharingSteps": {
        const result = await ctx.db
          .query("bookingExistingDataSharingSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingExistingDoctorSelectionSteps": {
        const result = await ctx.db
          .query("bookingExistingDoctorSelectionSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingExistingPersonalDataSteps": {
        const result = await ctx.db
          .query("bookingExistingPersonalDataSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingIdentities": {
        const result = await ctx.db
          .query("bookingIdentities")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingIdentityPatientAssociations": {
        const result = await ctx.db
          .query("bookingIdentityPatientAssociations")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingLocationSteps": {
        const result = await ctx.db
          .query("bookingLocationSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingPatientStatusSteps": {
        const result = await ctx.db
          .query("bookingPatientStatusSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingPrivacySteps": {
        const result = await ctx.db
          .query("bookingPrivacySteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingSessions": {
        const result = await ctx.db
          .query("bookingSessions")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "legacyBookingBlocks": {
        const result = await ctx.db
          .query("legacyBookingBlocks")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
    }
  },
  returns: v.object({
    continueCursor: v.string(),
    count: v.number(),
    isDone: v.boolean(),
  }),
});

type InferLegacyBookingReplayRow = LegacyBookingReplayRowInput & {
  appointmentId: Id<"appointments">;
  appointmentTypeLineageKey: Id<"appointmentTypes">;
  locationLineageKey: Id<"locations">;
  patientId?: Id<"patients">;
  practitionerLineageKey: Id<"practitioners">;
  practitionerName: string;
  selectedSlot: {
    practitionerLineageKey: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
  };
};

interface LegacyBookingReplayRowInput {
  bookedDurationMinutes: number;
  createdAt: number;
  dataSharingContacts: {
    city: string;
    dateOfBirth: string;
    firstName: string;
    gender: "diverse" | "female" | "male";
    lastName: string;
    phoneNumber: string;
    postalCode: string;
    street: string;
    title?: string;
  }[];
  legacyAppointmentId: string;
  personalData: {
    city?: string;
    dateOfBirth: string;
    email?: string;
    firstName: string;
    gender?: "diverse" | "female" | "male";
    lastName: string;
    phoneNumber: string;
    postalCode?: string;
    street?: string;
    title?: string;
  };
  pvsAppointmentStart: string;
  pvsAppointmentTypeTitle: string;
  pvsPatientNumber: number;
  reasonDescription: string;
  source: "legacy-pocketbase" | "telefonki";
  sourceSessionKey: string;
  userAuthId: string;
  userEmail: string;
}

async function ensureImportedUser(
  ctx: MutationCtx,
  args: { authId: string; email: string; now: bigint },
): Promise<{ inserted: boolean; userId: Id<"users"> }> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", args.authId))
    .first();

  if (existing) {
    return { inserted: false, userId: existing._id };
  }

  const userId = await ctx.db.insert("users", {
    authId: args.authId,
    createdAt: args.now,
    email: args.email,
  });
  return { inserted: true, userId };
}

async function insertImportedExistingBookingSteps(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: InferLegacyBookingReplayRow;
    ruleSetId: Id<"ruleSets">;
    sessionId: Id<"bookingSessions">;
    timestamp: bigint;
    userId: Id<"users">;
  },
): Promise<void> {
  const base = {
    createdAt: args.timestamp,
    lastModified: args.timestamp,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    sessionId: args.sessionId,
    userId: args.userId,
  };
  const dataSharingContacts = args.replayRow.dataSharingContacts.map(
    (contact) => ({
      ...contact,
      userId: args.userId,
    }),
  );

  await ctx.db.insert("bookingPrivacySteps", {
    ...base,
    consent: true,
  });
  await ctx.db.insert("bookingLocationSteps", {
    ...base,
    locationLineageKey: args.replayRow.locationLineageKey,
  });
  await ctx.db.insert("bookingPatientStatusSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
  });
  await ctx.db.insert("bookingExistingDoctorSelectionSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
    practitionerLineageKey: args.replayRow.practitionerLineageKey,
  });
  await ctx.db.insert("bookingExistingPersonalDataSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
    personalData: args.replayRow.personalData,
    practitionerLineageKey: args.replayRow.practitionerLineageKey,
  });
  await ctx.db.insert("bookingExistingDataSharingSteps", {
    ...base,
    dataSharingContacts,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
    personalData: args.replayRow.personalData,
    practitionerLineageKey: args.replayRow.practitionerLineageKey,
  });
  await ctx.db.insert("bookingExistingCalendarSelectionSteps", {
    ...base,
    appointmentTypeLineageKey: args.replayRow.appointmentTypeLineageKey,
    dataSharingContacts,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
    personalData: args.replayRow.personalData,
    practitionerLineageKey: args.replayRow.practitionerLineageKey,
    reasonDescription: args.replayRow.reasonDescription,
    selectedSlot: args.replayRow.selectedSlot,
  });
  await ctx.db.insert("bookingExistingConfirmationSteps", {
    ...base,
    appointmentId: args.replayRow.appointmentId,
    appointmentTypeLineageKey: args.replayRow.appointmentTypeLineageKey,
    bookedDurationMinutes: args.replayRow.bookedDurationMinutes,
    dataSharingContacts,
    isNewPatient: false,
    locationLineageKey: args.replayRow.locationLineageKey,
    ...(args.replayRow.patientId === undefined
      ? {}
      : { patientId: args.replayRow.patientId }),
    personalData: args.replayRow.personalData,
    practitionerLineageKey: args.replayRow.practitionerLineageKey,
    reasonDescription: args.replayRow.reasonDescription,
    selectedSlot: args.replayRow.selectedSlot,
  });
}

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

async function resolveLegacyBookingReplayRow(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
  },
): Promise<InferLegacyBookingReplayRow | null> {
  const patient = await ctx.db
    .query("patients")
    .withIndex("by_practiceId_patientId", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .eq("patientId", args.replayRow.pvsPatientNumber),
    )
    .first();

  if (patient?.recordType !== "pvs") {
    return null;
  }

  const appointmentsAtStart = await ctx.db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .eq("start", args.replayRow.pvsAppointmentStart),
    )
    .collect();
  const appointment = appointmentsAtStart.find(
    (row) =>
      row.patientId === patient._id &&
      row.appointmentTypeTitle === args.replayRow.pvsAppointmentTypeTitle &&
      row.practitionerLineageKey !== undefined,
  );

  if (!appointment?.practitionerLineageKey) {
    return null;
  }

  const practitioner = await ctx.db.get(
    "practitioners",
    appointment.practitionerLineageKey,
  );

  if (!practitioner) {
    return null;
  }

  return {
    appointmentId: appointment._id,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    bookedDurationMinutes: args.replayRow.bookedDurationMinutes,
    createdAt: args.replayRow.createdAt,
    dataSharingContacts: args.replayRow.dataSharingContacts,
    legacyAppointmentId: args.replayRow.legacyAppointmentId,
    locationLineageKey: appointment.locationLineageKey,
    patientId: patient._id,
    personalData: args.replayRow.personalData,
    practitionerLineageKey: appointment.practitionerLineageKey,
    practitionerName: practitioner.name,
    pvsAppointmentStart: args.replayRow.pvsAppointmentStart,
    pvsAppointmentTypeTitle: args.replayRow.pvsAppointmentTypeTitle,
    pvsPatientNumber: args.replayRow.pvsPatientNumber,
    reasonDescription: args.replayRow.reasonDescription,
    selectedSlot: {
      practitionerLineageKey: appointment.practitionerLineageKey,
      practitionerName: practitioner.name,
      startTime: appointment.start,
    },
    source: args.replayRow.source,
    sourceSessionKey: args.replayRow.sourceSessionKey,
    userAuthId: args.replayRow.userAuthId,
    userEmail: args.replayRow.userEmail,
  };
}
