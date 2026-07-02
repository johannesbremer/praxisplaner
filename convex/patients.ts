import { type Infer, v } from "convex/values";

import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";

import { isIsoDateString } from "../lib/typed-regex.js";
import { mutation, query } from "./_generated/server";
import {
  buildPatientSearchFirstName,
  buildPatientSearchLastName,
} from "./patientSearch";
import {
  requirePracticeStaff,
  requirePracticeStaffForMutation,
} from "./practiceAccess";
import { createTemporaryPatientRecord } from "./temporaryPatients";
import { ensureAuthenticatedIdentity } from "./userIdentity";
import {
  insuranceStatusValidator,
  patientUpsertResultValidator,
} from "./validators";

const patientRecordTypeValidator = v.union(
  v.literal("pvs"),
  v.literal("temporary"),
);

const patientDocumentValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("patients"),
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  city: v.optional(v.string()),
  createdAt: v.int64(),
  dateOfBirth: v.optional(v.string()),
  firstName: v.optional(v.string()),
  insuranceStatus: insuranceStatusValidator,
  lastModified: v.int64(),
  lastName: v.optional(v.string()),
  name: v.optional(v.string()),
  patientId: v.optional(v.number()),
  phoneNumber: v.optional(v.string()),
  practiceId: v.id("practices"),
  recordType: patientRecordTypeValidator,
  searchFirstName: v.string(),
  searchLastName: v.string(),
  sourceGdtFileName: v.optional(v.string()),
  street: v.optional(v.string()),
});

const patientNameLookupValidator = v.object({
  firstName: v.optional(v.string()),
  insuranceStatus: insuranceStatusValidator,
  lastName: v.optional(v.string()),
  name: v.optional(v.string()),
});

const patientSidebarDetailsValidator = v.object({
  city: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  firstName: v.optional(v.string()),
  insuranceStatus: insuranceStatusValidator,
  lastName: v.optional(v.string()),
  name: v.optional(v.string()),
  patientId: v.optional(v.number()),
  phoneNumber: v.optional(v.string()),
  recordType: patientRecordTypeValidator,
  street: v.optional(v.string()),
});

function normalizePatientDateOfBirth(
  value?: string,
): IsoDateString | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isIsoDateString(value)) {
    return value;
  }

  throw new Error(
    `Patient dateOfBirth must be a valid YYYY-MM-DD string, got "${value}".`,
  );
}

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
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const { dateOfBirth: rawDateOfBirth, ...restArgs } = args;
    const now = BigInt(Date.now());
    const dateOfBirth = normalizePatientDateOfBirth(rawDateOfBirth);

    // Check if patient exists
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_practiceId_patientId", (q) =>
        q.eq("practiceId", args.practiceId).eq("patientId", args.patientId),
      )
      .first();

    if (!existingPatient) {
      // Create new patient using spread operator with schema types
      const newPatientId = await ctx.db.insert("patients", {
        ...restArgs,
        ...(dateOfBirth !== undefined && { dateOfBirth }),
        createdAt: now,
        insuranceStatus: "unknown",
        lastModified: now,
        recordType: "pvs",
        searchFirstName: buildPatientSearchFirstName({
          firstName: args.firstName,
          lastName: args.lastName,
        }),
        searchLastName: buildPatientSearchLastName({
          firstName: args.firstName,
          lastName: args.lastName,
        }),
      });

      return {
        convexPatientId: newPatientId,
        insuranceStatus: "unknown" as const,
        isNewPatient: true,
        patientId: args.patientId,
        success: true,
      };
    }

    // Update existing patient with non-null fields only using spread pattern
    const updates = {
      lastModified: now,
      recordType: "pvs" as const,
      searchFirstName: buildPatientSearchFirstName({
        firstName: args.firstName ?? existingPatient.firstName,
        lastName: args.lastName ?? existingPatient.lastName,
        name: existingPatient.name,
      }),
      searchLastName: buildPatientSearchLastName({
        firstName: args.firstName ?? existingPatient.firstName,
        lastName: args.lastName ?? existingPatient.lastName,
        name: existingPatient.name,
      }),
      ...(args.firstName && { firstName: args.firstName }),
      ...(args.lastName && { lastName: args.lastName }),
      ...(dateOfBirth && { dateOfBirth }),
      ...(args.street && { street: args.street }),
      ...(args.city && { city: args.city }),
      ...(args.sourceGdtFileName && {
        sourceGdtFileName: args.sourceGdtFileName,
      }),
    };

    await ctx.db.patch("patients", existingPatient._id, updates);

    return {
      convexPatientId: existingPatient._id,
      insuranceStatus: existingPatient.insuranceStatus,
      isNewPatient: false,
      patientId: args.patientId,
      success: true,
    };
  },
  returns: patientUpsertResultValidator,
});

export const createTemporaryPatient = mutation({
  args: {
    name: v.string(),
    phoneNumber: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    return await createTemporaryPatientRecord(ctx, args);
  },
  returns: v.id("patients"),
});

export const updatePatientInsuranceStatus = mutation({
  args: {
    insuranceStatus: insuranceStatusValidator,
    patientId: v.id("patients"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);

    const patient = await ctx.db.get("patients", args.patientId);
    if (patient?.practiceId !== args.practiceId) {
      throw new Error("Patient not found");
    }

    await ctx.db.patch("patients", args.patientId, {
      insuranceStatus: args.insuranceStatus,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

/** List patients with flexible ordering options */
export const listPatients = query({
  args: {
    limit: v.optional(v.number()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    orderBy: v.optional(
      v.union(v.literal("createdAt"), v.literal("lastModified")),
    ),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const limit = args.limit ?? 20;
    const orderBy = args.orderBy ?? "lastModified";
    const order = args.order ?? "desc";

    const patients = await ctx.db
      .query("patients")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .order(order)
      .collect();

    return patients
      .toSorted((left, right) => {
        const comparison =
          orderBy === "lastModified"
            ? Number(left.lastModified - right.lastModified)
            : Number(left.createdAt - right.createdAt);
        return order === "asc" ? comparison : -comparison;
      })
      .slice(0, limit);
  },
  returns: v.array(patientDocumentValidator),
});

/** Get a patient by Convex ID */
export const getPatientById = query({
  args: { id: v.id("patients") },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const patient = await ctx.db.get("patients", args.id);
    if (!patient) {
      return null;
    }
    await requirePracticeStaff(ctx, patient.practiceId);
    return patient;
  },
  returns: v.union(patientDocumentValidator, v.null()),
});

/** Get a patient by patientId */
export const getPatient = query({
  args: { patientId: v.number(), practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const patient = await ctx.db
      .query("patients")
      .withIndex("by_practiceId_patientId", (q) =>
        q.eq("practiceId", args.practiceId).eq("patientId", args.patientId),
      )
      .first();
    return patient ?? null;
  },
  returns: v.union(patientDocumentValidator, v.null()),
});

/** Get multiple patients by their Convex IDs */
export const getPatientsByIds = query({
  args: {
    patientIds: v.array(v.id("patients")),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const patients = await Promise.all(
      args.patientIds.map((id) => ctx.db.get("patients", id)),
    );
    // Filter out nulls and return patient map for easy lookup
    const patientMap: Record<
      string,
      {
        firstName?: string;
        insuranceStatus: Infer<typeof insuranceStatusValidator>;
        lastName?: string;
        name?: string;
      }
    > = {};
    for (const patient of patients) {
      if (patient) {
        if (patient.practiceId !== args.practiceId) {
          continue;
        }
        const entry: {
          firstName?: string;
          insuranceStatus: Infer<typeof insuranceStatusValidator>;
          lastName?: string;
          name?: string;
        } = { insuranceStatus: patient.insuranceStatus };
        if (patient.firstName !== undefined) {
          entry.firstName = patient.firstName;
        }
        if (patient.lastName !== undefined) {
          entry.lastName = patient.lastName;
        }
        if (patient.name !== undefined) {
          entry.name = patient.name;
        }
        patientMap[patient._id] = entry;
      }
    }
    return patientMap;
  },
  returns: v.record(v.id("patients"), patientNameLookupValidator),
});

export const getPatientSidebarDetailsByIds = query({
  args: {
    patientIds: v.array(v.id("patients")),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const patients = await Promise.all(
      args.patientIds.map((id) => ctx.db.get("patients", id)),
    );

    const patientMap: Record<
      string,
      {
        city?: string;
        dateOfBirth?: string;
        firstName?: string;
        insuranceStatus: Infer<typeof insuranceStatusValidator>;
        lastName?: string;
        name?: string;
        patientId?: number;
        phoneNumber?: string;
        recordType: "pvs" | "temporary";
        street?: string;
      }
    > = {};

    for (const patient of patients) {
      if (patient?.practiceId !== args.practiceId) {
        continue;
      }

      patientMap[patient._id] = {
        ...(patient.city ? { city: patient.city } : {}),
        ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}),
        ...(patient.firstName ? { firstName: patient.firstName } : {}),
        ...(patient.lastName ? { lastName: patient.lastName } : {}),
        ...(patient.name ? { name: patient.name } : {}),
        ...(patient.patientId === undefined
          ? {}
          : { patientId: patient.patientId }),
        ...(patient.phoneNumber ? { phoneNumber: patient.phoneNumber } : {}),
        insuranceStatus: patient.insuranceStatus,
        recordType: patient.recordType,
        ...(patient.street ? { street: patient.street } : {}),
      };
    }

    return patientMap;
  },
  returns: v.record(v.id("patients"), patientSidebarDetailsValidator),
});

/** Search patients by name */
export const searchPatients = query({
  args: {
    practiceId: v.id("practices"),
    searchTerm: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const searchTerm = args.searchTerm.trim();

    if (searchTerm.length === 0) {
      return await ctx.db
        .query("patients")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
        .order("desc")
        .take(20);
    }

    const [firstNameResults, lastNameResults] = await Promise.all([
      ctx.db
        .query("patients")
        .withSearchIndex("search_by_searchFirstName", (q) =>
          q
            .search("searchFirstName", searchTerm)
            .eq("practiceId", args.practiceId),
        )
        .take(20),
      ctx.db
        .query("patients")
        .withSearchIndex("search_by_searchLastName", (q) =>
          q
            .search("searchLastName", searchTerm)
            .eq("practiceId", args.practiceId),
        )
        .take(20),
    ]);

    return mergePatientSearchResults(firstNameResults, lastNameResults);
  },
  returns: v.array(patientDocumentValidator),
});

function mergePatientSearchResults(
  firstNameResults: Doc<"patients">[],
  lastNameResults: Doc<"patients">[],
) {
  const lastNameIds = new Set(lastNameResults.map((patient) => patient._id));
  const mergedPatients = new Map<Id<"patients">, Doc<"patients">>();

  for (const patient of firstNameResults) {
    if (lastNameIds.has(patient._id)) {
      mergedPatients.set(patient._id, patient);
    }
  }

  for (const patient of firstNameResults) {
    if (!mergedPatients.has(patient._id)) {
      mergedPatients.set(patient._id, patient);
    }
  }

  for (const patient of lastNameResults) {
    if (!mergedPatients.has(patient._id)) {
      mergedPatients.set(patient._id, patient);
    }
  }

  return [...mergedPatients.values()].slice(0, 20);
}
