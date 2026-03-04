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

type TestContext = ReturnType<typeof createTestContext>;

async function createAppointmentBaseData(t: TestContext) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Appointments Test Practice",
    });

    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "Appointments Test Rule Set",
      draftRevision: 0,
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

async function createUser(t: TestContext, authId: string, email: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
  });
}

async function insertAppointment(
  t: TestContext,
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

function nextWeekday(weekday: number): Temporal.PlainDate {
  const today = Temporal.Now.plainDateISO("Europe/Berlin");
  const delta = (weekday - today.dayOfWeek + 7) % 7;
  return today.add({ days: delta === 0 ? 7 : delta });
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

  test("getBookedAppointmentsForCurrentUser returns all uncancelled future appointments in ascending order", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_booked_user";
    const userId = await createUser(t, authId, "booked@example.com");

    await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(-2),
    });

    const firstFutureAppointmentId = await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(3),
    });
    const secondFutureAppointmentId = await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(5),
    });

    const authed = t.withIdentity({
      email: "booked@example.com",
      subject: authId,
    });

    const upcomingAppointments = await authed.query(
      api.appointments.getBookedAppointmentsForCurrentUser,
      {},
    );
    expect(upcomingAppointments.map((appointment) => appointment._id)).toEqual([
      firstFutureAppointmentId,
      secondFutureAppointmentId,
    ]);

    await authed.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId: firstFutureAppointmentId,
    });

    const afterCancellation = await authed.query(
      api.appointments.getBookedAppointmentsForCurrentUser,
      {},
    );
    expect(afterCancellation.map((appointment) => appointment._id)).toEqual([
      secondFutureAppointmentId,
    ]);
  });

  test("getBookedAppointmentForCurrentUser ignores simulation appointments", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_booked_user_no_simulation";
    const userId = await createUser(t, authId, "booked-no-sim@example.com");

    const simulationWindow = makeSlotWindow(2);
    await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      await ctx.db.insert("appointments", {
        appointmentTypeId: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup (Simulation)",
        createdAt: now,
        end: simulationWindow.end,
        isSimulation: true,
        lastModified: now,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: simulationWindow.start,
        title: "Simulation-Termin",
        userId,
      });
    });

    const realWindow = makeSlotWindow(3);
    const realAppointmentId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await ctx.db.insert("appointments", {
        appointmentTypeId: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: realWindow.end,
        isSimulation: false,
        lastModified: now,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: realWindow.start,
        title: "Online-Termin: Checkup",
        userId,
      });
    });

    const authed = t.withIdentity({
      email: "booked-no-sim@example.com",
      subject: authId,
    });

    const upcomingAppointment = await authed.query(
      api.appointments.getBookedAppointmentForCurrentUser,
      {},
    );
    expect(upcomingAppointment?._id).toBe(realAppointmentId);
  });

  test("cancelOwnAppointment cancels the whole future chain from a non-root step", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      email: "series-owner@example.com",
      subject: "workos_series_owner",
    });
    const practiceId = await authed.mutation(api.practices.createPractice, {
      name: "Series Cancellation Practice",
    });
    const baseData = await authed.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const user = users.find(
        (candidate) => candidate.authId === "workos_series_owner",
      );
      if (!user) {
        throw new Error("Authenticated user should be provisioned");
      }

      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.currentActiveRuleSetId) {
        throw new Error("Practice should have an active rule set");
      }
      const ruleSetId = practice.currentActiveRuleSetId;

      const locationId = await ctx.db.insert("locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });

      const practitionerId = await ctx.db.insert("practitioners", {
        name: "Dr. Series",
        practiceId,
        ruleSetId,
      });

      for (const dayOfWeek of [1, 2, 3, 4, 5]) {
        await ctx.db.insert("baseSchedules", {
          dayOfWeek,
          endTime: "17:00",
          locationId,
          practiceId,
          practitionerId,
          ruleSetId,
          startTime: "08:00",
        });
      }

      const now = BigInt(Date.now());
      const followUpTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerIds: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Kontrolle",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", followUpTypeId, {
        lineageKey: followUpTypeId,
      });

      const rootAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        allowedPractitionerIds: [practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: followUpTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 2,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "step-1",
          },
        ],
        lastModified: now,
        name: "Ersttermin",
        practiceId,
        ruleSetId,
      });
      await ctx.db.patch("appointmentTypes", rootAppointmentTypeId, {
        lineageKey: rootAppointmentTypeId,
      });

      return {
        locationId,
        practiceId,
        practitionerId,
        rootAppointmentTypeId,
        ruleSetId,
        userId: user._id,
      };
    });

    const start = nextWeekday(1)
      .toZonedDateTime({
        plainTime: { hour: 10, minute: 0 },
        timeZone: "Europe/Berlin",
      })
      .toString();

    const createdSeries = await authed.mutation(
      api.appointments.createAppointmentSeries,
      {
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        rootAppointmentTypeId: baseData.rootAppointmentTypeId,
        rootTitle: "Kette",
        ruleSetId: baseData.ruleSetId,
        start,
        userId: baseData.userId,
      },
    );

    const followUpAppointmentId = createdSeries.steps[1]?.appointmentId;
    expect(followUpAppointmentId).toBeDefined();
    if (!followUpAppointmentId) {
      throw new Error("Follow-up appointment should exist");
    }

    await authed.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId: followUpAppointmentId,
    });

    const cancelledSeries = await t.run(async (ctx) => {
      return await ctx.db
        .query("appointments")
        .withIndex("by_seriesId", (q) =>
          q.eq("seriesId", createdSeries.seriesId),
        )
        .collect();
    });

    expect(cancelledSeries).toHaveLength(2);
    expect(
      cancelledSeries.every((appointment) => appointment.cancelledAt),
    ).toBe(true);
  });

  test("createAppointment rejects occupied simulation slots instead of replacing them", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      email: "staff@example.com",
      subject: "workos_staff_simulation_conflict",
    });
    const practiceId = await authed.mutation(api.practices.createPractice, {
      name: "Simulation Conflict Practice",
    });
    const baseData = await authed.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.currentActiveRuleSetId) {
        throw new Error("Practice should have an active rule set");
      }
      const ruleSetId = practice.currentActiveRuleSetId;

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
    const userId = await createUser(
      t,
      "workos_staff_simulation_conflict_user",
      "staff-simulation-conflict@example.com",
    );
    const window = makeSlotWindow(4);

    await insertAppointment(t, {
      ...baseData,
      userId,
      window,
    });

    await expect(
      authed.mutation(api.appointments.createAppointment, {
        appointmentTypeId: baseData.appointmentTypeId,
        end: window.end,
        isSimulation: true,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: window.start,
        title: "Simulationskollision",
      }),
    ).rejects.toThrow("bereits belegt");
  });

  test("cancelOwnAppointment cancels all future appointments in a series when the root appointment is cancelled", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_series_cancel_user";
    const userId = await createUser(t, authId, "series-cancel@example.com");
    const rootWindow = makeSlotWindow(4);
    const followUpStart = Temporal.ZonedDateTime.from(rootWindow.start)
      .add({ days: 5 })
      .toString();
    const followUpEnd = Temporal.ZonedDateTime.from(followUpStart)
      .add({ minutes: 30 })
      .toString();
    const seriesId = "series_test_cancel";

    const rootAppointmentId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const appointmentId = await ctx.db.insert("appointments", {
        appointmentTypeId: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: rootWindow.end,
        lastModified: now,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        seriesId,
        seriesStepIndex: 0n,
        start: rootWindow.start,
        title: "Root",
        userId,
      });

      await ctx.db.insert("appointments", {
        appointmentTypeId: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: followUpEnd,
        lastModified: now,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        seriesId,
        seriesStepIndex: 1n,
        start: followUpStart,
        title: "Follow-up",
        userId,
      });

      return appointmentId;
    });

    const authed = t.withIdentity({
      email: "series-cancel@example.com",
      subject: authId,
    });

    await authed.mutation(api.appointments.cancelOwnAppointment, {
      appointmentId: rootAppointmentId,
    });

    const remainingAppointments = await authed.query(
      api.appointments.getBookedAppointmentsForCurrentUser,
      {},
    );
    expect(remainingAppointments).toHaveLength(0);
  });
});
