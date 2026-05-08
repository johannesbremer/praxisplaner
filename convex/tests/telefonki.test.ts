import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

type TestContext = ReturnType<typeof createTestContext>;

async function addBlockingHoursAheadRule(
  t: TestContext,
  args: {
    minimumHours: number;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const rootRuleId = await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      createdAt: now,
      enabled: true,
      isRoot: true,
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });

    await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      conditionType: "HOURS_AHEAD",
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: "CONDITION",
      operator: "LESS_THAN",
      parentConditionId: rootRuleId,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      valueNumber: args.minimumHours,
    });
  });
}

async function createTelefonkiFixture(t: TestContext) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "TelefonKI Test Practice",
    });
    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: "TelefonKI Test Rule Set",
      draftRevision: 0,
      practiceId,
      saved: true,
      version: 1,
    });
    await ctx.db.patch("practices", practiceId, {
      currentActiveRuleSetId: ruleSetId,
    });

    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Dissen",
      practiceId,
      ruleSetId,
    });
    const practitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Telefon",
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
        duration: 30,
        lastModified: now,
        name: "Akut",
        practiceId,
        ruleSetId,
      },
    );

    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek,
        endTime: "16:00",
        locationLineageKey: locationId,
        practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId,
        startTime: "08:00",
      });
    }

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

function nextWeekdayAt(weekday: number, hour: number, minute: number): string {
  const today = Temporal.Now.plainDateISO("Europe/Berlin");
  const delta = (weekday - today.dayOfWeek + 7) % 7;
  return today
    .add({ days: delta === 0 ? 7 : delta })
    .toZonedDateTime({
      plainTime: { hour, minute },
      timeZone: "Europe/Berlin",
    })
    .toString();
}

function nextWeekdayDate(weekday: number): string {
  return Temporal.ZonedDateTime.from(nextWeekdayAt(weekday, 9, 0))
    .toPlainDate()
    .toString();
}

function simulatedContext(args: {
  appointmentTypeId: Id<"appointmentTypes">;
  locationId: Id<"locations">;
}) {
  return {
    appointmentTypeLineageKey: args.appointmentTypeId,
    locationLineageKey: args.locationId,
    patient: {
      dateOfBirth: "1980-01-01",
      isNew: false,
    },
  };
}

describe("TelefonKI availability", () => {
  test("returns bounded next slots and afternoon variants", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    const slots = await t.query(api.telefonki.nextAvailableSlots, {
      limit: 10,
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });

    expect(slots).toHaveLength(10);
    expect(slots[0]?.startTime).toBeDefined();

    const nextSlot = await t.query(api.telefonki.nextAvailableSlot, {
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(nextSlot?.startTime).toBe(slots[0]?.startTime);

    const afternoonSlots = await t.query(
      api.telefonki.nextAvailableAfternoonSlots,
      {
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      },
    );
    expect(afternoonSlots).toHaveLength(10);
    expect(
      afternoonSlots.every(
        (slot) => Temporal.ZonedDateTime.from(slot.startTime).hour >= 12,
      ),
    ).toBe(true);

    const afternoonSlot = await t.query(
      api.telefonki.nextAvailableAfternoonSlot,
      {
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      },
    );
    expect(afternoonSlot?.startTime).toBe(afternoonSlots[0]?.startTime);
  });

  test("searches a specific date only", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    const mondaySlots = await t.query(api.telefonki.availableSlotsOnDate, {
      date: nextWeekdayDate(1),
      limit: 10,
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(mondaySlots).toHaveLength(10);
    expect(
      mondaySlots.every(
        (slot) => Temporal.ZonedDateTime.from(slot.startTime).dayOfWeek === 1,
      ),
    ).toBe(true);

    const saturdaySlots = await t.query(api.telefonki.availableSlotsOnDate, {
      date: nextWeekdayDate(6),
      limit: 10,
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(saturdaySlots).toEqual([]);
  });

  test("returns no slots when active rules block all candidates", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    await addBlockingHoursAheadRule(t, {
      minimumHours: 24 * 365,
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const slots = await t.query(api.telefonki.nextAvailableSlots, {
      date: nextWeekdayDate(1),
      limit: 10,
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(slots).toEqual([]);
  });
});

describe("TelefonKI booking ownership", () => {
  test("books, views, cancels, and rejects a second appointment for the same call", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(api.telefonki.nextAvailableSlot, {
      date: nextWeekdayDate(1),
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const identityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      {
        callerPhoneNumber: "+491701234567",
        callId: "call-1",
        integrationActor: "livekit-agent",
        practiceId: fixture.practiceId,
      },
    );

    const booking = await t.mutation(api.telefonki.book, {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      locationLineageKey: fixture.locationId,
      patient: {
        dateOfBirth: "1980-01-01",
        firstName: "Ada",
        isNew: false,
        lastName: "Lovelace",
        phoneNumber: "+491701234567",
      },
      phoneBookingIdentityId: identityId,
      practitionerLineageKey: slot.practitionerLineageKey,
      practitionerName: slot.practitionerName,
      reasonDescription: "Rueckenschmerzen",
      startTime: slot.startTime,
    });
    expect(booking.appointmentId).toBeDefined();

    await expect(
      t.mutation(api.telefonki.book, {
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        locationLineageKey: fixture.locationId,
        patient: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          isNew: false,
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        phoneBookingIdentityId: identityId,
        practitionerLineageKey: slot.practitionerLineageKey,
        practitionerName: slot.practitionerName,
        reasonDescription: "Rueckenschmerzen",
        startTime: slot.startTime,
      }),
    ).rejects.toThrow("already has a booked appointment");

    const viewed = await t.query(api.telefonki.viewBookedAppointment, {
      phoneBookingIdentityId: identityId,
    });
    expect(viewed?.appointmentId).toBe(booking.appointmentId);

    const cancelled = await t.mutation(api.telefonki.cancelBookedAppointment, {
      phoneBookingIdentityId: identityId,
    });
    expect(cancelled?.appointmentId).toBe(booking.appointmentId);
    expect(cancelled?.cancelledAt).toBeDefined();
  });

  test("rejects booking a stale occupied slot", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(api.telefonki.nextAvailableSlot, {
      date: nextWeekdayDate(1),
      practiceId: fixture.practiceId,
      simulatedContext: simulatedContext({
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
      }),
    });
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const firstIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      {
        callId: "call-occupied-1",
        practiceId: fixture.practiceId,
      },
    );
    const secondIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      {
        callId: "call-occupied-2",
        practiceId: fixture.practiceId,
      },
    );

    const baseBookingArgs = {
      appointmentTypeLineageKey: fixture.appointmentTypeId,
      locationLineageKey: fixture.locationId,
      patient: {
        dateOfBirth: "1980-01-01",
        firstName: "Grace",
        isNew: false,
        lastName: "Hopper",
        phoneNumber: "+491709999999",
      },
      practitionerLineageKey: slot.practitionerLineageKey,
      practitionerName: slot.practitionerName,
      reasonDescription: "Akute Beschwerden",
      startTime: slot.startTime,
    };

    await t.mutation(api.telefonki.book, {
      ...baseBookingArgs,
      phoneBookingIdentityId: firstIdentityId,
    });

    await expect(
      t.mutation(api.telefonki.book, {
        ...baseBookingArgs,
        phoneBookingIdentityId: secondIdentityId,
      }),
    ).rejects.toThrow("Selected slot is no longer available");
  });
});
