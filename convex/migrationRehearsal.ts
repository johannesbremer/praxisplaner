import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { insertSelfLineageEntity } from "./lineage";

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
