import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { patientUpsertResultValidator } from "./validators";

/** Create or update a patient from GDT data */
export const createOrUpdatePatient = mutation({
  args: {
    city: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    patientId: v.number(),
    practiceId: v.id("practices"),
    sourceGdtFileName: v.optional(v.string()),
    street: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    // Check if patient exists
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .first();

    if (!existingPatient) {
      // Create new patient using spread operator with schema types
      const newPatientId = await ctx.db.insert("patients", {
        ...args,
        createdAt: now,
        lastModified: now,
      });

      return {
        convexPatientId: newPatientId,
        isNewPatient: true,
        patientId: args.patientId,
        success: true,
      };
    }

    // Update existing patient with non-null fields only using spread pattern
    const updates = {
      lastModified: now,
      ...(args.firstName && { firstName: args.firstName }),
      ...(args.lastName && { lastName: args.lastName }),
      ...(args.dateOfBirth && { dateOfBirth: args.dateOfBirth }),
      ...(args.street && { street: args.street }),
      ...(args.city && { city: args.city }),
      ...(args.sourceGdtFileName && {
        sourceGdtFileName: args.sourceGdtFileName,
      }),
    };

    await ctx.db.patch(existingPatient._id, updates);

    return {
      convexPatientId: existingPatient._id,
      isNewPatient: false,
      patientId: args.patientId,
      success: true,
    };
  },
  returns: patientUpsertResultValidator,
});

/** List patients with flexible ordering options */
export const listPatients = query({
  args: {
    limit: v.optional(v.number()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    orderBy: v.optional(
      v.union(v.literal("createdAt"), v.literal("lastModified")),
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const orderBy = args.orderBy ?? "lastModified";
    const order = args.order ?? "desc";

    return await ctx.db
      .query("patients")
      .withIndex(
        orderBy === "lastModified" ? "by_lastModified" : "by_createdAt",
      )
      .order(order)
      .take(limit);
  },
  returns: v.array(v.any()), // Patient documents from schema
});

/** Get a patient by patientId */
export const getPatient = query({
  args: { patientId: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .first();
  },
  returns: v.union(v.any(), v.null()), // Patient document or null
});

/** Get multiple patients by their Convex IDs */
export const getPatientsByIds = query({
  args: { patientIds: v.array(v.id("patients")) },
  handler: async (ctx, args) => {
    const patients = await Promise.all(
      args.patientIds.map((id) => ctx.db.get(id)),
    );
    // Filter out nulls and return patient map for easy lookup
    const patientMap: Record<
      string,
      { firstName?: string; lastName?: string }
    > = {};
    for (const patient of patients) {
      if (patient) {
        const entry: { firstName?: string; lastName?: string } = {};
        if (patient.firstName !== undefined) {
          entry.firstName = patient.firstName;
        }
        if (patient.lastName !== undefined) {
          entry.lastName = patient.lastName;
        }
        patientMap[patient._id] = entry;
      }
    }
    return patientMap;
  },
  returns: v.record(
    v.id("patients"),
    v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
    }),
  ),
});
