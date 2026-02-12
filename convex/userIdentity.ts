import type {
  GenericDatabaseReader,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { authKit } from "./auth";

type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type Reader = GenericDatabaseReader<DataModel>;

export async function ensureAuthenticatedUserId(
  ctx: MutationCtx,
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }

  const authId = identity.subject;
  const existing = await findUserByAuthId(ctx.db, authId);
  if (existing) {
    return existing._id;
  }

  const authUser = await authKit.getAuthUser(ctx);
  const fallbackEmail =
    "email" in identity &&
    typeof identity.email === "string" &&
    identity.email.length > 0
      ? identity.email
      : `${authId}@users.invalid`;

  return await ctx.db.insert("users", {
    authId,
    createdAt: BigInt(Date.now()),
    email: authUser?.email ?? fallbackEmail,
    ...(authUser?.firstName ? { firstName: authUser.firstName } : {}),
    ...(authUser?.lastName ? { lastName: authUser.lastName } : {}),
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
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  const user = await findUserByAuthId(ctx.db, identity.subject);
  return user?._id ?? null;
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
