import type { GenericMutationCtx } from "convex/server";

import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import { toPracticeSlug } from "../lib/practice-slug";
import { internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { isConvexAuthBypassEnabled } from "./authBypass";
import { createInitialRuleSet } from "./copyOnWrite";
import {
  DEV_AUTH_ORGANIZATION_ID,
  DEV_AUTH_PRACTICE_NAME,
  isDevAuthUserId,
} from "./devAuthData";
import {
  type OrganizationRole,
  organizationRoleValidator,
} from "./practiceAccess";
import { allocateUniquePracticeSlug } from "./practiceSlugs";

const WORKOS_API_BASE = `https://${getWorkOSApiHostname()}`;

type OrganizationPracticeCreationResult =
  | {
      message: string;
      reason: "practiceNameAlreadyExists" | "userAlreadyHasOrganization";
      status: "warning";
    }
  | {
      organizationId: string;
      practiceId: Id<"practices">;
      status: "created";
    };

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
  practiceId?: Id<"practices">;
}

const organizationPracticeCreationResultValidator = v.union(
  v.object({
    organizationId: v.string(),
    practiceId: v.id("practices"),
    status: v.literal("created"),
  }),
  v.object({
    message: v.string(),
    reason: v.union(
      v.literal("practiceNameAlreadyExists"),
      v.literal("userAlreadyHasOrganization"),
    ),
    status: v.literal("warning"),
  }),
);

export const createOrganizationPractice = action({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) =>
    await createOrganizationPracticeForCurrentUser(ctx, args),
  returns: organizationPracticeCreationResultValidator,
});

export async function createOrganizationPracticeForCurrentUser(
  ctx: ActionCtx,
  args: { name: string },
): Promise<OrganizationPracticeCreationResult> {
  const identity = await requireActionIdentity(ctx);
  const name = args.name.trim();
  if (name.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Practice name is required",
    });
  }
  await ctx.runQuery(internal.workosOrganizations.requireUniqueUserIdByAuthId, {
    authId: identity.subject,
  });
  if (shouldUseBypassOrganizations(identity.subject)) {
    return await ctx.runMutation(
      internal.workosOrganizations.createBypassOrganizationPractice,
      {
        name,
        workOSUserId: identity.subject,
      },
    );
  }
  const existingMemberships = await loadActiveWorkOSOrganizationMemberships({
    userId: identity.subject,
  });
  if (existingMemberships.length > 0) {
    return {
      message: "Ihr Benutzerkonto ist bereits einer Praxis zugeordnet.",
      reason: "userAlreadyHasOrganization",
      status: "warning",
    };
  }
  const existingPracticeId = await ctx.runQuery(
    internal.workosOrganizations.getPracticeIdByName,
    { name },
  );
  if (existingPracticeId) {
    return {
      message:
        "Dieser Praxisname ist bereits vergeben. Bitte waehlen Sie einen eindeutigen Namen.",
      reason: "practiceNameAlreadyExists",
      status: "warning",
    };
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

  return { organizationId: organization.id, practiceId, status: "created" };
}

export const syncCurrentUserOrganizationMembership = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"organizationMembers"> | null> => {
    const identity = await requireActionIdentity(ctx);
    if (shouldUseBypassOrganizations(identity.subject)) {
      return await ctx.runMutation(
        internal.workosOrganizations.syncBypassOrganizationMembership,
        {
          organizationId: args.organizationId,
          workOSUserId: identity.subject,
        },
      );
    }
    const membership = await loadActiveWorkOSOrganizationMembership({
      organizationId: args.organizationId,
      userId: identity.subject,
    });

    if (!membership) {
      await ctx.runMutation(
        internal.workosOrganizations
          .removeOrganizationMemberByWorkOSOrganization,
        {
          organizationId: args.organizationId,
          workOSUserId: identity.subject,
        },
      );
      return null;
    }

    const role = mapWorkOSRoleToOrganizationRoleOrNull(membership);
    if (!role) {
      await ctx.runMutation(
        internal.workosOrganizations
          .removeOrganizationMemberByWorkOSOrganization,
        {
          organizationId: args.organizationId,
          workOSUserId: identity.subject,
        },
      );
      return null;
    }

    return await ctx.runMutation(
      internal.workosOrganizations.upsertOrganizationMemberByWorkOSOrganization,
      {
        organizationId: args.organizationId,
        role,
        workOSUserId: identity.subject,
      },
    );
  },
  returns: v.union(v.id("organizationMembers"), v.null()),
});

export const joinBookingPracticeBySlug = action({
  args: {
    practiceSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"organizationMembers">> => {
    const identity = await requireActionIdentity(ctx);
    await provisionUserFromTrustedWorkOSIdentity(ctx, identity.subject);

    const organizationId = await ctx.runQuery(
      internal.workosOrganizations.getWorkOSOrganizationIdByPracticeSlug,
      { slug: args.practiceSlug },
    );
    if (!organizationId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Practice is not available for booking",
      });
    }

    if (shouldUseBypassOrganizations(identity.subject)) {
      return await ctx.runMutation(
        internal.workosOrganizations.joinBypassBookingPracticeBySlug,
        {
          role: "patient",
          slug: args.practiceSlug,
          workOSUserId: identity.subject,
        },
      );
    }
    await ctx.runQuery(
      internal.workosOrganizations.requireNoOtherLocalOrganizationMembership,
      {
        organizationId,
        workOSUserId: identity.subject,
      },
    );

    const memberships = await loadActiveWorkOSOrganizationMemberships({
      userId: identity.subject,
    });
    if (
      memberships.some(
        (membership) => membership.organizationId !== organizationId,
      )
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "User already belongs to another WorkOS organization",
      });
    }

    const targetMembership = memberships.find(
      (membership) => membership.organizationId === organizationId,
    );
    if (targetMembership) {
      const role = mapWorkOSRoleToOrganizationRoleOrNull(targetMembership);
      if (!role) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "WorkOS organization membership has no supported role",
        });
      }
      const membershipId = await ctx.runMutation(
        internal.workosOrganizations
          .upsertOrganizationMemberByWorkOSOrganization,
        {
          organizationId,
          role,
          workOSUserId: identity.subject,
        },
      );
      if (!membershipId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Practice is not available for booking",
        });
      }
      return membershipId;
    }

    await createWorkOSOrganizationMembership({
      organizationId,
      roleSlug: "patient",
      userId: identity.subject,
    });
    const membershipId = await ctx.runMutation(
      internal.workosOrganizations.upsertOrganizationMemberByWorkOSOrganization,
      {
        organizationId,
        role: "patient",
        workOSUserId: identity.subject,
      },
    );
    if (!membershipId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Practice is not available for booking",
      });
    }
    return membershipId;
  },
  returns: v.id("organizationMembers"),
});

export const getUsersManagementWidgetToken = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const identity = await requireActionIdentity(ctx);
    if (shouldUseBypassOrganizations(identity.subject)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "WorkOS user management is unavailable in auth bypass mode",
      });
    }
    await requireKnownWorkOSOrganization(ctx, args.organizationId);
    const membership = await loadActiveWorkOSOrganizationMembership({
      organizationId: args.organizationId,
      userId: identity.subject,
    });
    if (!membership || !canManageWorkOSOrganizationUsers(membership)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "WorkOS organization owner role required",
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
    if (shouldUseBypassOrganizations(identity.subject)) {
      return await ctx.runQuery(
        internal.workosOrganizations.listBypassUserOrganizations,
        {
          workOSUserId: identity.subject,
        },
      );
    }
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
      practiceId: v.optional(v.id("practices")),
    }),
  ),
});

export const createBypassOrganizationPractice = internalMutation({
  args: {
    name: v.string(),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args): Promise<OrganizationPracticeCreationResult> => {
    const user = await requireUserByAuthId(ctx.db, args.workOSUserId);
    const existingMemberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    if (existingMemberships.length > 0) {
      return {
        message: "Ihr Benutzerkonto ist bereits einer Praxis zugeordnet.",
        reason: "userAlreadyHasOrganization",
        status: "warning",
      };
    }
    const existingPractice = await findPracticeByName(ctx.db, args.name);
    if (existingPractice) {
      return {
        message:
          "Dieser Praxisname ist bereits vergeben. Bitte waehlen Sie einen eindeutigen Namen.",
        reason: "practiceNameAlreadyExists",
        status: "warning",
      };
    }

    const organizationId = await allocateBypassOrganizationId(
      ctx.db,
      args.name,
    );
    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
      slug: await allocateUniquePracticeSlug(ctx.db, args.name),
      workOSOrganizationId: organizationId,
    });
    await upsertOrganizationMembership(ctx, {
      practiceId,
      role: "owner",
      userId: user._id,
    });
    await createInitialRuleSet(ctx.db, practiceId);
    return { organizationId, practiceId, status: "created" };
  },
  returns: organizationPracticeCreationResultValidator,
});

export const listBypassUserOrganizations = internalQuery({
  args: {
    workOSUserId: v.string(),
  },
  handler: async (ctx, args): Promise<WorkOSOrganizationSummary[]> => {
    const user = await findUserByAuthId(ctx.db, args.workOSUserId);
    if (!user) {
      return [];
    }
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    const practices = await Promise.all(
      memberships.map(async (membership) => {
        return await ctx.db.get("practices", membership.practiceId);
      }),
    );
    return practices.flatMap((practice) => {
      if (!practice?.workOSOrganizationId) {
        return [];
      }
      return [
        {
          id: practice.workOSOrganizationId,
          name: practice.name,
          practiceId: practice._id,
        },
      ];
    });
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      practiceId: v.optional(v.id("practices")),
    }),
  ),
});

export const syncBypassOrganizationMembership = internalMutation({
  args: {
    organizationId: v.string(),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"organizationMembers"> | null> => {
    const practice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    const user = await findUserByAuthId(ctx.db, args.workOSUserId);
    if (!practice || !user) {
      return null;
    }
    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", practice._id).eq("userId", user._id),
      )
      .first();
    return membership?._id ?? null;
  },
  returns: v.union(v.id("organizationMembers"), v.null()),
});

export const joinBypassBookingPracticeBySlug = internalMutation({
  args: {
    role: organizationRoleValidator,
    slug: v.string(),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"organizationMembers">> => {
    const practice = await findPracticeBySlug(ctx.db, args.slug);
    const user = await requireUserByAuthId(ctx.db, args.workOSUserId);
    if (!practice?.workOSOrganizationId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Practice is not available for booking",
      });
    }
    return await upsertOrganizationMembership(ctx, {
      practiceId: practice._id,
      role: args.role,
      userId: user._id,
    });
  },
  returns: v.id("organizationMembers"),
});

export const createPracticeForWorkOSOrganization = internalMutation({
  args: {
    name: v.string(),
    organizationId: v.string(),
    role: organizationRoleValidator,
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUserByAuthId(ctx.db, args.workOSUserId);
    const existingPractice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );

    if (existingPractice) {
      await upsertOrganizationMembership(ctx, {
        practiceId: existingPractice._id,
        role: args.role,
        userId: user._id,
      });
      return existingPractice._id;
    }

    const practiceId = await ctx.db.insert("practices", {
      name: args.name,
      slug: await allocateUniquePracticeSlug(ctx.db, args.name),
      workOSOrganizationId: args.organizationId,
    });
    await upsertOrganizationMembership(ctx, {
      practiceId,
      role: args.role,
      userId: user._id,
    });
    await createInitialRuleSet(ctx.db, practiceId);

    return practiceId;
  },
  returns: v.id("practices"),
});

export const requireUniqueUserIdByAuthId = internalQuery({
  args: {
    authId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUserByAuthId(ctx.db, args.authId);
    return user._id;
  },
  returns: v.id("users"),
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

export const getWorkOSOrganizationIdByPracticeSlug = internalQuery({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const practice = await findPracticeBySlug(ctx.db, args.slug);
    return practice?.workOSOrganizationId ?? null;
  },
  returns: v.union(v.string(), v.null()),
});

export const requireNoOtherLocalOrganizationMembership = internalQuery({
  args: {
    organizationId: v.string(),
    workOSUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const targetPractice = await findPracticeByWorkOSOrganizationId(
      ctx.db,
      args.organizationId,
    );
    if (!targetPractice) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Practice is not available for booking",
      });
    }
    const user = await findUserByAuthId(ctx.db, args.workOSUserId);
    if (!user) {
      return null;
    }
    const existingMembership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (
      existingMembership &&
      existingMembership.practiceId !== targetPractice._id
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "User already belongs to another WorkOS organization",
      });
    }
    return null;
  },
  returns: v.null(),
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

export const removeOrganizationMemberByWorkOSOrganization = internalMutation({
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
      .query("organizationMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", practice._id).eq("userId", user._id),
      )
      .first();
    if (!membership) {
      return null;
    }
    await ctx.db.delete("organizationMembers", membership._id);
    return membership._id;
  },
  returns: v.union(v.id("organizationMembers"), v.null()),
});

export const upsertOrganizationMemberByWorkOSOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    role: organizationRoleValidator,
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
    return await upsertOrganizationMembership(ctx, {
      practiceId: practice._id,
      role: args.role,
      userId: user._id,
    });
  },
  returns: v.union(v.id("organizationMembers"), v.null()),
});

export function canManageWorkOSOrganizationUsers(
  membership: Pick<WorkOSOrganizationMembership, "roleSlugs" | "status">,
): boolean {
  return (
    membership.status === "active" &&
    hasWorkOSRoleSlug(membership.roleSlugs, "owner")
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

export function mapWorkOSRoleSlugsToOrganizationRole(
  roleSlugs: readonly string[],
): OrganizationRole {
  const role = mapWorkOSRoleSlugsToOrganizationRoleOrNull(roleSlugs);
  if (role) {
    return role;
  }
  throw new Error(
    `WorkOS organization membership has no supported role slug: ${roleSlugs.join(", ")}`,
  );
}

export function mapWorkOSRoleSlugsToOrganizationRoleOrNull(
  roleSlugs: readonly string[],
): null | OrganizationRole {
  if (hasWorkOSRoleSlug(roleSlugs, "owner")) {
    return "owner";
  }
  if (hasWorkOSRoleSlug(roleSlugs, "admin")) {
    return "admin";
  }
  if (hasWorkOSRoleSlug(roleSlugs, "staff")) {
    return "staff";
  }
  if (hasWorkOSRoleSlug(roleSlugs, "patient")) {
    return "patient";
  }
  return null;
}

export function mapWorkOSRoleToOrganizationRole(
  membership: Pick<WorkOSOrganizationMembership, "roleSlugs">,
): OrganizationRole {
  return mapWorkOSRoleSlugsToOrganizationRole(membership.roleSlugs);
}

export function mapWorkOSRoleToOrganizationRoleOrNull(
  membership: Pick<WorkOSOrganizationMembership, "roleSlugs">,
): null | OrganizationRole {
  return mapWorkOSRoleSlugsToOrganizationRoleOrNull(membership.roleSlugs);
}

async function allocateBypassOrganizationId(
  db: DatabaseReader,
  name: string,
): Promise<string> {
  const baseId =
    name === DEV_AUTH_PRACTICE_NAME
      ? DEV_AUTH_ORGANIZATION_ID
      : `org_dev_${toPracticeSlug(name).replaceAll("-", "_")}`;
  let candidate = baseId;
  let suffix = 2;

  while ((await findPracticeByWorkOSOrganizationId(db, candidate)) !== null) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }

  return candidate;
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
  roleSlug: OrganizationRole;
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
  roleSlug?: OrganizationRole;
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

async function findPracticeBySlug(
  db: DatabaseReader,
  slug: string,
): Promise<Doc<"practices"> | null> {
  const practices = await db
    .query("practices")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .collect();
  return practices.length === 1 ? (practices[0] ?? null) : null;
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
  expectedSlug: OrganizationRole,
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

async function loadTrustedWorkOSUser(workOSUserId: string): Promise<{
  email: string;
  firstName?: string;
  id: string;
  lastName?: string;
}> {
  const response = await fetch(
    `${WORKOS_API_BASE}/user_management/users/${encodeURIComponent(workOSUserId)}`,
    {
      headers: workOSHeaders(),
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(
      `WorkOS user lookup failed with status ${response.status}: ${await readWorkOSError(response)}`,
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

async function provisionUserFromTrustedWorkOSIdentity(
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
  const users = await db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .collect();
  if (users.length === 0) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authenticated user is not provisioned in Convex",
    });
  }
  if (users.length > 1) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Multiple app users exist for authenticated identity",
    });
  }
  const user = users[0];
  if (!user) {
    throw new Error("Expected exactly one user.");
  }
  return user;
}

function shouldUseBypassOrganizations(workOSUserId: string): boolean {
  return isConvexAuthBypassEnabled() || isDevAuthUserId(workOSUserId);
}

async function upsertOrganizationMembership(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    practiceId: Id<"practices">;
    role: OrganizationRole;
    userId: Id<"users">;
  },
): Promise<Id<"organizationMembers">> {
  const existing = await ctx.db
    .query("organizationMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", args.practiceId).eq("userId", args.userId),
    )
    .first();
  if (existing) {
    await ctx.db.patch("organizationMembers", existing._id, {
      role: args.role,
    });
    return existing._id;
  }
  const existingUserMembership = await ctx.db
    .query("organizationMembers")
    .withIndex("by_userId", (q) => q.eq("userId", args.userId))
    .first();
  if (
    existingUserMembership &&
    existingUserMembership.practiceId !== args.practiceId
  ) {
    throw new ConvexError({
      code: "ALREADY_EXISTS",
      message: "User already belongs to another WorkOS organization",
    });
  }
  return await ctx.db.insert("organizationMembers", {
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
