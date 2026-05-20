import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { getAppointmentPractitionerLineageKey } from "./appointmentOccupancy";
import {
  beihilfeStatusValidator,
  dataSharingContactInputValidator,
  hzvStatusValidator,
  insuranceTypeValidator,
  medicalHistoryValidator,
  personalDataValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
} from "./bookingValidators";
import { insertSelfLineageEntity } from "./lineage";
import {
  applyAppointmentHistoryPractitionerAssociation,
  canonicalizeBookingIdentityPractitionerAssociations,
  resolvePreferredPractitionerAssociation,
  setPractitionerAssociation,
} from "./practitionerAssociations";

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
  sourceSystem: v.union(
    v.literal("legacy-online"),
    v.literal("legacy-telefonki"),
  ),
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
  beihilfeStatus: v.optional(beihilfeStatusValidator),
  bookedDurationMinutes: v.optional(v.number()),
  createdAt: v.number(),
  dataSharingContacts: v.array(dataSharingContactInputValidator),
  hzvStatus: v.optional(hzvStatusValidator),
  insuranceType: v.optional(insuranceTypeValidator),
  legacyAppointmentId: v.optional(v.string()),
  locationName: v.optional(v.string()),
  medicalHistory: v.optional(medicalHistoryValidator),
  personalData: v.optional(personalDataValidator),
  pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
  pkvTariff: v.optional(pkvTariffValidator),
  practitionerName: v.optional(v.string()),
  pvsAppointmentStart: v.optional(v.string()),
  pvsAppointmentTypeTitle: v.optional(v.string()),
  pvsConsent: v.optional(v.literal(true)),
  pvsPatientNumber: v.optional(v.number()),
  reasonDescription: v.optional(v.string()),
  sessionStep: v.union(
    v.literal("privacy"),
    v.literal("location"),
    v.literal("patient-status"),
    v.literal("existing-doctor-selection"),
    v.literal("existing-data-input"),
    v.literal("existing-calendar-selection"),
    v.literal("existing-confirmation"),
    v.literal("new-insurance-type"),
    v.literal("new-gkv-details"),
    v.literal("new-pvs-consent"),
    v.literal("new-pkv-details"),
    v.literal("new-data-input"),
    v.literal("new-data-sharing"),
    v.literal("new-calendar-selection"),
    v.literal("new-confirmation"),
  ),
  source: v.literal("legacy-online"),
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

const pvsPatientPractitionerAssociationImportRowValidator = v.object({
  matchedAppointmentCount: v.number(),
  patientId: v.id("patients"),
  practitionerLineageKey: v.id("practitioners"),
});

const replayImportSkipReasonValidator = v.union(
  v.literal("missing_appointment"),
  v.literal("missing_location"),
  v.literal("missing_practitioner"),
);

const replayImportSkipRowValidator = v.object({
  legacyAppointmentId: v.optional(v.string()),
  locationName: v.optional(v.string()),
  practitionerName: v.optional(v.string()),
  pvsAppointmentStart: v.optional(v.string()),
  pvsAppointmentTypeTitle: v.optional(v.string()),
  pvsPatientNumber: v.optional(v.number()),
  reason: replayImportSkipReasonValidator,
  sessionStep: legacyBookingReplayRowValidator.fields.sessionStep,
  source: legacyBookingReplayRowValidator.fields.source,
  sourceSessionKey: v.string(),
  userAuthId: v.string(),
});

const practitionerAssociationDivergenceRowValidator = v.object({
  appointmentHistoryPractitionerLineageKey: v.id("practitioners"),
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  legacyAppointmentId: v.optional(v.string()),
  patientId: v.id("patients"),
  sourceSessionKey: v.string(),
  userAuthId: v.string(),
  winningPractitionerLineageKey: v.id("practitioners"),
});

async function ensureBookingIdentityImported(
  ctx: MutationCtx,
  args: {
    identity: Infer<typeof bookingIdentityImportRowValidator>;
    now: bigint;
    practiceId: Id<"practices">;
  },
): Promise<{ bookingIdentityId: Id<"bookingIdentities">; inserted: boolean }> {
  const existingIdentities = await ctx.db
    .query("bookingIdentities")
    .withIndex("by_sourceIdentity", (q) =>
      q
        .eq("sourceSystem", args.identity.sourceSystem)
        .eq("sourceIdentityId", args.identity.sourceIdentityId),
    )
    .collect();
  const existing = existingIdentities.find(
    (row) => row.practiceId === args.practiceId,
  );

  if (existing) {
    return { bookingIdentityId: existing._id, inserted: false };
  }

  const user =
    args.identity.userSourceId === undefined
      ? null
      : await ctx.db
          .query("users")
          .withIndex("by_authId", (q) =>
            q.eq("authId", `legacy-pocketbase:${args.identity.userSourceId}`),
          )
          .first();

  const bookingIdentityId = await ctx.db.insert("bookingIdentities", {
    ...(args.identity.dateOfBirth
      ? { dateOfBirth: args.identity.dateOfBirth }
      : {}),
    ...(args.identity.userEmail ? { email: args.identity.userEmail } : {}),
    ...(args.identity.firstName ? { firstName: args.identity.firstName } : {}),
    kind: args.identity.kind,
    lastModified: args.now,
    ...(args.identity.lastName ? { lastName: args.identity.lastName } : {}),
    createdAt: args.now,
    practiceId: args.practiceId,
    searchFirstName: normalizeSearch(
      args.identity.firstName,
      args.identity.lastName,
    ),
    searchLastName: normalizeSearch(
      args.identity.lastName,
      args.identity.firstName,
    ),
    sourceIdentityId: args.identity.sourceIdentityId,
    sourceSystem: args.identity.sourceSystem,
    ...(user ? { userId: user._id } : {}),
  });

  return { bookingIdentityId, inserted: true };
}

async function findLegacyOnlineBookingIdentityByUserAuthId(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    userAuthId: string;
  },
): Promise<Id<"bookingIdentities"> | undefined> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", args.userAuthId))
    .first();
  if (user === null) {
    return undefined;
  }

  const identities = await ctx.db
    .query("bookingIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .collect();

  return identities.find(
    (row) =>
      row.practiceId === args.practiceId &&
      row.sourceSystem === "legacy-online",
  )?._id;
}

function parseBookingIdentitySourceKey(sourceKey: string): {
  sourceIdentityId: string;
  sourceSystem: "legacy-online" | "legacy-telefonki";
} {
  const [sourceSystem, , ...identityParts] = sourceKey.split(":");
  const sourceIdentityId = identityParts.join(":");
  if (
    (sourceSystem !== "legacy-online" && sourceSystem !== "legacy-telefonki") ||
    sourceIdentityId.length === 0
  ) {
    throw new Error(`Unsupported booking identity source key: ${sourceKey}`);
  }
  return { sourceIdentityId, sourceSystem };
}

export const importBookingIdentities = mutation({
  args: {
    identities: v.array(bookingIdentityImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    let insertedIdentities = 0;
    let reusedIdentities = 0;

    for (const identity of args.identities) {
      const result = await ensureBookingIdentityImported(ctx, {
        identity,
        now,
        practiceId: args.practiceId,
      });
      if (result.inserted) {
        insertedIdentities += 1;
      } else {
        reusedIdentities += 1;
      }
    }

    return { insertedIdentities, reusedIdentities };
  },
  returns: v.object({
    insertedIdentities: v.number(),
    reusedIdentities: v.number(),
  }),
});

export const importBookingIdentityAssociations = mutation({
  args: {
    associations: v.array(bookingIdentityAssociationImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    let insertedAssociations = 0;
    let reusedAssociations = 0;
    let associatedPractitioners = 0;
    let skippedNoClearPractitioner = 0;
    let skippedMissingIdentity = 0;
    let skippedMissingPatient = 0;

    for (const association of args.associations) {
      const sourceIdentity = parseBookingIdentitySourceKey(
        association.bookingIdentitySourceKey,
      );
      const bookingIdentities = await ctx.db
        .query("bookingIdentities")
        .withIndex("by_sourceIdentity", (q) =>
          q
            .eq("sourceSystem", sourceIdentity.sourceSystem)
            .eq("sourceIdentityId", sourceIdentity.sourceIdentityId),
        )
        .collect();
      const bookingIdentity = bookingIdentities.find(
        (row) => row.practiceId === args.practiceId,
      );

      if (!bookingIdentity) {
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
          q.eq("bookingIdentityId", bookingIdentity._id).eq("status", "active"),
        )
        .collect();
      const existingAssociation = activeAssociations.find(
        (row) => row.patientId === patient._id,
      );

      if (existingAssociation) {
        await canonicalizeBookingIdentityPractitionerAssociations(ctx.db, {
          bookingIdentityId: bookingIdentity._id,
          now,
          patientId: patient._id,
          practiceId: args.practiceId,
          precedencePolicy: "import",
        });
        const practitionerAssociation =
          await applyAppointmentHistoryPractitionerAssociation(ctx.db, {
            bookingIdentityId: bookingIdentity._id,
            now,
            patientId: patient._id,
            practiceId: args.practiceId,
            precedencePolicy: "import",
          });
        if (
          practitionerAssociation.kind === "associated" ||
          practitionerAssociation.kind === "unchanged"
        ) {
          associatedPractitioners += 1;
        } else if (practitionerAssociation.kind === "no_clear_winner") {
          skippedNoClearPractitioner += 1;
        }
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
        bookingIdentityId: bookingIdentity._id,
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
      await canonicalizeBookingIdentityPractitionerAssociations(ctx.db, {
        bookingIdentityId: bookingIdentity._id,
        now,
        patientId: patient._id,
        practiceId: args.practiceId,
        precedencePolicy: "import",
      });
      const practitionerAssociation =
        await applyAppointmentHistoryPractitionerAssociation(ctx.db, {
          bookingIdentityId: bookingIdentity._id,
          now,
          patientId: patient._id,
          practiceId: args.practiceId,
          precedencePolicy: "import",
        });
      if (
        practitionerAssociation.kind === "associated" ||
        practitionerAssociation.kind === "unchanged"
      ) {
        associatedPractitioners += 1;
      } else if (practitionerAssociation.kind === "no_clear_winner") {
        skippedNoClearPractitioner += 1;
      }
      insertedAssociations += 1;
    }

    return {
      associatedPractitioners,
      insertedAssociations,
      reusedAssociations,
      skippedMissingIdentity,
      skippedMissingPatient,
      skippedNoClearPractitioner,
    };
  },
  returns: v.object({
    associatedPractitioners: v.number(),
    insertedAssociations: v.number(),
    reusedAssociations: v.number(),
    skippedMissingIdentity: v.number(),
    skippedMissingPatient: v.number(),
    skippedNoClearPractitioner: v.number(),
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

export const importPvsPatientPractitionerAssociations = mutation({
  args: {
    associations: v.array(pvsPatientPractitionerAssociationImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    const now = BigInt(Date.now());
    let importedAssociations = 0;
    let skippedMissingPatient = 0;

    for (const association of args.associations) {
      const patient = await ctx.db.get("patients", association.patientId);
      if (
        patient?.practiceId !== args.practiceId ||
        patient.recordType !== "pvs"
      ) {
        skippedMissingPatient += 1;
        continue;
      }

      const result = await setPractitionerAssociation(ctx.db, {
        evidence: {
          matchedAppointmentCount: association.matchedAppointmentCount,
        },
        now,
        patientId: association.patientId,
        practiceId: args.practiceId,
        practitionerLineageKey: association.practitionerLineageKey,
        precedencePolicy: "import",
        source: "appointment-history",
      });
      if (result.kind !== "rejected") {
        importedAssociations += 1;
      }
    }

    return { importedAssociations, skippedMissingPatient };
  },
  returns: v.object({
    importedAssociations: v.number(),
    skippedMissingPatient: v.number(),
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
        sourceSystem: "legacy-online",
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
    let associatedPractitioners = 0;
    let skippedMissingAppointment = 0;
    const skippedRows: Infer<typeof replayImportSkipRowValidator>[] = [];
    const practitionerAssociationDivergences: Infer<
      typeof practitionerAssociationDivergenceRowValidator
    >[] = [];

    for (const replayRow of args.replayRows) {
      const existingSession = await ctx.db
        .query("bookingSessions")
        .withIndex("by_practiceId_source_sourceSessionKey", (q) =>
          q
            .eq("practiceId", args.practiceId)
            .eq("source", replayRow.source)
            .eq("sourceSessionKey", replayRow.sourceSessionKey),
        )
        .first();

      if (existingSession) {
        reusedSessions += 1;
        continue;
      }

      const resolvedReplayContext = await resolveReplayContext(ctx, {
        practiceId: args.practiceId,
        replayRow,
        ruleSetId: args.ruleSetId,
      });
      if (resolvedReplayContext.kind === "skipped") {
        skippedMissingAppointment += 1;
        skippedRows.push({
          ...(replayRow.legacyAppointmentId === undefined
            ? {}
            : { legacyAppointmentId: replayRow.legacyAppointmentId }),
          ...(replayRow.locationName === undefined
            ? {}
            : { locationName: replayRow.locationName }),
          ...(replayRow.practitionerName === undefined
            ? {}
            : { practitionerName: replayRow.practitionerName }),
          ...(replayRow.pvsAppointmentStart === undefined
            ? {}
            : { pvsAppointmentStart: replayRow.pvsAppointmentStart }),
          ...(replayRow.pvsAppointmentTypeTitle === undefined
            ? {}
            : { pvsAppointmentTypeTitle: replayRow.pvsAppointmentTypeTitle }),
          ...(replayRow.pvsPatientNumber === undefined
            ? {}
            : { pvsPatientNumber: replayRow.pvsPatientNumber }),
          reason: resolvedReplayContext.reason,
          sessionStep: replayRow.sessionStep,
          source: replayRow.source,
          sourceSessionKey: replayRow.sourceSessionKey,
          userAuthId: replayRow.userAuthId,
        });
        continue;
      }

      const rowTimestamp = BigInt(replayRow.createdAt);
      const userResult = await ensureImportedUser(ctx, {
        authId: replayRow.userAuthId,
        email: replayRow.userEmail,
        now: rowTimestamp,
      });
      if (userResult.inserted) {
        insertedUsers += 1;
      } else {
        reusedUsers += 1;
      }

      if (resolvedReplayContext.context.practitionerLineageKey !== undefined) {
        const bookingIdentityId =
          await findLegacyOnlineBookingIdentityByUserAuthId(ctx, {
            practiceId: args.practiceId,
            userAuthId: replayRow.userAuthId,
          });
        const patientId = resolvedReplayContext.context.appointment?.patientId;
        if (bookingIdentityId !== undefined || patientId !== undefined) {
          if (patientId !== undefined) {
            const existingAssociation =
              await resolvePreferredPractitionerAssociation(ctx.db, {
                patientId,
                practiceId: args.practiceId,
              });
            if (
              existingAssociation !== null &&
              existingAssociation.source === "appointment-history" &&
              existingAssociation.practitionerLineageKey !==
                resolvedReplayContext.context.practitionerLineageKey
            ) {
              practitionerAssociationDivergences.push({
                appointmentHistoryPractitionerLineageKey:
                  existingAssociation.practitionerLineageKey,
                ...(bookingIdentityId === undefined
                  ? {}
                  : { bookingIdentityId }),
                ...(replayRow.legacyAppointmentId === undefined
                  ? {}
                  : { legacyAppointmentId: replayRow.legacyAppointmentId }),
                patientId,
                sourceSessionKey: replayRow.sourceSessionKey,
                userAuthId: replayRow.userAuthId,
                winningPractitionerLineageKey:
                  resolvedReplayContext.context.practitionerLineageKey,
              });
            }
          }
          const result = await setPractitionerAssociation(ctx.db, {
            ...(bookingIdentityId === undefined ? {} : { bookingIdentityId }),
            evidence: {
              ...(replayRow.legacyAppointmentId === undefined
                ? {}
                : { legacyAppointmentId: replayRow.legacyAppointmentId }),
              legacyIdentityId: replayRow.userAuthId,
              ...(replayRow.practitionerName === undefined
                ? {}
                : { legacyPractitionerName: replayRow.practitionerName }),
              sourceSessionKey: replayRow.sourceSessionKey,
            },
            now: rowTimestamp,
            ...(patientId === undefined ? {} : { patientId }),
            practiceId: args.practiceId,
            practitionerLineageKey:
              resolvedReplayContext.context.practitionerLineageKey,
            precedencePolicy: "import",
            source: "legacy-baumdiagramm",
          });
          if (result.kind !== "rejected") {
            associatedPractitioners += 1;
          }
        }
      }

      const sessionId = await ctx.db.insert("bookingSessions", {
        createdAt: rowTimestamp,
        expiresAt: rowTimestamp,
        lastModified: rowTimestamp,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
        source: replayRow.source,
        sourceSessionKey: replayRow.sourceSessionKey,
        state: { step: replayRow.sessionStep },
        status: "imported",
        userId: userResult.userId,
      });

      if (replayRow.sessionStep.startsWith("new-")) {
        await insertImportedNewReplaySteps(ctx, {
          practiceId: args.practiceId,
          replayRow,
          resolved: resolvedReplayContext.context,
          ruleSetId: args.ruleSetId,
          sessionId,
          timestamp: rowTimestamp,
          userId: userResult.userId,
        });
      } else {
        await insertImportedExistingReplaySteps(ctx, {
          practiceId: args.practiceId,
          replayRow,
          resolved: resolvedReplayContext.context,
          ruleSetId: args.ruleSetId,
          sessionId,
          timestamp: rowTimestamp,
          userId: userResult.userId,
        });
      }
      insertedSessions += 1;
    }

    return {
      associatedPractitioners,
      insertedSessions,
      insertedUsers,
      practitionerAssociationDivergences,
      reusedSessions,
      reusedUsers,
      skippedMissingAppointment,
      skippedRows,
    };
  },
  returns: v.object({
    associatedPractitioners: v.number(),
    insertedSessions: v.number(),
    insertedUsers: v.number(),
    practitionerAssociationDivergences: v.array(
      practitionerAssociationDivergenceRowValidator,
    ),
    reusedSessions: v.number(),
    reusedUsers: v.number(),
    skippedMissingAppointment: v.number(),
    skippedRows: v.array(replayImportSkipRowValidator),
  }),
});

export const countBookingIdentityAssociationImport = query({
  args: {},
  handler: async (ctx) => {
    assertMigrationRehearsalEnabled();

    const [bookingIdentities, associations, practitionerAssociations] =
      await Promise.all([
        ctx.db.query("bookingIdentities").collect(),
        ctx.db.query("bookingIdentityPatientAssociations").collect(),
        ctx.db.query("practitionerAssociations").collect(),
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
      practitionerAssociations: practitionerAssociations.length,
    };
  },
  returns: v.object({
    activeAssociations: v.number(),
    associations: v.number(),
    bookingIdentities: v.number(),
    legacyBookingBlocks: v.number(),
    legacyBookingSessions: v.number(),
    legacyUsers: v.number(),
    practitionerAssociations: v.number(),
  }),
});

const rehearsalCountTableNameValidator = v.union(
  v.literal("bookingSessions"),
  v.literal("bookingPrivacySteps"),
  v.literal("bookingLocationSteps"),
  v.literal("bookingPatientStatusSteps"),
  v.literal("bookingExistingDoctorSelectionSteps"),
  v.literal("bookingPersonalDataSteps"),
  v.literal("bookingCalendarSelectionSteps"),
  v.literal("bookingConfirmationSteps"),
  v.literal("bookingNewInsuranceTypeSteps"),
  v.literal("bookingNewGkvDetailSteps"),
  v.literal("bookingNewPkvConsentSteps"),
  v.literal("bookingNewPkvDetailSteps"),
  v.literal("bookingNewDataSharingSteps"),
  v.literal("bookingIdentities"),
  v.literal("bookingIdentityPatientAssociations"),
  v.literal("legacyBookingBlocks"),
  v.literal("practitionerAssociations"),
);

export const countRehearsalTablePage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tableName: rehearsalCountTableNameValidator,
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    switch (args.tableName) {
      case "bookingCalendarSelectionSteps": {
        const result = await ctx.db
          .query("bookingCalendarSelectionSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingConfirmationSteps": {
        const result = await ctx.db
          .query("bookingConfirmationSteps")
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
      case "bookingNewDataSharingSteps": {
        const result = await ctx.db
          .query("bookingNewDataSharingSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingNewGkvDetailSteps": {
        const result = await ctx.db
          .query("bookingNewGkvDetailSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingNewInsuranceTypeSteps": {
        const result = await ctx.db
          .query("bookingNewInsuranceTypeSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingNewPkvConsentSteps": {
        const result = await ctx.db
          .query("bookingNewPkvConsentSteps")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "bookingNewPkvDetailSteps": {
        const result = await ctx.db
          .query("bookingNewPkvDetailSteps")
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
      case "bookingPersonalDataSteps": {
        const result = await ctx.db
          .query("bookingPersonalDataSteps")
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
      case "practitionerAssociations": {
        const result = await ctx.db
          .query("practitionerAssociations")
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

export const countRehearsalTable = query({
  args: {
    tableName: rehearsalCountTableNameValidator,
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    switch (args.tableName) {
      case "bookingCalendarSelectionSteps": {
        const rows = await ctx.db
          .query("bookingCalendarSelectionSteps")
          .collect();
        return rows.length;
      }
      case "bookingConfirmationSteps": {
        const rows = await ctx.db.query("bookingConfirmationSteps").collect();
        return rows.length;
      }
      case "bookingExistingDoctorSelectionSteps": {
        const rows = await ctx.db
          .query("bookingExistingDoctorSelectionSteps")
          .collect();
        return rows.length;
      }
      case "bookingIdentities": {
        const rows = await ctx.db.query("bookingIdentities").collect();
        return rows.length;
      }
      case "bookingIdentityPatientAssociations": {
        const rows = await ctx.db
          .query("bookingIdentityPatientAssociations")
          .collect();
        return rows.length;
      }
      case "bookingLocationSteps": {
        const rows = await ctx.db.query("bookingLocationSteps").collect();
        return rows.length;
      }
      case "bookingNewDataSharingSteps": {
        const rows = await ctx.db.query("bookingNewDataSharingSteps").collect();
        return rows.length;
      }
      case "bookingNewGkvDetailSteps": {
        const rows = await ctx.db.query("bookingNewGkvDetailSteps").collect();
        return rows.length;
      }
      case "bookingNewInsuranceTypeSteps": {
        const rows = await ctx.db
          .query("bookingNewInsuranceTypeSteps")
          .collect();
        return rows.length;
      }
      case "bookingNewPkvConsentSteps": {
        const rows = await ctx.db.query("bookingNewPkvConsentSteps").collect();
        return rows.length;
      }
      case "bookingNewPkvDetailSteps": {
        const rows = await ctx.db.query("bookingNewPkvDetailSteps").collect();
        return rows.length;
      }
      case "bookingPatientStatusSteps": {
        const rows = await ctx.db.query("bookingPatientStatusSteps").collect();
        return rows.length;
      }
      case "bookingPersonalDataSteps": {
        const rows = await ctx.db.query("bookingPersonalDataSteps").collect();
        return rows.length;
      }
      case "bookingPrivacySteps": {
        const rows = await ctx.db.query("bookingPrivacySteps").collect();
        return rows.length;
      }
      case "bookingSessions": {
        const rows = await ctx.db.query("bookingSessions").collect();
        return rows.length;
      }
      case "legacyBookingBlocks": {
        const rows = await ctx.db.query("legacyBookingBlocks").collect();
        return rows.length;
      }
      case "practitionerAssociations": {
        const rows = await ctx.db.query("practitionerAssociations").collect();
        return rows.length;
      }
    }
  },
  returns: v.number(),
});

interface LegacyBookingReplayRowInput {
  beihilfeStatus?: "no" | "yes";
  bookedDurationMinutes?: number;
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
  hzvStatus?: "has-contract" | "interested" | "no-interest";
  insuranceType?: "gkv" | "pkv";
  legacyAppointmentId?: string;
  locationName?: string;
  medicalHistory?: {
    allergiesDescription?: string;
    currentMedications?: string;
    hasAllergies: boolean;
    hasDiabetes: boolean;
    hasHeartCondition: boolean;
    hasLungCondition: boolean;
    otherConditions?: string;
  };
  personalData?: {
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
  pkvInsuranceType?: "kvb" | "other" | "postb";
  pkvTariff?: "basis" | "premium" | "standard";
  practitionerName?: string;
  pvsAppointmentStart?: string;
  pvsAppointmentTypeTitle?: string;
  pvsConsent?: true;
  pvsPatientNumber?: number;
  reasonDescription?: string;
  sessionStep:
    | "existing-calendar-selection"
    | "existing-confirmation"
    | "existing-data-input"
    | "existing-doctor-selection"
    | "location"
    | "new-calendar-selection"
    | "new-confirmation"
    | "new-data-input"
    | "new-data-sharing"
    | "new-gkv-details"
    | "new-insurance-type"
    | "new-pkv-details"
    | "new-pvs-consent"
    | "patient-status"
    | "privacy";
  source: "legacy-online";
  sourceSessionKey: string;
  userAuthId: string;
  userEmail: string;
}

interface ResolvedReplayAppointment {
  appointmentId: Id<"appointments">;
  appointmentTypeLineageKey: Id<"appointmentTypes">;
  bookedDurationMinutes: number;
  locationLineageKey: Id<"locations">;
  patientId?: Id<"patients">;
  practitionerLineageKey: Id<"practitioners">;
  practitionerName: string;
  reasonDescription: string;
  selectedSlot: {
    practitionerLineageKey: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
  };
}

interface ResolvedReplayContext {
  appointment?: ResolvedReplayAppointment;
  locationLineageKey?: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
}

function addUserIdToContacts(
  contacts: LegacyBookingReplayRowInput["dataSharingContacts"],
  userId: Id<"users">,
) {
  return contacts.map((contact) => ({
    ...contact,
    userId,
  }));
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

function getReplayImportSkipReason(args: {
  appointment: null | ResolvedReplayAppointment;
  locationLineageKey: Id<"locations"> | undefined;
  practitionerLineageKey: Id<"practitioners"> | undefined;
  sessionStep: LegacyBookingReplayRowInput["sessionStep"];
}): Infer<typeof replayImportSkipReasonValidator> | null {
  if (
    replayStepRequiresLocation(args.sessionStep) &&
    args.locationLineageKey === undefined
  ) {
    return "missing_location";
  }

  if (
    replayStepRequiresPractitioner(args.sessionStep) &&
    args.practitionerLineageKey === undefined
  ) {
    return "missing_practitioner";
  }

  if (
    replayStepRequiresAppointment(args.sessionStep) &&
    args.appointment === null
  ) {
    return "missing_appointment";
  }

  return null;
}

async function insertImportedExistingReplaySteps(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
    resolved: ResolvedReplayContext;
    ruleSetId: Id<"ruleSets">;
    sessionId: Id<"bookingSessions">;
    timestamp: bigint;
    userId: Id<"users">;
  },
): Promise<void> {
  const locationLineageKey = args.resolved.locationLineageKey;
  const practitionerLineageKey =
    args.resolved.appointment?.practitionerLineageKey ??
    args.resolved.practitionerLineageKey;
  const appointment = args.resolved.appointment;
  const personalData = args.replayRow.personalData;

  const base = {
    createdAt: args.timestamp,
    lastModified: args.timestamp,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    sessionId: args.sessionId,
    userId: args.userId,
  };
  await ctx.db.insert("bookingPrivacySteps", {
    ...base,
    consent: true,
  });

  if (args.replayRow.sessionStep === "privacy") {
    return;
  }
  if (locationLineageKey === undefined) {
    return;
  }

  await ctx.db.insert("bookingLocationSteps", {
    ...base,
    locationLineageKey,
  });

  if (args.replayRow.sessionStep === "location") {
    return;
  }

  if (args.replayRow.sessionStep === "patient-status") {
    return;
  }

  await ctx.db.insert("bookingPatientStatusSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey,
  });
  if (practitionerLineageKey === undefined) {
    return;
  }

  await ctx.db.insert("bookingExistingDoctorSelectionSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey,
    practitionerLineageKey,
  });

  if (args.replayRow.sessionStep === "existing-doctor-selection") {
    return;
  }
  if (personalData === undefined) {
    return;
  }

  await ctx.db.insert("bookingPersonalDataSteps", {
    ...base,
    isNewPatient: false,
    locationLineageKey,
    personalData,
    practitionerLineageKey,
  });

  if (
    args.replayRow.sessionStep === "existing-data-input" ||
    args.replayRow.sessionStep === "existing-calendar-selection"
  ) {
    return;
  }
  if (!appointment) {
    return;
  }

  await ctx.db.insert("bookingCalendarSelectionSteps", {
    ...base,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    dataSharingContacts: [],
    isNewPatient: false,
    locationLineageKey,
    personalData,
    practitionerLineageKey,
    reasonDescription: appointment.reasonDescription,
    selectedSlot: appointment.selectedSlot,
  });
  await ctx.db.insert("bookingConfirmationSteps", {
    ...base,
    appointmentId: appointment.appointmentId,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    bookedDurationMinutes: appointment.bookedDurationMinutes,
    dataSharingContacts: [],
    isNewPatient: false,
    locationLineageKey,
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    personalData,
    practitionerLineageKey,
    reasonDescription: appointment.reasonDescription,
    selectedSlot: appointment.selectedSlot,
  });
}

async function insertImportedNewReplaySteps(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
    resolved: ResolvedReplayContext;
    ruleSetId: Id<"ruleSets">;
    sessionId: Id<"bookingSessions">;
    timestamp: bigint;
    userId: Id<"users">;
  },
): Promise<void> {
  const locationLineageKey = args.resolved.locationLineageKey;
  const appointment = args.resolved.appointment;
  const personalData = args.replayRow.personalData;

  const base = {
    createdAt: args.timestamp,
    lastModified: args.timestamp,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    sessionId: args.sessionId,
    userId: args.userId,
  };
  const dataSharingContacts = addUserIdToContacts(
    args.replayRow.dataSharingContacts,
    args.userId,
  );

  await ctx.db.insert("bookingPrivacySteps", {
    ...base,
    consent: true,
  });

  if (args.replayRow.sessionStep === "privacy") {
    return;
  }
  if (locationLineageKey === undefined) {
    return;
  }

  await ctx.db.insert("bookingLocationSteps", {
    ...base,
    locationLineageKey,
  });

  if (args.replayRow.sessionStep === "location") {
    return;
  }

  if (args.replayRow.sessionStep === "patient-status") {
    return;
  }

  await ctx.db.insert("bookingPatientStatusSteps", {
    ...base,
    isNewPatient: true,
    locationLineageKey,
  });

  if (args.replayRow.insuranceType === undefined) {
    return;
  }

  await ctx.db.insert("bookingNewInsuranceTypeSteps", {
    ...base,
    insuranceType: args.replayRow.insuranceType,
    isNewPatient: true,
    locationLineageKey,
  });

  if (args.replayRow.sessionStep === "new-insurance-type") {
    return;
  }

  if (args.replayRow.insuranceType === "gkv") {
    if (args.replayRow.hzvStatus === undefined) {
      return;
    }
    await ctx.db.insert("bookingNewGkvDetailSteps", {
      ...base,
      hzvStatus: args.replayRow.hzvStatus,
      insuranceType: "gkv",
      isNewPatient: true,
      locationLineageKey,
    });
    if (args.replayRow.sessionStep === "new-gkv-details") {
      return;
    }
  } else {
    if (args.replayRow.pvsConsent !== true) {
      return;
    }
    await ctx.db.insert("bookingNewPkvConsentSteps", {
      ...base,
      insuranceType: "pkv",
      isNewPatient: true,
      locationLineageKey,
      pvsConsent: true,
    });
    if (args.replayRow.sessionStep === "new-pvs-consent") {
      return;
    }
    await ctx.db.insert("bookingNewPkvDetailSteps", {
      ...base,
      ...(args.replayRow.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: args.replayRow.beihilfeStatus }),
      insuranceType: "pkv",
      isNewPatient: true,
      locationLineageKey,
      ...(args.replayRow.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
      ...(args.replayRow.pkvTariff === undefined
        ? {}
        : { pkvTariff: args.replayRow.pkvTariff }),
      pvsConsent: true,
    });
    if (args.replayRow.sessionStep === "new-pkv-details") {
      return;
    }
  }

  if (personalData === undefined) {
    return;
  }

  await ctx.db.insert("bookingPersonalDataSteps", {
    ...base,
    ...(args.replayRow.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: args.replayRow.beihilfeStatus }),
    ...(args.replayRow.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.replayRow.medicalHistory }),
    ...(args.replayRow.hzvStatus === undefined
      ? {}
      : { hzvStatus: args.replayRow.hzvStatus }),
    insuranceType: args.replayRow.insuranceType,
    isNewPatient: true,
    locationLineageKey,
    personalData,
    ...(args.replayRow.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
    ...(args.replayRow.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.replayRow.pkvTariff }),
    ...(args.replayRow.pvsConsent === true ? { pvsConsent: true } : {}),
  });

  if (args.replayRow.sessionStep === "new-data-input") {
    return;
  }

  if (args.replayRow.sessionStep === "new-data-sharing") {
    return;
  }

  await ctx.db.insert("bookingNewDataSharingSteps", {
    ...base,
    ...(args.replayRow.beihilfeStatus === undefined
      ? {}
      : { beihilfeStatus: args.replayRow.beihilfeStatus }),
    dataSharingContacts,
    ...(args.replayRow.hzvStatus === undefined
      ? {}
      : { hzvStatus: args.replayRow.hzvStatus }),
    insuranceType: args.replayRow.insuranceType,
    isNewPatient: true,
    locationLineageKey,
    ...(args.replayRow.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.replayRow.medicalHistory }),
    personalData,
    ...(args.replayRow.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
    ...(args.replayRow.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.replayRow.pkvTariff }),
    ...(args.replayRow.pvsConsent === true ? { pvsConsent: true } : {}),
  });

  if (args.replayRow.sessionStep === "new-calendar-selection") {
    return;
  }
  if (!appointment) {
    return;
  }

  await ctx.db.insert("bookingCalendarSelectionSteps", {
    ...base,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    dataSharingContacts,
    ...(args.replayRow.hzvStatus === undefined
      ? {}
      : { hzvStatus: args.replayRow.hzvStatus }),
    insuranceType: args.replayRow.insuranceType,
    isNewPatient: true,
    locationLineageKey,
    ...(args.replayRow.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.replayRow.medicalHistory }),
    personalData,
    ...(args.replayRow.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
    ...(args.replayRow.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.replayRow.pkvTariff }),
    ...(args.replayRow.pvsConsent === true ? { pvsConsent: true } : {}),
    reasonDescription: appointment.reasonDescription,
    selectedSlot: appointment.selectedSlot,
  });
  await ctx.db.insert("bookingConfirmationSteps", {
    ...base,
    appointmentId: appointment.appointmentId,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    bookedDurationMinutes: appointment.bookedDurationMinutes,
    dataSharingContacts,
    ...(args.replayRow.hzvStatus === undefined
      ? {}
      : { hzvStatus: args.replayRow.hzvStatus }),
    insuranceType: args.replayRow.insuranceType,
    isNewPatient: true,
    locationLineageKey,
    ...(args.replayRow.medicalHistory === undefined
      ? {}
      : { medicalHistory: args.replayRow.medicalHistory }),
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    personalData,
    ...(args.replayRow.pkvInsuranceType === undefined
      ? {}
      : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
    ...(args.replayRow.pkvTariff === undefined
      ? {}
      : { pkvTariff: args.replayRow.pkvTariff }),
    ...(args.replayRow.pvsConsent === true ? { pvsConsent: true } : {}),
    reasonDescription: appointment.reasonDescription,
    selectedSlot: appointment.selectedSlot,
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

function replayStepRequiresAppointment(
  step: LegacyBookingReplayRowInput["sessionStep"],
): boolean {
  return step === "existing-confirmation" || step === "new-confirmation";
}

function replayStepRequiresLocation(
  step: LegacyBookingReplayRowInput["sessionStep"],
): boolean {
  return step !== "privacy";
}

function replayStepRequiresPractitioner(
  step: LegacyBookingReplayRowInput["sessionStep"],
): boolean {
  return (
    step === "existing-data-input" ||
    step === "existing-calendar-selection" ||
    step === "existing-confirmation"
  );
}

async function resolveLocationLineageKey(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
  locationName: string | undefined,
): Promise<Id<"locations"> | undefined> {
  if (!locationName) {
    return undefined;
  }

  const location = await ctx.db
    .query("locations")
    .withIndex("by_ruleSetId_name", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("name", locationName),
    )
    .first();

  return location?.lineageKey;
}

async function resolvePractitionerLineageKey(
  ctx: MutationCtx,
  args: {
    practitionerName: string | undefined;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"practitioners"> | undefined> {
  if (!args.practitionerName) {
    return undefined;
  }
  const practitionerName = args.practitionerName;

  const exact = await ctx.db
    .query("practitioners")
    .withIndex("by_ruleSetId_name", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("name", practitionerName),
    )
    .first();
  if (exact?.lineageKey) {
    return exact.lineageKey;
  }
  return undefined;
}

async function resolveReplayAppointment(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
  },
): Promise<null | ResolvedReplayAppointment> {
  if (
    args.replayRow.bookedDurationMinutes === undefined ||
    args.replayRow.pvsAppointmentStart === undefined ||
    args.replayRow.pvsAppointmentTypeTitle === undefined ||
    args.replayRow.pvsPatientNumber === undefined ||
    args.replayRow.reasonDescription === undefined
  ) {
    return null;
  }
  const pvsPatientNumber = args.replayRow.pvsPatientNumber;
  const pvsAppointmentStart = args.replayRow.pvsAppointmentStart;

  const patient = await ctx.db
    .query("patients")
    .withIndex("by_practiceId_patientId", (q) =>
      q.eq("practiceId", args.practiceId).eq("patientId", pvsPatientNumber),
    )
    .first();

  if (patient?.recordType !== "pvs") {
    return null;
  }

  const appointmentsAtStart = await ctx.db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q.eq("practiceId", args.practiceId).eq("start", pvsAppointmentStart),
    )
    .collect();
  const appointment = appointmentsAtStart.find(
    (row) =>
      row.patientId === patient._id &&
      row.appointmentTypeTitle === args.replayRow.pvsAppointmentTypeTitle &&
      getAppointmentPractitionerLineageKey(row.occupancyScope) !== undefined,
  );

  const practitionerLineageKey =
    appointment === undefined
      ? undefined
      : getAppointmentPractitionerLineageKey(appointment.occupancyScope);
  if (!appointment || !practitionerLineageKey) {
    return null;
  }

  const practitioner = await ctx.db.get(
    "practitioners",
    practitionerLineageKey,
  );

  if (!practitioner) {
    return null;
  }

  return {
    appointmentId: appointment._id,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    bookedDurationMinutes: args.replayRow.bookedDurationMinutes,
    locationLineageKey: appointment.locationLineageKey,
    patientId: patient._id,
    practitionerLineageKey,
    practitionerName: practitioner.name,
    reasonDescription: args.replayRow.reasonDescription,
    selectedSlot: {
      practitionerLineageKey,
      practitionerName: practitioner.name,
      startTime: appointment.start,
    },
  };
}

async function resolveReplayContext(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<
  | { context: ResolvedReplayContext; kind: "resolved" }
  | {
      kind: "skipped";
      reason:
        | "missing_appointment"
        | "missing_location"
        | "missing_practitioner";
    }
> {
  const appointment = await resolveReplayAppointment(ctx, {
    practiceId: args.practiceId,
    replayRow: args.replayRow,
  });
  const locationLineageKey =
    appointment?.locationLineageKey ??
    (await resolveLocationLineageKey(
      ctx,
      args.ruleSetId,
      args.replayRow.locationName,
    ));

  const practitionerLineageKey =
    appointment?.practitionerLineageKey ??
    (await resolvePractitionerLineageKey(ctx, {
      practitionerName: args.replayRow.practitionerName,
      ruleSetId: args.ruleSetId,
    }));

  const preflightSkipReason = getReplayImportSkipReason({
    appointment,
    locationLineageKey,
    practitionerLineageKey,
    sessionStep: args.replayRow.sessionStep,
  });
  if (preflightSkipReason !== null) {
    return { kind: "skipped", reason: preflightSkipReason };
  }

  return {
    context: {
      ...(appointment === null ? {} : { appointment }),
      ...(locationLineageKey === undefined ? {} : { locationLineageKey }),
      ...(practitionerLineageKey === undefined
        ? {}
        : { practitionerLineageKey }),
    },
    kind: "resolved",
  };
}
