import type { GenericDatabaseReader } from "convex/server";

import { v } from "convex/values";

import type { DataModel, Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  requirePracticeManager,
  requirePracticeStaff,
  requirePracticeStaffForMutation,
} from "./practiceAccess";
import { requireAuthenticatedUserIdForQuery } from "./userIdentity";

interface ReaderCtx {
  db: GenericDatabaseReader<DataModel>;
}

const blockRecordValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("onlineAccountBlocks"),
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  createdAt: v.int64(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  legacyUserId: v.optional(v.string()),
  practiceId: v.id("practices"),
  reason: v.string(),
  sourceSystem: v.union(v.literal("legacy-online"), v.literal("online")),
  userId: v.id("users"),
});

const bookingIdentityBlockStatusValidator = v.object({
  block: v.union(blockRecordValidator, v.null()),
  canBlock: v.boolean(),
  reason: v.optional(v.string()),
});

async function buildBlockRecord(
  ctx: ReaderCtx,
  block: NonNullable<Awaited<ReturnType<typeof getActiveBlockForUser>>>,
) {
  const user = await ctx.db.get("users", block.userId);
  return {
    ...block,
    email: user?.email ?? "Unbekannt",
    ...(user?.firstName ? { firstName: user.firstName } : {}),
    ...(user?.lastName ? { lastName: user.lastName } : {}),
  };
}

async function getActiveBlockForUser(
  ctx: ReaderCtx,
  args: {
    practiceId: Id<"practices">;
    userId: Id<"users">;
  },
) {
  return await ctx.db
    .query("onlineAccountBlocks")
    .withIndex("by_userId_practiceId", (q) =>
      q.eq("userId", args.userId).eq("practiceId", args.practiceId),
    )
    .first();
}

function normalizeBlockReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new Error("Block reason must contain at least 3 characters.");
  }
  return trimmed;
}

export const getCurrentUserBlockByPracticeSlug = query({
  args: { practiceSlug: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserIdForQuery(ctx);
    const practice = await ctx.db
      .query("practices")
      .withIndex("by_slug", (q) => q.eq("slug", args.practiceSlug))
      .first();
    if (!practice) {
      return null;
    }
    const block = await getActiveBlockForUser(ctx, {
      practiceId: practice._id,
      userId,
    });
    return block ? await buildBlockRecord(ctx, block) : null;
  },
  returns: v.union(blockRecordValidator, v.null()),
});

export const getStatusForBookingIdentity = query({
  args: {
    bookingIdentityId: v.id("bookingIdentities"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await requirePracticeStaff(ctx, args.practiceId);
    const bookingIdentity = await ctx.db.get(
      "bookingIdentities",
      args.bookingIdentityId,
    );
    if (
      bookingIdentity?.practiceId !== args.practiceId ||
      bookingIdentity.kind !== "online" ||
      bookingIdentity.userId === undefined
    ) {
      return {
        block: null,
        canBlock: false,
      };
    }
    const block = await getActiveBlockForUser(ctx, {
      practiceId: args.practiceId,
      userId: bookingIdentity.userId,
    });
    return {
      block: block ? await buildBlockRecord(ctx, block) : null,
      canBlock: true,
      ...(block ? { reason: block.reason } : {}),
    };
  },
  returns: bookingIdentityBlockStatusValidator,
});

export const listForPractice = query({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    await requirePracticeManager(ctx, args.practiceId);
    const blocks = await ctx.db
      .query("onlineAccountBlocks")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();
    return await Promise.all(
      blocks
        .toSorted((left, right) => Number(right.createdAt - left.createdAt))
        .map((block) => buildBlockRecord(ctx, block)),
    );
  },
  returns: v.array(blockRecordValidator),
});

export const blockBookingIdentity = mutation({
  args: {
    bookingIdentityId: v.id("bookingIdentities"),
    practiceId: v.id("practices"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const bookingIdentity = await ctx.db.get(
      "bookingIdentities",
      args.bookingIdentityId,
    );
    if (
      bookingIdentity?.practiceId !== args.practiceId ||
      bookingIdentity.kind !== "online" ||
      bookingIdentity.userId === undefined
    ) {
      throw new Error("Online booking identity not found for this practice.");
    }
    const reason = normalizeBlockReason(args.reason);
    const existingBlock = await getActiveBlockForUser(ctx, {
      practiceId: args.practiceId,
      userId: bookingIdentity.userId,
    });
    if (existingBlock) {
      await ctx.db.patch("onlineAccountBlocks", existingBlock._id, {
        bookingIdentityId: args.bookingIdentityId,
        reason,
        sourceSystem: "online",
      });
      return existingBlock._id;
    }
    return await ctx.db.insert("onlineAccountBlocks", {
      bookingIdentityId: args.bookingIdentityId,
      createdAt: BigInt(Date.now()),
      practiceId: args.practiceId,
      reason,
      sourceSystem: "online",
      userId: bookingIdentity.userId,
    });
  },
  returns: v.id("onlineAccountBlocks"),
});

export const unblock = mutation({
  args: {
    blockId: v.id("onlineAccountBlocks"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const block = await ctx.db.get("onlineAccountBlocks", args.blockId);
    if (block?.practiceId !== args.practiceId) {
      throw new Error("Online account block not found for this practice.");
    }
    await ctx.db.delete("onlineAccountBlocks", args.blockId);
    return args.blockId;
  },
  returns: v.id("onlineAccountBlocks"),
});

export const restore = mutation({
  args: {
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    legacyUserId: v.optional(v.string()),
    practiceId: v.id("practices"),
    reason: v.string(),
    sourceSystem: v.union(v.literal("legacy-online"), v.literal("online")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const reason = normalizeBlockReason(args.reason);
    const existingBlock = await getActiveBlockForUser(ctx, {
      practiceId: args.practiceId,
      userId: args.userId,
    });
    if (existingBlock) {
      await ctx.db.patch("onlineAccountBlocks", existingBlock._id, {
        ...(args.bookingIdentityId === undefined
          ? {}
          : { bookingIdentityId: args.bookingIdentityId }),
        ...(args.legacyUserId === undefined
          ? {}
          : { legacyUserId: args.legacyUserId }),
        reason,
        sourceSystem: args.sourceSystem,
      });
      return existingBlock._id;
    }
    return await ctx.db.insert("onlineAccountBlocks", {
      ...(args.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: args.bookingIdentityId }),
      createdAt: BigInt(Date.now()),
      ...(args.legacyUserId === undefined
        ? {}
        : { legacyUserId: args.legacyUserId }),
      practiceId: args.practiceId,
      reason,
      sourceSystem: args.sourceSystem,
      userId: args.userId,
    });
  },
  returns: v.id("onlineAccountBlocks"),
});
