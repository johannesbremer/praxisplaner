import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const PREFERENCE_SINGLETON_KEY = "user_preference";

export const get = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("gdtDirectoryPreference")
      .withIndex("by_singletonKey", (q) =>
        q.eq("singletonKey", PREFERENCE_SINGLETON_KEY),
      )
      .first();
  },
});

export const save = mutation({
  args: { directoryName: v.string() },
  handler: async (ctx, { directoryName }) => {
    const existingPreference = await ctx.db
      .query("gdtDirectoryPreference")
      .withIndex("by_singletonKey", (q) =>
        q.eq("singletonKey", PREFERENCE_SINGLETON_KEY),
      )
      .first();

    if (existingPreference) {
      await ctx.db.patch(existingPreference._id, { directoryName });
    } else {
      await ctx.db.insert("gdtDirectoryPreference", {
        directoryName,
        singletonKey: PREFERENCE_SINGLETON_KEY,
      });
    }
    return { directoryName };
  },
});

export const remove = mutation({
  handler: async (ctx) => {
    const existingPreference = await ctx.db
      .query("gdtDirectoryPreference")
      .withIndex("by_singletonKey", (q) =>
        q.eq("singletonKey", PREFERENCE_SINGLETON_KEY),
      )
      .first();

    if (existingPreference) {
      await ctx.db.delete(existingPreference._id);
    }
  },
});
