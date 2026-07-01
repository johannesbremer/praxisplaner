import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";

import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server";
import { resolveActivePvsPatientIdForBookingIdentity } from "./bookingIdentities";
import {
  beihilfeStatusValidator,
  dataSharingContactInputValidator,
  hzvStatusValidator,
  insuranceTypeValidator,
  legacyMedicalHistorySnapshotValidator,
  personalDataValidator,
  pkvInsuranceTypeValidator,
  pkvTariffValidator,
} from "./bookingValidators";
import { insertSelfLineageEntity } from "./lineage";
import {
  requireManagerRuleSetScope,
  requirePracticeManager,
} from "./practiceAccess";
import {
  applyAppointmentHistoryPractitionerAssociation,
  canonicalizeBookingIdentityPractitionerAssociations,
  resolvePreferredPractitionerAssociation,
  setPractitionerAssociation,
} from "./practitionerAssociations";

const legacyMissingOnlineBookingPractitionerName = "Dr. Verena Meyer zu Hörste";

function assertMigrationRehearsalEnabled(): void {
  if (process.env["MIGRATION_REHEARSAL_ENABLED"] !== "true") {
    throw new Error(
      "Migration rehearsal mutations are disabled. Set MIGRATION_REHEARSAL_ENABLED=true on a local deployment.",
    );
  }
}

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
    await requireManagerRuleSetScope(ctx, args.ruleSetId);

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

    await Promise.all(
      baseSchedules.map((row) => ctx.db.delete("baseSchedules", row._id)),
    );

    const practitionerLineageKeys: Id<"practitioners">[] = [];
    const usedPractitionerIds = new Set<Id<"practitioners">>();
    const practitionerByName = new Map(
      practitioners.map((practitioner) => [practitioner.name, practitioner]),
    );
    for (const name of args.practitioners) {
      const existingPractitioner = practitionerByName.get(name);
      const practitionerId =
        existingPractitioner?._id ??
        (await insertSelfLineageEntity(ctx.db, "practitioners", {
          name,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        }));
      await ctx.db.patch("practitioners", practitionerId, {
        deleted: false,
        name,
        parentId: practitionerId,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      });
      usedPractitionerIds.add(practitionerId);
      practitionerLineageKeys.push(practitionerId);
    }
    await Promise.all(
      practitioners
        .filter((row) => !usedPractitionerIds.has(row._id))
        .map((row) =>
          ctx.db.patch("practitioners", row._id, { deleted: true }),
        ),
    );

    const locationIds: Id<"locations">[] = [];
    const usedLocationIds = new Set<Id<"locations">>();
    const locationByName = new Map(
      locations.map((location) => [location.name, location]),
    );
    for (const name of args.locations) {
      const existingLocation = locationByName.get(name);
      const locationId =
        existingLocation?._id ??
        (await insertSelfLineageEntity(ctx.db, "locations", {
          name,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        }));
      await ctx.db.patch("locations", locationId, {
        deleted: false,
        name,
        parentId: locationId,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      });
      usedLocationIds.add(locationId);
      locationIds.push(locationId);
    }
    await Promise.all(
      locations
        .filter((row) => !usedLocationIds.has(row._id))
        .map((row) => ctx.db.patch("locations", row._id, { deleted: true })),
    );

    const now = BigInt(Date.now());
    const appointmentTypeIds: Id<"appointmentTypes">[] = [];
    const usedAppointmentTypeIds = new Set<Id<"appointmentTypes">>();
    const appointmentTypeByName = new Map(
      appointmentTypes.map((appointmentType) => [
        appointmentType.name,
        appointmentType,
      ]),
    );
    for (const appointmentType of args.appointmentTypes) {
      const existingAppointmentType = appointmentTypeByName.get(
        appointmentType.name,
      );
      const appointmentTypeId =
        existingAppointmentType?._id ??
        (await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
          allowedPractitionerLineageKeys: practitionerLineageKeys,
          appointmentPlan: { steps: [] },
          createdAt: now,
          defaultOccupancy: { kind: "selectedPractitioner" },
          duration: appointmentType.duration,
          lastModified: now,
          name: appointmentType.name,
          practiceId: args.practiceId,
          ruleSetId: args.ruleSetId,
        }));
      await ctx.db.patch("appointmentTypes", appointmentTypeId, {
        allowedPractitionerLineageKeys: practitionerLineageKeys,
        appointmentPlan: { steps: [] },
        defaultOccupancy: { kind: "selectedPractitioner" },
        deleted: false,
        duration: appointmentType.duration,
        lastModified: now,
        name: appointmentType.name,
        parentId: appointmentTypeId,
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      });
      usedAppointmentTypeIds.add(appointmentTypeId);
      appointmentTypeIds.push(appointmentTypeId);
    }
    await Promise.all(
      appointmentTypes
        .filter((row) => !usedAppointmentTypeIds.has(row._id))
        .map((row) =>
          ctx.db.patch("appointmentTypes", row._id, { deleted: true }),
        ),
    );

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
    await requirePracticeManager(ctx, args.practiceId);

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
    await requireManagerRuleSetScope(ctx, args.ruleSetId);

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
  createdAt: v.number(),
  dataSharingContacts: v.array(dataSharingContactInputValidator),
  hzvStatus: v.optional(hzvStatusValidator),
  insuranceType: v.optional(insuranceTypeValidator),
  locationName: v.optional(v.string()),
  medicalHistory: v.optional(legacyMedicalHistorySnapshotValidator),
  medicalHistoryComplete: v.optional(v.boolean()),
  personalData: v.optional(personalDataValidator),
  pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
  pkvTariff: v.optional(pkvTariffValidator),
  practitionerName: v.optional(v.string()),
  pvsConsent: v.optional(v.literal(true)),
  sessionStep: v.union(
    v.literal("privacy"),
    v.literal("location"),
    v.literal("patient-status"),
    v.literal("existing-doctor-selection"),
    v.literal("existing-data-input"),
    v.literal("existing-calendar-selection"),
    v.literal("new-insurance-type"),
    v.literal("new-gkv-details"),
    v.literal("new-pvs-consent"),
    v.literal("new-pkv-details"),
    v.literal("new-data-input"),
    v.literal("new-data-sharing"),
    v.literal("new-calendar-selection"),
  ),
  source: v.literal("legacy-online"),
  sourceSessionKey: v.string(),
  userAuthId: v.string(),
  userEmail: v.string(),
});

const legacyUnmatchedFutureBookingHoldImportRowValidator = v.object({
  createdAt: v.number(),
  end: v.string(),
  legacyAppointmentId: v.string(),
  legacyType: v.optional(v.string()),
  locationName: v.optional(v.string()),
  practitionerName: v.optional(v.string()),
  start: v.string(),
  userAuthId: v.string(),
  userEmail: v.string(),
});

const bookingIdentityAssociationImportRowValidator = v.object({
  associationKey: v.string(),
  bookingIdentitySourceKey: v.string(),
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
  v.literal("missing_location"),
  v.literal("missing_practitioner"),
);

const replayImportSkipRowValidator = v.object({
  locationName: v.optional(v.string()),
  practitionerName: v.optional(v.string()),
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
    createdAt: args.now,
    kind: args.identity.kind,
    lastModified: args.now,
    practiceId: args.practiceId,
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
    await requirePracticeManager(ctx, args.practiceId);

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
    await requirePracticeManager(ctx, args.practiceId);

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
      const existingAssociation = activeAssociations.some(
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

export const importLegacyUsers = internalMutation({
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
    await requirePracticeManager(ctx, args.practiceId);

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
    await requirePracticeManager(ctx, args.practiceId);

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
        .query("onlineAccountBlocks")
        .withIndex("by_userId_practiceId", (q) =>
          q.eq("userId", userResult.userId).eq("practiceId", args.practiceId),
        )
        .first();

      if (existing) {
        reusedBlocks += 1;
        continue;
      }

      await ctx.db.insert("onlineAccountBlocks", {
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
    await requirePracticeManager(ctx, args.practiceId);

    let insertedSessions = 0;
    let reusedSessions = 0;
    let insertedUsers = 0;
    let reusedUsers = 0;
    let associatedPractitioners = 0;
    let rejectedBaumdiagramPractitionerOverwrites = 0;
    const skippedRows: Infer<typeof replayImportSkipRowValidator>[] = [];
    const practitionerAssociationDivergences: Infer<
      typeof practitionerAssociationDivergenceRowValidator
    >[] = [];

    for (const replayRow of args.replayRows) {
      const resolvedReplayContext = await resolveReplayContext(ctx, {
        practiceId: args.practiceId,
        replayRow,
        ruleSetId: args.ruleSetId,
      });
      if (resolvedReplayContext.kind === "skipped") {
        skippedRows.push({
          ...(replayRow.locationName === undefined
            ? {}
            : { locationName: replayRow.locationName }),
          ...(replayRow.practitionerName === undefined
            ? {}
            : { practitionerName: replayRow.practitionerName }),
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

      const existingPrivacyStep = await ctx.db
        .query("bookingPrivacySteps")
        .withIndex("by_userId_practiceId_ruleSetId", (q) =>
          q
            .eq("userId", userResult.userId)
            .eq("practiceId", args.practiceId)
            .eq("ruleSetId", args.ruleSetId),
        )
        .first();
      if (existingPrivacyStep) {
        reusedSessions += 1;
        continue;
      }

      if (resolvedReplayContext.context.practitionerLineageKey !== undefined) {
        const bookingIdentityId =
          await findLegacyOnlineBookingIdentityByUserAuthId(ctx, {
            practiceId: args.practiceId,
            userAuthId: replayRow.userAuthId,
          });
        const patientId =
          (bookingIdentityId === undefined
            ? null
            : await resolveActivePvsPatientIdForBookingIdentity(
                ctx.db,
                bookingIdentityId,
              )) ?? undefined;
        if (bookingIdentityId !== undefined || patientId !== undefined) {
          let precedencePolicy: "import" | "runtime" = "import";
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
              const existingPractitioner = await ctx.db.get(
                "practitioners",
                existingAssociation.practitionerLineageKey,
              );
              if (
                existingPractitioner?.name ===
                legacyMissingOnlineBookingPractitionerName
              ) {
                practitionerAssociationDivergences.push({
                  appointmentHistoryPractitionerLineageKey:
                    existingAssociation.practitionerLineageKey,
                  ...(bookingIdentityId === undefined
                    ? {}
                    : { bookingIdentityId }),
                  patientId,
                  sourceSessionKey: replayRow.sourceSessionKey,
                  userAuthId: replayRow.userAuthId,
                  winningPractitionerLineageKey:
                    resolvedReplayContext.context.practitionerLineageKey,
                });
                precedencePolicy = "runtime";
                rejectedBaumdiagramPractitionerOverwrites += 1;
              }
            }
          }
          const result = await setPractitionerAssociation(ctx.db, {
            ...(bookingIdentityId === undefined ? {} : { bookingIdentityId }),
            now: rowTimestamp,
            ...(patientId === undefined ? {} : { patientId }),
            practiceId: args.practiceId,
            practitionerLineageKey:
              resolvedReplayContext.context.practitionerLineageKey,
            precedencePolicy,
            source: "legacy-baumdiagramm",
          });
          if (result.kind !== "rejected") {
            associatedPractitioners += 1;
          }
        }
      }

      if (replayRow.sessionStep.startsWith("new-")) {
        await insertImportedNewReplaySteps(ctx, {
          practiceId: args.practiceId,
          replayRow,
          resolved: resolvedReplayContext.context,
          ruleSetId: args.ruleSetId,
          timestamp: rowTimestamp,
          userId: userResult.userId,
        });
      } else {
        await insertImportedExistingReplaySteps(ctx, {
          practiceId: args.practiceId,
          replayRow,
          resolved: resolvedReplayContext.context,
          ruleSetId: args.ruleSetId,
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
      rejectedBaumdiagramPractitionerOverwrites,
      reusedSessions,
      reusedUsers,
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
    rejectedBaumdiagramPractitionerOverwrites: v.number(),
    reusedSessions: v.number(),
    reusedUsers: v.number(),
    skippedRows: v.array(replayImportSkipRowValidator),
  }),
});

export const importLegacyUnmatchedFutureBookingHolds = mutation({
  args: {
    holds: v.array(legacyUnmatchedFutureBookingHoldImportRowValidator),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();
    await requirePracticeManager(ctx, args.practiceId);

    let insertedHolds = 0;
    let insertedUsers = 0;
    let reusedHolds = 0;
    let reusedUsers = 0;

    for (const hold of args.holds) {
      const existingHold = await ctx.db
        .query("legacyUnmatchedFutureBookingHolds")
        .withIndex("by_practiceId_legacyAppointmentId", (q) =>
          q
            .eq("practiceId", args.practiceId)
            .eq("legacyAppointmentId", hold.legacyAppointmentId),
        )
        .first();

      if (existingHold) {
        reusedHolds += 1;
        continue;
      }

      const rowTimestamp = BigInt(hold.createdAt);
      const userResult = await ensureImportedUser(ctx, {
        authId: hold.userAuthId,
        email: hold.userEmail,
        now: rowTimestamp,
      });
      if (userResult.inserted) {
        insertedUsers += 1;
      } else {
        reusedUsers += 1;
      }

      await ctx.db.insert("legacyUnmatchedFutureBookingHolds", {
        createdAt: rowTimestamp,
        end: hold.end,
        lastModified: rowTimestamp,
        legacyAppointmentId: hold.legacyAppointmentId,
        ...(hold.legacyType === undefined
          ? {}
          : { legacyType: hold.legacyType }),
        ...(hold.locationName === undefined
          ? {}
          : { locationName: hold.locationName }),
        practiceId: args.practiceId,
        ...(hold.practitionerName === undefined
          ? {}
          : { practitionerName: hold.practitionerName }),
        start: hold.start,
        userId: userResult.userId,
      });
      insertedHolds += 1;
    }

    return {
      insertedHolds,
      insertedUsers,
      reusedHolds,
      reusedUsers,
    };
  },
  returns: v.object({
    insertedHolds: v.number(),
    insertedUsers: v.number(),
    reusedHolds: v.number(),
    reusedUsers: v.number(),
  }),
});

export const countBookingIdentityAssociationImport = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertMigrationRehearsalEnabled();

    const [bookingIdentities, associations, practitionerAssociations] =
      await Promise.all([
        ctx.db.query("bookingIdentities").collect(),
        ctx.db.query("bookingIdentityPatientAssociations").collect(),
        ctx.db.query("practitionerAssociations").collect(),
      ]);
    const [bookingBlocks, unresolvedLegacyHolds] = await Promise.all([
      ctx.db.query("onlineAccountBlocks").collect(),
      ctx.db.query("legacyUnmatchedFutureBookingHolds").collect(),
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
      legacyUnmatchedFutureBookingHolds: unresolvedLegacyHolds.length,
      legacyUsers: legacyUsers.length,
      onlineAccountBlocks: bookingBlocks.length,
      practitionerAssociations: practitionerAssociations.length,
    };
  },
  returns: v.object({
    activeAssociations: v.number(),
    associations: v.number(),
    bookingIdentities: v.number(),
    legacyUnmatchedFutureBookingHolds: v.number(),
    legacyUsers: v.number(),
    onlineAccountBlocks: v.number(),
    practitionerAssociations: v.number(),
  }),
});

export const getRehearsalDiagnostics = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertMigrationRehearsalEnabled();

    const [
      bookingIdentityPatientAssociations,
      bookingNewInsuranceTypeSteps,
      practitionerAssociations,
    ] = await Promise.all([
      ctx.db.query("bookingIdentityPatientAssociations").collect(),
      ctx.db.query("bookingNewInsuranceTypeSteps").collect(),
      ctx.db.query("practitionerAssociations").collect(),
    ]);

    const insuranceTypeCounts = { gkv: 0, pkv: 0 };
    for (const row of bookingNewInsuranceTypeSteps) {
      insuranceTypeCounts[row.insuranceType] += 1;
    }
    const practitionerAssociationsWithoutPatientId =
      practitionerAssociations.filter((row) => row.patientId === undefined);
    const activePatientAssociationByBookingIdentityId = new Map(
      bookingIdentityPatientAssociations
        .filter((row) => row.status === "active")
        .map((row) => [row.bookingIdentityId, row.patientId]),
    );
    const resolvablePractitionerAssociationsWithoutPatientId =
      practitionerAssociationsWithoutPatientId.filter(
        (row) =>
          row.bookingIdentityId !== undefined &&
          activePatientAssociationByBookingIdentityId.has(
            row.bookingIdentityId,
          ),
      );

    return {
      bookingNewInsuranceTypeCounts: insuranceTypeCounts,
      practitionerAssociationsWithoutPatientId:
        practitionerAssociationsWithoutPatientId.length,
      practitionerAssociationsWithoutPatientIdBySource:
        countPractitionerAssociationsBySource(
          practitionerAssociationsWithoutPatientId,
        ),
      resolvablePractitionerAssociationsWithoutPatientId:
        resolvablePractitionerAssociationsWithoutPatientId.length,
    };
  },
  returns: v.object({
    bookingNewInsuranceTypeCounts: v.object({
      gkv: v.number(),
      pkv: v.number(),
    }),
    practitionerAssociationsWithoutPatientId: v.number(),
    practitionerAssociationsWithoutPatientIdBySource: v.object({
      appointmentHistory: v.number(),
      legacyBaumdiagramm: v.number(),
      manual: v.number(),
    }),
    resolvablePractitionerAssociationsWithoutPatientId: v.number(),
  }),
});

function countPractitionerAssociationsBySource(
  rows: Doc<"practitionerAssociations">[],
) {
  const counts = {
    appointmentHistory: 0,
    legacyBaumdiagramm: 0,
    manual: 0,
  };
  for (const row of rows) {
    if (row.source === "appointment-history") {
      counts.appointmentHistory += 1;
    } else if (row.source === "legacy-baumdiagramm") {
      counts.legacyBaumdiagramm += 1;
    } else {
      counts.manual += 1;
    }
  }
  return counts;
}

const rehearsalCountTableNameValidator = v.union(
  v.literal("bookingPrivacySteps"),
  v.literal("bookingLocationSteps"),
  v.literal("bookingPatientStatusSteps"),
  v.literal("bookingExistingDoctorSelectionSteps"),
  v.literal("bookingPersonalDataSteps"),
  v.literal("bookingNewInsuranceTypeSteps"),
  v.literal("bookingNewGkvDetailSteps"),
  v.literal("bookingNewPkvConsentSteps"),
  v.literal("bookingNewPkvDetailSteps"),
  v.literal("bookingNewDataSharingSteps"),
  v.literal("bookingIdentities"),
  v.literal("bookingIdentityPatientAssociations"),
  v.literal("onlineAccountBlocks"),
  v.literal("legacyUnmatchedFutureBookingHolds"),
  v.literal("practitionerAssociations"),
);

export const countRehearsalTablePage = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    tableName: rehearsalCountTableNameValidator,
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    switch (args.tableName) {
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
      case "legacyUnmatchedFutureBookingHolds": {
        const result = await ctx.db
          .query("legacyUnmatchedFutureBookingHolds")
          .paginate(args.paginationOpts);
        return {
          continueCursor: result.continueCursor,
          count: result.page.length,
          isDone: result.isDone,
        };
      }
      case "onlineAccountBlocks": {
        const result = await ctx.db
          .query("onlineAccountBlocks")
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

export const countRehearsalTable = internalQuery({
  args: {
    tableName: rehearsalCountTableNameValidator,
  },
  handler: async (ctx, args) => {
    assertMigrationRehearsalEnabled();

    switch (args.tableName) {
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
      case "legacyUnmatchedFutureBookingHolds": {
        const rows = await ctx.db
          .query("legacyUnmatchedFutureBookingHolds")
          .collect();
        return rows.length;
      }
      case "onlineAccountBlocks": {
        const rows = await ctx.db.query("onlineAccountBlocks").collect();
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
  locationName?: string;
  medicalHistory?: {
    allergyNotes?: string;
    currentMedications?: string;
    hasAllergies: boolean;
    hasCancer: boolean;
    hasCirculationDisorder: boolean;
    hasDepression: boolean;
    hasDiabetes: boolean;
    hasGout: boolean;
    hasHeartCondition: boolean;
    hasHypertension: boolean;
    hasIntolerance: boolean;
    hasKidneyCondition: boolean;
    hasLipidDisorder: boolean;
    hasLiverCondition: boolean;
    hasLungCondition: boolean;
    hasOperations: boolean;
    hasSymptoms: boolean;
    hasThyroidCondition: boolean;
    hasVaricoseVeins: boolean;
    intoleranceNotes?: string;
    medicationNotes?: string;
    noAdditionalDetails: boolean;
    noKnownConditions: boolean;
    operationNotes?: string;
    otherConditionNotes?: string;
    smokes: boolean;
    symptomNotes?: string;
    takesMedication: boolean;
  };
  medicalHistoryComplete?: boolean;
  personalData?: {
    city: string;
    dateOfBirth: string;
    email: string;
    firstName: string;
    gender: "diverse" | "female" | "male";
    lastName: string;
    phoneNumber: string;
    postalCode: string;
    street: string;
    title?: string;
  };
  pkvInsuranceType?: "kvb" | "other" | "postb";
  pkvTariff?: "basis" | "premium" | "standard";
  practitionerName?: string;
  pvsConsent?: true;
  sessionStep:
    | "existing-calendar-selection"
    | "existing-data-input"
    | "existing-doctor-selection"
    | "location"
    | "new-calendar-selection"
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

interface ResolvedReplayContext {
  locationLineageKey?: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
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

  return null;
}

async function insertImportedExistingReplaySteps(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
    resolved: ResolvedReplayContext;
    ruleSetId: Id<"ruleSets">;
    timestamp: bigint;
    userId: Id<"users">;
  },
): Promise<void> {
  const locationLineageKey = args.resolved.locationLineageKey;
  const practitionerLineageKey = args.resolved.practitionerLineageKey;
  const personalData = args.replayRow.personalData;

  const base = {
    createdAt: args.timestamp,
    lastModified: args.timestamp,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    userId: args.userId,
  };
  await ctx.db.insert("bookingPrivacySteps", {
    ...base,
    consent: args.replayRow.sessionStep !== "privacy",
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
  });

  if (personalData !== undefined) {
    await ctx.db.insert("bookingPersonalDataSteps", {
      ...base,
      city: personalData.city,
      dateOfBirth: personalData.dateOfBirth,
      email: personalData.email,
      firstName: personalData.firstName,
      gender: personalData.gender,
      lastName: personalData.lastName,
      phoneNumber: personalData.phoneNumber,
      postalCode: personalData.postalCode,
      street: personalData.street,
      ...(personalData.title === undefined
        ? {}
        : { title: personalData.title }),
    });
  }

  if (practitionerLineageKey === undefined) {
    return;
  }

  await ctx.db.insert("bookingExistingDoctorSelectionSteps", {
    ...base,
    practitionerLineageKey,
  });

  if (args.replayRow.sessionStep === "existing-doctor-selection") {
    return;
  }
  if (args.replayRow.sessionStep === "existing-data-input") {
    return;
  }

  if (args.replayRow.sessionStep === "existing-calendar-selection") {
    return;
  }
}

async function insertImportedNewReplaySteps(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    replayRow: LegacyBookingReplayRowInput;
    resolved: ResolvedReplayContext;
    ruleSetId: Id<"ruleSets">;
    timestamp: bigint;
    userId: Id<"users">;
  },
): Promise<void> {
  const locationLineageKey = args.resolved.locationLineageKey;
  const personalData = args.replayRow.personalData;

  const base = {
    createdAt: args.timestamp,
    lastModified: args.timestamp,
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
    userId: args.userId,
  };

  await ctx.db.insert("bookingPrivacySteps", {
    ...base,
    consent: args.replayRow.sessionStep !== "privacy",
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
  });

  if (args.replayRow.insuranceType === undefined) {
    return;
  }

  await ctx.db.insert("bookingNewInsuranceTypeSteps", {
    ...base,
    insuranceType: args.replayRow.insuranceType,
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
    });
    if (args.replayRow.sessionStep === "new-pvs-consent") {
      return;
    }
    await ctx.db.insert("bookingNewPkvDetailSteps", {
      ...base,
      ...(args.replayRow.beihilfeStatus === undefined
        ? {}
        : { beihilfeStatus: args.replayRow.beihilfeStatus }),
      ...(args.replayRow.pkvInsuranceType === undefined
        ? {}
        : { pkvInsuranceType: args.replayRow.pkvInsuranceType }),
      ...(args.replayRow.pkvTariff === undefined
        ? {}
        : { pkvTariff: args.replayRow.pkvTariff }),
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
    city: personalData.city,
    dateOfBirth: personalData.dateOfBirth,
    email: personalData.email,
    firstName: personalData.firstName,
    gender: personalData.gender,
    lastName: personalData.lastName,
    phoneNumber: personalData.phoneNumber,
    postalCode: personalData.postalCode,
    street: personalData.street,
    ...(personalData.title === undefined ? {} : { title: personalData.title }),
  });

  if (args.replayRow.medicalHistory !== undefined) {
    await ctx.db.insert("bookingMedicalHistoryEntries", {
      ...base,
      ...(args.replayRow.medicalHistory.allergyNotes === undefined
        ? {}
        : { allergyNotes: args.replayRow.medicalHistory.allergyNotes }),
      hasAllergies: args.replayRow.medicalHistory.hasAllergies,
      hasCancer: args.replayRow.medicalHistory.hasCancer,
      hasCirculationDisorder:
        args.replayRow.medicalHistory.hasCirculationDisorder,
      hasDepression: args.replayRow.medicalHistory.hasDepression,
      hasDiabetes: args.replayRow.medicalHistory.hasDiabetes,
      hasGout: args.replayRow.medicalHistory.hasGout,
      hasHeartCondition: args.replayRow.medicalHistory.hasHeartCondition,
      hasHypertension: args.replayRow.medicalHistory.hasHypertension,
      hasIntolerance: args.replayRow.medicalHistory.hasIntolerance,
      hasKidneyCondition: args.replayRow.medicalHistory.hasKidneyCondition,
      hasLipidDisorder: args.replayRow.medicalHistory.hasLipidDisorder,
      hasLiverCondition: args.replayRow.medicalHistory.hasLiverCondition,
      hasLungCondition: args.replayRow.medicalHistory.hasLungCondition,
      hasOperations: args.replayRow.medicalHistory.hasOperations,
      hasSymptoms: args.replayRow.medicalHistory.hasSymptoms,
      hasThyroidCondition: args.replayRow.medicalHistory.hasThyroidCondition,
      hasVaricoseVeins: args.replayRow.medicalHistory.hasVaricoseVeins,
      ...(args.replayRow.medicalHistory.intoleranceNotes === undefined
        ? {}
        : { intoleranceNotes: args.replayRow.medicalHistory.intoleranceNotes }),
      isComplete: args.replayRow.medicalHistoryComplete === true,
      ...(args.replayRow.medicalHistory.medicationNotes === undefined &&
      args.replayRow.medicalHistory.currentMedications === undefined
        ? {}
        : {
            medicationNotes:
              args.replayRow.medicalHistory.medicationNotes ??
              args.replayRow.medicalHistory.currentMedications,
          }),
      noAdditionalDetails: args.replayRow.medicalHistory.noAdditionalDetails,
      noKnownConditions: args.replayRow.medicalHistory.noKnownConditions,
      ...(args.replayRow.medicalHistory.operationNotes === undefined
        ? {}
        : { operationNotes: args.replayRow.medicalHistory.operationNotes }),
      ...(args.replayRow.medicalHistory.otherConditionNotes === undefined
        ? {}
        : {
            otherConditionNotes:
              args.replayRow.medicalHistory.otherConditionNotes,
          }),
      smokes: args.replayRow.medicalHistory.smokes,
      ...(args.replayRow.medicalHistory.symptomNotes === undefined
        ? {}
        : { symptomNotes: args.replayRow.medicalHistory.symptomNotes }),
      takesMedication: args.replayRow.medicalHistory.takesMedication,
    });
  }

  if (args.replayRow.sessionStep === "new-data-input") {
    return;
  }

  if (args.replayRow.sessionStep === "new-data-sharing") {
    return;
  }

  await ctx.db.insert("bookingNewDataSharingSteps", {
    ...base,
  });

  for (const [index, contact] of args.replayRow.dataSharingContacts.entries()) {
    await ctx.db.insert("bookingNewDataSharingContactRows", {
      ...base,
      city: contact.city,
      dateOfBirth: contact.dateOfBirth,
      firstName: contact.firstName,
      gender: contact.gender,
      index,
      lastName: contact.lastName,
      phoneNumber: contact.phoneNumber,
      postalCode: contact.postalCode,
      street: contact.street,
      ...(contact.title === undefined ? {} : { title: contact.title }),
    });
  }

  if (args.replayRow.sessionStep === "new-calendar-selection") {
    return;
  }
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
    step === "existing-data-input" || step === "existing-calendar-selection"
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
      reason: "missing_location" | "missing_practitioner";
    }
> {
  const locationLineageKey = await resolveLocationLineageKey(
    ctx,
    args.ruleSetId,
    args.replayRow.locationName,
  );

  const practitionerLineageKey = await resolvePractitionerLineageKey(ctx, {
    practitionerName: args.replayRow.practitionerName,
    ruleSetId: args.ruleSetId,
  });

  const preflightSkipReason = getReplayImportSkipReason({
    locationLineageKey,
    practitionerLineageKey,
    sessionStep: args.replayRow.sessionStep,
  });
  if (preflightSkipReason !== null) {
    return { kind: "skipped", reason: preflightSkipReason };
  }

  return {
    context: {
      ...(locationLineageKey === undefined ? {} : { locationLineageKey }),
      ...(practitionerLineageKey === undefined
        ? {}
        : { practitionerLineageKey }),
    },
    kind: "resolved",
  };
}
