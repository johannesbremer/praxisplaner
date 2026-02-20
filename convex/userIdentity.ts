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
  const identity = await getIdentityWithOptionalInsecureFallback(ctx);
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
  const authId = identity.subject;
  const existing = await findUserByAuthId(ctx.db, authId);
  if (existing) {
    return existing._id;
  }

  const fallbackEmail =
    "email" in identity &&
    typeof identity.email === "string" &&
    identity.email.length > 0
      ? identity.email
      : `${authId}@users.invalid`;

  return await ctx.db.insert("users", {
    authId,
    createdAt: BigInt(Date.now()),
    email: fallbackEmail,
  });
}

export async function findUserByAuthId(
  db: Reader,
  authId: string,
): Promise<Doc<"users"> | null> {
  const users = await db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .collect();
  return selectCanonicalUser(users);
}

export async function getAuthenticatedUserIdForQuery(
  ctx: QueryCtx,
): Promise<Id<"users"> | null> {
  const identity = await getIdentityWithOptionalInsecureFallback(ctx);
  if (!identity) {
    return null;
  }
  const user = await findUserByAuthId(ctx.db, identity.subject);
  return user?._id ?? null;
}

async function getIdentityWithOptionalInsecureFallback(
  ctx: AuthCtx,
): Promise<AuthenticatedIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    return identity;
  }

  return {
    email: "local-dev-user@users.invalid",
    subject: "local-dev-user",
  };
}

function selectCanonicalUser(users: Doc<"users">[]): Doc<"users"> | null {
  if (users.length === 0) {
    return null;
  }
  const sortedUsers = users
    .toSorted((a, b) => {
      if (a._creationTime !== b._creationTime) {
        return a._creationTime - b._creationTime;
      }
      return a._id.localeCompare(b._id);
    })
    .at(0);
  return sortedUsers ?? null;
}
