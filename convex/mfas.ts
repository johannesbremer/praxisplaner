import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { MfaId } from "./identity";

import { mutation, query } from "./_generated/server";
import { bumpDraftRevision, resolveDraftForWrite } from "./copyOnWrite";
import { asMfaId, asMfaLineageKey } from "./identity";
import { insertSelfLineageEntity, requireLineageKey } from "./lineage";
import {
  ensurePracticeAccessForMutation,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import { ensureAuthenticatedIdentity } from "./userIdentity";

const expectedDraftRevisionValidator = v.union(v.number(), v.null());

const createMfaResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("mfas"),
  ruleSetId: v.id("ruleSets"),
});

const draftMutationResultValidator = v.object({
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
});

async function resolveMfaEntityInRuleSet(
  ctx: MutationCtx,
  mfaId: MfaId,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Doc<"mfas">> {
  const mfa = await ctx.db.get("mfas", mfaId);
  if (!mfa) {
    throw new Error("MFA nicht gefunden.");
  }
  if (mfa.practiceId !== practiceId) {
    throw new Error("MFA gehört nicht zu dieser Praxis.");
  }
  if (mfa.ruleSetId === ruleSetId) {
    return mfa;
  }

  const lineageKey = requireLineageKey({
    entityId: mfa._id,
    entityType: "mfa",
    lineageKey: mfa.lineageKey,
    ruleSetId: mfa.ruleSetId,
  });
  const mapped = await ctx.db
    .query("mfas")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q
        .eq("ruleSetId", ruleSetId)
        .eq("lineageKey", asMfaLineageKey(lineageKey)),
    )
    .first();

  if (mapped?.practiceId !== practiceId) {
    throw new Error("MFA konnte im aktuellen Regelset nicht aufgelöst werden.");
  }

  return mapped;
}

export const list = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    return await ctx.db
      .query("mfas")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});

export const create = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("mfas")),
    name: v.string(),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("MFA-Name ist erforderlich.");
    }

    const { ruleSetId } = await resolveDraftForWrite(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const existing = await ctx.db
      .query("mfas")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", name),
      )
      .first();
    if (existing) {
      throw new Error("Eine MFA mit diesem Namen existiert bereits.");
    }

    if (args.lineageKey) {
      const lineageKey = asMfaLineageKey(args.lineageKey);
      const existingByLineage = await ctx.db
        .query("mfas")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
        )
        .first();
      if (existingByLineage) {
        throw new Error("Diese MFA existiert im aktuellen Regelset bereits.");
      }
    }

    const entityId = await insertSelfLineageEntity(ctx.db, "mfas", {
      createdAt: BigInt(Date.now()),
      ...(args.lineageKey ? { lineageKey: args.lineageKey } : {}),
      name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: createMfaResultValidator,
});

export const remove = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    mfaId: v.id("mfas"),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const { ruleSetId } = await resolveDraftForWrite(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const mfa = await resolveMfaEntityInRuleSet(
      ctx,
      asMfaId(args.mfaId),
      args.practiceId,
      ruleSetId,
    );

    const vacations = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_mfaId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("mfaId", mfa._id),
      )
      .collect();

    for (const vacation of vacations) {
      await ctx.db.delete("vacations", vacation._id);
    }

    await ctx.db.delete("mfas", mfa._id);

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return { draftRevision, ruleSetId };
  },
  returns: draftMutationResultValidator,
});
