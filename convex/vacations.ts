import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import { getPractitionerVacationRangesForDate } from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { findConflictingAppointment } from "./appointmentConflicts";
import {
  resolveAppointmentTypeIdForRuleSet,
  resolveLocationIdForRuleSet,
  resolvePractitionerIdForRuleSet,
} from "./appointmentCoverage";
import {
  resolvePractitionerLineageKey,
  resolveStoredAppointmentReferencesForWrite,
} from "./appointmentReferences";
import { isActivationBoundSimulation } from "./appointmentSimulation";
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
  entityId: v.optional(v.id("vacations")),
  ruleSetId: v.id("ruleSets"),
});

const vacationCoverageReassignmentValidator = v.object({
  appointmentId: v.id("appointments"),
  targetPractitionerId: v.id("practitioners"),
});

function appointmentOverlapsVacationRanges(
  appointment: Pick<Doc<"appointments">, "end" | "start">,
  vacationRanges: { endMinutes: number; startMinutes: number }[],
) {
  const start = Temporal.ZonedDateTime.from(appointment.start).withTimeZone(
    "Europe/Berlin",
  );
  const end = Temporal.ZonedDateTime.from(appointment.end).withTimeZone(
    "Europe/Berlin",
  );
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  return vacationRanges.some(
    (range) =>
      startMinutes < range.endMinutes && endMinutes > range.startMinutes,
  );
}

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

async function deleteCoverageSimulationAppointmentsForVacation(
  ctx: MutationCtx,
  args: {
    ruleSetId: Id<"ruleSets">;
    vacationLineageKey: Id<"vacations">;
  },
) {
  const simulationAppointments = await ctx.db
    .query("appointments")
    .withIndex(
      "by_simulationRuleSetId_reassignmentSourceVacationLineageKey",
      (q) =>
        q
          .eq("simulationRuleSetId", args.ruleSetId)
          .eq("reassignmentSourceVacationLineageKey", args.vacationLineageKey),
    )
    .collect();

  for (const simulationAppointment of simulationAppointments) {
    if (!isActivationBoundSimulation(simulationAppointment)) {
      continue;
    }
    await ctx.db.delete("appointments", simulationAppointment._id);
  }
}

async function getPatientDateOfBirthForAppointment(
  ctx: MutationCtx,
  appointment: Doc<"appointments">,
) {
  if (!appointment.patientId) {
    return;
  }

  const patient = await ctx.db.get("patients", appointment.patientId);
  return patient?.dateOfBirth;
}

function getVacationStaffId(vacation: Doc<"vacations">) {
  return vacation.staffType === "practitioner"
    ? vacation.practitionerId
    : vacation.mfaId;
}

async function replaceVacationsInDraft(
  ctx: MutationCtx,
  args: {
    date: string;
    mfaId?: Id<"mfas">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacingVacationLineageKeys: Id<"vacations">[];
    ruleSetId: Id<"ruleSets">;
    staffType: "mfa" | "practitioner";
  },
) {
  if (args.replacingVacationLineageKeys.length === 0) {
    return;
  }

  for (const lineageKey of args.replacingVacationLineageKeys) {
    const existingVacation = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", lineageKey),
      )
      .first();

    if (!existingVacation) {
      continue;
    }

    if (
      existingVacation.practiceId !== args.practiceId ||
      existingVacation.date !== args.date ||
      existingVacation.staffType !== args.staffType ||
      (args.staffType === "practitioner"
        ? existingVacation.practitionerId !== args.practitionerId
        : existingVacation.mfaId !== args.mfaId)
    ) {
      throw new Error(
        "Der zu ersetzende Urlaub passt nicht mehr zum aktuellen Bearbeitungskontext.",
      );
    }

    await deleteCoverageSimulationAppointmentsForVacation(ctx, {
      ruleSetId: args.ruleSetId,
      vacationLineageKey: requireVacationLineageKey(existingVacation),
    });
    await ctx.db.delete("vacations", existingVacation._id);
  }
}

async function resolveMfaIdInRuleSet(
  ctx: MutationCtx,
  mfaId: Id<"mfas">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"mfas">> {
  const mfa = await ctx.db.get("mfas", mfaId);
  if (!mfa) {
    const mapped = await ctx.db
      .query("mfas")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("lineageKey", mfaId),
      )
      .first();
    if (mapped?.practiceId !== practiceId) {
      throw new Error("MFA nicht gefunden.");
    }
    return mapped._id;
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
    const mapped = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("lineageKey", practitionerId),
      )
      .first();
    if (mapped?.practiceId !== practiceId) {
      throw new Error("Arzt nicht gefunden.");
    }
    return mapped._id;
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
    const vacations = await ctx.db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", args.ruleSetId).gte("date", args.startDate),
      )
      .filter((q) => q.lt(q.field("date"), args.endDateExclusive))
      .collect();

    return vacations.map((vacation) => ({
      ...vacation,
      lineageKey: requireVacationLineageKey(vacation),
    }));
  },
});

function requireVacationLineageKey(vacation: Doc<"vacations">) {
  if (!vacation.lineageKey) {
    throw new Error(
      `[INVARIANT:VACATION_LINEAGE_KEY_MISSING] Urlaub ${vacation._id} in Regelset ${vacation.ruleSetId} hat keinen lineageKey.`,
    );
  }
  return vacation.lineageKey;
}

export const createVacation = mutation({
  args: {
    date: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("vacations")),
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

    const existingByLineage = args.lineageKey
      ? await ctx.db
          .query("vacations")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", ruleSetId).eq("lineageKey", args.lineageKey),
          )
          .first()
      : null;

    if (existingByLineage) {
      if (
        existingByLineage.practiceId !== args.practiceId ||
        existingByLineage.date !== args.date ||
        existingByLineage.portion !== args.portion ||
        existingByLineage.staffType !== args.staffType ||
        (args.staffType === "practitioner"
          ? existingByLineage.practitionerId !== resolved.practitionerId
          : existingByLineage.mfaId !== resolved.mfaId)
      ) {
        throw new Error(
          "Urlaub mit dieser lineageKey existiert bereits mit anderen Daten.",
        );
      }

      const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
      return {
        draftRevision,
        entityId: existingByLineage._id,
        ruleSetId,
      };
    }

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

    let entityId: Id<"vacations">;
    if (existing) {
      if (
        args.lineageKey &&
        existing.lineageKey &&
        existing.lineageKey !== args.lineageKey
      ) {
        throw new Error(
          "Urlaub für diesen Zeitraum existiert bereits mit anderer lineageKey.",
        );
      }
      entityId = existing._id;
      const lineageKey = args.lineageKey ?? requireVacationLineageKey(existing);
      if (existing.lineageKey !== lineageKey) {
        await ctx.db.patch("vacations", existing._id, {
          lineageKey,
        });
      }
    } else {
      entityId = await ctx.db.insert("vacations", {
        createdAt: BigInt(Date.now()),
        date: args.date,
        ...(args.lineageKey ? { lineageKey: args.lineageKey } : {}),
        ...(resolved.mfaId ? { mfaId: resolved.mfaId } : {}),
        portion: args.portion,
        practiceId: args.practiceId,
        ...(resolved.practitionerId
          ? { practitionerId: resolved.practitionerId }
          : {}),
        ruleSetId,
        staffType: args.staffType,
      });
      if (!args.lineageKey) {
        await ctx.db.patch("vacations", entityId, { lineageKey: entityId });
      }
    }

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: draftMutationResultValidator,
});

async function createVacationInDraft(
  ctx: MutationCtx,
  args: {
    date: string;
    expectedDraftRevision: null | number;
    lineageKey?: Id<"vacations">;
    mfaId?: Id<"mfas">;
    portion: "afternoon" | "full" | "morning";
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    resolvedRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId: Id<"ruleSets">;
    staffType: "mfa" | "practitioner";
  },
) {
  let ruleSetId = args.resolvedRuleSetId;
  if (!ruleSetId) {
    const resolvedDraft = await resolveDraftForWrite(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );
    ruleSetId = resolvedDraft.ruleSetId;
  }

  const resolved = await assertStaffExists(ctx, {
    ...(args.mfaId ? { mfaId: args.mfaId } : {}),
    practiceId: args.practiceId,
    ...(args.practitionerId ? { practitionerId: args.practitionerId } : {}),
    ruleSetId,
    staffType: args.staffType,
  });

  const existingByLineage = args.lineageKey
    ? await ctx.db
        .query("vacations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", args.lineageKey),
        )
        .first()
    : null;

  if (existingByLineage) {
    if (
      existingByLineage.practiceId !== args.practiceId ||
      existingByLineage.date !== args.date ||
      existingByLineage.portion !== args.portion ||
      existingByLineage.staffType !== args.staffType ||
      (args.staffType === "practitioner"
        ? existingByLineage.practitionerId !== resolved.practitionerId
        : existingByLineage.mfaId !== resolved.mfaId)
    ) {
      throw new Error(
        "Urlaub mit dieser lineageKey existiert bereits mit anderen Daten.",
      );
    }

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return {
      draftRevision,
      entityId: existingByLineage._id,
      ruleSetId,
    };
  }

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

  let entityId: Id<"vacations">;
  if (existing) {
    if (
      args.lineageKey &&
      existing.lineageKey &&
      existing.lineageKey !== args.lineageKey
    ) {
      throw new Error(
        "Urlaub für diesen Zeitraum existiert bereits mit anderer lineageKey.",
      );
    }
    entityId = existing._id;
    const lineageKey = args.lineageKey ?? requireVacationLineageKey(existing);
    if (existing.lineageKey !== lineageKey) {
      await ctx.db.patch("vacations", existing._id, {
        lineageKey,
      });
    }
  } else {
    entityId = await ctx.db.insert("vacations", {
      createdAt: BigInt(Date.now()),
      date: args.date,
      ...(args.lineageKey ? { lineageKey: args.lineageKey } : {}),
      ...(resolved.mfaId ? { mfaId: resolved.mfaId } : {}),
      portion: args.portion,
      practiceId: args.practiceId,
      ...(resolved.practitionerId
        ? { practitionerId: resolved.practitionerId }
        : {}),
      ruleSetId,
      staffType: args.staffType,
    });
    if (!args.lineageKey) {
      await ctx.db.patch("vacations", entityId, { lineageKey: entityId });
    }
  }

  const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
  return { draftRevision, entityId, ruleSetId };
}

export const createVacationWithCoverageAdjustments = mutation({
  args: {
    date: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    portion: vacationPortionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    reassignments: v.array(vacationCoverageReassignmentValidator),
    replacingVacationLineageKeys: v.optional(v.array(v.id("vacations"))),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      throw new Error("Aktives Regelset nicht gefunden.");
    }
    const { ruleSetId } = await resolveDraftForWrite(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );
    const replacingVacationLineageKeys = [
      ...(args.replacingVacationLineageKeys ?? []),
    ];
    const retainedLineageKey =
      replacingVacationLineageKeys.length === 1
        ? replacingVacationLineageKeys[0]
        : undefined;

    const activePractitionerId = await resolvePractitionerIdForRuleSet(ctx.db, {
      practiceId: args.practiceId,
      practitionerId: args.practitionerId,
      ruleSetId: practice.currentActiveRuleSetId,
    });
    const draftPractitionerId = await resolvePractitionerIdInRuleSet(
      ctx,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );
    const activePractitionerLineageKey = await resolvePractitionerLineageKey(
      ctx.db,
      activePractitionerId,
    );
    await replaceVacationsInDraft(ctx, {
      date: args.date,
      practiceId: args.practiceId,
      practitionerId: draftPractitionerId,
      replacingVacationLineageKeys,
      ruleSetId,
      staffType: "practitioner",
    });

    const vacationResult = await createVacationInDraft(ctx, {
      date: args.date,
      expectedDraftRevision: args.expectedDraftRevision,
      ...(retainedLineageKey ? { lineageKey: retainedLineageKey } : {}),
      portion: args.portion,
      practiceId: args.practiceId,
      practitionerId: args.practitionerId,
      resolvedRuleSetId: ruleSetId,
      selectedRuleSetId: ruleSetId,
      staffType: "practitioner",
    });
    const vacation = vacationResult.entityId
      ? await ctx.db.get("vacations", vacationResult.entityId)
      : null;
    if (!vacation) {
      throw new Error("Urlaub konnte nicht angelegt werden.");
    }
    const vacationLineageKey = requireVacationLineageKey(vacation);

    await deleteCoverageSimulationAppointmentsForVacation(ctx, {
      ruleSetId,
      vacationLineageKey,
    });

    const selectedVacationPractitionerId =
      await resolvePractitionerIdForRuleSet(ctx.db, {
        practiceId: args.practiceId,
        practitionerId: args.practitionerId,
        ruleSetId,
      });

    const [baseSchedules, vacations] = await Promise.all([
      ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      ctx.db
        .query("vacations")
        .withIndex("by_ruleSetId_date", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("date", args.date),
        )
        .collect(),
    ]);
    const vacationRanges = getPractitionerVacationRangesForDate(
      Temporal.PlainDate.from(args.date),
      selectedVacationPractitionerId,
      baseSchedules,
      vacations,
    );

    const now = BigInt(Date.now());
    const seenAppointmentIds = new Set<Id<"appointments">>();
    for (const reassignment of args.reassignments) {
      if (seenAppointmentIds.has(reassignment.appointmentId)) {
        throw new Error(
          "Jeder betroffene Termin darf nur einmal verschoben werden.",
        );
      }
      seenAppointmentIds.add(reassignment.appointmentId);

      const appointment = await ctx.db.get(
        "appointments",
        reassignment.appointmentId,
      );
      if (!appointment) {
        throw new Error("Termin nicht gefunden.");
      }
      if (appointment.practiceId !== args.practiceId) {
        throw new Error("Termin gehört nicht zu dieser Praxis.");
      }
      if (
        appointment.cancelledAt !== undefined ||
        appointment.isSimulation === true
      ) {
        throw new Error("Nur echte, aktive Termine können verschoben werden.");
      }
      if (appointment.practitionerLineageKey !== activePractitionerLineageKey) {
        throw new Error(
          "Mindestens ein Termin gehört nicht mehr zum ausgewählten Behandler.",
        );
      }
      if (
        Temporal.ZonedDateTime.from(appointment.start)
          .withTimeZone("Europe/Berlin")
          .toPlainDate()
          .toString() !== args.date ||
        !appointmentOverlapsVacationRanges(appointment, vacationRanges)
      ) {
        throw new Error(
          "Mindestens ein Termin ist nicht vom angefragten Urlaub betroffen. Bitte Vorschläge neu laden.",
        );
      }
      if (appointment.seriesId !== undefined) {
        throw new Error(
          "Kettentermine können derzeit nicht automatisch verschoben werden.",
        );
      }

      const targetPractitionerIdInDraft = await resolvePractitionerIdForRuleSet(
        ctx.db,
        {
          practiceId: args.practiceId,
          practitionerId: reassignment.targetPractitionerId,
          ruleSetId,
        },
      );
      const targetPractitioner = await ctx.db.get(
        "practitioners",
        targetPractitionerIdInDraft,
      );
      if (
        targetPractitioner?.practiceId !== args.practiceId ||
        targetPractitioner.ruleSetId !== ruleSetId
      ) {
        throw new Error("Ziel-Behandler konnte nicht validiert werden.");
      }

      const selectedAppointmentTypeId =
        await resolveAppointmentTypeIdForRuleSet(ctx.db, {
          appointmentTypeId: appointment.appointmentTypeLineageKey,
          practiceId: args.practiceId,
          targetRuleSetId: ruleSetId,
        });
      const selectedAppointmentType = await ctx.db.get(
        "appointmentTypes",
        selectedAppointmentTypeId,
      );
      if (!selectedAppointmentType) {
        throw new Error("Terminart des Termins konnte nicht geladen werden.");
      }
      if (
        !selectedAppointmentType.allowedPractitionerIds.includes(
          targetPractitionerIdInDraft,
        )
      ) {
        throw new Error(
          "Der Ziel-Behandler ist für diese Terminart nicht freigegeben.",
        );
      }
      const selectedLocationId = await resolveLocationIdForRuleSet(ctx.db, {
        locationId: appointment.locationLineageKey,
        practiceId: args.practiceId,
        targetRuleSetId: ruleSetId,
      });

      const targetPractitionerLineageKey = await resolvePractitionerLineageKey(
        ctx.db,
        targetPractitionerIdInDraft,
      );

      const conflictingAppointment = targetPractitionerLineageKey
        ? await findConflictingAppointment(ctx.db, {
            candidate: {
              end: appointment.end,
              locationLineageKey: appointment.locationLineageKey,
              practitionerLineageKey: targetPractitionerLineageKey,
              start: appointment.start,
            },
            excludeAppointmentIds: [appointment._id],
            practiceId: args.practiceId,
            scope: "real",
          })
        : null;

      if (conflictingAppointment) {
        throw new Error(
          "Mindestens ein Verschiebevorschlag ist nicht mehr frei. Bitte Vorschläge neu laden.",
        );
      }
      const patientDateOfBirth = await getPatientDateOfBirthForAppointment(
        ctx,
        appointment,
      );
      const schedulingResult = await ctx.runQuery(
        internal.scheduling.getSlotsForDayInternal,
        {
          date: Temporal.ZonedDateTime.from(appointment.start)
            .withTimeZone("Europe/Berlin")
            .toPlainDate()
            .toString(),
          excludedAppointmentIds: [appointment._id],
          practiceId: args.practiceId,
          ruleSetId,
          simulatedContext: {
            appointmentTypeId: selectedAppointmentTypeId,
            locationId: selectedLocationId,
            patient: {
              ...(patientDateOfBirth
                ? { dateOfBirth: patientDateOfBirth }
                : {}),
              isNew: false,
            },
          },
        },
      );
      const matchingSlot = schedulingResult.slots.find(
        (slot) =>
          slot.status === "AVAILABLE" &&
          slot.practitionerId === targetPractitionerIdInDraft &&
          slot.startTime === appointment.start,
      );

      if (!matchingSlot) {
        throw new Error(
          "Mindestens ein Verschiebevorschlag ist nicht mehr gueltig. Bitte Vorschläge neu laden.",
        );
      }
      const appointmentsReplacingCurrent = await ctx.db
        .query("appointments")
        .withIndex("by_replacesAppointmentId", (q) =>
          q.eq("replacesAppointmentId", appointment._id),
        )
        .collect();
      const existingSimulationAppointments =
        appointmentsReplacingCurrent.filter(
          (candidate) =>
            candidate.isSimulation === true &&
            candidate.simulationRuleSetId === ruleSetId &&
            isActivationBoundSimulation(candidate),
        );
      const conflictingDraftSimulation = appointmentsReplacingCurrent.find(
        (candidate) =>
          candidate.isSimulation === true &&
          candidate.simulationRuleSetId === ruleSetId &&
          !isActivationBoundSimulation(candidate),
      );
      if (conflictingDraftSimulation) {
        throw new Error(
          "Mindestens ein Termin wurde in der Simulation bereits manuell angepasst. Bitte Urlaubsvorschläge neu laden.",
        );
      }
      const [existingSimulationAppointment, ...duplicateSimulations] =
        existingSimulationAppointments;
      for (const duplicateSimulation of duplicateSimulations) {
        await ctx.db.delete("appointments", duplicateSimulation._id);
      }

      const storedReferences = await resolveStoredAppointmentReferencesForWrite(
        ctx.db,
        {
          appointmentTypeId: selectedAppointmentTypeId,
          locationId: selectedLocationId,
          practitionerId: targetPractitionerIdInDraft,
        },
      );

      const nextAppointmentData = {
        ...storedReferences,
        appointmentTypeTitle: appointment.appointmentTypeTitle,
        end: appointment.end,
        lastModified: now,
        ...(appointment.patientId ? { patientId: appointment.patientId } : {}),
        practiceId: args.practiceId,
        reassignmentSourceVacationLineageKey: vacationLineageKey,
        replacesAppointmentId: appointment._id,
        simulationKind: "activation-reassignment" as const,
        simulationRuleSetId: ruleSetId,
        start: appointment.start,
        title: appointment.title,
        ...(appointment.userId ? { userId: appointment.userId } : {}),
      };

      if (existingSimulationAppointment) {
        await ctx.db.patch("appointments", existingSimulationAppointment._id, {
          ...nextAppointmentData,
          createdAt: existingSimulationAppointment.createdAt,
          simulationValidatedAt: now,
        });
      } else {
        await ctx.db.insert("appointments", {
          ...nextAppointmentData,
          createdAt: now,
          isSimulation: true,
          simulationValidatedAt: now,
        });
      }
    }

    return vacationResult;
  },
  returns: draftMutationResultValidator,
});

export const deleteVacation = mutation({
  args: {
    date: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("vacations")),
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

    const existingByLineage = args.lineageKey
      ? await ctx.db
          .query("vacations")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", ruleSetId).eq("lineageKey", args.lineageKey),
          )
          .first()
      : null;

    const existing =
      existingByLineage ??
      (args.lineageKey
        ? null
        : await ctx.db
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
            .first());

    if (
      existingByLineage &&
      (existingByLineage.practiceId !== args.practiceId ||
        existingByLineage.date !== args.date ||
        existingByLineage.portion !== args.portion ||
        existingByLineage.staffType !== args.staffType ||
        (args.staffType === "practitioner"
          ? existingByLineage.practitionerId !== resolved.practitionerId
          : existingByLineage.mfaId !== resolved.mfaId))
    ) {
      throw new Error(
        "Urlaub mit dieser lineageKey existiert bereits mit anderen Daten.",
      );
    }

    const entityId = existing?._id;

    if (existing) {
      const vacationLineageKey = requireVacationLineageKey(existing);
      await deleteCoverageSimulationAppointmentsForVacation(ctx, {
        ruleSetId,
        vacationLineageKey,
      });
      await ctx.db.delete("vacations", existing._id);
    }

    const draftRevision = await bumpDraftRevision(ctx.db, ruleSetId);
    return {
      draftRevision,
      ...(entityId ? { entityId } : {}),
      ruleSetId,
    };
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
    return vacations
      .filter(
        (vacation) =>
          vacation.staffType === "practitioner" &&
          getVacationStaffId(vacation) !== undefined,
      )
      .map((vacation) => ({
        ...vacation,
        lineageKey: requireVacationLineageKey(vacation),
      }));
  },
});
