import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { createAppointmentFromTrustedSource } from "../appointments";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

type TestContext = ReturnType<typeof createTestContext>;
const TEST_TELEFONKI_SECRET = "telefonki-test-secret";

function withTelefonkiSecret<T extends object>(
  args: T,
): T & { integrationSecret: string } {
  return {
    ...args,
    integrationSecret: TEST_TELEFONKI_SECRET,
  };
}

const originalTelefonkiSecret = process.env["TELEFONKI_SHARED_SECRET"];

beforeEach(() => {
  process.env["TELEFONKI_SHARED_SECRET"] = TEST_TELEFONKI_SECRET;
});

afterEach(() => {
  if (originalTelefonkiSecret === undefined) {
    delete process.env["TELEFONKI_SHARED_SECRET"];
    return;
  }
  process.env["TELEFONKI_SHARED_SECRET"] = originalTelefonkiSecret;
});

async function addBlockingClientTypeRule(
  t: TestContext,
  args: {
    clientType: string;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  await t.run(async (ctx) => {
    const now = BigInt(Date.now());
    const rootRuleId = await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      createdAt: now,
      isRoot: true,
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });

    await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      conditionType: "CLIENT_TYPE",
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: "CONDITION",
      operator: "IS",
      parentConditionId: rootRuleId,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      valueIds: [args.clientType],
    });
  });
}

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
    const phoneNumberId = await ctx.db.insert("practicePhoneNumbers", {
      createdAt: BigInt(Date.now()),
      lastModified: BigInt(Date.now()),
      phoneNumber: "+495421000000",
      practiceId,
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
      phoneNumberId,
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
    clientType: "Phone-AI",
    locationLineageKey: args.locationId,
    patient: {
      dateOfBirth: "1980-01-01",
      isNew: false,
    },
  };
}

describe("TelefonKI availability", () => {
  test("fails closed when the TelefonKI shared secret is not configured", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    delete process.env["TELEFONKI_SHARED_SECRET"];

    await expect(
      t.query(
        api.telefonki.getActiveConfig,
        withTelefonkiSecret({
          practiceId: fixture.practiceId,
        }),
      ),
    ).rejects.toThrow("TelefonKI shared secret is not configured.");
  });

  test("resolves the practice by dialed phone number", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    const resolved = await t.query(
      api.telefonki.resolvePracticeByDialedPhoneNumber,
      withTelefonkiSecret({
        dialedPracticePhoneNumber: "+495421000000",
      }),
    );

    expect(resolved.practiceId).toBe(fixture.practiceId);
    expect(resolved.dialedPracticePhoneNumber).toBe("+495421000000");
  });

  test("rejects non-E.164 dialed practice phone numbers", async () => {
    const t = createTestContext();
    await createTelefonkiFixture(t);

    await expect(
      t.query(
        api.telefonki.resolvePracticeByDialedPhoneNumber,
        withTelefonkiSecret({
          dialedPracticePhoneNumber: "05421 000000",
        }),
      ),
    ).rejects.toThrow("Practice phone number must be provided in E.164 format");
  });

  test("rejects unknown dialed phone numbers", async () => {
    const t = createTestContext();
    await createTelefonkiFixture(t);

    await expect(
      t.query(
        api.telefonki.resolvePracticeByDialedPhoneNumber,
        withTelefonkiSecret({
          dialedPracticePhoneNumber: "+495421999999",
        }),
      ),
    ).rejects.toThrow("No practice is configured for the dialed phone number");
  });

  test("maps different dialed numbers to different practices", async () => {
    const t = createTestContext();
    const firstFixture = await createTelefonkiFixture(t);
    const secondFixture = await t.run(async (ctx) => {
      const practiceId = await ctx.db.insert("practices", {
        name: "TelefonKI Zweitpraxis",
      });
      await ctx.db.insert("practicePhoneNumbers", {
        createdAt: BigInt(Date.now()),
        lastModified: BigInt(Date.now()),
        phoneNumber: "+495431000000",
        practiceId,
      });
      return { practiceId };
    });

    const firstResolved = await t.query(
      api.telefonki.resolvePracticeByDialedPhoneNumber,
      withTelefonkiSecret({
        dialedPracticePhoneNumber: "+495421000000",
      }),
    );
    const secondResolved = await t.query(
      api.telefonki.resolvePracticeByDialedPhoneNumber,
      withTelefonkiSecret({
        dialedPracticePhoneNumber: "+495431000000",
      }),
    );

    expect(firstResolved.practiceId).toBe(firstFixture.practiceId);
    expect(secondResolved.practiceId).toBe(secondFixture.practiceId);
  });

  test("returns bounded next slots and afternoon variants", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    const slots = await t.query(
      api.telefonki.nextAvailableSlots,
      withTelefonkiSecret({
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );

    expect(slots).toHaveLength(10);
    expect(slots[0]?.startTime).toBeDefined();

    const nextSlot = await t.query(
      api.telefonki.nextAvailableSlot,
      withTelefonkiSecret({
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(nextSlot?.startTime).toBe(slots[0]?.startTime);

    const afternoonSlots = await t.query(
      api.telefonki.nextAvailableAfternoonSlots,
      withTelefonkiSecret({
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(afternoonSlots).toHaveLength(10);
    expect(
      afternoonSlots.every(
        (slot) => Temporal.ZonedDateTime.from(slot.startTime).hour >= 12,
      ),
    ).toBe(true);

    const afternoonSlot = await t.query(
      api.telefonki.nextAvailableAfternoonSlot,
      withTelefonkiSecret({
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(afternoonSlot?.startTime).toBe(afternoonSlots[0]?.startTime);
  });

  test("only offers slots that cover the full TelefonKI appointment duration", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const blockedStartTime = nextWeekdayAt(1, 8, 5);

    await t.run(async (ctx) => {
      await createAppointmentFromTrustedSource(ctx, {
        appointmentTypeId: fixture.appointmentTypeId,
        locationId: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerId: fixture.practitionerId,
        start: blockedStartTime,
        temporaryPatientName: "Grace Hopper",
        temporaryPatientPhoneNumber: "+491709999999",
        title: "Bestehender Termin",
      });
    });

    const slots = await t.query(
      api.telefonki.availableSlotsOnDate,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );

    expect(
      slots.some((slot) => slot.startTime === nextWeekdayAt(1, 8, 0)),
    ).toBe(false);
  });

  test("honors a selected practitioner when searching", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const secondPractitionerId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Wunsch",
          practiceId: fixture.practiceId,
          ruleSetId: fixture.ruleSetId,
        },
      );

      await ctx.db.patch("appointmentTypes", fixture.appointmentTypeId, {
        allowedPractitionerLineageKeys: [
          fixture.practitionerId,
          practitionerId,
        ],
      });

      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "16:00",
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: fixture.ruleSetId,
        startTime: "08:00",
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 2,
        endTime: "16:00",
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: fixture.ruleSetId,
        startTime: "08:00",
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 3,
        endTime: "16:00",
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: fixture.ruleSetId,
        startTime: "08:00",
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 4,
        endTime: "16:00",
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: fixture.ruleSetId,
        startTime: "08:00",
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 5,
        endTime: "16:00",
        locationLineageKey: fixture.locationId,
        practiceId: fixture.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: fixture.ruleSetId,
        startTime: "08:00",
      });

      void now;
      return practitionerId;
    });

    const slots = await t.query(
      api.telefonki.nextAvailableSlots,
      withTelefonkiSecret({
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: {
          ...simulatedContext({
            appointmentTypeId: fixture.appointmentTypeId,
            locationId: fixture.locationId,
          }),
          practitionerLineageKey: secondPractitionerId,
        },
      }),
    );

    expect(slots).toHaveLength(10);
    expect(
      slots.every(
        (slot) => slot.practitionerLineageKey === secondPractitionerId,
      ),
    ).toBe(true);
  });

  test("searches a specific date only", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    const mondaySlots = await t.query(
      api.telefonki.availableSlotsOnDate,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(mondaySlots).toHaveLength(10);
    expect(
      mondaySlots.every(
        (slot) => Temporal.ZonedDateTime.from(slot.startTime).dayOfWeek === 1,
      ),
    ).toBe(true);

    const saturdaySlots = await t.query(
      api.telefonki.availableSlotsOnDate,
      withTelefonkiSecret({
        date: nextWeekdayDate(6),
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
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

    const slots = await t.query(
      api.telefonki.nextAvailableSlots,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(slots).toEqual([]);
  });

  test("forces availability searches to use the Phone-AI client type", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    await addBlockingClientTypeRule(t, {
      clientType: "Phone-AI",
      practiceId: fixture.practiceId,
      ruleSetId: fixture.ruleSetId,
    });

    const slots = await t.query(
      api.telefonki.nextAvailableSlots,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        limit: 10,
        practiceId: fixture.practiceId,
        simulatedContext: {
          ...simulatedContext({
            appointmentTypeId: fixture.appointmentTypeId,
            locationId: fixture.locationId,
          }),
          clientType: "MFA",
        },
      }),
    );
    expect(slots).toEqual([]);
  });

  test("hides appointment series types from TelefonKI config and queries", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const followUpAppointmentTypeId = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      return await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
        allowedPractitionerLineageKeys: [fixture.practitionerId],
        createdAt: now,
        duration: 30,
        followUpPlan: [
          {
            appointmentTypeLineageKey: fixture.appointmentTypeId,
            locationMode: "inherit",
            offsetUnit: "days",
            offsetValue: 7,
            practitionerMode: "inherit",
            required: true,
            searchMode: "first_available_on_or_after",
            stepId: "follow-up-1",
          },
        ],
        lastModified: now,
        name: "Serientermin",
        practiceId: fixture.practiceId,
        ruleSetId: fixture.ruleSetId,
      });
    });

    const config = await t.query(
      api.telefonki.getActiveConfig,
      withTelefonkiSecret({
        practiceId: fixture.practiceId,
      }),
    );
    expect(
      config.appointmentTypes.some(
        (appointmentType) =>
          appointmentType.lineageKey === followUpAppointmentTypeId,
      ),
    ).toBe(false);

    await expect(
      t.query(
        api.telefonki.nextAvailableSlot,
        withTelefonkiSecret({
          practiceId: fixture.practiceId,
          simulatedContext: simulatedContext({
            appointmentTypeId: followUpAppointmentTypeId,
            locationId: fixture.locationId,
          }),
        }),
      ),
    ).rejects.toThrow("Appointment type is not available.");
  });
});

describe("TelefonKI booking ownership", () => {
  test("rejects non-E.164 caller phone numbers when creating a phone booking identity", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);

    await expect(
      t.mutation(
        api.telefonki.createOrReusePhoneBookingIdentity,
        withTelefonkiSecret({
          callerPhoneNumber: "01701234567",
          callId: "call-invalid-caller",
          dialedPracticePhoneNumber: "+495421000000",
          practiceId: fixture.practiceId,
        }),
      ),
    ).rejects.toThrow(
      "TelefonKI caller phone number must be provided in E.164 format",
    );
  });

  test("books, views, cancels, and rejects a second appointment for the same call", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(
      api.telefonki.nextAvailableSlot,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const identityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callerPhoneNumber: "+491701234567",
        callId: "call-1",
        dialedPracticePhoneNumber: "+495421000000",
        integrationActor: "livekit-agent",
        practiceId: fixture.practiceId,
      }),
    );

    const booking = await t.mutation(
      api.telefonki.book,
      withTelefonkiSecret({
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
    );
    expect(booking.appointmentId).toBeDefined();

    const persisted = await t.run(async (ctx) => {
      const appointment = await ctx.db.get(
        "appointments",
        booking.appointmentId,
      );
      const patient = appointment?.patientId
        ? await ctx.db.get("patients", appointment.patientId)
        : null;
      return { appointment, patient };
    });
    expect(persisted.appointment?.patientId).toBeDefined();
    expect(persisted.patient?.name).toBe("Ada Lovelace");
    expect(persisted.patient?.phoneNumber).toBe("+491701234567");
    expect(persisted.patient?.recordType).toBe("temporary");

    await expect(
      t.mutation(
        api.telefonki.book,
        withTelefonkiSecret({
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
      ),
    ).rejects.toThrow("already has a booked appointment");

    const viewed = await t.query(
      api.telefonki.viewBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: identityId,
      }),
    );
    expect(viewed?.appointmentId).toBe(booking.appointmentId);

    const cancelled = await t.mutation(
      api.telefonki.cancelBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: identityId,
      }),
    );
    expect(cancelled?.appointmentId).toBe(booking.appointmentId);
    expect(cancelled?.cancelledAt).toBeDefined();

    const viewedAfterCancellation = await t.query(
      api.telefonki.viewBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: identityId,
      }),
    );
    expect(viewedAfterCancellation).toBeNull();

    const cancelledAgain = await t.mutation(
      api.telefonki.cancelBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: identityId,
      }),
    );
    expect(cancelledAgain).toBeNull();
  });

  test("rejects booking a stale occupied slot", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(
      api.telefonki.nextAvailableSlot,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const firstIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callId: "call-occupied-1",
        dialedPracticePhoneNumber: "+495421000000",
        practiceId: fixture.practiceId,
      }),
    );
    const secondIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callId: "call-occupied-2",
        dialedPracticePhoneNumber: "+495421000000",
        practiceId: fixture.practiceId,
      }),
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

    await t.mutation(
      api.telefonki.book,
      withTelefonkiSecret({
        ...baseBookingArgs,
        phoneBookingIdentityId: firstIdentityId,
      }),
    );

    await expect(
      t.mutation(
        api.telefonki.book,
        withTelefonkiSecret({
          ...baseBookingArgs,
          phoneBookingIdentityId: secondIdentityId,
        }),
      ),
    ).rejects.toThrow("Selected slot is no longer available");
  });

  test("rejects non-E.164 patient phone numbers at booking time", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(
      api.telefonki.nextAvailableSlot,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const identityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callId: "call-invalid-phone",
        dialedPracticePhoneNumber: "+495421000000",
        practiceId: fixture.practiceId,
      }),
    );

    await expect(
      t.mutation(
        api.telefonki.book,
        withTelefonkiSecret({
          appointmentTypeLineageKey: fixture.appointmentTypeId,
          locationLineageKey: fixture.locationId,
          patient: {
            dateOfBirth: "1980-01-01",
            firstName: "Ada",
            isNew: false,
            lastName: "Lovelace",
            phoneNumber: "01701234567",
          },
          phoneBookingIdentityId: identityId,
          practitionerLineageKey: slot.practitionerLineageKey,
          practitionerName: slot.practitionerName,
          reasonDescription: "Rueckenschmerzen",
          startTime: slot.startTime,
        }),
      ),
    ).rejects.toThrow(
      "TelefonKI caller phone number must be provided in E.164 format",
    );
  });

  test("view and cancel stay scoped to the same phone booking identity", async () => {
    const t = createTestContext();
    const fixture = await createTelefonkiFixture(t);
    const slot = await t.query(
      api.telefonki.nextAvailableSlot,
      withTelefonkiSecret({
        date: nextWeekdayDate(1),
        practiceId: fixture.practiceId,
        simulatedContext: simulatedContext({
          appointmentTypeId: fixture.appointmentTypeId,
          locationId: fixture.locationId,
        }),
      }),
    );
    expect(slot).not.toBeNull();
    if (!slot) {
      throw new Error("Expected a TelefonKI slot.");
    }

    const ownerIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callId: "call-owner",
        dialedPracticePhoneNumber: "+495421000000",
        practiceId: fixture.practiceId,
      }),
    );
    const otherIdentityId = await t.mutation(
      api.telefonki.createOrReusePhoneBookingIdentity,
      withTelefonkiSecret({
        callId: "call-other",
        dialedPracticePhoneNumber: "+495421000000",
        practiceId: fixture.practiceId,
      }),
    );

    await t.mutation(
      api.telefonki.book,
      withTelefonkiSecret({
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        locationLineageKey: fixture.locationId,
        patient: {
          dateOfBirth: "1980-01-01",
          firstName: "Ada",
          isNew: false,
          lastName: "Lovelace",
          phoneNumber: "+491701234567",
        },
        phoneBookingIdentityId: ownerIdentityId,
        practitionerLineageKey: slot.practitionerLineageKey,
        practitionerName: slot.practitionerName,
        reasonDescription: "Rueckenschmerzen",
        startTime: slot.startTime,
      }),
    );

    const viewed = await t.query(
      api.telefonki.viewBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: otherIdentityId,
      }),
    );
    const cancelled = await t.mutation(
      api.telefonki.cancelBookedAppointment,
      withTelefonkiSecret({
        phoneBookingIdentityId: otherIdentityId,
      }),
    );

    expect(viewed).toBeNull();
    expect(cancelled).toBeNull();
  });
});
