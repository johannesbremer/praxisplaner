import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import { mutation, query } from "./_generated/server";

// Query to get a temporary patient by ID
export const getTemporaryPatient = query({
  args: {
    temporaryPatientId: v.id("temporaryPatients"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("temporaryPatients", args.temporaryPatientId);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("temporaryPatients"),
      createdAt: v.int64(),
      firstName: v.string(),
      lastName: v.string(),
      phoneNumber: v.string(),
      practiceId: v.id("practices"),
    }),
    v.null(),
  ),
});

// Mutation to create a temporary patient
export const createTemporaryPatient = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    phoneNumber: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Verify practice exists
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }

    const now = Temporal.Now.instant().epochMilliseconds;

    const temporaryPatientId = await ctx.db.insert("temporaryPatients", {
      createdAt: BigInt(now),
      firstName: args.firstName,
      lastName: args.lastName,
      phoneNumber: args.phoneNumber,
      practiceId: args.practiceId,
    });

    return temporaryPatientId;
  },
  returns: v.id("temporaryPatients"),
});

// Query to search temporary patients by last name (for autocomplete)
export const searchTemporaryPatients = query({
  args: {
    practiceId: v.id("practices"),
    searchTerm: v.string(),
  },
  handler: async (ctx, args) => {
    const patients = await ctx.db
      .query("temporaryPatients")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const searchLower = args.searchTerm.toLowerCase();

    return patients.filter(
      (patient) =>
        patient.lastName.toLowerCase().includes(searchLower) ||
        patient.firstName.toLowerCase().includes(searchLower) ||
        patient.phoneNumber.includes(args.searchTerm),
    );
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("temporaryPatients"),
      createdAt: v.int64(),
      firstName: v.string(),
      lastName: v.string(),
      phoneNumber: v.string(),
      practiceId: v.id("practices"),
    }),
  ),
});

/** Get multiple temporary patients by their Convex IDs */
export const getTemporaryPatientsByIds = query({
  args: { temporaryPatientIds: v.array(v.id("temporaryPatients")) },
  handler: async (ctx, args) => {
    const patients = await Promise.all(
      args.temporaryPatientIds.map((id) => ctx.db.get("temporaryPatients", id)),
    );
    // Filter out nulls and return patient map for easy lookup
    const patientMap: Record<string, { firstName: string; lastName: string }> =
      {};
    for (const patient of patients) {
      if (patient) {
        patientMap[patient._id] = {
          firstName: patient.firstName,
          lastName: patient.lastName,
        };
      }
    }
    return patientMap;
  },
  returns: v.record(
    v.id("temporaryPatients"),
    v.object({
      firstName: v.string(),
      lastName: v.string(),
    }),
  ),
});
