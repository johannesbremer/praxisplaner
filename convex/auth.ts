// convex/auth.ts
import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";

import type { DataModel } from "./_generated/dataModel";

import { components, internal } from "./_generated/api";
import { findUserByAuthId } from "./userIdentity";
import { mapWorkOSRoleSlugsToPracticeRole } from "./workosOrganizations";

// Get a typed object of internal Convex functions exported by this file
const authFunctions: AuthFunctions = internal.auth;
const authBypassEnabled = process.env["AUTH_BYPASS_ENABLED"] === "true";

const workOSClientId =
  process.env["WORKOS_CLIENT_ID"] ??
  (authBypassEnabled ? "client_local_preview_placeholder" : undefined);
const workOSApiKey =
  process.env["WORKOS_API_KEY"] ??
  (authBypassEnabled ? "sk_test_local_preview_placeholder" : undefined);
const workOSWebhookSecret =
  process.env["WORKOS_WEBHOOK_SECRET"] ??
  (authBypassEnabled ? "whsec_local_preview_placeholder" : undefined);

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  additionalEventTypes: [
    "organization_membership.created",
    "organization_membership.deleted",
    "organization_membership.updated",
  ],
  authFunctions,
  ...(workOSApiKey === undefined ? {} : { apiKey: workOSApiKey }),
  ...(workOSClientId === undefined ? {} : { clientId: workOSClientId }),
  ...(workOSWebhookSecret === undefined
    ? {}
    : { webhookSecret: workOSWebhookSecret }),
});

/**
 * User sync events from WorkOS.
 *
 * When users are created, updated, or deleted in WorkOS, these events
 * sync that data to our users table. This gives us a local users table
 * that we can query directly and extend with app-specific data.
 */
export const { authKitEvent } = authKit.events({
  "organization_membership.created": async (ctx, event) => {
    const membership = parseWorkOSOrganizationMembershipEvent(event.data);
    if (membership.status !== "active") {
      return;
    }
    await ctx.runMutation(
      internal.workosOrganizations.upsertPracticeMemberByWorkOSOrganization,
      {
        organizationId: membership.organizationId,
        role: mapWorkOSRoleSlugsToPracticeRole(membership.roleSlugs),
        workOSUserId: membership.userId,
      },
    );
  },
  "organization_membership.deleted": async (ctx, event) => {
    const membership = parseWorkOSOrganizationMembershipEvent(event.data);
    await ctx.runMutation(
      internal.workosOrganizations.removePracticeMemberByWorkOSOrganization,
      {
        organizationId: membership.organizationId,
        workOSUserId: membership.userId,
      },
    );
  },
  "organization_membership.updated": async (ctx, event) => {
    const membership = parseWorkOSOrganizationMembershipEvent(event.data);
    if (membership.status !== "active") {
      await ctx.runMutation(
        internal.workosOrganizations.removePracticeMemberByWorkOSOrganization,
        {
          organizationId: membership.organizationId,
          workOSUserId: membership.userId,
        },
      );
      return;
    }
    await ctx.runMutation(
      internal.workosOrganizations.upsertPracticeMemberByWorkOSOrganization,
      {
        organizationId: membership.organizationId,
        role: mapWorkOSRoleSlugsToPracticeRole(membership.roleSlugs),
        workOSUserId: membership.userId,
      },
    );
  },
  "user.created": async (ctx, event) => {
    // Check if user already exists to handle webhook retries idempotently
    const existingUsers = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", event.data.id))
      .collect();

    if (existingUsers.length > 0) {
      // User already exists, update their data instead
      const updateData: {
        email: string;
        firstName?: string;
        lastName?: string;
      } = {
        email: event.data.email,
      };
      if (event.data.firstName) {
        updateData.firstName = event.data.firstName;
      }
      if (event.data.lastName) {
        updateData.lastName = event.data.lastName;
      }
      await Promise.all(
        existingUsers.map((existingUser) =>
          ctx.db.patch("users", existingUser._id, updateData),
        ),
      );
      return;
    }

    // Insert new user
    const userData: {
      authId: string;
      createdAt: bigint;
      email: string;
      firstName?: string;
      lastName?: string;
    } = {
      authId: event.data.id,
      createdAt: BigInt(Date.now()),
      email: event.data.email,
    };
    if (event.data.firstName) {
      userData.firstName = event.data.firstName;
    }
    if (event.data.lastName) {
      userData.lastName = event.data.lastName;
    }
    await ctx.db.insert("users", userData);
  },
  "user.deleted": async (ctx, event) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", event.data.id))
      .collect();
    if (users.length === 0) {
      console.warn(`User not found for delete: ${event.data.id}`);
      return;
    }
    await Promise.all(users.map((user) => ctx.db.delete("users", user._id)));
  },
  "user.updated": async (ctx, event) => {
    const user = await findUserByAuthId(ctx.db, event.data.id);
    if (!user) {
      console.warn(`User not found for update: ${event.data.id}`);
      return;
    }
    const updateData: {
      email: string;
      firstName?: string;
      lastName?: string;
    } = {
      email: event.data.email,
    };
    if (event.data.firstName) {
      updateData.firstName = event.data.firstName;
    }
    if (event.data.lastName) {
      updateData.lastName = event.data.lastName;
    }
    await ctx.db.patch("users", user._id, updateData);
  },
});

export const { backfillUsers } = authKit.utils();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkOSMembershipStatus(
  value: unknown,
): value is "active" | "inactive" | "pending" {
  return ["active", "inactive", "pending"].includes(String(value));
}

function parseWorkOSOrganizationMembershipEvent(data: unknown): {
  organizationId: string;
  roleSlugs: string[];
  status: "active" | "inactive" | "pending";
  userId: string;
} {
  if (!isRecord(data)) {
    throw new Error("WorkOS organization membership event data was invalid.");
  }
  const organizationId = data["organization_id"];
  const roleSlug = data["role_slug"];
  const roleSlugs = data["role_slugs"];
  const status = data["status"];
  const userId = data["user_id"];
  if (
    typeof organizationId !== "string" ||
    !isWorkOSMembershipStatus(status) ||
    typeof userId !== "string"
  ) {
    throw new Error("WorkOS organization membership event data was invalid.");
  }
  return {
    organizationId,
    roleSlugs: [
      ...(Array.isArray(roleSlugs)
        ? roleSlugs.filter((role): role is string => typeof role === "string")
        : []),
      ...(typeof roleSlug === "string" ? [roleSlug] : []),
    ],
    status,
    userId,
  };
}
