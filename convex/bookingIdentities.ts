import type { GenericDatabaseReader } from "convex/server";

import { v } from "convex/values";

import type { DataModel, Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { mutation, query } from "./_generated/server";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
} from "./practiceAccess";

type Reader = GenericDatabaseReader<DataModel>;
const SEARCH_WHITESPACE_REGEX = regex.as(String.raw`\s+`, "gu");

const bookingIdentityKindValidator = v.union(
  v.literal("online"),
  v.literal("telefonki"),
  v.literal("temporary"),
);

const bookingIdentitySourceSystemValidator = v.union(
  v.literal("legacy-online"),
  v.literal("legacy-telefonki"),
  v.literal("online"),
  v.literal("telefonki"),
);

export async function resolveActivePvsPatientIdForBookingIdentity(
  db: Reader,
  bookingIdentityId: Id<"bookingIdentities">,
): Promise<Id<"patients"> | null> {
  const activeAssociations = await db
    .query("bookingIdentityPatientAssociations")
    .withIndex("by_bookingIdentityId_status", (q) =>
      q.eq("bookingIdentityId", bookingIdentityId).eq("status", "active"),
    )
    .collect();

  const canonicalAssociation = activeAssociations
    .toSorted((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return Number(right.createdAt - left.createdAt);
      }
      return right._id.localeCompare(left._id);
    })
    .at(0);

  return canonicalAssociation?.patientId ?? null;
}

export const createBookingIdentity = mutation({
  args: {
    dateOfBirth: v.optional(v.string()),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    kind: bookingIdentityKindValidator,
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    practiceId: v.id("practices"),
    sourceIdentityId: v.optional(v.string()),
    sourceSystem: v.optional(bookingIdentitySourceSystemValidator),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const now = BigInt(Date.now());
    return await ctx.db.insert("bookingIdentities", {
      ...args,
      createdAt: now,
      lastModified: now,
      searchFirstName: normalizeSearch(args.firstName, args.lastName),
      searchLastName: normalizeSearch(args.lastName, args.firstName),
    });
  },
  returns: v.id("bookingIdentities"),
});

export const associateBookingIdentityWithPvsPatient = mutation({
  args: {
    bookingIdentityId: v.id("bookingIdentities"),
    evidenceCount: v.optional(v.number()),
    legacyAppointmentId: v.optional(v.string()),
    legacyIdentityId: v.optional(v.string()),
    method: v.union(v.literal("automatic"), v.literal("manual")),
    patientId: v.id("patients"),
    practiceId: v.id("practices"),
    pvsAppointmentSourceKey: v.optional(v.string()),
    pvsPatientNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const membership = await ensurePracticeAccessForMutation(
      ctx,
      args.practiceId,
    );

    const bookingIdentity = await ctx.db.get(
      "bookingIdentities",
      args.bookingIdentityId,
    );
    if (bookingIdentity?.practiceId !== args.practiceId) {
      throw new Error("Booking Identity not found for this practice.");
    }

    const patient = await ctx.db.get("patients", args.patientId);
    if (
      patient?.practiceId !== args.practiceId ||
      patient.recordType !== "pvs"
    ) {
      throw new Error("PVS Patient not found for this practice.");
    }

    const activeAssociations = await ctx.db
      .query("bookingIdentityPatientAssociations")
      .withIndex("by_bookingIdentityId_status", (q) =>
        q
          .eq("bookingIdentityId", args.bookingIdentityId)
          .eq("status", "active"),
      )
      .collect();

    const existingSamePatient = activeAssociations.find(
      (association) => association.patientId === args.patientId,
    );
    if (existingSamePatient) {
      return existingSamePatient._id;
    }

    const now = BigInt(Date.now());
    const userId = membership.userId;
    for (const association of activeAssociations) {
      await ctx.db.patch(
        "bookingIdentityPatientAssociations",
        association._id,
        {
          status: "superseded",
          supersededAt: now,
          supersededByUserId: userId,
        },
      );
    }

    return await ctx.db.insert("bookingIdentityPatientAssociations", {
      bookingIdentityId: args.bookingIdentityId,
      createdAt: now,
      createdByUserId: userId,
      ...(args.evidenceCount === undefined
        ? {}
        : { evidenceCount: args.evidenceCount }),
      ...(args.legacyAppointmentId === undefined
        ? {}
        : { legacyAppointmentId: args.legacyAppointmentId }),
      ...(args.legacyIdentityId === undefined
        ? {}
        : { legacyIdentityId: args.legacyIdentityId }),
      method: args.method,
      patientId: args.patientId,
      practiceId: args.practiceId,
      ...(args.pvsAppointmentSourceKey === undefined
        ? {}
        : { pvsAppointmentSourceKey: args.pvsAppointmentSourceKey }),
      ...(args.pvsPatientNumber === undefined
        ? {}
        : { pvsPatientNumber: args.pvsPatientNumber }),
      status: "active",
    });
  },
  returns: v.id("bookingIdentityPatientAssociations"),
});

export const getActivePvsPatientForBookingIdentity = query({
  args: {
    bookingIdentityId: v.id("bookingIdentities"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const bookingIdentity = await ctx.db.get(
      "bookingIdentities",
      args.bookingIdentityId,
    );
    if (bookingIdentity?.practiceId !== args.practiceId) {
      return null;
    }

    const patientId = await resolveActivePvsPatientIdForBookingIdentity(
      ctx.db,
      args.bookingIdentityId,
    );
    if (!patientId) {
      return null;
    }

    const patient = await ctx.db.get("patients", patientId);
    if (patient?.practiceId !== args.practiceId) {
      return null;
    }

    return patient;
  },
});

function normalizeSearch(
  firstPart: string | undefined,
  secondPart: string | undefined,
): string {
  const parts = [];
  for (const part of [firstPart, secondPart]) {
    const compactPart = part?.trim().replaceAll(SEARCH_WHITESPACE_REGEX, " ");
    if (compactPart) {
      parts.push(compactPart);
    }
  }
  return parts.join(" ").toLocaleLowerCase();
}
