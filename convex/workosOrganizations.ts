import type { GenericMutationCtx } from "convex/server";

import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import { internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { createInitialRuleSet } from "./copyOnWrite";
import { type PracticeRole, practiceRoleValidator } from "./practiceAccess";

const WORKOS_API_BASE = `https://${getWorkOSApiHostname()}`;

type WorkOSMembershipStatus = "active" | "inactive" | "pending";

interface WorkOSOrganizationMembership {
  id: string;
  object: "organization_membership";
  organizationId: string;
  roleSlugs: string[];
  status: WorkOSMembershipStatus;
  userId: string;
}

interface WorkOSOrganizationSummary {
  id: string;
  name: string;
}

export const createOrganizationPractice = action({
  args: {
    name: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    organizationId: string;
    practiceId: Id<"practices">;
  }> => {
    const identity = await requireActionIdentity(ctx);
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Practice name is required",
      });
    }
    const existingMemberships = await loadActiveWorkOSOrganizationMemberships({
      userId: identity.subject,
    });
    if (existingMemberships.length > 0) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "User already belongs to a WorkOS organization",
      });
    }
    const existingPracticeId = await ctx.runQuery(
      internal.workosOrganizations.getPracticeIdByName,
      { name },
    );
    if (existingPracticeId) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "Practice name already exists",
      });
    }
    const organization = await createWorkOSOrganization(name);
    await createWorkOSOrganizationMembership({
      organizationId: organization.id,
      roleSlug: "owner",
      userId: identity.subject,
    });
    const practiceId = await ctx.runMutation(
      internal.workosOrganizations.createPracticeForWorkOSOrganization,
      {
        name,
        organizationId: organization.id,
        role: "owner",
        workOSUserId: identity.subject,
      },
    );

    return { organizationId: organization.id, practiceId };
  },
  returns: v.object({
    organizationId: v.string(),
    practiceId: v.id("practices"),
  }),
});

export const syncCurrentUserOrganizationMembership = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"practiceMembers"> | null> => {
    const identity = await requireActionIdentity(ctx);
    const membership = await loadActiveWorkOSOrganizationMembership({
      organizationId: args.organizationId,
      userId: identity.subject,
    });

    if (!membership) {
      await ctx.runMutation(
        internal.workosOrganizations.removePracticeMemberByWorkOSOrganization,
        {
          organizationId: args.organizationId,
          workOSUserId: identity.subject,
        },
      );
      return null;
    }

    return await ctx.runMutation(
      internal.workosOrganizations.upsertPracticeMemberByWorkOSOrganization,
      {
        organizationId: args.organizationId,
        role: mapWorkOSRoleToPracticeRole(membership),
        workOSUserId: identity.subject,
      },
    );
  },
  returns: v.union(v.id("practiceMembers"), v.null()),
});

export const getUsersManagementWidgetToken = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const identity = await requireActionIdentity(ctx);
    await requireKnownWorkOSOrganization(ctx, args.organizationId);
    const membership = await loadActiveWorkOSOrganizationMembership({
      organizationId: args.organizationId,
      userId: identity.subject,
    });
    if (!membership || !canManageWorkOSOrganizationUsers(membership)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "WorkOS organization admin or owner role required",
      });
    }
    const token = await createWorkOSWidgetToken({
      organizationId: args.organizationId,
      scopes: ["widgets:users-table:manage"],
      userId: identity.subject,
    });
    return token;
  },
  returns: v.string(),
});

export const listCurrentUserOrganizations = action({
  args: {},
  handler: async (ctx): Promise<WorkOSOrganizationSummary[]> => {
    const identity = await requireActionIdentity(ctx);
    const memberships = await loadActiveWorkOSOrganizationMemberships({
      userId: identity.subject,
    });
    return await Promise.all(
      memberships.map(async (membership) => {
        return await loadWorkOSOrganization(membership.organizationId);
      }),
    );
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
    }),
  ),
});

export const createPracticeForWorkOSOrganization = internalMutation({
  args: {
    name: v.string(),
    organizationId: v.string(),
    role: practiceRoleValidator,
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUserByAuthId(ctx.db, args.workOSUserId);
    const existingPractice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );

    if (existingPractice) {
      await upsertPracticeMembership(ctx, {
        practiceId: existingPractice._id,
        role: args.role,
        userId: user._id,
      });
      return existingPractice._id;
    }

    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
      workOSOrganizationId: args.organizationId,
    });
    await upsertPracticeMembership(ctx, {
      practiceId,
      role: args.role,
      userId: user._id,
    });
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

export const getPracticeIdByWorkOSOrganizationId = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    return practice?._id ?? null;
  },
  returns: v.union(v.id("practices"), v.null()),
});

export const getPracticeIdByName = internalQuery({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeByName(ctx.db, args.name);
    return practice?._id ?? null;
  },
  returns: v.union(v.id("practices"), v.null()),
});

export const hasPracticeForWorkOSOrganization = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    return practice !== null;
  },
  returns: v.boolean(),
});

export const removePracticeMemberByWorkOSOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    const user = await findUserByAuthId(ctx.db, args.workOSUserId);
    if (!practice || !user) {
      return null;
    }
    const membership = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", practice._id).eq("userId", user._id),
      )
      .first();
    if (!membership) {
      return null;
    }
    await ctx.db.delete("practiceMembers", membership._id);
    return membership._id;
  },
  returns: v.union(v.id("practiceMembers"), v.null()),
});

export const upsertPracticeMemberByWorkOSOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    role: practiceRoleValidator,
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    if (!practice) {
      return null;
    }
    const user = await requireUserByAuthId(ctx.db, args.workOSUserId);
    return await upsertPracticeMembership(ctx, {
      practiceId: practice._id,
      role: args.role,
      userId: user._id,
    });
  },
  returns: v.union(v.id("practiceMembers"), v.null()),
});

export function canManageWorkOSOrganizationUsers(
  membership: Pick<WorkOSOrganizationMembership, "roleSlugs" | "status">,
): boolean {
  return (
    membership.status === "active" &&
    (hasWorkOSRoleSlug(membership.roleSlugs, "admin") ||
      hasWorkOSRoleSlug(membership.roleSlugs, "owner"))
  );
}

export function getWorkOSOrganizationMembershipRoleSlugs(
  membership: Record<string, unknown>,
): string[] {
  return [
    ...getWorkOSRoleObjectSlugs(membership["role"]),
    ...getWorkOSRoleObjectSlugs(membership["roles"]),
  ];
}

export function mapWorkOSRoleSlugsToPracticeRole(
  roleSlugs: readonly string[],
): PracticeRole {
  if (hasWorkOSRoleSlug(roleSlugs, "owner")) {
    return "owner";
  }
  if (hasWorkOSRoleSlug(roleSlugs, "admin")) {
    return "admin";
  }
  return "staff";
}

export function mapWorkOSRoleToPracticeRole(
  membership: Pick<WorkOSOrganizationMembership, "roleSlugs">,
): PracticeRole {
  return mapWorkOSRoleSlugsToPracticeRole(membership.roleSlugs);
}

async function createWorkOSOrganization(name: string): Promise<{ id: string }> {
  const response = await fetch(`${WORKOS_API_BASE}/organizations`, {
    body: JSON.stringify({ name }),
    headers: workOSHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `WorkOS organization creation failed with status ${response.status}: ${await readWorkOSError(response)}`,
    );
  }
  return parseWorkOSObjectWithId(await response.json(), "organization");
}

async function createWorkOSOrganizationMembership(args: {
  organizationId: string;
  roleSlug: PracticeRole;
  userId: string;
}): Promise<WorkOSOrganizationMembership> {
  const response = await createWorkOSOrganizationMembershipRequest(args);
  if (!response.ok) {
    throw new Error(
      `WorkOS organization membership creation failed with status ${response.status}: ${await readWorkOSError(response)}`,
    );
  }
  return parseWorkOSOrganizationMembership(await response.json());
}

async function createWorkOSOrganizationMembershipRequest(args: {
  organizationId: string;
  roleSlug?: PracticeRole;
  userId: string;
}): Promise<Response> {
  return await fetch(
    `${WORKOS_API_BASE}/user_management/organization_memberships`,
    {
      body: JSON.stringify({
        organization_id: args.organizationId,
        ...(args.roleSlug ? { role_slug: args.roleSlug } : {}),
        user_id: args.userId,
      }),
      headers: workOSHeaders(),
      method: "POST",
    },
  );
}

async function createWorkOSWidgetToken(args: {
  organizationId: string;
  scopes: string[];
  userId: string;
}): Promise<string> {
  const response = await fetch(`${WORKOS_API_BASE}/widgets/token`, {
    body: JSON.stringify({
      organization_id: args.organizationId,
      scopes: args.scopes,
      user_id: args.userId,
    }),
    headers: workOSHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `WorkOS widget token creation failed with status ${response.status}: ${await readWorkOSError(response)}`,
    );
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value["token"] !== "string") {
    throw new Error("WorkOS widget token response was invalid.");
  }
  return value["token"];
}

async function findPracticeByName(
  db: DatabaseReader,
  name: string,
): Promise<Doc<"practices"> | null> {
  return await db
    .query("practices")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();
}

async function findPracticeByWorkOSOrganizationId(
  db: DatabaseReader,
  organizationId: string,
): Promise<Doc<"practices"> | null> {
  return await db
    .query("practices")
    .withIndex("by_workOSOrganizationId", (q) =>
      q.eq("workOSOrganizationId", organizationId),
    )
    .first();
}

async function findUserByAuthId(
  db: DatabaseReader,
  authId: string,
): Promise<Doc<"users"> | null> {
  return await db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .first();
}

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

function getWorkOSRoleObjectSlugs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => getWorkOSRoleObjectSlugs(item));
  }
  if (!isRecord(value)) {
    return [];
  }
  const slug = value["slug"];
  return typeof slug === "string" ? [slug] : [];
}

function hasWorkOSRoleSlug(
  roleSlugs: readonly string[],
  expectedSlug: PracticeRole,
): boolean {
  return roleSlugs.some(
    (slug) => slug === expectedSlug || slug === `org:${expectedSlug}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkOSMembershipStatus(
  value: unknown,
): value is WorkOSMembershipStatus {
  return ["active", "inactive", "pending"].includes(String(value));
}

async function loadActiveWorkOSOrganizationMembership(args: {
  organizationId: string;
  userId: string;
}): Promise<null | WorkOSOrganizationMembership> {
  const memberships = await loadActiveWorkOSOrganizationMemberships(args);
  const membership = memberships.at(0);
  return membership ?? null;
}

async function loadActiveWorkOSOrganizationMemberships(args: {
  organizationId?: string;
  userId: string;
}): Promise<WorkOSOrganizationMembership[]> {
  const url = new URL(
    `${WORKOS_API_BASE}/user_management/organization_memberships`,
  );
  if (args.organizationId) {
    url.searchParams.set("organization_id", args.organizationId);
  }
  url.searchParams.set("user_id", args.userId);
  url.searchParams.set("statuses[]", "active");

  const response = await fetch(url, {
    headers: workOSHeaders(),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `WorkOS organization membership lookup failed with status ${response.status}: ${await readWorkOSError(response)}`,
    );
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value["data"])) {
    throw new Error("WorkOS organization memberships response was invalid.");
  }
  const memberships: unknown[] = value["data"];
  return memberships.map((membership) =>
    parseWorkOSOrganizationMembership(membership),
  );
}

async function loadWorkOSOrganization(
  organizationId: string,
): Promise<WorkOSOrganizationSummary> {
  const response = await fetch(
    `${WORKOS_API_BASE}/organizations/${organizationId}`,
    {
      headers: workOSHeaders(),
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(
      `WorkOS organization lookup failed with status ${response.status}: ${await readWorkOSError(response)}`,
    );
  }
  return parseWorkOSOrganization(await response.json());
}

function parseWorkOSObjectWithId(
  value: unknown,
  expectedObject: string,
): { id: string } {
  const payload =
    isRecord(value) && isRecord(value[expectedObject])
      ? value[expectedObject]
      : value;
  if (!isRecord(payload) || typeof payload["id"] !== "string") {
    throw new Error(`WorkOS ${expectedObject} response was invalid.`);
  }
  return { id: payload["id"] };
}

function parseWorkOSOrganization(value: unknown): WorkOSOrganizationSummary {
  const payload =
    isRecord(value) && isRecord(value["organization"])
      ? value["organization"]
      : value;
  if (
    !isRecord(payload) ||
    typeof payload["id"] !== "string" ||
    typeof payload["name"] !== "string"
  ) {
    throw new Error("WorkOS organization response was invalid.");
  }
  return { id: payload["id"], name: payload["name"] };
}

function parseWorkOSOrganizationMembership(
  value: unknown,
): WorkOSOrganizationMembership {
  const payload =
    isRecord(value) && isRecord(value["organization_membership"])
      ? value["organization_membership"]
      : value;
  if (!isRecord(payload)) {
    throw new Error("WorkOS organization membership response was invalid.");
  }

  const id = payload["id"];
  const object = payload["object"];
  const organizationId = payload["organization_id"];
  const status = payload["status"];
  const userId = payload["user_id"];
  if (
    typeof id !== "string" ||
    object !== "organization_membership" ||
    typeof organizationId !== "string" ||
    !isWorkOSMembershipStatus(status) ||
    typeof userId !== "string"
  ) {
    throw new Error("WorkOS organization membership response was invalid.");
  }

  return {
    id,
    object,
    organizationId,
    roleSlugs: getWorkOSOrganizationMembershipRoleSlugs(payload),
    status,
    userId,
  };
}

async function readWorkOSError(response: Response): Promise<string> {
  const body = await response.text();
  return body.length > 0 ? body : response.statusText;
}

async function requireActionIdentity(ctx: {
  auth: {
    getUserIdentity: () => Promise<null | { subject: string }>;
  };
}): Promise<{ subject: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return identity;
}

async function requireKnownWorkOSOrganization(
  ctx: ActionCtx,
  organizationId: string,
): Promise<void> {
  const exists = await ctx.runQuery(
    internal.workosOrganizations.hasPracticeForWorkOSOrganization,
    { organizationId },
  );
  if (!exists) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Organization is not managed by this application",
    });
  }
}

async function requireUserByAuthId(
  db: DatabaseReader,
  authId: string,
): Promise<Doc<"users">> {
  const user = await findUserByAuthId(db, authId);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authenticated user is not provisioned in Convex",
    });
  }
  return user;
}

async function upsertPracticeMembership(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    practiceId: Id<"practices">;
    role: PracticeRole;
    userId: Id<"users">;
  },
): Promise<Id<"practiceMembers">> {
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
  return await ctx.db.insert("practiceMembers", {
    createdAt: BigInt(Date.now()),
    practiceId: args.practiceId,
    role: args.role,
    userId: args.userId,
  });
}

function workOSHeaders(): Headers {
  const apiKey = process.env["WORKOS_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing WORKOS_API_KEY environment variable.");
  }
  return new Headers({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
}
