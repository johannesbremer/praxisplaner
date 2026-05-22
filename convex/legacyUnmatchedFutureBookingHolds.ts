import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./bookingSessions.shared";

const APPOINTMENT_TIMEZONE = "Europe/Berlin";

export const legacyUnmatchedFutureBookingHoldSummaryValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("legacyUnmatchedFutureBookingHolds"),
  createdAt: v.int64(),
  end: v.string(),
  kind: v.literal("legacy-unmatched-future-hold"),
  lastModified: v.int64(),
  legacyAppointmentId: v.string(),
  legacyType: v.optional(v.string()),
  locationName: v.optional(v.string()),
  practiceId: v.id("practices"),
  practitionerName: v.optional(v.string()),
  start: v.string(),
  userId: v.id("users"),
});

export type LegacyUnmatchedFutureBookingHoldDoc =
  Doc<"legacyUnmatchedFutureBookingHolds">;

export async function getFutureLegacyUnmatchedBookingHoldsForUser(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    practiceId?: Id<"practices">;
    userId: Id<"users">;
  },
): Promise<LegacyUnmatchedFutureBookingHoldDoc[]> {
  const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
  const nowStartLowerBound = Temporal.Now.instant()
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
  const practiceId = args.practiceId;
  const holds: LegacyUnmatchedFutureBookingHoldDoc[] = [];

  if (practiceId === undefined) {
    const query = ctx.db
      .query("legacyUnmatchedFutureBookingHolds")
      .withIndex("by_userId_start", (q) =>
        q.eq("userId", args.userId).gte("start", nowStartLowerBound),
      );
    for await (const hold of query) {
      if (
        isLegacyUnmatchedFutureBookingHoldVisible(hold, nowEpochMilliseconds)
      ) {
        holds.push(hold);
      }
    }
    return holds;
  }

  const query = ctx.db
    .query("legacyUnmatchedFutureBookingHolds")
    .withIndex("by_userId_practiceId_start", (q) =>
      q
        .eq("userId", args.userId)
        .eq("practiceId", practiceId)
        .gte("start", nowStartLowerBound),
    );
  for await (const hold of query) {
    if (isLegacyUnmatchedFutureBookingHoldVisible(hold, nowEpochMilliseconds)) {
      holds.push(hold);
    }
  }

  return holds;
}

export function isLegacyUnmatchedFutureBookingHoldVisible(
  hold: Pick<LegacyUnmatchedFutureBookingHoldDoc, "start">,
  nowEpochMilliseconds: number,
): boolean {
  return (
    Temporal.ZonedDateTime.from(hold.start).epochMilliseconds >
    nowEpochMilliseconds
  );
}

export function toLegacyUnmatchedFutureBookingHoldSummary(
  hold: LegacyUnmatchedFutureBookingHoldDoc,
) {
  return {
    ...hold,
    kind: "legacy-unmatched-future-hold" as const,
  };
}
