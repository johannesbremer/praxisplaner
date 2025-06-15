import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

/** Create or update a patient from GDT data */
export const upsertPatient = mutation({
  args: {
    city: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    patientId: v.number(),
    sourceGdtFileName: v.optional(v.string()),
    street: v.optional(v.string()),
  },
  handler: async (context, arguments_) => {
    const now = BigInt(Date.now());

    // Check if patient exists
    const existingPatient = await context.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", arguments_.patientId))
      .first();

    if (!existingPatient) {
      // Create new patient using spread operator with schema types
      await context.db.insert("patients", {
        ...arguments_,
        createdAt: now,
        lastModified: now,
      });

      return {
        isNewPatient: true,
        patientId: arguments_.patientId,
        success: true,
      };
    }

    // Update existing patient with non-null fields only using spread pattern
    const updates = {
      lastModified: now,
      ...(arguments_.firstName && { firstName: arguments_.firstName }),
      ...(arguments_.lastName && { lastName: arguments_.lastName }),
      ...(arguments_.dateOfBirth && { dateOfBirth: arguments_.dateOfBirth }),
      ...(arguments_.street && { street: arguments_.street }),
      ...(arguments_.city && { city: arguments_.city }),
      ...(arguments_.sourceGdtFileName && {
        sourceGdtFileName: arguments_.sourceGdtFileName,
      }),
    };

    await context.db.patch(existingPatient._id, updates);

    return {
      isNewPatient: false,
      patientId: arguments_.patientId,
      success: true,
    };
  },
  returns: v.object({
    isNewPatient: v.boolean(),
    patientId: v.number(),
    success: v.boolean(),
  }),
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
  handler: async (context, arguments_) => {
    const limit = arguments_.limit ?? 20;
    const orderBy = arguments_.orderBy ?? "lastModified";
    const order = arguments_.order ?? "desc";

    return await context.db
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
  handler: async (context, arguments_) => {
    return await context.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", arguments_.patientId))
      .first();
  },
  returns: v.union(v.any(), v.null()), // Patient document or null
});
