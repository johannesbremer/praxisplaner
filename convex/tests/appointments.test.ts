import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { insertSelfLineageEntity, requireLineageKey } from "../lineage";
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

    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Main Location",
      practiceId,
      ruleSetId,
    });

    const practitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Appointments",
        practiceId,
        ruleSetId,
      },
    );

    const now = BigInt(Date.now());
    const appointmentTypeId = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerIds: [practitionerId],
        createdAt: now,
        duration: 30,
        lastModified: now,
        name: "Checkup",
        practiceId,
        ruleSetId,
      },
    );

    return {
      appointmentTypeId,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
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
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    const location = await ctx.db.get("locations", args.locationId);
    const practitioner = await ctx.db.get("practitioners", args.practitionerId);

    if (!appointmentType || !location || !practitioner) {
      throw new Error(
        "Appointment test fixture is missing referenced entities",
      );
    }

    return await ctx.db.insert("appointments", {
      appointmentTypeLineageKey: requireLineageKey({
        entityId: appointmentType._id,
        entityType: "appointment type",
        lineageKey: appointmentType.lineageKey,
        ruleSetId: appointmentType.ruleSetId,
      }),
      appointmentTypeTitle: "Checkup",
      createdAt: now,
      end: args.window.end,
      lastModified: now,
      locationLineageKey: requireLineageKey({
        entityId: location._id,
        entityType: "location",
        lineageKey: location.lineageKey,
        ruleSetId: location.ruleSetId,
      }),
      practiceId: args.practiceId,
      practitionerLineageKey: requireLineageKey({
        entityId: practitioner._id,
        entityType: "practitioner",
        lineageKey: practitioner.lineageKey,
        ruleSetId: practitioner.ruleSetId,
      }),
      start: args.window.start,
      title: "Online-Termin: Checkup",
      userId: args.userId,
    });
  });
}

async function insertAppointmentRecord(
  t: TestContext,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    cancelledAt?: bigint;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    simulationRuleSetId?: Id<"ruleSets">;
    userId: Id<"users">;
    window: SlotWindow;
  },
) {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      args.appointmentTypeId,
    );
    const location = await ctx.db.get("locations", args.locationId);
    const practitioner = await ctx.db.get("practitioners", args.practitionerId);

    if (!appointmentType || !location || !practitioner) {
      throw new Error(
        "Appointment test fixture is missing referenced entities",
      );
    }

    return await ctx.db.insert("appointments", {
      appointmentTypeLineageKey: requireLineageKey({
        entityId: appointmentType._id,
        entityType: "appointment type",
        lineageKey: appointmentType.lineageKey,
        ruleSetId: appointmentType.ruleSetId,
      }),
      appointmentTypeTitle: "Checkup",
      ...(args.cancelledAt === undefined
        ? {}
        : {
            cancelledAt: args.cancelledAt,
          }),
      createdAt: now,
      end: args.window.end,
      ...(args.isSimulation === true ? { isSimulation: true } : {}),
      lastModified: now,
      locationLineageKey: requireLineageKey({
        entityId: location._id,
        entityType: "location",
        lineageKey: location.lineageKey,
        ruleSetId: location.ruleSetId,
      }),
      practiceId: args.practiceId,
      practitionerLineageKey: requireLineageKey({
        entityId: practitioner._id,
        entityType: "practitioner",
        lineageKey: practitioner.lineageKey,
        ruleSetId: practitioner.ruleSetId,
      }),
      ...(args.replacesAppointmentId === undefined
        ? {}
        : { replacesAppointmentId: args.replacesAppointmentId }),
      ...(args.simulationRuleSetId === undefined
        ? {}
        : { simulationRuleSetId: args.simulationRuleSetId }),
      start: args.window.start,
      title: "Online-Termin: Checkup",
      userId: args.userId,
    });
  });
}

async function insertBlockedSlotRecord(
  t: TestContext,
  args: {
    isSimulation?: boolean;
    locationId: Id<"locations">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesBlockedSlotId?: Id<"blockedSlots">;
    title: string;
    window: SlotWindow;
  },
) {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const location = await ctx.db.get("locations", args.locationId);
    const practitioner = args.practitionerId
      ? await ctx.db.get("practitioners", args.practitionerId)
      : null;

    if (!location || (args.practitionerId && !practitioner)) {
      throw new Error(
        "Blocked slot test fixture is missing referenced entities",
      );
    }

    return await ctx.db.insert("blockedSlots", {
      createdAt: now,
      end: args.window.end,
      ...(args.isSimulation === true ? { isSimulation: true } : {}),
      lastModified: now,
      locationLineageKey: requireLineageKey({
        entityId: location._id,
        entityType: "location",
        lineageKey: location.lineageKey,
        ruleSetId: location.ruleSetId,
      }),
      practiceId: args.practiceId,
      ...(practitioner
        ? {
            practitionerLineageKey: requireLineageKey({
              entityId: practitioner._id,
              entityType: "practitioner",
              lineageKey: practitioner.lineageKey,
              ruleSetId: practitioner.ruleSetId,
            }),
          }
        : {}),
      ...(args.replacesBlockedSlotId === undefined
        ? {}
        : { replacesBlockedSlotId: args.replacesBlockedSlotId }),
      start: args.window.start,
      title: args.title,
    });
  });
}

function makeDayRange(daysOffset: number) {
  const date = Temporal.Now.plainDateISO("Europe/Berlin").add({
    days: daysOffset,
  });
  const dayStart = date.toZonedDateTime({
    plainTime: { hour: 0, minute: 0 },
    timeZone: "Europe/Berlin",
  });

  return {
    date,
    dayEnd: dayStart.add({ days: 1 }).toString(),
    dayStart: dayStart.toString(),
  };
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
        appointmentTypeLineageKey: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup (Simulation)",
        createdAt: now,
        end: simulationWindow.end,
        isSimulation: true,
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        start: simulationWindow.start,
        title: "Simulation-Termin",
        userId,
      });
    });

    const realWindow = makeSlotWindow(3);
    const realAppointmentId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: realWindow.end,
        isSimulation: false,
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
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

  test("createAppointment scopes draft simulations to the appointment type rule set by default", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_scoped_simulation_default";
    const userId = await createUser(t, authId, "scoped-sim@example.com");
    const authed = t.withIdentity({
      email: "scoped-sim@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const appointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: true,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: makeSlotWindow(4).start,
        title: "Scoped simulation",
        userId,
      },
    );

    const appointment = await t.run(async (ctx) =>
      ctx.db.get("appointments", appointmentId),
    );

    expect(appointment?.simulationRuleSetId).toBe(baseData.ruleSetId);
    expect(appointment?.simulationKind).toBe("draft");
    expect(appointment?.simulationValidatedAt).toBeDefined();
  });

  test("createAppointment creates a temporary patient at booking time", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_temporary_patient_booking";
    const userId = await createUser(t, authId, "temp-booking@example.com");
    const authed = t.withIdentity({
      email: "temp-booking@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const appointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: makeSlotWindow(6).start,
        temporaryPatientName: "Alex Beispiel",
        temporaryPatientPhoneNumber: "+491701234567",
        title: "Temporärer Termin",
      },
    );

    const { appointment, patient } = await t.run(async (ctx) => {
      const appointment = await ctx.db.get("appointments", appointmentId);
      const patient = appointment?.patientId
        ? await ctx.db.get("patients", appointment.patientId)
        : null;

      return { appointment, patient };
    });

    expect(appointment?.patientId).toBeDefined();
    expect(appointment?.userId).toBeUndefined();
    expect(patient?.name).toBe("Alex Beispiel");
    expect(patient?.phoneNumber).toBe("+491701234567");
    expect(patient?.recordType).toBe("temporary");
    expect(patient?.firstName).toBeUndefined();
    expect(patient?.lastName).toBeUndefined();
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

      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });

      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Series",
          practiceId,
          ruleSetId,
        },
      );

      for (const dayOfWeek of [1, 2, 3, 4, 5]) {
        await insertSelfLineageEntity(ctx.db, "baseSchedules", {
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
      const followUpTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Kontrolle",
          practiceId,
          ruleSetId,
        },
      );

      const rootAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
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
        },
      );

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

      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });

      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Appointments",
          practiceId,
          ruleSetId,
        },
      );

      const now = BigInt(Date.now());
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Checkup",
          practiceId,
          ruleSetId,
        },
      );

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
        isSimulation: true,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: window.start,
        title: "Simulationskollision",
        userId,
      }),
    ).rejects.toThrow("bereits belegt");
  });

  test("createAppointment derives the booked duration from the appointment type", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      email: "staff@example.com",
      subject: "workos_staff_server_duration",
    });
    const practiceId = await authed.mutation(api.practices.createPractice, {
      name: "Server Duration Practice",
    });
    const baseData = await authed.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.currentActiveRuleSetId) {
        throw new Error("Practice should have an active rule set");
      }
      const ruleSetId = practice.currentActiveRuleSetId;

      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });

      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Appointments",
          practiceId,
          ruleSetId,
        },
      );

      const now = BigInt(Date.now());
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Checkup",
          practiceId,
          ruleSetId,
        },
      );

      return {
        appointmentTypeId,
        locationId,
        practiceId,
        practitionerId,
      };
    });
    const userId = await createUser(
      t,
      "workos_staff_server_duration_user",
      "staff-server-duration@example.com",
    );
    const window = makeSlotWindow(4);

    const appointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: window.start,
        title: "Server duration",
        userId,
      },
    );

    const createdAppointment = await t.run(async (ctx) => {
      return await ctx.db.get("appointments", appointmentId);
    });

    expect(createdAppointment).not.toBeNull();
    expect(createdAppointment?.end).toBe(window.end);
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
        appointmentTypeLineageKey: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: rootWindow.end,
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        seriesId,
        seriesStepIndex: 0n,
        start: rootWindow.start,
        title: "Root",
        userId,
      });

      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: baseData.appointmentTypeId,
        appointmentTypeTitle: "Checkup",
        createdAt: now,
        end: followUpEnd,
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
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

describe("appointments update safety", () => {
  test("updateAppointment rejects moving an appointment onto an occupied practitioner slot", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_update_collision";
    const userId = await createUser(t, authId, "update-collision@example.com");
    const authed = t.withIdentity({
      email: "update-collision@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const otherPractitionerId = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", baseData.practiceId);
      return await insertSelfLineageEntity(ctx.db, "practitioners", {
        name: "Dr. Other",
        practiceId: baseData.practiceId,
        ruleSetId: practice?.currentActiveRuleSetId as Id<"ruleSets">,
      });
    });

    await t.run(async (ctx) => {
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        baseData.appointmentTypeId,
      );
      await ctx.db.patch("appointmentTypes", baseData.appointmentTypeId, {
        allowedPractitionerIds: [
          ...(appointmentType?.allowedPractitionerIds ?? []),
          otherPractitionerId,
        ],
      });
    });

    const window = makeSlotWindow(4);
    const appointmentToMove = await insertAppointment(t, {
      ...baseData,
      userId,
      window,
    });
    await insertAppointment(t, {
      ...baseData,
      practitionerId: otherPractitionerId,
      userId,
      window,
    });

    await expect(
      authed.mutation(api.appointments.updateAppointment, {
        id: appointmentToMove,
        practitionerId: otherPractitionerId,
      }),
    ).rejects.toThrow("Der gewaehlte Zeitraum ist bereits belegt.");
  });

  test("createAppointment rejects creating an appointment on an occupied blocked slot", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_create_blocked_slot_collision";
    const userId = await createUser(
      t,
      authId,
      "create-blocked-slot-collision@example.com",
    );
    const authed = t.withIdentity({
      email: "create-blocked-slot-collision@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const window = makeSlotWindow(5);
    await insertBlockedSlotRecord(t, {
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      title: "Sperrung",
      window,
    });

    await expect(
      authed.mutation(api.appointments.createAppointment, {
        appointmentTypeId: baseData.appointmentTypeId,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: window.start,
        title: "Termin kollidiert mit Sperrung",
        userId,
      }),
    ).rejects.toThrow("Der gewaehlte Zeitraum ist bereits belegt.");
  });

  test("updateAppointment rejects moving an appointment onto an occupied blocked slot", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_update_blocked_slot_collision";
    const userId = await createUser(
      t,
      authId,
      "update-blocked-slot-collision@example.com",
    );
    const authed = t.withIdentity({
      email: "update-blocked-slot-collision@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const appointmentToMove = await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(6),
    });
    const blockedWindow = makeSlotWindow(7);
    await insertBlockedSlotRecord(t, {
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      title: "Sperrung",
      window: blockedWindow,
    });

    await expect(
      authed.mutation(api.appointments.updateAppointment, {
        end: blockedWindow.end,
        id: appointmentToMove,
        start: blockedWindow.start,
      }),
    ).rejects.toThrow("Der gewaehlte Zeitraum ist bereits belegt.");
  });

  test("simulation conflicts are scoped to the current draft rule set", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_sim_scope";
    const userId = await createUser(t, authId, "sim-scope@example.com");
    const authed = t.withIdentity({
      email: "sim-scope@example.com",
      subject: authId,
    });

    const { draftRuleSetA, draftRuleSetB } = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", baseData.practiceId);
      const parentVersion = practice?.currentActiveRuleSetId;
      if (!parentVersion) {
        throw new Error("Expected active rule set for practice");
      }

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const draftRuleSetA = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Draft A",
        draftRevision: 0,
        parentVersion,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });
      const draftRuleSetB = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Draft B",
        draftRevision: 0,
        parentVersion,
        practiceId: baseData.practiceId,
        saved: false,
        version: 3,
      });

      return { draftRuleSetA, draftRuleSetB };
    });

    const window = makeSlotWindow(6);

    await authed.mutation(api.appointments.createAppointment, {
      appointmentTypeId: baseData.appointmentTypeId,
      isSimulation: true,
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      simulationRuleSetId: draftRuleSetA,
      start: window.start,
      title: "Draft A Simulation",
      userId,
    });

    await expect(
      authed.mutation(api.appointments.createAppointment, {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: true,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        simulationRuleSetId: draftRuleSetB,
        start: window.start,
        title: "Draft B Simulation",
        userId,
      }),
    ).resolves.toBeDefined();
  });

  test("simulated appointments must be updated through the simulation mutation", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_sim_update";
    const userId = await createUser(t, authId, "sim-update@example.com");
    const authed = t.withIdentity({
      email: "sim-update@example.com",
      subject: authId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const appointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: true,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        simulationRuleSetId: baseData.ruleSetId,
        start: makeSlotWindow(10).start,
        title: "Simulation vor Änderung",
        userId,
      },
    );

    await expect(
      authed.mutation(api.appointments.updateAppointment, {
        id: appointmentId,
        title: "Sollte fehlschlagen",
      }),
    ).rejects.toThrow("Echttermin-Bearbeitung");

    await authed.mutation(api.appointments.updateSimulationAppointment, {
      id: appointmentId,
      title: "Simulation nach Änderung",
    });

    const updatedAppointment = await t.run(async (ctx) =>
      ctx.db.get("appointments", appointmentId),
    );

    expect(updatedAppointment?.title).toBe("Simulation nach Änderung");
    expect(updatedAppointment?.isSimulation).toBe(true);
    expect(updatedAppointment?.simulationKind).toBe("draft");
    expect(updatedAppointment?.simulationRuleSetId).toBe(baseData.ruleSetId);
  });

  test("unsaved diff ignores manual simulated replacements", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_manual_sim_diff";
    const userId = await createUser(t, authId, "manual-sim-diff@example.com");
    const authed = t.withIdentity({
      email: "manual-sim-diff@example.com",
      subject: authId,
    });

    const unsavedRuleSetId = await t.run(async (ctx) => {
      await ctx.db.patch("appointmentTypes", baseData.appointmentTypeId, {
        lineageKey: baseData.appointmentTypeId,
      });
      await ctx.db.patch("locations", baseData.locationId, {
        lineageKey: baseData.locationId,
      });
      await ctx.db.patch("practitioners", baseData.practitionerId, {
        lineageKey: baseData.practitionerId,
      });
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Unsaved Draft",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });
    });

    const realAppointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: false,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: makeSlotWindow(11).start,
        title: "Echter Termin",
        userId,
      },
    );

    await authed.mutation(api.appointments.createAppointment, {
      appointmentTypeId: baseData.appointmentTypeId,
      isSimulation: true,
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      replacesAppointmentId: realAppointmentId,
      simulationRuleSetId: unsavedRuleSetId,
      start: makeSlotWindow(11).start,
      title: "Manuelle Simulation",
      userId,
    });

    const diff = await authed.query(api.ruleSets.getUnsavedRuleSetDiff, {
      practiceId: baseData.practiceId,
      ruleSetId: unsavedRuleSetId,
    });
    const coverageSection = diff?.sections.find(
      (section) => section.key === "appointmentCoverage",
    );

    expect(coverageSection?.added).toHaveLength(0);
    expect(coverageSection?.removed).toHaveLength(0);
  });

  test("activating a saved ruleset clears non-replacement simulation appointments", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_sim_cleanup";
    const userId = await createUser(t, authId, "sim-cleanup@example.com");
    const authed = t.withIdentity({
      email: "sim-cleanup@example.com",
      subject: authId,
    });

    const unsavedRuleSetId = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", baseData.practiceId);
      const parentVersion = practice?.currentActiveRuleSetId;
      if (!parentVersion) {
        throw new Error("Expected active rule set for practice");
      }
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Unsaved Draft",
        draftRevision: 0,
        parentVersion,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });
    });

    await authed.mutation(api.appointments.createAppointment, {
      appointmentTypeId: baseData.appointmentTypeId,
      isSimulation: true,
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      simulationRuleSetId: unsavedRuleSetId,
      start: makeSlotWindow(7).start,
      title: "Draft preview only",
      userId,
    });

    await authed.mutation(api.ruleSets.saveUnsavedRuleSet, {
      description: "Simulation cleanup",
      practiceId: baseData.practiceId,
      setAsActive: true,
    });

    const remainingSimulations = await t.run(async (ctx) =>
      ctx.db
        .query("appointments")
        .withIndex("by_simulationRuleSetId", (q) =>
          q.eq("simulationRuleSetId", unsavedRuleSetId),
        )
        .collect(),
    );

    expect(remainingSimulations).toHaveLength(0);
  });

  test("clearing simulated data keeps activation-bound vacation reassignments", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_sim_clear_keep_reassignments";
    const userId = await createUser(t, authId, "sim-clear-keep@example.com");
    const authed = t.withIdentity({
      email: "sim-clear-keep@example.com",
      subject: authId,
    });

    const unsavedRuleSetId = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", baseData.practiceId);
      const parentVersion = practice?.currentActiveRuleSetId;
      if (!parentVersion) {
        throw new Error("Expected active rule set for practice");
      }
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Unsaved Draft",
        draftRevision: 0,
        parentVersion,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });
    });

    const realAppointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: false,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: makeSlotWindow(8).start,
        title: "Real appointment",
        userId,
      },
    );

    await authed.mutation(api.appointments.createAppointment, {
      appointmentTypeId: baseData.appointmentTypeId,
      isSimulation: true,
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      simulationRuleSetId: unsavedRuleSetId,
      start: makeSlotWindow(9).start,
      title: "Draft preview only",
      userId,
    });

    const activationBoundSimulationId = await t.run(async (ctx) => {
      const vacationId = await insertSelfLineageEntity(ctx.db, "vacations", {
        createdAt: BigInt(Date.now()),
        date: "2026-01-05",
        portion: "morning",
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        ruleSetId: unsavedRuleSetId,
        staffType: "practitioner",
      });
      return await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: baseData.appointmentTypeId,
        appointmentTypeTitle: "Kontrolle",
        createdAt: BigInt(Date.now()),
        end: makeSlotWindow(8).end,
        isSimulation: true,
        lastModified: BigInt(Date.now()),
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        reassignmentSourceVacationLineageKey: vacationId,
        replacesAppointmentId: realAppointmentId,
        simulationKind: "activation-reassignment",
        simulationRuleSetId: unsavedRuleSetId,
        simulationValidatedAt: BigInt(Date.now()),
        start: makeSlotWindow(8).start,
        title: "Auto reassigned",
        userId,
      });
    });

    const clearResult = await authed.mutation(
      api.appointments.deleteAllSimulatedData,
      {
        practiceId: baseData.practiceId,
      },
    );

    expect(clearResult.appointmentsDeleted).toBe(1);

    const [remainingActivationBound, remainingDraftOnly] = await t.run(
      async (ctx) => {
        const activationBound = await ctx.db.get(
          "appointments",
          activationBoundSimulationId,
        );
        const draftOnlyAppointments = await ctx.db
          .query("appointments")
          .withIndex("by_simulationRuleSetId", (q) =>
            q.eq("simulationRuleSetId", unsavedRuleSetId),
          )
          .collect();
        return [activationBound, draftOnlyAppointments];
      },
    );

    expect(remainingActivationBound?._id).toBe(activationBoundSimulationId);
    expect(
      remainingDraftOnly.filter(
        (appointment) =>
          appointment.simulationKind !== "activation-reassignment",
      ),
    ).toHaveLength(0);
  });

  test("simulated replacements tolerate missing patient links on the replaced appointment", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const authId = "workos_sim_missing_patient";
    const userId = await createUser(
      t,
      authId,
      "sim-missing-patient@example.com",
    );
    const authed = t.withIdentity({
      email: "sim-missing-patient@example.com",
      subject: authId,
    });

    const { patientId, unsavedRuleSetId } = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", baseData.practiceId);
      const parentVersion = practice?.currentActiveRuleSetId;
      if (!parentVersion) {
        throw new Error("Expected active rule set for practice");
      }
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const patientId = await ctx.db.insert("patients", {
        createdAt: BigInt(Date.now()),
        firstName: "Pat",
        lastModified: BigInt(Date.now()),
        lastName: "Missing",
        practiceId: baseData.practiceId,
        recordType: "pvs",
        searchFirstName: "Pat",
        searchLastName: "Missing",
      });

      const unsavedRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Unsaved Draft",
        draftRevision: 0,
        parentVersion,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });

      return { patientId, unsavedRuleSetId };
    });

    const realAppointmentId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: false,
        locationId: baseData.locationId,
        patientId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        start: makeSlotWindow(8).start,
        title: "Real appointment",
      },
    );

    await t.run(async (ctx) => {
      await ctx.db.delete("patients", patientId);
    });

    const simulatedReplacementId = await authed.mutation(
      api.appointments.createAppointment,
      {
        appointmentTypeId: baseData.appointmentTypeId,
        isSimulation: true,
        locationId: baseData.locationId,
        patientId,
        practiceId: baseData.practiceId,
        practitionerId: baseData.practitionerId,
        replacesAppointmentId: realAppointmentId,
        simulationRuleSetId: unsavedRuleSetId,
        start: makeSlotWindow(8).start,
        title: "Sim replacement",
      },
    );

    const simulatedReplacement = await t.run(async (ctx) => {
      return await ctx.db.get("appointments", simulatedReplacementId);
    });

    expect(simulatedReplacement?.replacesAppointmentId).toBe(realAppointmentId);
    expect(simulatedReplacement?.patientId).toBeUndefined();
    expect(simulatedReplacement?.isSimulation).toBe(true);
  });

  test("getAppointments remaps appointment references by lineage into the displayed rule set", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);

    const savedRuleSetId = await t.run(async (ctx) => {
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Saved Rule Set B",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });
    });

    const copiedEntityIds = await t.run(async (ctx) => {
      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        lineageKey: baseData.locationId,
        name: "Main Location Copy",
        practiceId: baseData.practiceId,
        ruleSetId: savedRuleSetId,
      });

      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          lineageKey: baseData.practitionerId,
          name: "Dr. Appointments Copy",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );

      const now = BigInt(Date.now());
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [practitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          lineageKey: baseData.appointmentTypeId,
          name: "Checkup Copy",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );

      return { appointmentTypeId, locationId, practitionerId };
    });

    const userId = await createUser(
      t,
      "workos_lineage_display",
      "lineage-display@example.com",
    );
    const authed = t.withIdentity({
      email: "lineage-display@example.com",
      subject: "workos_lineage_display",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const appointmentId = await insertAppointment(t, {
      appointmentTypeId: copiedEntityIds.appointmentTypeId,
      locationId: copiedEntityIds.locationId,
      practiceId: baseData.practiceId,
      practitionerId: copiedEntityIds.practitionerId,
      userId,
      window: makeSlotWindow(4),
    });

    const appointmentsInDisplayedRuleSet = await authed.query(
      api.appointments.getAppointments,
      {
        activeRuleSetId: baseData.ruleSetId,
        selectedRuleSetId: baseData.ruleSetId,
      },
    );

    expect(appointmentsInDisplayedRuleSet).toHaveLength(1);
    const displayedAppointment = appointmentsInDisplayedRuleSet[0];
    expect(displayedAppointment?._id).toBe(appointmentId);

    expect(displayedAppointment?.appointmentTypeId).toBe(
      baseData.appointmentTypeId,
    );
    expect(displayedAppointment?.locationId).toBe(baseData.locationId);
    expect(displayedAppointment?.practitionerId).toBe(baseData.practitionerId);
  });

  test("getAppointments ignores unrelated draft simulations before remapping the displayed rule set", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_foreign_draft_simulation",
      "foreign-draft-simulation@example.com",
    );
    const authed = t.withIdentity({
      email: "foreign-draft-simulation@example.com",
      subject: "workos_foreign_draft_simulation",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const foreignRuleSetId = await t.run(async (ctx) => {
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Foreign Draft",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: false,
        version: 2,
      });
    });

    await t.run(async (ctx) => {
      const foreignLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          name: "Foreign Location",
          practiceId: baseData.practiceId,
          ruleSetId: foreignRuleSetId,
        },
      );
      const foreignPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Foreign Practitioner",
          practiceId: baseData.practiceId,
          ruleSetId: foreignRuleSetId,
        },
      );
      const now = BigInt(Date.now());
      const foreignAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [foreignPractitionerId],
          createdAt: now,
          duration: 30,
          lastModified: now,
          name: "Foreign Type",
          practiceId: baseData.practiceId,
          ruleSetId: foreignRuleSetId,
        },
      );

      await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: foreignAppointmentTypeId,
        appointmentTypeTitle: "Foreign Type",
        createdAt: now,
        end: makeSlotWindow(6).end,
        isSimulation: true,
        lastModified: now,
        locationLineageKey: foreignLocationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: foreignPractitionerId,
        simulationKind: "draft",
        simulationRuleSetId: foreignRuleSetId,
        simulationValidatedAt: now,
        start: makeSlotWindow(6).start,
        title: "Foreign draft simulation",
        userId,
      });
    });

    await expect(
      authed.query(api.appointments.getAppointments, {
        activeRuleSetId: baseData.ruleSetId,
      }),
    ).resolves.toEqual([]);
  });

  test("getAppointments remaps through soft-deleted entities in the displayed rule set", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);

    const savedRuleSetId = await t.run(async (ctx) => {
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Saved Rule Set Missing Mapping",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });
    });

    const userId = await createUser(
      t,
      "workos_missing_display_mapping",
      "missing-display-mapping@example.com",
    );
    const authed = t.withIdentity({
      email: "missing-display-mapping@example.com",
      subject: "workos_missing_display_mapping",
    });
    const deletedDisplayEntityIds = await t.run(async (ctx) => {
      const deletedLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          deleted: true,
          lineageKey: baseData.locationId,
          name: "Deleted Location Copy",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const deletedPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          deleted: true,
          lineageKey: baseData.practitionerId,
          name: "Deleted Practitioner Copy",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const now = BigInt(Date.now());
      const deletedTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [deletedPractitionerId],
          createdAt: now,
          deleted: true,
          duration: 30,
          lastModified: now,
          lineageKey: baseData.appointmentTypeId,
          name: "Deleted Type Copy",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      return {
        deletedLocationId,
        deletedPractitionerId,
        deletedTypeId,
      };
    });

    await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(4),
    });

    await expect(
      authed.query(api.appointments.getAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        selectedRuleSetId: savedRuleSetId,
      }),
    ).resolves.toMatchObject([
      {
        appointmentTypeId: deletedDisplayEntityIds.deletedTypeId,
        locationId: deletedDisplayEntityIds.deletedLocationId,
        practitionerId: deletedDisplayEntityIds.deletedPractitionerId,
      },
    ]);
  });

  test("getAppointments skips appointments that cannot be remapped into the displayed rule set", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);

    const savedRuleSetId = await t.run(async (ctx) => {
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Saved Rule Set Without Mappings",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });
    });

    const userId = await createUser(
      t,
      "workos_unmappable_display_appointment",
      "unmappable-display-appointment@example.com",
    );
    const authed = t.withIdentity({
      email: "unmappable-display-appointment@example.com",
      subject: "workos_unmappable_display_appointment",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    await insertAppointment(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(4),
    });

    await expect(
      authed.query(api.appointments.getAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        selectedRuleSetId: savedRuleSetId,
      }),
    ).resolves.toEqual([]);
  });

  test("getBlockedSlots applies scope before display remapping", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);

    const foreignRuleSetId = await t.run(async (ctx) => {
      return await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Foreign Rule Set",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });
    });

    const userId = await createUser(
      t,
      "workos_blocked_slot_scope",
      "blocked-slot-scope@example.com",
    );
    const authed = t.withIdentity({
      email: "blocked-slot-scope@example.com",
      subject: "workos_blocked_slot_scope",
    });

    const realWindow = makeSlotWindow(4);
    const simulationWindow = makeSlotWindow(5);

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const foreignLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          name: "Foreign Location",
          practiceId: baseData.practiceId,
          ruleSetId: foreignRuleSetId,
        },
      );
      const foreignPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Foreign Practitioner",
          practiceId: baseData.practiceId,
          ruleSetId: foreignRuleSetId,
        },
      );

      const now = BigInt(Date.now());
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: realWindow.end,
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        start: realWindow.start,
        title: "Real blocked slot",
      });
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: simulationWindow.end,
        isSimulation: true,
        lastModified: now,
        locationLineageKey: foreignLocationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: foreignPractitionerId,
        start: simulationWindow.start,
        title: "Foreign simulation blocked slot",
      });
    });

    await expect(
      authed.query(api.appointments.getBlockedSlots, {
        activeRuleSetId: baseData.ruleSetId,
        scope: "real",
      }),
    ).resolves.toMatchObject([
      {
        locationId: baseData.locationId,
        practitionerId: baseData.practitionerId,
        title: "Real blocked slot",
      },
    ]);
  });
});

describe("calendar day appointment queries", () => {
  test("getCalendarDayAppointments enforces practice access", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const range = makeDayRange(2);
    await createUser(t, "workos_day_query_no_access", "no-access@example.com");
    const authed = t.withIdentity({
      email: "no-access@example.com",
      subject: "workos_day_query_no_access",
    });

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        dayEnd: range.dayEnd,
        dayStart: range.dayStart,
        practiceId: baseData.practiceId,
        scope: "real",
      }),
    ).rejects.toThrow();
  });

  test("getCalendarDayAppointments returns only same-day records for the requested location and scope", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_query_scope",
      "day-query-scope@example.com",
    );
    const authed = t.withIdentity({
      email: "day-query-scope@example.com",
      subject: "workos_day_query_scope",
    });
    const targetRange = makeDayRange(3);

    const otherLocationId = await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      return await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Secondary Location",
        practiceId: baseData.practiceId,
        ruleSetId: baseData.ruleSetId,
      });
    });

    const expectedRealAppointmentId = await insertAppointmentRecord(t, {
      ...baseData,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      isSimulation: true,
      simulationRuleSetId: baseData.ruleSetId,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 11, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 11, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      locationId: otherLocationId,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      userId,
      window: makeSlotWindow(4),
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      cancelledAt: BigInt(Date.now()),
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 13, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 13, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "real",
      }),
    ).resolves.toMatchObject([
      {
        _id: expectedRealAppointmentId,
        locationId: baseData.locationId,
        practitionerId: baseData.practitionerId,
      },
    ]);

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "simulation",
      }),
    ).resolves.toMatchObject([
      {
        _id: expectedRealAppointmentId,
        locationId: baseData.locationId,
      },
      {
        isSimulation: true,
        locationId: baseData.locationId,
      },
    ]);
  });

  test("getCalendarDayAppointments hides an in-range real appointment when its simulation replacement moved to another day", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_query_simulation_replacement",
      "day-query-simulation-replacement@example.com",
    );
    const authed = t.withIdentity({
      email: "day-query-simulation-replacement@example.com",
      subject: "workos_day_query_simulation_replacement",
    });
    const targetRange = makeDayRange(6);
    const movedRange = makeDayRange(7);

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const realAppointmentId = await insertAppointmentRecord(t, {
      ...baseData,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 9, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 9, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      isSimulation: true,
      replacesAppointmentId: realAppointmentId,
      simulationRuleSetId: baseData.ruleSetId,
      userId,
      window: {
        end: movedRange.date
          .toZonedDateTime({
            plainTime: { hour: 15, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: movedRange.date
          .toZonedDateTime({
            plainTime: { hour: 15, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "real",
      }),
    ).resolves.toHaveLength(1);

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "simulation",
      }),
    ).resolves.toHaveLength(0);
  });

  test("getCalendarDayAppointments ignores simulation replacements from another practice", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const foreignPracticeData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_query_cross_practice_simulation_replacement",
      "day-query-cross-practice-simulation-replacement@example.com",
    );
    const authed = t.withIdentity({
      email: "day-query-cross-practice-simulation-replacement@example.com",
      subject: "workos_day_query_cross_practice_simulation_replacement",
    });
    const targetRange = makeDayRange(10);

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const realAppointmentId = await insertAppointmentRecord(t, {
      ...baseData,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 11, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 11, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertAppointmentRecord(t, {
      ...foreignPracticeData,
      isSimulation: true,
      replacesAppointmentId: realAppointmentId,
      simulationRuleSetId: baseData.ruleSetId,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "simulation",
      }),
    ).resolves.toMatchObject([
      {
        _id: realAppointmentId,
        locationId: baseData.locationId,
      },
    ]);
  });

  test("getCalendarDayAppointments accepts a deleted selected location when resolving day-query lineage", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_query_deleted_selected_location",
      "day-query-deleted-selected-location@example.com",
    );
    const authed = t.withIdentity({
      email: "day-query-deleted-selected-location@example.com",
      subject: "workos_day_query_deleted_selected_location",
    });
    const targetRange = makeDayRange(12);

    const displayRuleSet = await t.run(async (ctx) => {
      const savedRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Deleted Display Location Rule Set",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const deletedDisplayedLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          deleted: true,
          lineageKey: baseData.locationId,
          name: "Deleted Display Location",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const displayedPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          lineageKey: baseData.practitionerId,
          name: "Displayed Practitioner",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const displayedAppointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerIds: [displayedPractitionerId],
          createdAt: BigInt(Date.now()),
          duration: 30,
          lastModified: BigInt(Date.now()),
          lineageKey: baseData.appointmentTypeId,
          name: "Displayed Checkup",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );

      return {
        deletedDisplayedLocationId,
        displayedAppointmentTypeId,
        displayedPractitionerId,
        savedRuleSetId,
      };
    });

    await insertAppointmentRecord(t, {
      ...baseData,
      userId,
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 9, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 9, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayAppointments, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: displayRuleSet.deletedDisplayedLocationId,
        practiceId: baseData.practiceId,
        scope: "real",
        selectedRuleSetId: displayRuleSet.savedRuleSetId,
      }),
    ).resolves.toMatchObject([
      {
        appointmentTypeId: displayRuleSet.displayedAppointmentTypeId,
        locationId: displayRuleSet.deletedDisplayedLocationId,
        practitionerId: displayRuleSet.displayedPractitionerId,
      },
    ]);
  });

  test("getCalendarDayBlockedSlots filters by location lineage and remaps ids after filtering", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_blocked_slots",
      "day-blocked-slots@example.com",
    );
    const authed = t.withIdentity({
      email: "day-blocked-slots@example.com",
      subject: "workos_day_blocked_slots",
    });
    const targetRange = makeDayRange(5);

    const displayRuleSet = await t.run(async (ctx) => {
      const savedRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Displayed Rule Set",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const displayedLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          lineageKey: baseData.locationId,
          name: "Displayed Main Location",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const displayedPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          lineageKey: baseData.practitionerId,
          name: "Displayed Practitioner",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const otherLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          name: "Other Location",
          practiceId: baseData.practiceId,
          ruleSetId: baseData.ruleSetId,
        },
      );

      const now = BigInt(Date.now());
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        lastModified: now,
        locationLineageKey: baseData.locationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        title: "Main location block",
      });
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        lastModified: now,
        locationLineageKey: otherLocationId,
        practiceId: baseData.practiceId,
        practitionerLineageKey: baseData.practitionerId,
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 12, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        title: "Other location block",
      });

      return {
        displayedLocationId,
        displayedPractitionerId,
        savedRuleSetId,
      };
    });

    await expect(
      authed.query(api.appointments.getCalendarDayBlockedSlots, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: displayRuleSet.displayedLocationId,
        practiceId: baseData.practiceId,
        scope: "real",
        selectedRuleSetId: displayRuleSet.savedRuleSetId,
      }),
    ).resolves.toMatchObject([
      {
        locationId: displayRuleSet.displayedLocationId,
        practitionerId: displayRuleSet.displayedPractitionerId,
        title: "Main location block",
      },
    ]);
  });

  test("getCalendarDayBlockedSlots hides an in-range real block when its simulation replacement moved to another day", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_blocked_slot_simulation_replacement",
      "day-blocked-slot-simulation-replacement@example.com",
    );
    const authed = t.withIdentity({
      email: "day-blocked-slot-simulation-replacement@example.com",
      subject: "workos_day_blocked_slot_simulation_replacement",
    });
    const targetRange = makeDayRange(8);
    const movedRange = makeDayRange(9);

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const realBlockedSlotId = await insertBlockedSlotRecord(t, {
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      title: "Real blocked slot",
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertBlockedSlotRecord(t, {
      isSimulation: true,
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      replacesBlockedSlotId: realBlockedSlotId,
      title: "Moved blocked slot",
      window: {
        end: movedRange.date
          .toZonedDateTime({
            plainTime: { hour: 16, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: movedRange.date
          .toZonedDateTime({
            plainTime: { hour: 16, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayBlockedSlots, {
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "real",
      }),
    ).resolves.toHaveLength(1);

    await expect(
      authed.query(api.appointments.getCalendarDayBlockedSlots, {
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "simulation",
      }),
    ).resolves.toHaveLength(0);
  });

  test("getCalendarDayBlockedSlots ignores simulation replacements from another practice", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const foreignPracticeData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_blocked_slot_cross_practice_replacement",
      "day-blocked-slot-cross-practice-replacement@example.com",
    );
    const authed = t.withIdentity({
      email: "day-blocked-slot-cross-practice-replacement@example.com",
      subject: "workos_day_blocked_slot_cross_practice_replacement",
    });
    const targetRange = makeDayRange(11);

    await t.run(async (ctx) => {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });
    });

    const realBlockedSlotId = await insertBlockedSlotRecord(t, {
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      title: "Real blocked slot",
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 13, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 13, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await insertBlockedSlotRecord(t, {
      isSimulation: true,
      locationId: foreignPracticeData.locationId,
      practiceId: foreignPracticeData.practiceId,
      practitionerId: foreignPracticeData.practitionerId,
      replacesBlockedSlotId: realBlockedSlotId,
      title: "Foreign blocked slot replacement",
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 14, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 14, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayBlockedSlots, {
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: baseData.locationId,
        practiceId: baseData.practiceId,
        scope: "simulation",
      }),
    ).resolves.toMatchObject([
      {
        locationId: baseData.locationId,
        title: "Real blocked slot",
      },
    ]);
  });

  test("getCalendarDayBlockedSlots accepts a deleted selected location when resolving day-query lineage", async () => {
    const t = createTestContext();
    const baseData = await createAppointmentBaseData(t);
    const userId = await createUser(
      t,
      "workos_day_blocked_slots_deleted_selected_location",
      "day-blocked-slots-deleted-selected-location@example.com",
    );
    const authed = t.withIdentity({
      email: "day-blocked-slots-deleted-selected-location@example.com",
      subject: "workos_day_blocked_slots_deleted_selected_location",
    });
    const targetRange = makeDayRange(13);

    const displayRuleSet = await t.run(async (ctx) => {
      const savedRuleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Deleted Display Blocked Slot Location Rule Set",
        draftRevision: 0,
        parentVersion: baseData.ruleSetId,
        practiceId: baseData.practiceId,
        saved: true,
        version: 2,
      });

      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: baseData.practiceId,
        role: "owner",
        userId,
      });

      const deletedDisplayedLocationId = await insertSelfLineageEntity(
        ctx.db,
        "locations",
        {
          deleted: true,
          lineageKey: baseData.locationId,
          name: "Deleted Display Blocked Slot Location",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );
      const displayedPractitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          lineageKey: baseData.practitionerId,
          name: "Displayed Blocked Slot Practitioner",
          practiceId: baseData.practiceId,
          ruleSetId: savedRuleSetId,
        },
      );

      return {
        deletedDisplayedLocationId,
        displayedPractitionerId,
        savedRuleSetId,
      };
    });

    await insertBlockedSlotRecord(t, {
      locationId: baseData.locationId,
      practiceId: baseData.practiceId,
      practitionerId: baseData.practitionerId,
      title: "Main location block",
      window: {
        end: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 30 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
        start: targetRange.date
          .toZonedDateTime({
            plainTime: { hour: 10, minute: 0 },
            timeZone: "Europe/Berlin",
          })
          .toString(),
      },
    });

    await expect(
      authed.query(api.appointments.getCalendarDayBlockedSlots, {
        activeRuleSetId: baseData.ruleSetId,
        dayEnd: targetRange.dayEnd,
        dayStart: targetRange.dayStart,
        locationId: displayRuleSet.deletedDisplayedLocationId,
        practiceId: baseData.practiceId,
        scope: "real",
        selectedRuleSetId: displayRuleSet.savedRuleSetId,
      }),
    ).resolves.toMatchObject([
      {
        locationId: displayRuleSet.deletedDisplayedLocationId,
        practitionerId: displayRuleSet.displayedPractitionerId,
        title: "Main location block",
      },
    ]);
  });
});
