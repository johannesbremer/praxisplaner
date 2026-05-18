import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { InternalSchedulingResultSlot } from "./scheduling";

import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getAppointmentPractitionerLineageKey } from "./appointmentOccupancy";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveLocationIdForRuleSetByLineage,
  resolvePractitionerIdForRuleSetByLineage,
} from "./appointmentReferences";
import { createAppointmentFromTrustedSource } from "./appointments";
import { normalizeE164PhoneNumber } from "./e164PhoneNumber";
import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import { normalizePracticePhoneNumber } from "./practicePhoneNumbers";
import { createTemporaryPatientRecord } from "./temporaryPatients";
import {
  asIsoDateString,
  asZonedDateTimeString,
  type ZonedDateTimeString,
} from "./typedDtos";
import { simulatedContextValidator } from "./validators";

const SEARCH_TIMEZONE = "Europe/Berlin";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const MAX_SEARCH_DAYS = 90;
const AFTERNOON_START_HOUR = 12;

const telefonkiSlotValidator = v.object({
  duration: v.number(),
  locationLineageKey: v.id("locations"),
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  startTime: v.string(),
});

const telefonkiAppointmentValidator = v.object({
  appointmentId: v.id("appointments"),
  appointmentTypeTitle: v.string(),
  cancelledAt: v.optional(v.int64()),
  end: v.string(),
  locationLineageKey: v.id("locations"),
  practitionerLineageKey: v.optional(v.id("practitioners")),
  start: v.string(),
  title: v.string(),
});

const availabilityArgs = {
  date: v.optional(v.string()),
  integrationSecret: v.optional(v.string()),
  limit: v.optional(v.number()),
  practiceId: v.id("practices"),
  simulatedContext: simulatedContextValidator,
};

interface ActivePracticeContext {
  practice: Doc<"practices">;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

interface AvailabilityArgs {
  date?: string;
  integrationSecret?: string;
  limit?: number;
  practiceId: Id<"practices">;
  simulatedContext: {
    appointmentTypeLineageKey?: Id<"appointmentTypes">;
    locationLineageKey?: Id<"locations">;
    patient: {
      dateOfBirth?: string;
      isNew: boolean;
    };
    practitionerLineageKey?: Id<"practitioners">;
    requestedAt?: string;
  };
}

interface AvailableSlot {
  duration: number;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

function assertTelefonkiAccess(args: { integrationSecret?: string }): void {
  const expectedSecret = process.env["TELEFONKI_SHARED_SECRET"]?.trim();
  if (!expectedSecret) {
    throw new Error("TelefonKI shared secret is not configured.");
  }
  if (args.integrationSecret !== expectedSecret) {
    throw new Error("TelefonKI integration access denied.");
  }
}

function buildSlotCoverageKey(slot: {
  locationLineageKey: Id<"locations">;
  practitionerLineageKey: Id<"practitioners">;
  startTime: string;
}): string {
  return [
    slot.startTime,
    slot.locationLineageKey,
    slot.practitionerLineageKey,
  ].join("::");
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
}

async function getAvailableSlots(args: {
  afternoonOnly: boolean;
  ctx: QueryCtx;
  search: AvailabilityArgs;
  searchDateOnly: boolean;
}): Promise<ReturnType<typeof toTelefonkiSlot>[]> {
  assertTelefonkiAccess(args.search);
  const limit = clampLimit(args.search.limit);
  const { practiceId, ruleSetId } = await requireActivePracticeContext(
    args.ctx,
    args.search.practiceId,
  );
  const appointmentTypeLineageKey =
    args.search.simulatedContext.appointmentTypeLineageKey;
  if (!appointmentTypeLineageKey) {
    throw new Error("appointmentTypeLineageKey is required.");
  }

  const appointmentTypeId = await resolveAppointmentTypeIdForRuleSetByLineage(
    args.ctx.db,
    {
      lineageKey: asAppointmentTypeLineageKey(appointmentTypeLineageKey),
      ruleSetId,
    },
  );
  const appointmentType = await args.ctx.db.get(
    "appointmentTypes",
    appointmentTypeId,
  );
  if (!isTelefonkiBookableAppointmentType(appointmentType)) {
    throw new Error("Appointment type is not available.");
  }
  const allowedPractitionerLineageKeys = new Set(
    appointmentType.allowedPractitionerLineageKeys.map((lineageKey) =>
      asPractitionerLineageKey(lineageKey),
    ),
  );

  const slots: ReturnType<typeof toTelefonkiSlot>[] = [];
  const startDate = Temporal.PlainDate.from(
    getSearchStartDate(args.search.date),
  );
  const maxOffset = args.searchDateOnly ? 0 : MAX_SEARCH_DAYS;
  const requestedPractitionerLineageKey =
    args.search.simulatedContext.practitionerLineageKey;

  for (
    let offset = 0;
    offset <= maxOffset && slots.length < limit;
    offset += 1
  ) {
    const date = startDate.add({ days: offset }).toString();
    const result: { slots: InternalSchedulingResultSlot[] } =
      await args.ctx.runQuery(internal.scheduling.getSlotsForDayInternal, {
        date,
        enforceFutureOnly: true,
        practiceId,
        ruleSetId,
        simulatedContext: args.search.simulatedContext,
      });
    const slotByCoverageKey = new Map(
      result.slots.map((slot) => [buildSlotCoverageKey(slot), slot]),
    );

    for (const slot of result.slots.toSorted((left, right) =>
      left.startTime.localeCompare(right.startTime),
    )) {
      if (slots.length >= limit) {
        break;
      }
      if (slot.status !== "AVAILABLE") {
        continue;
      }
      if (
        !allowedPractitionerLineageKeys.has(
          asPractitionerLineageKey(slot.practitionerLineageKey),
        )
      ) {
        continue;
      }
      if (
        requestedPractitionerLineageKey !== undefined &&
        slot.practitionerLineageKey !== requestedPractitionerLineageKey
      ) {
        continue;
      }
      if (
        !isSlotAvailableForAppointmentDuration({
          requiredDurationMinutes: appointmentType.duration,
          slot,
          slotByCoverageKey,
        })
      ) {
        continue;
      }
      if (args.afternoonOnly && !isAfternoonSlot(slot)) {
        continue;
      }
      slots.push(toTelefonkiSlot(slot, appointmentType.duration));
    }
  }

  return slots;
}

function getSearchStartDate(date: string | undefined): IsoDateString {
  if (date !== undefined) {
    return asIsoDateString(date);
  }

  return asIsoDateString(Temporal.Now.plainDateISO(SEARCH_TIMEZONE).toString());
}

function hasFollowUpPlan(appointmentType: Doc<"appointmentTypes"> | null) {
  return (appointmentType?.followUpPlan?.length ?? 0) > 0;
}

function isAfternoonSlot(slot: Pick<AvailableSlot, "startTime">) {
  return (
    Temporal.ZonedDateTime.from(slot.startTime).hour >= AFTERNOON_START_HOUR
  );
}

function isSlotAvailableForAppointmentDuration(args: {
  requiredDurationMinutes: number;
  slot: InternalSchedulingResultSlot;
  slotByCoverageKey: ReadonlyMap<string, InternalSchedulingResultSlot>;
}): boolean {
  let coveredDurationMinutes = 0;
  let currentStartTime = Temporal.ZonedDateTime.from(args.slot.startTime);

  while (coveredDurationMinutes < args.requiredDurationMinutes) {
    const currentSlot = args.slotByCoverageKey.get(
      buildSlotCoverageKey({
        locationLineageKey: args.slot.locationLineageKey,
        practitionerLineageKey: args.slot.practitionerLineageKey,
        startTime: currentStartTime.toString(),
      }),
    );
    if (currentSlot?.status !== "AVAILABLE") {
      return false;
    }
    if (currentSlot.duration <= 0) {
      return false;
    }

    coveredDurationMinutes += currentSlot.duration;
    currentStartTime = currentStartTime.add({
      minutes: currentSlot.duration,
    });
  }

  return true;
}

function isTelefonkiBookableAppointmentType(
  appointmentType: Doc<"appointmentTypes"> | null,
): appointmentType is Doc<"appointmentTypes"> {
  return (
    appointmentType !== null &&
    appointmentType.deleted !== true &&
    appointmentType.lineageKey !== undefined &&
    !hasFollowUpPlan(appointmentType)
  );
}

function normalizeTelefonkiCallerPhoneNumber(rawPhoneNumber: string): string {
  return normalizeE164PhoneNumber({
    emptyMessage: "TelefonKI caller phone number is required.",
    example: "+491701234567",
    invalidMessagePrefix: "TelefonKI caller phone number",
    rawPhoneNumber,
  });
}

async function requireActivePracticeContext(
  ctx: MutationCtx | QueryCtx,
  practiceId: Id<"practices">,
): Promise<ActivePracticeContext> {
  const practice = await ctx.db.get("practices", practiceId);
  if (!practice) {
    throw new Error("Practice not found.");
  }
  if (!practice.currentActiveRuleSetId) {
    throw new Error("Practice has no active rule set.");
  }
  return {
    practice,
    practiceId,
    ruleSetId: practice.currentActiveRuleSetId,
  };
}

async function requireAvailableSelectedSlot(
  ctx: MutationCtx,
  args: {
    appointmentTypeLineageKey: Id<"appointmentTypes">;
    locationLineageKey: Id<"locations">;
    patientDateOfBirth?: string;
    patientIsNew: boolean;
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
    requiredDurationMinutes: number;
    ruleSetId: Id<"ruleSets">;
    startTime: string;
  },
) {
  const startTime = asZonedDateTimeString(args.startTime);
  if (
    Temporal.Instant.compare(
      Temporal.ZonedDateTime.from(startTime).toInstant(),
      Temporal.Now.instant(),
    ) <= 0
  ) {
    throw new Error("Appointments must be booked in the future.");
  }

  const date = Temporal.ZonedDateTime.from(startTime).toPlainDate().toString();
  const result: { slots: InternalSchedulingResultSlot[] } = await ctx.runQuery(
    internal.scheduling.getSlotsForDayInternal,
    {
      date,
      enforceFutureOnly: true,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      simulatedContext: {
        appointmentTypeLineageKey: args.appointmentTypeLineageKey,
        locationLineageKey: args.locationLineageKey,
        patient: {
          ...(args.patientDateOfBirth !== undefined && {
            dateOfBirth: args.patientDateOfBirth,
          }),
          isNew: args.patientIsNew,
        },
      },
    },
  );
  const slotByCoverageKey = new Map(
    result.slots.map((slot) => [buildSlotCoverageKey(slot), slot]),
  );

  const matchingSlot = result.slots.find(
    (slot) =>
      slot.status === "AVAILABLE" &&
      slot.startTime === startTime &&
      slot.locationLineageKey === args.locationLineageKey &&
      slot.practitionerLineageKey === args.practitionerLineageKey,
  );
  if (
    !matchingSlot ||
    !isSlotAvailableForAppointmentDuration({
      requiredDurationMinutes: args.requiredDurationMinutes,
      slot: matchingSlot,
      slotByCoverageKey,
    })
  ) {
    throw new Error("Selected slot is no longer available.");
  }
}

async function requirePhoneBookingIdentity(
  ctx: MutationCtx | QueryCtx,
  phoneBookingIdentityId: Id<"phoneBookingIdentities">,
) {
  const identity = await ctx.db.get(
    "phoneBookingIdentities",
    phoneBookingIdentityId,
  );
  if (!identity) {
    throw new Error("Phone booking identity not found.");
  }
  return identity;
}

function toTelefonkiAppointment(appointment: Doc<"appointments">): null | {
  appointmentId: Id<"appointments">;
  appointmentTypeTitle: string;
  cancelledAt?: bigint;
  end: string;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey?: Id<"practitioners">;
  start: string;
  title: string;
} {
  if (appointment.isSimulation === true) {
    return null;
  }
  const practitionerLineageKey = getAppointmentPractitionerLineageKey(
    appointment.occupancyScope,
  );
  return {
    appointmentId: appointment._id,
    appointmentTypeTitle: appointment.appointmentTypeTitle,
    ...(appointment.cancelledAt !== undefined && {
      cancelledAt: appointment.cancelledAt,
    }),
    end: appointment.end,
    locationLineageKey: appointment.locationLineageKey,
    ...(practitionerLineageKey === undefined ? {} : { practitionerLineageKey }),
    start: appointment.start,
    title: appointment.title,
  };
}

function toTelefonkiSlot(
  slot: AvailableSlot,
  appointmentDuration: number,
): {
  duration: number;
  locationLineageKey: Id<"locations">;
  practitionerLineageKey: Id<"practitioners">;
  practitionerName: string;
  startTime: ZonedDateTimeString;
} {
  return {
    duration: appointmentDuration,
    locationLineageKey: slot.locationLineageKey,
    practitionerLineageKey: slot.practitionerLineageKey,
    practitionerName: slot.practitionerName,
    startTime: asZonedDateTimeString(slot.startTime),
  };
}

export const createOrReusePhoneBookingIdentity = mutation({
  args: {
    callerPhoneNumber: v.optional(v.string()),
    callId: v.string(),
    dialedPracticePhoneNumber: v.optional(v.string()),
    integrationActor: v.optional(v.string()),
    integrationSecret: v.optional(v.string()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const { ruleSetId } = await requireActivePracticeContext(
      ctx,
      args.practiceId,
    );
    const callId = args.callId.trim();
    if (callId.length === 0) {
      throw new Error("callId is required.");
    }

    const existing = await ctx.db
      .query("phoneBookingIdentities")
      .withIndex("by_practiceId_callId", (q) =>
        q.eq("practiceId", args.practiceId).eq("callId", callId),
      )
      .unique();
    const now = BigInt(Date.now());
    if (existing) {
      await ctx.db.patch("phoneBookingIdentities", existing._id, {
        ...(args.callerPhoneNumber !== undefined && {
          callerPhoneNumber: normalizeTelefonkiCallerPhoneNumber(
            args.callerPhoneNumber,
          ),
        }),
        ...(args.dialedPracticePhoneNumber !== undefined && {
          dialedPracticePhoneNumber: normalizePracticePhoneNumber(
            args.dialedPracticePhoneNumber,
          ),
        }),
        ...(args.integrationActor !== undefined && {
          integrationActor: args.integrationActor,
        }),
        lastModified: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("phoneBookingIdentities", {
      callId,
      ...(args.callerPhoneNumber !== undefined && {
        callerPhoneNumber: normalizeTelefonkiCallerPhoneNumber(
          args.callerPhoneNumber,
        ),
      }),
      createdAt: now,
      ...(args.dialedPracticePhoneNumber !== undefined && {
        dialedPracticePhoneNumber: normalizePracticePhoneNumber(
          args.dialedPracticePhoneNumber,
        ),
      }),
      ...(args.integrationActor !== undefined && {
        integrationActor: args.integrationActor,
      }),
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId,
    });
  },
  returns: v.id("phoneBookingIdentities"),
});

export const resolvePracticeByDialedPhoneNumber = query({
  args: {
    dialedPracticePhoneNumber: v.string(),
    integrationSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const normalizedPhoneNumber = normalizePracticePhoneNumber(
      args.dialedPracticePhoneNumber,
    );
    const mapping = await ctx.db
      .query("practicePhoneNumbers")
      .withIndex("by_phoneNumber", (q) =>
        q.eq("phoneNumber", normalizedPhoneNumber),
      )
      .unique();
    if (!mapping) {
      throw new Error("No practice is configured for the dialed phone number.");
    }

    const practice = await ctx.db.get("practices", mapping.practiceId);
    if (!practice) {
      throw new Error("Practice for dialed phone number was not found.");
    }

    return {
      dialedPracticePhoneNumber: normalizedPhoneNumber,
      practiceId: practice._id,
      practiceName: practice.name,
    };
  },
  returns: v.object({
    dialedPracticePhoneNumber: v.string(),
    practiceId: v.id("practices"),
    practiceName: v.string(),
  }),
});

export const getActiveConfig = query({
  args: {
    integrationSecret: v.optional(v.string()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const { ruleSetId } = await requireActivePracticeContext(
      ctx,
      args.practiceId,
    );
    const [appointmentTypes, locations, practitioners] = await Promise.all([
      ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      ctx.db
        .query("locations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
    ]);

    return {
      appointmentTypes: appointmentTypes
        .filter(
          (entry) =>
            entry.practiceId === args.practiceId &&
            !entry.deleted &&
            (entry.followUpPlan?.length ?? 0) === 0,
        )
        .map((entry) => ({
          duration: entry.duration,
          lineageKey: requireLineageKey({
            entityId: entry._id,
            entityType: "appointment type",
            lineageKey: entry.lineageKey,
            ruleSetId: entry.ruleSetId,
          }),
          name: entry.name,
        })),
      locations: locations
        .filter(
          (entry) => entry.practiceId === args.practiceId && !entry.deleted,
        )
        .map((entry) => ({
          lineageKey: requireLineageKey({
            entityId: entry._id,
            entityType: "location",
            lineageKey: entry.lineageKey,
            ruleSetId: entry.ruleSetId,
          }),
          name: entry.name,
        })),
      practitioners: practitioners
        .filter(
          (entry) => entry.practiceId === args.practiceId && !entry.deleted,
        )
        .map((entry) => ({
          lineageKey: requireLineageKey({
            entityId: entry._id,
            entityType: "practitioner",
            lineageKey: entry.lineageKey,
            ruleSetId: entry.ruleSetId,
          }),
          name: entry.name,
          tags: entry.tags ?? [],
        })),
      ruleSetId,
    };
  },
});

export const nextAvailableSlot = query({
  args: availabilityArgs,
  handler: async (ctx, args) => {
    const slots = await getAvailableSlots({
      afternoonOnly: false,
      ctx,
      search: { ...args, limit: 1 },
      searchDateOnly: false,
    });
    return slots[0] ?? null;
  },
  returns: v.union(v.null(), telefonkiSlotValidator),
});

export const nextAvailableSlots = query({
  args: availabilityArgs,
  handler: async (ctx, args) => {
    return await getAvailableSlots({
      afternoonOnly: false,
      ctx,
      search: args,
      searchDateOnly: false,
    });
  },
  returns: v.array(telefonkiSlotValidator),
});

export const nextAvailableAfternoonSlot = query({
  args: availabilityArgs,
  handler: async (ctx, args) => {
    const slots = await getAvailableSlots({
      afternoonOnly: true,
      ctx,
      search: { ...args, limit: 1 },
      searchDateOnly: false,
    });
    return slots[0] ?? null;
  },
  returns: v.union(v.null(), telefonkiSlotValidator),
});

export const nextAvailableAfternoonSlots = query({
  args: availabilityArgs,
  handler: async (ctx, args) => {
    return await getAvailableSlots({
      afternoonOnly: true,
      ctx,
      search: args,
      searchDateOnly: false,
    });
  },
  returns: v.array(telefonkiSlotValidator),
});

export const availableSlotsOnDate = query({
  args: {
    ...availabilityArgs,
    date: v.string(),
  },
  handler: async (ctx, args) => {
    return await getAvailableSlots({
      afternoonOnly: false,
      ctx,
      search: args,
      searchDateOnly: true,
    });
  },
  returns: v.array(telefonkiSlotValidator),
});

export const book = mutation({
  args: {
    appointmentTypeLineageKey: v.id("appointmentTypes"),
    integrationSecret: v.optional(v.string()),
    locationLineageKey: v.id("locations"),
    patient: v.object({
      dateOfBirth: v.optional(v.string()),
      firstName: v.string(),
      isNew: v.boolean(),
      lastName: v.string(),
      phoneNumber: v.optional(v.string()),
    }),
    phoneBookingIdentityId: v.id("phoneBookingIdentities"),
    practitionerLineageKey: v.id("practitioners"),
    practitionerName: v.string(),
    reasonDescription: v.string(),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const identity = await requirePhoneBookingIdentity(
      ctx,
      args.phoneBookingIdentityId,
    );
    if (identity.appointmentId !== undefined) {
      throw new Error("TelefonKI call already has a booked appointment.");
    }
    const active = await requireActivePracticeContext(ctx, identity.practiceId);
    if (active.ruleSetId !== identity.ruleSetId) {
      throw new Error(
        "Phone booking identity was created for another rule set.",
      );
    }

    const [appointmentTypeId, locationId, practitionerId] = await Promise.all([
      resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
        lineageKey: asAppointmentTypeLineageKey(args.appointmentTypeLineageKey),
        ruleSetId: active.ruleSetId,
      }),
      resolveLocationIdForRuleSetByLineage(ctx.db, {
        lineageKey: asLocationLineageKey(args.locationLineageKey),
        ruleSetId: active.ruleSetId,
      }),
      resolvePractitionerIdForRuleSetByLineage(ctx.db, {
        lineageKey: asPractitionerLineageKey(args.practitionerLineageKey),
        ruleSetId: active.ruleSetId,
      }),
    ]);
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      appointmentTypeId,
    );
    if (!isTelefonkiBookableAppointmentType(appointmentType)) {
      throw new Error("Appointment type is not available.");
    }
    if (
      !appointmentType.allowedPractitionerLineageKeys.includes(
        args.practitionerLineageKey,
      )
    ) {
      throw new Error("Practitioner is not allowed for this appointment type.");
    }

    await requireAvailableSelectedSlot(ctx, {
      appointmentTypeLineageKey: args.appointmentTypeLineageKey,
      locationLineageKey: args.locationLineageKey,
      ...(args.patient.dateOfBirth !== undefined && {
        patientDateOfBirth: args.patient.dateOfBirth,
      }),
      patientIsNew: args.patient.isNew,
      practiceId: active.practiceId,
      practitionerLineageKey: args.practitionerLineageKey,
      requiredDurationMinutes: appointmentType.duration,
      ruleSetId: active.ruleSetId,
      startTime: args.startTime,
    });

    const patientName =
      `${args.patient.firstName.trim()} ${args.patient.lastName.trim()}`.trim();
    const rawPatientPhoneNumber = args.patient.phoneNumber?.trim();
    if (!rawPatientPhoneNumber) {
      throw new Error(
        "TelefonKI bookings require the caller phone number to persist the patient record.",
      );
    }
    const patientPhoneNumber = normalizeTelefonkiCallerPhoneNumber(
      rawPatientPhoneNumber,
    );
    const temporaryPatientId = await createTemporaryPatientRecord(ctx, {
      name: patientName,
      phoneNumber: patientPhoneNumber,
      practiceId: active.practiceId,
    });
    const appointmentId = await createAppointmentFromTrustedSource(ctx, {
      appointmentTypeId,
      isNewPatient: args.patient.isNew,
      locationId,
      ...(args.patient.dateOfBirth !== undefined && {
        patientDateOfBirth: args.patient.dateOfBirth,
      }),
      patientId: temporaryPatientId,
      phoneBookingIdentityId: args.phoneBookingIdentityId,
      practiceId: active.practiceId,
      practitionerId,
      start: args.startTime,
      title: `TelefonKI-Termin: ${appointmentType.name} - ${args.reasonDescription.trim()}`,
    });

    const now = BigInt(Date.now());
    await ctx.db.patch("phoneBookingIdentities", args.phoneBookingIdentityId, {
      appointmentId,
      ...(args.patient.phoneNumber !== undefined && {
        callerPhoneNumber: patientPhoneNumber,
      }),
      lastModified: now,
    });

    return {
      appointmentId,
      patientName,
      practitionerName: args.practitionerName,
    };
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
    patientName: v.string(),
    practitionerName: v.string(),
  }),
});

export const viewBookedAppointment = query({
  args: {
    integrationSecret: v.optional(v.string()),
    phoneBookingIdentityId: v.id("phoneBookingIdentities"),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const identity = await requirePhoneBookingIdentity(
      ctx,
      args.phoneBookingIdentityId,
    );
    if (identity.appointmentId === undefined) {
      return null;
    }
    const appointment = await ctx.db.get(
      "appointments",
      identity.appointmentId,
    );
    if (
      appointment?.phoneBookingIdentityId !== args.phoneBookingIdentityId ||
      appointment.cancelledAt !== undefined
    ) {
      return null;
    }
    return toTelefonkiAppointment(appointment);
  },
  returns: v.union(v.null(), telefonkiAppointmentValidator),
});

export const cancelBookedAppointment = mutation({
  args: {
    integrationSecret: v.optional(v.string()),
    phoneBookingIdentityId: v.id("phoneBookingIdentities"),
  },
  handler: async (ctx, args) => {
    assertTelefonkiAccess(args);
    const identity = await requirePhoneBookingIdentity(
      ctx,
      args.phoneBookingIdentityId,
    );
    if (identity.appointmentId === undefined) {
      return null;
    }
    const appointment = await ctx.db.get(
      "appointments",
      identity.appointmentId,
    );
    if (appointment?.phoneBookingIdentityId !== args.phoneBookingIdentityId) {
      return null;
    }
    if (appointment.cancelledAt !== undefined) {
      return null;
    }
    if (
      Temporal.Instant.compare(
        Temporal.ZonedDateTime.from(appointment.start).toInstant(),
        Temporal.Now.instant(),
      ) <= 0
    ) {
      throw new Error("Only future appointments can be cancelled.");
    }

    const now = BigInt(Date.now());
    await ctx.db.patch("appointments", appointment._id, {
      cancelledAt: now,
      cancelledByPhoneBookingIdentityId: args.phoneBookingIdentityId,
      lastModified: now,
    });

    const updatedAppointment = await ctx.db.get(
      "appointments",
      appointment._id,
    );
    return updatedAppointment
      ? toTelefonkiAppointment(updatedAppointment)
      : null;
  },
  returns: v.union(v.null(), telefonkiAppointmentValidator),
});
