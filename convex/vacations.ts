import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import { mutation, query } from "./_generated/server";
import { bumpDraftRevision, resolveDraftForWrite } from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import { ensureAuthenticatedIdentity } from "./userIdentity";

const vacationPortionValidator = v.union(
  v.literal("full"),
  v.literal("morning"),
  v.literal("afternoon"),
);

const staffTypeValidator = v.union(v.literal("mfa"), v.literal("practitioner"));
const expectedDraftRevisionValidator = v.union(v.number(), v.null());

const draftMutationResultValidator = v.object({
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
});

async function assertStaffExists(
  ctx: MutationCtx,
  args: {
    mfaId?: Id<"mfas">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
    staffType: "mfa" | "practitioner";
  },
): Promise<
  | { mfaId: Id<"mfas">; practitionerId?: never }
  | { mfaId?: never; practitionerId: Id<"practitioners"> }
> {
  if (args.staffType === "practitioner") {
    if (!args.practitionerId || args.mfaId) {
      throw new Error("Ungültige Urlaubszuordnung für Arzt.");
    }
    return {
      practitionerId: await resolvePractitionerIdInRuleSet(
        ctx,
        args.practitionerId,
        args.practiceId,
        args.ruleSetId,
      ),
    };
  }

  if (!args.mfaId || args.practitionerId) {
    throw new Error("Ungültige Urlaubszuordnung für MFA.");
  }
  return {
    mfaId: await resolveMfaIdInRuleSet(
      ctx,
      args.mfaId,
      args.practiceId,
      args.ruleSetId,
    ),
  };
}

function getVacationStaffId(vacation: Doc<"vacations">) {
  return vacation.staffType === "practitioner"
    ? vacation.practitionerId
    : vacation.mfaId;
}

async function resolveMfaIdInRuleSet(
  ctx: MutationCtx,
  mfaId: Id<"mfas">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"mfas">> {
  const mfa = await ctx.db.get("mfas", mfaId);
  if (!mfa) {
    throw new Error("MFA nicht gefunden.");
  }
  if (mfa.practiceId !== practiceId) {
    throw new Error("MFA gehört nicht zu dieser Praxis.");
  }
  if (mfa.ruleSetId === ruleSetId) {
    return mfa._id;
  }

  const lineageKey = mfa.lineageKey ?? mfa._id;
  const mapped = await ctx.db
    .query("mfas")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (mapped?.practiceId !== practiceId) {
    throw new Error("MFA konnte im aktuellen Regelset nicht aufgelöst werden.");
  }

  return mapped._id;
}

async function resolvePractitionerIdInRuleSet(
  ctx: MutationCtx,
  practitionerId: Id<"practitioners">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  const practitioner = await ctx.db.get("practitioners", practitionerId);
  if (!practitioner) {
    throw new Error("Arzt nicht gefunden.");
  }
  if (practitioner.practiceId !== practiceId) {
    throw new Error("Arzt gehört nicht zu dieser Praxis.");
  }
  if (practitioner.ruleSetId === ruleSetId) {
    return practitioner._id;
  }

  const lineageKey = practitioner.lineageKey ?? practitioner._id;
  const mapped = await ctx.db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (mapped?.practiceId !== practiceId) {
    throw new Error(
      "Arzt konnte im aktuellen Regelset nicht aufgelöst werden.",
    );
  }

  return mapped._id;
}

export const getVacationsInRange = query({
  args: {
    endDateExclusive: v.string(),
    ruleSetId: v.id("ruleSets"),
    startDate: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    return await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", args.ruleSetId).gte("date", args.startDate),
      )
      .filter((q) => q.lt(q.field("date"), args.endDateExclusive))
      .collect();
  },
});

export const createVacation = mutation({
  args: {
    date: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    mfaId: v.optional(v.id("mfas")),
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    selectedRuleSetId: v.id("ruleSets"),
    staffType: staffTypeValidator,
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

    const resolved = await assertStaffExists(ctx, {
      ...(args.mfaId ? { mfaId: args.mfaId } : {}),
      practiceId: args.practiceId,
      ...(args.practitionerId ? { practitionerId: args.practitionerId } : {}),
      ruleSetId,
      staffType: args.staffType,
    });

    const existing = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("date", args.date),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("staffType"), args.staffType),
          q.eq(q.field("portion"), args.portion),
          args.staffType === "practitioner"
            ? q.eq(q.field("practitionerId"), resolved.practitionerId)
            : q.eq(q.field("mfaId"), resolved.mfaId),
        ),
      )
      .first();

    if (!existing) {
      await ctx.db.insert("vacations", {
        createdAt: BigInt(Date.now()),
        date: args.date,
        ...(resolved.mfaId ? { mfaId: resolved.mfaId } : {}),
        portion: args.portion,
        practiceId: args.practiceId,
        ...(resolved.practitionerId
          ? { practitionerId: resolved.practitionerId }
          : {}),
        ruleSetId,
        staffType: args.staffType,
      });
    }

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return { draftRevision, ruleSetId };
  },
  returns: draftMutationResultValidator,
});

export const deleteVacation = mutation({
  args: {
    date: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    mfaId: v.optional(v.id("mfas")),
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    selectedRuleSetId: v.id("ruleSets"),
    staffType: staffTypeValidator,
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

    const resolved = await assertStaffExists(ctx, {
      ...(args.mfaId ? { mfaId: args.mfaId } : {}),
      practiceId: args.practiceId,
      ...(args.practitionerId ? { practitionerId: args.practitionerId } : {}),
      ruleSetId,
      staffType: args.staffType,
    });

    const existing = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("date", args.date),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("staffType"), args.staffType),
          q.eq(q.field("portion"), args.portion),
          args.staffType === "practitioner"
            ? q.eq(q.field("practitionerId"), resolved.practitionerId)
            : q.eq(q.field("mfaId"), resolved.mfaId),
        ),
      )
      .first();

    if (existing) {
      await ctx.db.delete("vacations", existing._id);
    }

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return { draftRevision, ruleSetId };
  },
  returns: draftMutationResultValidator,
});

export const getPractitionerVacationsForDate = query({
  args: {
    date: v.string(),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const vacations = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("date", args.date),
      )
      .collect();
    return vacations.filter(
      (vacation) =>
        vacation.staffType === "practitioner" &&
        getVacationStaffId(vacation) !== undefined,
    );
  },
});
