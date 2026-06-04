import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import {
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQuery,
} from "./userIdentity";

type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

export const practiceRoleValidator = v.union(
  v.literal("staff"),
  v.literal("admin"),
  v.literal("owner"),
);

export type PracticeRole = Doc<"practiceMembers">["role"];

interface PracticeScopedResource {
  practiceId: Id<"practices">;
}

interface RuleSetAccess {
  membership: Doc<"practiceMembers">;
  practiceId: Id<"practices">;
  ruleSet: Doc<"ruleSets">;
}

const ROLE_WEIGHT: Record<PracticeRole, number> = {
  admin: 2,
  owner: 3,
  staff: 1,
};

export async function ensurePracticeAccessForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
  minimumRole: PracticeRole = "staff",
): Promise<Doc<"practiceMembers">> {
  const userId = await ensureAuthenticatedUserId(ctx);
  const membership = await findPracticeMembership(ctx, practiceId, userId);

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

export async function ensurePracticeAccessForQuery(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
  minimumRole: PracticeRole = "staff",
): Promise<Doc<"practiceMembers">> {
  if (isConvexAuthBypassEnabled()) {
    const membership = await findAnyPracticeMembership(ctx, practiceId);
    if (!membership) {
      throw forbiddenError("No access to this practice");
    }
    return membership;
  }

  const userId = await getQueryUserId(ctx);
  if (!userId) {
    throw unauthorizedError("Authenticated user is not provisioned in Convex");
  }
  const membership = await findPracticeMembership(ctx, practiceId, userId);

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

export async function ensureRuleSetAccessForMutation(
  ctx: MutationCtx,
  ruleSetId: Id<"ruleSets">,
  minimumRole: PracticeRole = "staff",
): Promise<Id<"practices">> {
  const ruleSet = await ctx.db.get("ruleSets", ruleSetId);
  if (!ruleSet) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Rule set not found",
    });
  }

  await ensurePracticeAccessForMutation(ctx, ruleSet.practiceId, minimumRole);
  return ruleSet.practiceId;
}

export async function ensureRuleSetAccessForQuery(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
  minimumRole: PracticeRole = "staff",
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
  if (isConvexAuthBypassEnabled()) {
    const practices = await ctx.db.query("practices").collect();
    return practices.map((practice) => practice._id);
  }
  const { _id: userId } = await requireUser(ctx);
  const memberships = await ctx.db
    .query("practiceMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  return memberships.map((membership) => membership.practiceId);
}

export function isConvexAuthBypassEnabled(): boolean {
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") {
    return false;
  }
  const bypassEnabled =
    process.env["AUTH_BYPASS_ENABLED"] === "true" ||
    process.env["VITE_AUTH_BYPASS_ENABLED"] === "true";
  if (!bypassEnabled) {
    return false;
  }
  return (
    process.env["VERCEL_ENV"] !== "production" &&
    process.env["VITE_VERCEL_ENV"] !== "production"
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
  if (!isConvexAuthBypassEnabled()) {
    await requireUser(ctx);
  }
  return await requireRule(ctx, ruleSetId);
}

export async function requireCurrentUserBookingScope(
  ctx: QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<{ practiceId: Id<"practices">; userId: Id<"users"> }> {
  const user = await requireUser(ctx);
  await requireRuleSetBelongsToPractice(ctx, args.ruleSetId, args.practiceId);
  return { practiceId: args.practiceId, userId: user._id };
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

export async function requirePracticeManager(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"practiceMembers">> {
  return await ensurePracticeAccessForQuery(ctx, practiceId, "admin");
}

export async function requirePracticeManagerForMutation(
  ctx: MutationCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"practiceMembers">> {
  return await ensurePracticeAccessForMutation(ctx, practiceId, "admin");
}

export async function requirePracticeMember(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
  minimumRole: PracticeRole = "staff",
): Promise<Doc<"practiceMembers">> {
  return await ensurePracticeAccessForQuery(ctx, practiceId, minimumRole);
}

export async function requirePracticeMemberOrCurrentUserBookingScope(
  ctx: QueryCtx,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<{
  membership?: Doc<"practiceMembers">;
  practiceId: Id<"practices">;
  userId?: Id<"users">;
}> {
  await requireRuleSetBelongsToPractice(ctx, args.ruleSetId, args.practiceId);
  if (isConvexAuthBypassEnabled()) {
    return { practiceId: args.practiceId };
  }
  const user = await requireUser(ctx);
  const membership = await findPracticeMembership(
    ctx,
    args.practiceId,
    user._id,
  );
  return {
    ...(membership ? { membership } : {}),
    practiceId: args.practiceId,
    userId: user._id,
  };
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
  minimumRole: PracticeRole = "staff",
): Promise<RuleSetAccess> {
  const ruleSet = await requireRule(ctx, ruleSetId);
  const membership = await ensurePracticeAccessForQuery(
    ctx,
    ruleSet.practiceId,
    minimumRole,
  );
  return { membership, practiceId: ruleSet.practiceId, ruleSet };
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

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await getAuthenticatedUserIdForQuery(ctx);
  if (!userId) {
    throw unauthorizedError("Authenticated user is not provisioned in Convex");
  }

  const user = await ctx.db.get("users", userId);
  if (!user) {
    throw unauthorizedError("Authenticated user row was not found");
  }

  return user;
}

async function findAnyPracticeMembership(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
): Promise<Doc<"practiceMembers"> | null> {
  return await ctx.db
    .query("practiceMembers")
    .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
    .first();
}

async function findPracticeMembership(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
  userId: Id<"users">,
): Promise<Doc<"practiceMembers"> | null> {
  return await ctx.db
    .query("practiceMembers")
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

async function getQueryUserId(ctx: QueryCtx): Promise<Id<"users"> | null> {
  return await getAuthenticatedUserIdForQuery(ctx);
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
  actual: PracticeRole,
  minimum: PracticeRole,
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
