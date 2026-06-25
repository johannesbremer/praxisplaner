import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import {
  ensureAuthenticatedUserId,
  requireAuthenticatedUserIdForQuery,
} from "./userIdentity";

type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

export const organizationRoleValidator = v.union(
  v.literal("patient"),
  v.literal("staff"),
  v.literal("admin"),
  v.literal("owner"),
);

export type ManagerOrganizationRole = Extract<
  OrganizationRole,
  "admin" | "owner"
>;
export type OrganizationRole = Doc<"organizationMembers">["role"];
export type StaffOrganizationRole = Exclude<OrganizationRole, "patient">;

interface PracticeScopedResource {
  practiceId: Id<"practices">;
}

interface RuleSetAccess {
  membership: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
}

declare const scopeBrand: unique symbol;

export type ManagerPracticeScope = ScopeBrand<"ManagerPracticeScope"> & {
  membership: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
};

export type ManagerRuleSetScope = ScopeBrand<"ManagerRuleSetScope"> & {
  membership: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
  ruleSetId: Id<"ruleSets">;
};

export type MigrationRehearsalScope = ScopeBrand<"MigrationRehearsalScope"> & {
  practiceId: Id<"practices">;
  ruleSet?: Doc<"ruleSets">;
  ruleSetId?: Id<"ruleSets">;
};

export type PatientBookingScope = ScopeBrand<"PatientBookingScope"> & {
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
  ruleSetId: Id<"ruleSets">;
  userId: Id<"users">;
};

export type StaffPracticeScope = ScopeBrand<"StaffPracticeScope"> & {
  membership: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
};

export type StaffRuleSetScope = ScopeBrand<"StaffRuleSetScope"> & {
  membership: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
  ruleSetId: Id<"ruleSets">;
};

export type TrustedPracticeScope = ScopeBrand<"TrustedPracticeScope"> & {
  practiceId: Id<"practices">;
};

export type TrustedRuleSetScope = ScopeBrand<"TrustedRuleSetScope"> & {
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
  ruleSetId: Id<"ruleSets">;
};

interface ScopeBrand<Name extends string> {
  readonly [scopeBrand]: Name;
}

const ROLE_WEIGHT: Record<OrganizationRole, number> = {
  admin: 2,
  owner: 3,
  patient: 0,
  staff: 1,
};

export async function ensureRuleSetAccessForMutation(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
  minimumRole: StaffOrganizationRole = "staff",
): Promise<Id<"practices">> {
  const ruleSet = await ctx.db.get("ruleSets", ruleSetId);
  if (!ruleSet) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Rule set not found",
    });
  }

  await ensureOrganizationAccessForMutation(
    ctx,
    ruleSet.practiceId,
    minimumRole,
  );
  return ruleSet.practiceId;
}

export async function ensureRuleSetAccessForQuery(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
  minimumRole: StaffOrganizationRole = "staff",
): Promise<Id<"practices">> {
  const { practiceId } = await requireRuleSetMember(
    ctx,
    ruleSetId,
    minimumRole,
  );
  return practiceId;
}

export async function getAccessiblePracticeIdsForQuery(
  ctx: QueryCtx,
): Promise<Id<"practices">[]> {
  const { _id: userId } = await requireUser(ctx);
  const memberships = await ctx.db
    .query("organizationMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  return memberships.map((membership) => membership.practiceId);
}

export async function getAccessibleStaffPracticeIdsForQuery(
  ctx: QueryCtx,
): Promise<Id<"practices">[]> {
  const { _id: userId } = await requireUser(ctx);
  const memberships = await ctx.db
    .query("organizationMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  return memberships.flatMap((membership) =>
    membership.role === "patient" ? [] : [membership.practiceId],
  );
}

export async function requireActiveBookingRuleSet(
  ctx: MutationCtx | QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"ruleSets">> {
  const practice = await ctx.db.get("practices", args.practiceId);
  if (!practice) {
    throw notFoundError("Practice not found");
  }
  if (practice.currentActiveRuleSetId !== args.ruleSetId) {
    throw forbiddenError("Booking rule set is not active for this practice");
  }
  return await requireRule(ctx, args.ruleSetId);
}

export async function requireAuthenticatedRuleSet(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<Doc<"ruleSets">> {
  await requireUser(ctx);
  return await requireRule(ctx, ruleSetId);
}

export async function requireCurrentUserBookingScope(
  ctx: QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<PatientBookingScope> {
  const user = await requireUser(ctx);
  const ruleSet = await requireRuleSetBelongsToPractice(
    ctx,
    args.ruleSetId,
    args.practiceId,
  );
  return brandScope({
    practiceId: args.practiceId,
    ruleSet,
    ruleSetId: args.ruleSetId,
    userId: user._id,
  } as PatientBookingScope);
}

export async function requireManagerPracticeScope(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<ManagerPracticeScope> {
  const membership = await requirePracticeManager(ctx, practiceId);
  return brandScope({ membership, practiceId } as ManagerPracticeScope);
}

export async function requireManagerPracticeScopeForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<ManagerPracticeScope> {
  const membership = await requirePracticeManagerForMutation(ctx, practiceId);
  return brandScope({ membership, practiceId } as ManagerPracticeScope);
}

export async function requireManagerRuleSetScope(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<ManagerRuleSetScope> {
  const { membership, practiceId, ruleSet } = await requireRuleSetMember(
    ctx,
    ruleSetId,
    "admin",
  );
  return brandScope({
    membership,
    practiceId,
    ruleSet,
    ruleSetId,
  } as ManagerRuleSetScope);
}

export async function requireManagerRuleSetScopeForMutation(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<ManagerRuleSetScope> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  const membership = await ensureOrganizationAccessForMutation(
    ctx,
    ruleSet.practiceId,
    "admin",
  );
  return brandScope({
    membership,
    practiceId: ruleSet.practiceId,
    ruleSet,
    ruleSetId,
  } as ManagerRuleSetScope);
}

export async function requireOrganizationMember(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForQuery(ctx, practiceId, "patient");
}

export async function requireOrganizationMemberForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForMutation(ctx, practiceId, "patient");
}

export async function requireOrganizationMemberOrCurrentUserBookingScope(
  ctx: QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<{
  membership?: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
  userId?: Id<"users">;
}> {
  await requireRuleSetBelongsToPractice(ctx, args.ruleSetId, args.practiceId);
  const user = await requireUser(ctx);
  const membership = await findOrganizationMembership(
    ctx,
    args.practiceId,
    user._id,
  );
  if (!membership) {
    throw forbiddenError("No access to this practice");
  }
  if (!roleSatisfiesMinimum(membership.role, "staff")) {
    const practice = await ctx.db.get("practices", args.practiceId);
    if (practice?.currentActiveRuleSetId !== args.ruleSetId) {
      throw forbiddenError("No access to this practice");
    }
    return {
      practiceId: args.practiceId,
      userId: user._id,
    };
  }
  return {
    membership,
    practiceId: args.practiceId,
    userId: user._id,
  };
}

export async function requireOwnedUserId(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user._id !== userId) {
    throw forbiddenError("Cannot read another user's data");
  }
  return user;
}

export async function requirePatientBookingScopeForMutation(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<PatientBookingScope> {
  const userId = await ensureAuthenticatedUserId(ctx);
  const membership = await findOrganizationMembership(
    ctx,
    args.practiceId,
    userId,
  );
  if (!membership) {
    throw forbiddenError("No access to this practice");
  }
  const ruleSet = await requireActiveBookingRuleSet(ctx, args);
  return brandScope({
    practiceId: args.practiceId,
    ruleSet,
    ruleSetId: args.ruleSetId,
    userId,
  } as PatientBookingScope);
}

export async function requirePracticeManager(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForQuery(ctx, practiceId, "admin");
}

export async function requirePracticeManagerForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForMutation(ctx, practiceId, "admin");
}

export async function requirePracticeOwnerForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForMutation(ctx, practiceId, "owner");
}

export async function requirePracticeStaff(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForQuery(ctx, practiceId, "staff");
}

export async function requirePracticeStaffForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"organizationMembers">> {
  return await ensureOrganizationAccessForMutation(ctx, practiceId, "staff");
}

export async function requireRuleSetBelongsToPractice(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Doc<"ruleSets">> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  return requireSamePractice(
    ruleSet,
    practiceId,
    "Rule set does not belong to this practice",
  );
}

export async function requireRuleSetManagerForMutation(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"practices">> {
  return await ensureRuleSetAccessForMutation(ctx, ruleSetId, "admin");
}

export async function requireRuleSetMember(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
  minimumRole: StaffOrganizationRole = "staff",
): Promise<RuleSetAccess> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  const membership = await ensureOrganizationAccessForQuery(
    ctx,
    ruleSet.practiceId,
    minimumRole,
  );
  return { membership, practiceId: ruleSet.practiceId, ruleSet };
}

export async function requireRuleSetMemberOrCurrentUserBookingScope(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<{
  membership?: Doc<"organizationMembers">;
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
  userId?: Id<"users">;
}> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  const scope = await requireOrganizationMemberOrCurrentUserBookingScope(ctx, {
    practiceId: ruleSet.practiceId,
    ruleSetId,
  });
  return { ...scope, ruleSet };
}

export function requireSamePractice<T extends PracticeScopedResource>(
  resource: null | T | undefined,
  practiceId: Id<"practices">,
  message = "Resource does not belong to this practice",
): T {
  if (!resource) {
    throw notFoundError("Resource not found");
  }
  if (resource.practiceId !== practiceId) {
    throw forbiddenError(message);
  }
  return resource;
}

export async function requireStaffPracticeScope(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<StaffPracticeScope> {
  const membership = await requirePracticeStaff(ctx, practiceId);
  return brandScope({ membership, practiceId } as StaffPracticeScope);
}

export async function requireStaffPracticeScopeForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<StaffPracticeScope> {
  const membership = await requirePracticeStaffForMutation(ctx, practiceId);
  return brandScope({ membership, practiceId } as StaffPracticeScope);
}

export async function requireStaffRuleSetScope(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<StaffRuleSetScope> {
  const { membership, practiceId, ruleSet } = await requireRuleSetMember(
    ctx,
    ruleSetId,
    "staff",
  );
  return brandScope({
    membership,
    practiceId,
    ruleSet,
    ruleSetId,
  } as StaffRuleSetScope);
}

export async function requireStaffRuleSetScopeForMutation(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<StaffRuleSetScope> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  const membership = await requirePracticeStaffForMutation(
    ctx,
    ruleSet.practiceId,
  );
  return brandScope({
    membership,
    practiceId: ruleSet.practiceId,
    ruleSet,
    ruleSetId,
  } as StaffRuleSetScope);
}

export async function requireTrustedPracticeScope(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
): Promise<TrustedPracticeScope> {
  const practice = await ctx.db.get("practices", practiceId);
  if (!practice) {
    throw notFoundError("Practice not found");
  }
  return brandScope({ practiceId } as TrustedPracticeScope);
}

export async function requireTrustedRuleSetScope(
  ctx: MutationCtx | QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<TrustedRuleSetScope> {
  const ruleSet = await requireRuleSetBelongsToPractice(
    ctx,
    args.ruleSetId,
    args.practiceId,
  );
  return brandScope({
    practiceId: args.practiceId,
    ruleSet,
    ruleSetId: args.ruleSetId,
  } as TrustedRuleSetScope);
}

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await requireAuthenticatedUserIdForQuery(ctx);
  const user = await ctx.db.get("users", userId);
  if (!user) {
    throw unauthorizedError("Authenticated user row was not found");
  }

  return user;
}

function brandScope<T>(scope: T): T {
  return scope;
}

async function ensureOrganizationAccessForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
  minimumRole: OrganizationRole,
): Promise<Doc<"organizationMembers">> {
  const userId = await ensureAuthenticatedUserId(ctx);
  const membership = await findOrganizationMembership(ctx, practiceId, userId);

  if (!membership) {
    throw forbiddenError("No access to this practice");
  }

  if (!roleSatisfiesMinimum(membership.role, minimumRole)) {
    throw forbiddenError(
      `Role ${membership.role} is insufficient for this action (requires ${minimumRole})`,
    );
  }

  return membership;
}

async function ensureOrganizationAccessForQuery(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
  minimumRole: OrganizationRole,
): Promise<Doc<"organizationMembers">> {
  const userId = await getQueryUserId(ctx);
  const membership = await findOrganizationMembership(ctx, practiceId, userId);

  if (!membership) {
    throw forbiddenError("No access to this practice");
  }

  if (!roleSatisfiesMinimum(membership.role, minimumRole)) {
    throw forbiddenError(
      `Role ${membership.role} is insufficient for this action (requires ${minimumRole})`,
    );
  }

  return membership;
}

async function findOrganizationMembership(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
  userId: Id<"users">,
): Promise<Doc<"organizationMembers"> | null> {
  return await ctx.db
    .query("organizationMembers")
    .withIndex("by_practiceId_userId", (q) =>
      q.eq("practiceId", practiceId).eq("userId", userId),
    )
    .first();
}

function forbiddenError(message: string): ConvexError<{
  code: "FORBIDDEN";
  message: string;
}> {
  return new ConvexError({
    code: "FORBIDDEN",
    message,
  });
}

async function getQueryUserId(ctx: QueryCtx): Promise<Id<"users">> {
  return await requireAuthenticatedUserIdForQuery(ctx);
}

function notFoundError(message: string): ConvexError<{
  code: "NOT_FOUND";
  message: string;
}> {
  return new ConvexError({
    code: "NOT_FOUND",
    message,
  });
}

async function requireRule(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
): Promise<Doc<"ruleSets">> {
  const ruleSet = await ctx.db.get("ruleSets", ruleSetId);
  if (!ruleSet) {
    throw notFoundError("Rule set not found");
  }
  return ruleSet;
}

function roleSatisfiesMinimum(
  actual: OrganizationRole,
  minimum: OrganizationRole,
): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[minimum];
}

function unauthorizedError(message: string): ConvexError<{
  code: "UNAUTHORIZED";
  message: string;
}> {
  return new ConvexError({
    code: "UNAUTHORIZED",
    message,
  });
}
