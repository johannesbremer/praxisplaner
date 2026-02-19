import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

interface SlotWindow {
  end: string;
  start: string;
}

async function createAppointmentBaseData(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Appointments Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Appointments Test Rule Set",
      practiceId,
      saved: true,
      version: 1,
    });

    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    const locationId = await ctx.db.insert("locations", {
      name: "Main Location",
      practiceId,
      ruleSetId,
    });

    const practitionerId = await ctx.db.insert("practitioners", {
      name: "Dr. Appointments",
      practiceId,
      ruleSetId,
    });

    const now = BigInt(Date.now());
    const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
      allowedPractitionerIds: [practitionerId],
      createdAt: now,
      duration: 30,
      lastModified: now,
      name: "Checkup",
      practiceId,
      ruleSetId,
    });

    return {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
    };
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

async function createUser(
  t: ReturnType<typeof convexTest>,
  authId: string,
  email: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
  });
}

async function insertAppointment(
  t: ReturnType<typeof convexTest>,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    userId: Id<"users">;
    window: SlotWindow;
  },
) {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    return await ctx.db.insert("appointments", {
      appointmentTypeId: args.appointmentTypeId,
      appointmentTypeTitle: "Checkup",
      createdAt: now,
      end: args.window.end,
      lastModified: now,
      locationId: args.locationId,
      practiceId: args.practiceId,
      practitionerId: args.practitionerId,
      start: args.window.start,
      title: "Online-Termin: Checkup",
      userId: args.userId,
    });
  });
}

function makeSlotWindow(daysOffset: number): SlotWindow {
  const date = Temporal.Now.plainDateISO("Europe/Berlin").add({
    days: daysOffset,
  });
  const start = date.toZonedDateTime({
    plainTime: { hour: 10, minute: 0 },
    timeZone: "Europe/Berlin",
  });
  const end = start.add({ minutes: 30 });
  return {
    end: end.toString(),
    start: start.toString(),
  };
}

describe("appointments self-service cancellation", () => {
  test("cancelOwnAppointment only allows cancelling the authenticated user's own appointment", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const ownerAuthId = "workos_owner";
    const otherAuthId = "workos_other";

    const ownerUserId = await createUser(t, ownerAuthId, "owner@example.com");
    await createUser(t, otherAuthId, "other@example.com");

    const appointmentId = await insertAppointment(t, {
      ...baseData,
      userId: ownerUserId,
      window: makeSlotWindow(2),
    });

    const owner = t.withIdentity({
      email: "owner@example.com",
      subject: ownerAuthId,
    });
    const other = t.withIdentity({
      email: "other@example.com",
      subject: otherAuthId,
    });

    await expect(
      other.mutation(api.appointments.cancelOwnAppointment, { appointmentId }),
    ).rejects.toThrow("Access denied");

    await owner.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId,
    });

    const cancelledAppointment = await t.run(async (ctx) => {
      return await ctx.db.get("appointments", appointmentId);
    });

    expect(cancelledAppointment?.cancelledAt).toBeDefined();
    expect(cancelledAppointment?.cancelledByUserId).toBe(ownerUserId);

    const visibleAppointments = await owner.query(
      api.appointments.getAppointmentsForPatient,
      { userId: ownerUserId },
    );
    expect(visibleAppointments).toHaveLength(0);
  });

  test("getBookedAppointmentForCurrentUser returns only uncancelled future appointments", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_booked_user";
    const userId = await createUser(t, authId, "booked@example.com");

    await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(-2),
    });

    const futureAppointmentId = await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(3),
    });

    const authed = t.withIdentity({
      email: "booked@example.com",
      subject: authId,
    });

    const upcomingAppointment = await authed.query(
      api.appointments.getBookedAppointmentForCurrentUser,
      {},
    );
    expect(upcomingAppointment?._id).toBe(futureAppointmentId);

    await authed.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId: futureAppointmentId,
    });

    const afterCancellation = await authed.query(
      api.appointments.getBookedAppointmentForCurrentUser,
      {},
    );
    expect(afterCancellation).toBeNull();
  });
});
