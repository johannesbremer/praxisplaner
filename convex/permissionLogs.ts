import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

export const logPermissionEvent = mutation({
  args: {
    accessMode: v.union(v.literal("read"), v.literal("readwrite")),
    context: v.string(),
    errorMessage: v.optional(v.string()),
    handleName: v.string(),
    operationType: v.union(v.literal("query"), v.literal("request")),
    resultState: v.union(
      v.literal("granted"),
      v.literal("prompt"),
      v.literal("denied"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args) => {
    const dataToInsert: {
      accessMode: "read" | "readwrite";
      context: string;
      errorMessage?: string;
      handleName: string;
      operationType: "query" | "request";
      resultState: "denied" | "error" | "granted" | "prompt";
      timestamp: bigint;
    } = {
      ...args,
      timestamp: BigInt(Date.now()),
    };
    if (args.errorMessage === undefined) {
      delete dataToInsert.errorMessage; // Only include if present
    }
    await ctx.db.insert("permissionEvents", dataToInsert);
  },
});

export const getRecentPermissionEvents = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 30; // Default to 30 recent events
    return await ctx.db
      .query("permissionEvents")
      .order("desc") // Get the most recent ones first by 'timestamp'
      .take(limit);
  },
});
