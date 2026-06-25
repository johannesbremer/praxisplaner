// convex/users.ts
import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import { internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { authKit } from "./auth";
import { requirePracticeStaff } from "./practiceAccess";
import { personalDataValidator } from "./schema";
import { asPersonalDataInput, type PersonalDataInput } from "./typedDtos";
import { findUserByAuthId } from "./userIdentity";
import { workOSAuthUserValidator } from "./validators";

type BookingPersonalData = PersonalDataInput;

async function getLatestBookingPersonalData(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    userId: Id<"users">;
  },
): Promise<BookingPersonalData | null> {
  const personalDataSteps = await db
    .query("bookingPersonalDataSteps")
    .withIndex("by_userId_practiceId_ruleSetId", (q) =>
      q.eq("userId", args.userId).eq("practiceId", args.practiceId),
    )
    .collect();
  const latestPersonalDataStep = personalDataSteps
    .toSorted((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return Number(right.createdAt - left.createdAt);
      }
      return right._id.localeCompare(left._id);
    })
    .at(0);

  return latestPersonalDataStep
    ? asPersonalDataInput({
        city: latestPersonalDataStep.city,
        dateOfBirth: latestPersonalDataStep.dateOfBirth,
        email: latestPersonalDataStep.email,
        firstName: latestPersonalDataStep.firstName,
        gender: latestPersonalDataStep.gender,
        lastName: latestPersonalDataStep.lastName,
        phoneNumber: latestPersonalDataStep.phoneNumber,
        postalCode: latestPersonalDataStep.postalCode,
        street: latestPersonalDataStep.street,
        ...(latestPersonalDataStep.title === undefined
          ? {}
          : { title: latestPersonalDataStep.title }),
      })
    : null;
}

/**
 * Get the currently authenticated user.
 * Returns the user from our users table if authenticated, null otherwise.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authKit.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    // Find our app's user record by authId
    const user = await findUserByAuthId(ctx.db, authUser.id);

    return user;
  },
  returns: v.union(
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
});

export const provisionCurrentUserFromAuthIdentity = action({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    return await provisionUserFromTrustedWorkOSIdentity(ctx, identity.subject);
  },
  returns: v.id("users"),
});

export async function provisionUserFromTrustedWorkOSIdentity(
  ctx: ActionCtx,
  workOSUserId: string,
): Promise<Id<"users">> {
  const existingUserId = await ctx.runQuery(
    internal.users.getProvisionedUserIdByAuthId,
    { authId: workOSUserId },
  );
  if (existingUserId) {
    return existingUserId;
  }

  const authUser = await loadTrustedWorkOSUser(workOSUserId);
  return await ctx.runMutation(
    internal.users.insertProvisionedUserFromTrustedProfile,
    {
      email: authUser.email,
      ...(authUser.firstName ? { firstName: authUser.firstName } : {}),
      ...(authUser.lastName ? { lastName: authUser.lastName } : {}),
      workOSUserId: authUser.id,
    },
  );
}

export const getProvisionedUserIdByAuthId = internalQuery({
  args: {
    authId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await findUserByAuthId(ctx.db, args.authId);
    return user?._id ?? null;
  },
  returns: v.union(v.id("users"), v.null()),
});

export const insertProvisionedUserFromTrustedProfile = internalMutation({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingUser = await findUserByAuthId(ctx.db, args.workOSUserId);
    if (existingUser) {
      return existingUser._id;
    }
    return await ctx.db.insert("users", {
      authId: args.workOSUserId,
      createdAt: BigInt(Date.now()),
      email: args.email,
      ...(args.firstName ? { firstName: args.firstName } : {}),
      ...(args.lastName ? { lastName: args.lastName } : {}),
    });
  },
  returns: v.id("users"),
});

function getWorkOSApiHostname(): string {
  const apiHostname = process.env["WORKOS_API_HOSTNAME"]?.trim();
  if (!apiHostname) {
    return "api.workos.com";
  }
  if (
    apiHostname.includes("://") ||
    apiHostname.includes("/") ||
    apiHostname.endsWith(".authkit.app")
  ) {
    throw new Error(
      "WORKOS_API_HOSTNAME must be a WorkOS Authentication API hostname, not an AuthKit app URL.",
    );
  }
  return apiHostname;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadTrustedWorkOSUser(workOSUserId: string): Promise<{
  email: string;
  firstName?: string;
  id: string;
  lastName?: string;
}> {
  const apiKey = process.env["WORKOS_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing WORKOS_API_KEY environment variable.");
  }
  const apiHostname = getWorkOSApiHostname();
  const response = await fetch(
    `https://${apiHostname}/user_management/users/${encodeURIComponent(workOSUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(
      `WorkOS user lookup failed with status ${response.status}.`,
    );
  }
  const user = parseWorkOSUserResponse(await response.json());
  return {
    email: user.email,
    id: user.id,
    ...(user.firstName ? { firstName: user.firstName } : {}),
    ...(user.lastName ? { lastName: user.lastName } : {}),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseWorkOSUserResponse(value: unknown): {
  email: string;
  firstName?: string;
  id: string;
  lastName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("WorkOS user response was not an object.");
  }
  const id = value["id"];
  const email = value["email"];
  if (typeof id !== "string" || typeof email !== "string") {
    throw new TypeError("WorkOS user response is missing required fields.");
  }
  const firstName = optionalString(value["first_name"]);
  const lastName = optionalString(value["last_name"]);
  return {
    email,
    id,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  };
}

/**
 * Get the authenticated user from WorkOS (auth metadata).
 * This returns the WorkOS user data directly from the component.
 * @returns The WorkOS user object if authenticated, null otherwise.
 */
export const getAuthUser = query({
  args: {},
  handler: async (ctx) => {
    return await authKit.getAuthUser(ctx);
  },
  returns: v.union(workOSAuthUserValidator, v.null()),
});

/**
 * Get a user by their Convex ID.
 */
export const getById = query({
  args: { id: v.id("users"), practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    await requirePracticeStaff(ctx, args.practiceId);
    const user = await ctx.db.get("users", args.id);
    if (!user) {
      return null;
    }
    if (
      !(await canReadUserDisplayForPractice(ctx.db, args.id, args.practiceId))
    ) {
      return null;
    }

    const personalData = await getLatestBookingPersonalData(ctx.db, {
      practiceId: args.practiceId,
      userId: args.id,
    });

    return {
      ...user,
      ...(personalData && { bookingPersonalData: personalData }),
    };
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("users"),
      authId: v.string(),
      bookingPersonalData: v.optional(personalDataValidator),
      createdAt: v.int64(),
      email: v.string(),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
    }),
    v.null(),
  ),
});

/**
 * Fetch a lightweight map of users by their Convex IDs for UI display.
 * Returns only the fields we need for names and email fallbacks.
 */
export const getUsersByIds = query({
  args: { practiceId: v.id("practices"), userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    await requirePracticeStaff(ctx, args.practiceId);
    const users = await Promise.all(
      args.userIds.map((id) => ctx.db.get("users", id)),
    );

    const userMap: Record<
      Id<"users">,
      {
        email: string;
        firstName?: string;
        lastName?: string;
      }
    > = {};

    for (const user of users) {
      if (!user) {
        continue;
      }
      if (
        !(await canReadUserDisplayForPractice(
          ctx.db,
          user._id,
          args.practiceId,
        ))
      ) {
        continue;
      }

      userMap[user._id] = {
        email: user.email,
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
      };
    }

    return userMap;
  },
  returns: v.record(
    v.id("users"),
    v.object({
      email: v.string(),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
    }),
  ),
});

async function canReadUserDisplayForPractice(
  db: DatabaseReader,
  userId: Id<"users">,
  practiceId: Id<"practices">,
): Promise<boolean> {
  const membership = await db
    .query("organizationMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", practiceId).eq("userId", userId),
    )
    .first();
  if (membership) {
    return true;
  }

  const appointments = await db
    .query("appointments")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  return appointments.some(
    (appointment) => appointment.practiceId === practiceId,
  );
}
