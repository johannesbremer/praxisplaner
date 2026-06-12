import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { isConvexAuthBypassEnabled } from "./authBypass";
import { createInitialRuleSet } from "./copyOnWrite";
import { DEV_AUTH_ORGANIZATION_ID } from "./devAuthData";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  getAccessiblePracticeIdsForQuery,
  practiceRoleValidator,
  requirePracticeManager,
} from "./practiceAccess";
import { normalizePracticePhoneNumber } from "./practicePhoneNumbers";
import { allocateUniquePracticeSlug } from "./practiceSlugs";
import {
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQueryOrNull,
  requireAuthenticatedUserIdForQuery,
} from "./userIdentity";

const practiceListItemValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("practices"),
  currentActiveRuleSetId: v.optional(v.id("ruleSets")),
  name: v.string(),
  slug: v.optional(v.string()),
  workOSOrganizationId: v.optional(v.string()),
});

/**
 * Create a new practice with the given name.
 * Also creates an initial saved rule set and sets it as active.
 */
export const createPractice = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const slug = await allocateUniquePracticeSlug(ctx.db, args.name);
    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
      slug,
    });

    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
    });

    // Create initial saved rule set and set it as active
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

/**
 * Get all practices visible to the current user.
 */
export const getAllPractices = query({
  args: {},
  handler: async (ctx) => {
    const practiceIds = await getAccessiblePracticeIdsForQuery(ctx);
    const practiceCandidates = await Promise.all(
      practiceIds.map((practiceId) => ctx.db.get("practices", practiceId)),
    );
    const practices: {
      _creationTime: number;
      _id: Id<"practices">;
      currentActiveRuleSetId?: Id<"ruleSets">;
      name: string;
      slug?: string;
      workOSOrganizationId?: string;
    }[] = [];

    for (const practice of practiceCandidates) {
      if (!practice) {
        continue;
      }
      practices.push(practice);
    }

    return practices;
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
      slug: v.optional(v.string()),
      workOSOrganizationId: v.optional(v.string()),
    }),
  ),
});

export const getAllPracticesIfAuthenticated = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedUserIdForQueryOrNull(ctx);
    if (!userId) {
      return [];
    }

    const memberships = await ctx.db
      .query("practiceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const practiceCandidates = await Promise.all(
      memberships.map((membership) =>
        ctx.db.get("practices", membership.practiceId),
      ),
    );

    return practiceCandidates.filter((practice) => practice !== null);
  },
  returns: v.array(practiceListItemValidator),
});

/**
 * Get practices visible to authenticated patient booking flows.
 *
 * Patients are not practice members, so this intentionally does not use
 * practiceMembers. Booking-specific queries still validate practice/rule-set
 * relationships before exposing scheduling data.
 */
export const getBookingPractices = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUserIdForQuery(ctx);
    return await ctx.db.query("practices").collect();
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
      slug: v.optional(v.string()),
      workOSOrganizationId: v.optional(v.string()),
    }),
  ),
});

export const getBookingPracticesIfAuthenticated = query({
  args: { organizationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserIdForQueryOrNull(ctx);
    if (!userId) {
      return [];
    }
    const organizationId =
      args.organizationId ??
      (isConvexAuthBypassEnabled() ? DEV_AUTH_ORGANIZATION_ID : null);
    if (!organizationId) {
      return [];
    }
    const practice = await ctx.db
      .query("practices")
      .withIndex("by_workOSOrganizationId", (q) =>
        q.eq("workOSOrganizationId", organizationId),
      )
      .unique();
    return practice ? [practice] : [];
  },
  returns: v.array(practiceListItemValidator),
});

/**
 * Get a specific practice by ID.
 */
export const getPractice = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db.get("practices", args.practiceId);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
      slug: v.optional(v.string()),
      workOSOrganizationId: v.optional(v.string()),
    }),
    v.null(),
  ),
});

export const getAccessiblePracticeBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const practiceIds = await getAccessiblePracticeIdsForQuery(ctx);
    const practices = await Promise.all(
      practiceIds.map((practiceId) => ctx.db.get("practices", practiceId)),
    );
    const matchingPractices = practices.filter(
      (practice) => practice?.slug === args.slug,
    );
    return matchingPractices.length === 1 ? matchingPractices[0] : null;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
      slug: v.optional(v.string()),
      workOSOrganizationId: v.optional(v.string()),
    }),
    v.null(),
  ),
});

export const getBookingPracticeBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUserIdForQuery(ctx);
    const practicesBySlug = await ctx.db
      .query("practices")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();
    if (practicesBySlug.length > 0) {
      return practicesBySlug.length === 1 ? practicesBySlug[0] : null;
    }
    return null;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practices"),
      currentActiveRuleSetId: v.optional(v.id("ruleSets")),
      name: v.string(),
      slug: v.optional(v.string()),
      workOSOrganizationId: v.optional(v.string()),
    }),
    v.null(),
  ),
});

export const listPracticePhoneNumbers = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await requirePracticeManager(ctx, args.practiceId);

    const phoneNumbers = await ctx.db
      .query("practicePhoneNumbers")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    return phoneNumbers.toSorted((left, right) =>
      left.phoneNumber.localeCompare(right.phoneNumber),
    );
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("practicePhoneNumbers"),
      createdAt: v.int64(),
      lastModified: v.int64(),
      phoneNumber: v.string(),
      practiceId: v.id("practices"),
    }),
  ),
});

export const upsertPracticePhoneNumber = mutation({
  args: {
    phoneNumber: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId, "admin");

    const normalizedPhoneNumber = normalizePracticePhoneNumber(
      args.phoneNumber,
    );
    const existing = await ctx.db
      .query("practicePhoneNumbers")
      .withIndex("by_phoneNumber", (q) =>
        q.eq("phoneNumber", normalizedPhoneNumber),
      )
      .unique();

    if (existing && existing.practiceId !== args.practiceId) {
      throw new Error(
        "Practice phone number is already assigned to another practice.",
      );
    }

    const now = BigInt(Date.now());
    if (existing) {
      await ctx.db.patch("practicePhoneNumbers", existing._id, {
        lastModified: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("practicePhoneNumbers", {
      createdAt: now,
      lastModified: now,
      phoneNumber: normalizedPhoneNumber,
      practiceId: args.practiceId,
    });
  },
  returns: v.id("practicePhoneNumbers"),
});

export const removePracticePhoneNumber = mutation({
  args: {
    practicePhoneNumberId: v.id("practicePhoneNumbers"),
  },
  handler: async (ctx, args) => {
    const practicePhoneNumber = await ctx.db.get(
      "practicePhoneNumbers",
      args.practicePhoneNumberId,
    );
    if (!practicePhoneNumber) {
      throw new Error("Practice phone number not found.");
    }

    await ensurePracticeAccessForMutation(
      ctx,
      practicePhoneNumber.practiceId,
      "admin",
    );
    await ctx.db.delete("practicePhoneNumbers", args.practicePhoneNumberId);
    return args.practicePhoneNumberId;
  },
  returns: v.id("practicePhoneNumbers"),
});

/**
 * Initialize a default practice for development purposes.
 * Returns the existing practice membership for the user if available.
 */
export const initializeDefaultPractice = mutation({
  args: {},
  handler: async (ctx) => {
    if (!isConvexAuthBypassEnabled()) {
      throw new Error(
        "Default practice bootstrap is only available in bypass mode.",
      );
    }

    const userId = await ensureAuthenticatedUserId(ctx);
    const existingMemberships = await ctx.db
      .query("practiceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    for (const membership of existingMemberships) {
      const practice = await ctx.db.get("practices", membership.practiceId);
      if (practice) {
        if (!practice.slug) {
          await ctx.db.patch("practices", practice._id, {
            slug: await allocateUniquePracticeSlug(ctx.db, practice.name),
          });
        }
        return membership.practiceId;
      }

      await ctx.db.delete("practiceMembers", membership._id);
    }

    const existingPractices = await ctx.db.query("practices").collect();

    if (existingPractices.length > 0) {
      const firstPractice = existingPractices[0];
      if (!firstPractice) {
        throw new Error("Expected first practice to exist");
      }
      if (!firstPractice.slug) {
        await ctx.db.patch("practices", firstPractice._id, {
          slug: await allocateUniquePracticeSlug(ctx.db, firstPractice.name),
        });
      }

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: firstPractice._id,
        role: "staff",
        userId,
      });

      return firstPractice._id;
    }

    const defaultPracticeName = "Standardpraxis";
    const practiceId = await ctx.db.insert("practices", {
      name: defaultPracticeName,
      slug: await allocateUniquePracticeSlug(ctx.db, defaultPracticeName),
    });

    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
    });

    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

/**
 * Add or update a member role in a practice.
 */
export const upsertPracticeMember = mutation({
  args: {
    practiceId: v.id("practices"),
    role: practiceRoleValidator,
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId, "admin");

    const existing = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", args.practiceId).eq("userId", args.userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("practiceMembers", existing._id, { role: args.role });
      return existing._id;
    }

    const existingUserMembership = await ctx.db
      .query("practiceMembers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (
      existingUserMembership &&
      existingUserMembership.practiceId !== args.practiceId
    ) {
      throw new Error("User already belongs to another practice.");
    }

    return await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId: args.practiceId,
      role: args.role,
      userId: args.userId,
    });
  },
  returns: v.id("practiceMembers"),
});

/**
 * Get practice members with user profile data.
 */
export const getPracticeMembers = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await requirePracticeManager(ctx, args.practiceId);

    const members = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const users = await Promise.all(
      members.map((member) => ctx.db.get("users", member.userId)),
    );

    return members.map((member, index) => ({
      _id: member._id,
      createdAt: member.createdAt,
      practiceId: member.practiceId,
      role: member.role,
      user: users[index] ?? null,
      userId: member.userId,
    }));
  },
  returns: v.array(
    v.object({
      _id: v.id("practiceMembers"),
      createdAt: v.int64(),
      practiceId: v.id("practices"),
      role: practiceRoleValidator,
      user: v.union(
        v.object({
          _creationTime: v.number(),
          _id: v.id("users"),
          authId: v.string(),
          createdAt: v.int64(),
          email: v.string(),
          firstName: v.optional(v.string()),
          lastName: v.optional(v.string()),
        }),
        v.null(),
      ),
      userId: v.id("users"),
    }),
  ),
});
