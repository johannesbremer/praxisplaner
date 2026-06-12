import type {
  GenericDatabaseReader,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import { ConvexError } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

type AuthCtx = MutationCtx | QueryCtx;
interface AuthenticatedIdentity {
  email?: string;
  subject: string;
}
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type Reader = GenericDatabaseReader<DataModel>;

export async function ensureAuthenticatedIdentity(
  ctx: AuthCtx,
): Promise<AuthenticatedIdentity> {
  const identity = await getConvexAuthIdentity(ctx);
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return identity;
}

export async function ensureAuthenticatedUserId(
  ctx: MutationCtx,
): Promise<Id<"users">> {
  const identity = await ensureAuthenticatedIdentity(ctx);
  const user = await findUserByAuthId(ctx.db, identity.subject);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authenticated user is not provisioned in Convex",
    });
  }
  return user._id;
}

export async function findUserByAuthId(
  db: Reader,
  authId: string,
): Promise<Doc<"users"> | null> {
  const users = await db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .collect();
  if (users.length === 0) {
    return null;
  }
  if (users.length > 1) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Multiple app users exist for authenticated identity",
    });
  }
  const user = users.at(0);
  if (!user) {
    return null;
  }
  return user;
}

export async function getAuthenticatedUserIdForQueryOrNull(
  ctx: QueryCtx,
): Promise<Id<"users"> | null> {
  const identity = await getConvexAuthIdentity(ctx);
  if (!identity) {
    return null;
  }
  const user = await findUserByAuthId(ctx.db, identity.subject);
  return user?._id ?? null;
}

export async function requireAuthenticatedUserIdForQuery(
  ctx: QueryCtx,
): Promise<Id<"users">> {
  const identity = await getConvexAuthIdentity(ctx);
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  const user = await findUserByAuthId(ctx.db, identity.subject);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authenticated user is not provisioned in Convex",
    });
  }
  return user._id;
}

async function getConvexAuthIdentity(
  ctx: AuthCtx,
): Promise<AuthenticatedIdentity | null> {
  return await ctx.auth.getUserIdentity();
}
