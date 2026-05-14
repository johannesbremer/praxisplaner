import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";

import type { Id } from "../../convex/_generated/dataModel";

import { insertSelfLineageEntity } from "../../convex/lineage";
import schema from "../../convex/schema";
import { modules } from "../../convex/tests/test.setup";

const PROPERTY_AUTH_ID = "workos_property_owner";
const PROPERTY_EMAIL = "property-owner@example.com";

export interface PropertySchedulingFixture {
  appointmentTypeId: Id<"appointmentTypes">;
  baseScheduleId: Id<"baseSchedules">;
  date: string;
  locationId: Id<"locations">;
  practiceId: Id<"practices">;
  practitionerId: Id<"practitioners">;
  ruleSetId: Id<"ruleSets">;
  userId: Id<"users">;
}

export type PropertyTestContext = ReturnType<typeof createPropertyTestContext>;

export async function createPropertySchedulingFixture(
  t: PropertyTestContext,
  args: {
    date?: Temporal.PlainDate;
    description?: string;
    scheduleEnd?: string;
    scheduleStart?: string;
  } = {},
): Promise<PropertySchedulingFixture> {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Property Practice",
    });
    const userId = await ctx.db.insert("users", {
      authId: PROPERTY_AUTH_ID,
      createdAt: BigInt(Date.now()),
      email: PROPERTY_EMAIL,
    });
    await ctx.db.insert("practiceMembers", {
      createdAt: BigInt(Date.now()),
      practiceId,
      role: "owner",
      userId,
    });
    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: args.description ?? "Property Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });
    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });
    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Property Location",
      practiceId,
      ruleSetId,
    });
    const practitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Property",
        practiceId,
        ruleSetId,
      },
    );
    const now = BigInt(Date.now());
    const appointmentTypeId = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: now,
        duration: 5,
        followUpPlan: [],
        lastModified: now,
        name: "Property Checkup",
        practiceId,
        ruleSetId,
      },
    );
    const date = args.date ?? Temporal.PlainDate.from("2026-06-15");
    const baseScheduleId = await insertSelfLineageEntity(
      ctx.db,
      "baseSchedules",
      {
        dayOfWeek: date.dayOfWeek === 7 ? 0 : date.dayOfWeek,
        endTime: args.scheduleEnd ?? "09:30",
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId,
        startTime: args.scheduleStart ?? "09:00",
      },
    );

    return {
      appointmentTypeId,
      baseScheduleId,
      date: date.toString(),
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
      userId,
    };
  });
}

export function createPropertyTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: PROPERTY_EMAIL,
    subject: PROPERTY_AUTH_ID,
  });
}

export function createUnauthenticatedPropertyTestContext() {
  return convexTest(schema, modules);
}

export function zonedWindow(
  date: string | Temporal.PlainDate,
  args: { durationMinutes?: number; hour: number; minute: number },
) {
  const plainDate =
    typeof date === "string" ? Temporal.PlainDate.from(date) : date;
  const start = plainDate.toZonedDateTime({
    plainTime: { hour: args.hour, minute: args.minute },
    timeZone: "Europe/Berlin",
  });
  const end = start.add({ minutes: args.durationMinutes ?? 5 });
  return { end: end.toString(), start: start.toString() };
}
