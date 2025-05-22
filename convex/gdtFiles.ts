// convex/gdtFiles.ts
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

export const addProcessedFile = mutation({
  args: {
    fileContent: v.string(),
    fileName: v.string(),
    gdtParsedSuccessfully: v.boolean(),
    processingErrorMessage: v.optional(v.string()),
    sourceDirectoryName: v.string(),
  },
  handler: async (ctx, args) => {
    const dataToInsert: {
      // Define a type for clarity or use as-is
      fileContent: string;
      fileName: string;
      gdtParsedSuccessfully: boolean;
      processedAt: bigint;
      processingErrorMessage?: string; // Make it optional here too
      sourceDirectoryName: string;
    } = {
      fileContent: args.fileContent,
      fileName: args.fileName,
      gdtParsedSuccessfully: args.gdtParsedSuccessfully,
      processedAt: BigInt(Date.now()),
      sourceDirectoryName: args.sourceDirectoryName,
    };

    if (args.processingErrorMessage !== undefined) {
      dataToInsert.processingErrorMessage = args.processingErrorMessage;
    }

    await ctx.db.insert("processedGdtFiles", dataToInsert);
  },
});

export const getRecentProcessedFiles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20; // Default for display
    return await ctx.db.query("processedGdtFiles").order("desc").take(limit);
  },
});
