import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { findUserByAuthId } from "./userIdentity";
import {
  ensureAuthenticatedIdentity,
  ensureAuthenticatedUserId,
} from "./userIdentity";

type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

export const practiceRoleValidator = v.union(
  v.literal("staff"),
  v.literal("admin"),
  v.literal("owner"),
);

export type PracticeRole = Doc<"practiceMembers">["role"];

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
  const userId = await getQueryUserId(ctx);
  if (!userId) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authenticated user is not provisioned in Convex yet",
    });
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
  const ruleSet = await ctx.db.get("ruleSets", ruleSetId);
  if (!ruleSet) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Rule set not found",
    });
  }

  await ensurePracticeAccessForQuery(ctx, ruleSet.practiceId, minimumRole);
  return ruleSet.practiceId;
}

export async function getAccessiblePracticeIdsForQuery(
  ctx: QueryCtx,
): Promise<Id<"practices">[]> {
  const userId = await getQueryUserId(ctx);
  if (!userId) {
    return [];
  }
  const memberships = await ctx.db
    .query("practiceMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  return memberships.map((membership) => membership.practiceId);
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
  const identity = await ensureAuthenticatedIdentity(ctx);
  const user = await findUserByAuthId(ctx.db, identity.subject);
  if (!user) {
    return null;
  }
  return user._id;
}

function roleSatisfiesMinimum(
  actual: PracticeRole,
  minimum: PracticeRole,
): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[minimum];
}
