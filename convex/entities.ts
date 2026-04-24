/**
 * Entity Management API
 *
 * Public mutations and queries for managing entities within rule sets.
 * All mutations require an unsaved rule set (saved=false).
 *
 * Entities managed here:
 * - Appointment Types
 * - Practitioners
 * - Locations
 * - Base Schedules
 * - Rule Conditions (Rules)
 */

import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import { parseConditionTreeTransport } from "../lib/condition-tree.js";
import { mutation, query } from "./_generated/server";
import { getEffectiveAppointmentsForOccupancyView } from "./appointmentConflicts";
import {
  previewPractitionerCoverageForAppointment,
  resolveAppointmentTypeIdForRuleSet,
  resolveLocationIdForRuleSet,
  resolvePractitionerIdForRuleSet,
} from "./appointmentCoverage";
import {
  resolveLocationLineageKey,
  resolvePractitionerLineageKey,
  resolveStoredAppointmentReferencesForWrite,
} from "./appointmentReferences";
import { isActivationBoundSimulation } from "./appointmentSimulation";
import {
  bumpDraftRevision,
  resolveDraftForWrite,
  validateAppointmentTypeLineageKeysInRuleSet,
  validateLocationLineageKeysInRuleSet,
  validatePractitionerLineageKeysInRuleSet,
  verifyEntityInUnsavedRuleSet,
} from "./copyOnWrite";
import {
  appointmentTypeResultValidator,
  baseScheduleBatchResultValidator,
  baseScheduleCreatePayloadValidator,
  baseSchedulePayloadValidator,
  baseScheduleResultValidator,
  conditionTreeTransportValidator,
  deletePractitionerWithDependenciesResultValidator,
  expectedDraftRevisionValidator,
  locationResultValidator,
  practitionerDependencySnapshotValidator,
  practitionerResultValidator,
  replaceBaseScheduleSetResultValidator,
  restorePractitionerWithDependenciesResultValidator,
  ruleResultValidator,
} from "./entities.validators";
import {
  type FollowUpPlan,
  followUpStepValidator,
  validateFollowUpPlan,
} from "./followUpPlans";
import {
  type AppointmentTypeLineageKey,
  asAppointmentTypeLineageKey,
  asBaseScheduleLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type BaseScheduleLineageKey,
  type LocationLineageKey,
  type PractitionerLineageKey,
} from "./identity";
import { insertSelfLineageEntity } from "./lineage";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import { type ConditionTreeNode, validateConditionTree } from "./ruleEngine";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  asBaseScheduleCreatePayload,
  asBaseSchedulePayload,
} from "./typedDtos";
import { ensureAuthenticatedIdentity } from "./userIdentity";

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

// ================================
// SHARED TYPES
// ================================

async function finalizeDraftMutation(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<number> {
  return await bumpDraftRevision(db, ruleSetId);
}

async function resolveDraftRuleSetForMutation(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
  expectedDraftRevision: null | number,
  selectedRuleSetId: Id<"ruleSets">,
): Promise<Id<"ruleSets">> {
  const resolved = await resolveDraftForWrite(
    db,
    practiceId,
    expectedDraftRevision,
    selectedRuleSetId,
  );
  return resolved.ruleSetId;
}

// ================================
// SHARED HELPER FUNCTIONS
// ================================

function assertRuleSetEntityIsActive(params: {
  entity: { deleted?: boolean };
  entityId: string;
  entityLabel: "Behandler" | "Standort" | "Terminart";
  errorCode:
    | "[LINEAGE:APPOINTMENT_TYPE_DELETED]"
    | "[LINEAGE:LOCATION_DELETED]"
    | "[LINEAGE:PRACTITIONER_DELETED]";
  ruleSetId: Id<"ruleSets">;
}): void {
  if (!isDeletedRuleSetEntity(params.entity)) {
    return;
  }

  throw new Error(
    `${params.errorCode} ${params.entityLabel} ${params.entityId} wurde in Regelset ${params.ruleSetId} gelöscht und kann nicht mehr neu referenziert werden.`,
  );
}

async function createAutomaticReassignmentSimulationsForDeletedPractitioner(
  ctx: MutationCtx,
  args: {
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    practitionerLineageKey: PractitionerLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"appointments">[]> {
  const practice = await ctx.db.get("practices", args.practiceId);
  if (!practice?.currentActiveRuleSetId) {
    return [];
  }

  const nowIso = Temporal.Now.zonedDateTimeISO("Europe/Berlin").toString();
  const appointments = await ctx.db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q.eq("practiceId", args.practiceId).gte("start", nowIso),
    )
    .collect();
  const effectiveAppointments = getEffectiveAppointmentsForOccupancyView(
    appointments,
    "draftEffective",
    args.ruleSetId,
  );
  const affectedAppointmentsBySourceId = new Map<
    Id<"appointments">,
    Doc<"appointments">
  >();

  for (const appointment of effectiveAppointments) {
    if (appointment.practitionerLineageKey !== args.practitionerLineageKey) {
      continue;
    }

    if (appointment.isSimulation !== true) {
      affectedAppointmentsBySourceId.set(appointment._id, appointment);
      continue;
    }

    if (
      !isActivationBoundSimulation(appointment) ||
      !appointment.replacesAppointmentId
    ) {
      continue;
    }

    const sourceAppointment = await ctx.db.get(
      "appointments",
      appointment.replacesAppointmentId,
    );
    if (
      sourceAppointment?.practiceId !== args.practiceId ||
      sourceAppointment.isSimulation === true ||
      sourceAppointment.cancelledAt !== undefined
    ) {
      continue;
    }

    affectedAppointmentsBySourceId.set(
      sourceAppointment._id,
      sourceAppointment,
    );
  }

  const affectedAppointments = [...affectedAppointmentsBySourceId.values()];
  const createdSimulationIds: Id<"appointments">[] = [];
  const now = BigInt(Date.now());

  for (const appointment of affectedAppointments) {
    const appointmentsReplacingCurrent = await ctx.db
      .query("appointments")
      .withIndex("by_replacesAppointmentId", (q) =>
        q.eq("replacesAppointmentId", appointment._id),
      )
      .collect();
    for (const existingSimulation of appointmentsReplacingCurrent) {
      if (
        existingSimulation.isSimulation === true &&
        existingSimulation.simulationRuleSetId === args.ruleSetId &&
        isActivationBoundSimulation(existingSimulation)
      ) {
        await ctx.db.delete("appointments", existingSimulation._id);
      }
    }

    const suggestion = await previewPractitionerCoverageForAppointment(ctx, {
      activeRuleSetId: practice.currentActiveRuleSetId,
      appointment,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      selectedPractitionerId: args.practitionerId,
    });

    if (!suggestion.targetPractitionerLineageKey) {
      continue;
    }

    const appointmentTypeId = await resolveAppointmentTypeIdForRuleSet(ctx.db, {
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        appointment.appointmentTypeLineageKey,
      ),
      practiceId: args.practiceId,
      targetRuleSetId: args.ruleSetId,
    });
    const locationId = await resolveLocationIdForRuleSet(ctx.db, {
      locationLineageKey: asLocationLineageKey(appointment.locationLineageKey),
      practiceId: args.practiceId,
      targetRuleSetId: args.ruleSetId,
    });
    const storedReferences = await resolveStoredAppointmentReferencesForWrite(
      ctx.db,
      {
        appointmentTypeId,
        locationId,
        practitionerId: await resolvePractitionerIdForRuleSet(ctx.db, {
          practiceId: args.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            suggestion.targetPractitionerLineageKey,
          ),
          ruleSetId: args.ruleSetId,
        }),
      },
    );

    const simulationAppointmentId = await ctx.db.insert("appointments", {
      ...storedReferences,
      appointmentTypeTitle: appointment.appointmentTypeTitle,
      createdAt: now,
      end: appointment.end,
      isSimulation: true,
      lastModified: now,
      ...(appointment.patientId ? { patientId: appointment.patientId } : {}),
      practiceId: args.practiceId,
      replacesAppointmentId: appointment._id,
      simulationKind: "activation-reassignment",
      simulationRuleSetId: args.ruleSetId,
      simulationValidatedAt: now,
      start: appointment.start,
      title: appointment.title,
      ...(appointment.userId ? { userId: appointment.userId } : {}),
    });
    createdSimulationIds.push(simulationAppointmentId);
  }

  return createdSimulationIds;
}

async function ensureBaseScheduleLineageKeyForWrite(
  db: DatabaseWriter,
  entity: Doc<"baseSchedules">,
): Promise<Id<"baseSchedules">> {
  if (entity.lineageKey) {
    return entity.lineageKey;
  }

  await verifyEntityInUnsavedRuleSet(db, entity.ruleSetId, "base schedule");
  await db.patch("baseSchedules", entity._id, {
    lineageKey: entity._id,
  });
  return entity._id;
}

function isDeletedRuleSetEntity(
  entity: null | undefined | { deleted?: boolean },
): boolean {
  return isRuleSetEntityDeleted(entity);
}

function missingLineageKeyError(params: {
  entityId: string;
  entityType:
    | "appointment type"
    | "base schedule"
    | "location"
    | "practitioner";
  ruleSetId: Id<"ruleSets">;
}): Error {
  return new Error(
    `[INVARIANT:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entityId} in Regelset ${params.ruleSetId} hat keinen lineageKey. ` +
      "Bitte Daten konsistent neu erzeugen oder per Migration bereinigen.",
  );
}

function requireAppointmentTypeLineageKey(
  entity: Pick<Doc<"appointmentTypes">, "_id" | "lineageKey" | "ruleSetId">,
): AppointmentTypeLineageKey {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "appointment type",
      ruleSetId: entity.ruleSetId,
    });
  }
  return asAppointmentTypeLineageKey(entity.lineageKey);
}

function requireBaseScheduleLineageKey(
  entity: Pick<Doc<"baseSchedules">, "_id" | "lineageKey" | "ruleSetId">,
): BaseScheduleLineageKey {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "base schedule",
      ruleSetId: entity.ruleSetId,
    });
  }
  return asBaseScheduleLineageKey(entity.lineageKey);
}

function requireLocationLineageKey(
  entity: Pick<Doc<"locations">, "_id" | "lineageKey" | "ruleSetId">,
): LocationLineageKey {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "location",
      ruleSetId: entity.ruleSetId,
    });
  }
  return asLocationLineageKey(entity.lineageKey);
}

function requirePractitionerLineageKey(
  entity: Pick<Doc<"practitioners">, "_id" | "lineageKey" | "ruleSetId">,
): PractitionerLineageKey {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "practitioner",
      ruleSetId: entity.ruleSetId,
    });
  }
  return asPractitionerLineageKey(entity.lineageKey);
}

async function resolveBaseScheduleDisplayReferences(params: {
  db: DatabaseReader;
  locationLineageKey: LocationLineageKey;
  practiceId: Id<"practices">;
  practitionerLineageKey: PractitionerLineageKey;
  ruleSetId: Id<"ruleSets">;
}): Promise<{
  locationId: Id<"locations">;
  locationLineageKey: LocationLineageKey;
  practitionerId: Id<"practitioners">;
  practitionerLineageKey: PractitionerLineageKey;
}> {
  const [locationId, practitionerId] = await Promise.all([
    resolveLocationIdForRuleSet(params.db, {
      locationLineageKey: asLocationLineageKey(params.locationLineageKey),
      practiceId: params.practiceId,
      targetRuleSetId: params.ruleSetId,
    }),
    resolvePractitionerIdInRuleSet(
      params.db,
      params.practitionerLineageKey,
      params.practiceId,
      params.ruleSetId,
    ),
  ]);

  return {
    locationId,
    locationLineageKey: params.locationLineageKey,
    practitionerId,
    practitionerLineageKey: params.practitionerLineageKey,
  };
}

/**
 * Resolve a base schedule ID into the current unsaved rule set.
 * Returns null when neither the original nor a CoW copy exists.
 */
async function resolveBaseScheduleIdInRuleSet(
  db: DatabaseReader,
  baseScheduleId: Id<"baseSchedules">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"baseSchedules"> | null> {
  const scheduleEntity = await db.get("baseSchedules", baseScheduleId);
  if (!scheduleEntity) {
    return null;
  }

  if (scheduleEntity.ruleSetId === ruleSetId) {
    return scheduleEntity._id;
  }

  const lineageKey = requireBaseScheduleLineageKey(scheduleEntity);
  const scheduleCopy = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  return scheduleCopy?._id ?? null;
}

/**
 * Resolve a location ID into the current unsaved rule set.
 */
async function resolveLocationIdInRuleSet(
  db: DatabaseReader,
  locationId: Id<"locations">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"locations">> {
  const locationEntity = await db.get("locations", locationId);
  if (!locationEntity) {
    throw new Error("Location not found");
  }
  if (locationEntity.practiceId !== practiceId) {
    throw new Error("Location does not belong to this practice");
  }

  if (locationEntity.ruleSetId === ruleSetId) {
    assertRuleSetEntityIsActive({
      entity: locationEntity,
      entityId: locationEntity._id,
      entityLabel: "Standort",
      errorCode: "[LINEAGE:LOCATION_DELETED]",
      ruleSetId,
    });
    return locationEntity._id;
  }

  const lineageKey = requireLocationLineageKey(locationEntity);
  const locationCopy = await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (locationCopy?.practiceId !== practiceId) {
    throw new Error(
      `[LINEAGE:LOCATION_NOT_FOUND] Standort mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${ruleSetId} nicht gefunden.`,
    );
  }

  assertRuleSetEntityIsActive({
    entity: locationCopy,
    entityId: locationCopy._id,
    entityLabel: "Standort",
    errorCode: "[LINEAGE:LOCATION_DELETED]",
    ruleSetId,
  });

  return locationCopy._id;
}

/**
 * Resolve appointment type entity in the target unsaved rule set.
 */
async function resolveAppointmentTypeEntityInRuleSet(
  db: DatabaseReader,
  appointmentTypeId: Id<"appointmentTypes">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Doc<"appointmentTypes">> {
  const appointmentTypeEntity = await db.get(
    "appointmentTypes",
    appointmentTypeId,
  );
  if (!appointmentTypeEntity) {
    throw new Error("Appointment type not found");
  }
  if (appointmentTypeEntity.practiceId !== practiceId) {
    throw new Error("Appointment type does not belong to this practice");
  }

  if (appointmentTypeEntity.ruleSetId === ruleSetId) {
    assertRuleSetEntityIsActive({
      entity: appointmentTypeEntity,
      entityId: appointmentTypeEntity._id,
      entityLabel: "Terminart",
      errorCode: "[LINEAGE:APPOINTMENT_TYPE_DELETED]",
      ruleSetId,
    });
    return appointmentTypeEntity;
  }

  const lineageKey = requireAppointmentTypeLineageKey(appointmentTypeEntity);
  const appointmentTypeCopy = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (appointmentTypeCopy?.practiceId !== practiceId) {
    throw new Error(
      `[LINEAGE:APPOINTMENT_TYPE_NOT_FOUND] Terminart mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${ruleSetId} nicht gefunden.`,
    );
  }

  assertRuleSetEntityIsActive({
    entity: appointmentTypeCopy,
    entityId: appointmentTypeCopy._id,
    entityLabel: "Terminart",
    errorCode: "[LINEAGE:APPOINTMENT_TYPE_DELETED]",
    ruleSetId,
  });

  return appointmentTypeCopy;
}

/**
 * Resolve a practitioner ID into the current unsaved rule set.
 */
async function resolvePractitionerIdInRuleSet(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  const practitionerEntity = await db.get("practitioners", practitionerId);
  if (!practitionerEntity) {
    const practitionerCopy = await db
      .query("practitioners")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("lineageKey", practitionerId),
      )
      .first();
    if (practitionerCopy?.practiceId === practiceId) {
      return practitionerCopy._id;
    }

    throw new Error(
      `[LINEAGE:PRACTITIONER_SOURCE_NOT_FOUND] Behandler ${practitionerId} konnte nicht geladen werden. ` +
        "Die Änderung referenziert vermutlich eine veraltete ID oder einen nicht mehr verfügbaren Herkunftsdatensatz.",
    );
  }
  if (practitionerEntity.practiceId !== practiceId) {
    throw new Error("Practitioner does not belong to this practice");
  }

  if (practitionerEntity.ruleSetId === ruleSetId) {
    assertRuleSetEntityIsActive({
      entity: practitionerEntity,
      entityId: practitionerEntity._id,
      entityLabel: "Behandler",
      errorCode: "[LINEAGE:PRACTITIONER_DELETED]",
      ruleSetId,
    });
    return practitionerEntity._id;
  }

  const lineageKey = requirePractitionerLineageKey(practitionerEntity);
  const practitionerCopy = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (practitionerCopy?.practiceId !== practiceId) {
    throw new Error(
      `[LINEAGE:PRACTITIONER_NOT_FOUND] Behandler mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${ruleSetId} nicht gefunden.`,
    );
  }

  assertRuleSetEntityIsActive({
    entity: practitionerCopy,
    entityId: practitionerCopy._id,
    entityLabel: "Behandler",
    errorCode: "[LINEAGE:PRACTITIONER_DELETED]",
    ruleSetId,
  });

  return practitionerCopy._id;
}

/**
 * Resolve practitioner entity in the target unsaved rule set.
 */
async function resolvePractitionerEntityInRuleSet(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
) {
  const practitionerEntity = await db.get("practitioners", practitionerId);
  if (!practitionerEntity) {
    throw new Error("Practitioner not found");
  }
  if (practitionerEntity.practiceId !== practiceId) {
    throw new Error("Practitioner does not belong to this practice");
  }

  if (practitionerEntity.ruleSetId === ruleSetId) {
    assertRuleSetEntityIsActive({
      entity: practitionerEntity,
      entityId: practitionerEntity._id,
      entityLabel: "Behandler",
      errorCode: "[LINEAGE:PRACTITIONER_DELETED]",
      ruleSetId,
    });
    return practitionerEntity;
  }

  const lineageKey = requirePractitionerLineageKey(practitionerEntity);
  const practitionerCopy = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (practitionerCopy?.practiceId !== practiceId) {
    throw new Error(
      `[LINEAGE:PRACTITIONER_NOT_FOUND] Behandler mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${ruleSetId} nicht gefunden.`,
    );
  }

  assertRuleSetEntityIsActive({
    entity: practitionerCopy,
    entityId: practitionerCopy._id,
    entityLabel: "Behandler",
    errorCode: "[LINEAGE:PRACTITIONER_DELETED]",
    ruleSetId,
  });

  return practitionerCopy;
}

/**
 * Resolve selected practitioner entity IDs to lineage keys and validate they
 * exist in the target rule set.
 * @throws Error if practitionerIds contains invalid practitioners
 * @returns Array of resolved practitioner lineage keys
 */
async function resolvePractitionerLineageKeys(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  ruleSetId: Id<"ruleSets">,
): Promise<PractitionerLineageKey[] | undefined>;
async function resolvePractitionerLineageKeys(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  ruleSetId: Id<"ruleSets">,
): Promise<PractitionerLineageKey[] | undefined> {
  if (!practitionerIds) {
    return undefined;
  }

  const seen = new Set<PractitionerLineageKey>();
  const resolved: PractitionerLineageKey[] = [];

  for (const practitionerId of practitionerIds) {
    const practitionerLineageKey = asPractitionerLineageKey(
      await resolvePractitionerLineageKey(db, asPractitionerId(practitionerId)),
    );
    if (!seen.has(practitionerLineageKey)) {
      seen.add(practitionerLineageKey);
      resolved.push(practitionerLineageKey);
    }
  }

  await validatePractitionerLineageKeysInRuleSet(db, resolved, ruleSetId);
  return resolved;
}

// ================================
// APPOINTMENT TYPES
// ================================

/**
 * Create a new appointment type in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createAppointmentType = mutation({
  args: {
    duration: v.number(), // duration in minutes
    expectedDraftRevision: expectedDraftRevisionValidator,
    followUpPlan: v.optional(v.array(followUpStepValidator)),
    lineageKey: v.optional(v.id("appointmentTypes")),
    name: v.string(),
    practiceId: v.id("practices"),
    practitionerIds: v.array(v.id("practitioners")),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const allowedPractitionerLineageKeys = await resolvePractitionerLineageKeys(
      ctx.db,
      args.practitionerIds,
      ruleSetId,
    );
    const normalizedAllowedPractitionerLineageKeys =
      allowedPractitionerLineageKeys ?? [];
    const followUpPlan = await validateFollowUpPlan(
      ctx.db,
      ruleSetId,
      args.followUpPlan,
      args.lineageKey
        ? asAppointmentTypeLineageKey(args.lineageKey)
        : undefined,
    );

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .collect();

    if (
      existing.some(
        (appointmentType) => !isDeletedRuleSetEntity(appointmentType),
      )
    ) {
      throw new Error(
        "Appointment type with this name already exists in this rule set",
      );
    }

    if (args.lineageKey) {
      const lineageKey = args.lineageKey;
      const existingByLineage = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
        )
        .first();
      if (existingByLineage && !isDeletedRuleSetEntity(existingByLineage)) {
        throw new Error(
          `[LINEAGE:APPOINTMENT_TYPE_DUPLICATE] Terminart mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
      if (existingByLineage) {
        await verifyEntityInUnsavedRuleSet(
          ctx.db,
          existingByLineage.ruleSetId,
          "appointment type",
        );
        await ctx.db.patch("appointmentTypes", existingByLineage._id, {
          allowedPractitionerLineageKeys:
            normalizedAllowedPractitionerLineageKeys,
          deleted: false,
          duration: args.duration,
          followUpPlan: followUpPlan ?? [],
          lastModified: BigInt(Date.now()),
          name: args.name,
        });

        const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
        return {
          draftRevision,
          entityId: existingByLineage._id,
          ruleSetId,
        };
      }
    }

    // Create the appointment type
    const entityId = await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
      allowedPractitionerLineageKeys: normalizedAllowedPractitionerLineageKeys,
      createdAt: BigInt(Date.now()),
      duration: args.duration,
      ...(followUpPlan && { followUpPlan }),
      lastModified: BigInt(Date.now()),
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: appointmentTypeResultValidator,
});

/**
 * Update an appointment type in an unsaved rule set
 */
export const updateAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    duration: v.optional(v.number()),
    expectedDraftRevision: expectedDraftRevisionValidator,
    followUpPlan: v.optional(v.array(followUpStepValidator)),
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    practitionerIds: v.optional(v.array(v.id("practitioners"))),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const appointmentType = await resolveAppointmentTypeEntityInRuleSet(
      ctx.db,
      args.appointmentTypeId,
      args.practiceId,
      ruleSetId,
    );

    // Check name uniqueness if changing name
    if (args.name !== undefined && args.name !== appointmentType.name) {
      const newName = args.name; // Narrow type for TypeScript
      const existing = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", newName),
        )
        .collect();

      if (
        existing.some(
          (candidate) =>
            !isDeletedRuleSetEntity(candidate) &&
            candidate._id !== appointmentType._id,
        )
      ) {
        throw new Error(
          "Appointment type with this name already exists in this rule set",
        );
      }
    }

    // Build updates object
    const updates: Partial<{
      allowedPractitionerLineageKeys: PractitionerLineageKey[];
      duration: number;
      followUpPlan: FollowUpPlan;
      lastModified: bigint;
      name: string;
    }> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.duration !== undefined) {
      updates.duration = args.duration;
    }
    if (args.practitionerIds !== undefined) {
      const resolved = await resolvePractitionerLineageKeys(
        ctx.db,
        args.practitionerIds,
        ruleSetId,
      );
      updates.allowedPractitionerLineageKeys = resolved ?? [];
    }
    if (args.followUpPlan !== undefined) {
      const validatedFollowUpPlan = await validateFollowUpPlan(
        ctx.db,
        ruleSetId,
        args.followUpPlan,
        requireAppointmentTypeLineageKey(appointmentType),
      );
      updates.followUpPlan = validatedFollowUpPlan ?? [];
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      appointmentType.ruleSetId,
      "appointment type",
    );

    await ctx.db.patch("appointmentTypes", appointmentType._id, updates);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: appointmentType._id, ruleSetId };
  },
  returns: appointmentTypeResultValidator,
});

/**
 * Delete an appointment type from an unsaved rule set
 */
export const deleteAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    appointmentTypeLineageKey: v.optional(v.id("appointmentTypes")),
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    let appointmentType: Doc<"appointmentTypes"> | null = null;

    try {
      appointmentType = await resolveAppointmentTypeEntityInRuleSet(
        ctx.db,
        args.appointmentTypeId,
        args.practiceId,
        ruleSetId,
      );
    } catch {
      const lineageKey = args.appointmentTypeLineageKey;
      if (lineageKey) {
        const byLineage = await ctx.db
          .query("appointmentTypes")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
          )
          .first();
        if (byLineage?.practiceId === args.practiceId) {
          appointmentType = byLineage;
        }
      }
    }

    if (!appointmentType) {
      throw new Error(
        `[LINEAGE:APPOINTMENT_TYPE_NOT_FOUND] Terminart konnte über ID ${args.appointmentTypeId} und lineageKey ${args.appointmentTypeLineageKey ?? "n/a"} nicht aufgelöst werden (Regelset ${ruleSetId}).`,
      );
    }
    if (isDeletedRuleSetEntity(appointmentType)) {
      throw new Error(
        `[LINEAGE:APPOINTMENT_TYPE_ALREADY_DELETED] Terminart ${appointmentType._id} ist in Regelset ${ruleSetId} bereits gelöscht.`,
      );
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      appointmentType.ruleSetId,
      "appointment type",
    );

    await ctx.db.patch("appointmentTypes", appointmentType._id, {
      deleted: true,
      lastModified: BigInt(Date.now()),
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: appointmentType._id, ruleSetId };
  },
  returns: appointmentTypeResultValidator,
});

/**
 * Get all appointment types for a rule set
 */
export const getAppointmentTypes = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return appointmentTypes
      .filter(
        (appointmentType) =>
          args.includeDeleted === true ||
          !isDeletedRuleSetEntity(appointmentType),
      )
      .map((appointmentType) => ({
        ...appointmentType,
        lineageKey: requireAppointmentTypeLineageKey(appointmentType),
      }));
  },
});

// ================================
// PRACTITIONERS
// ================================

/**
 * Create a new practitioner in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createPractitioner = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("practitioners")),
    name: v.string(),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .collect();

    if (
      existing.some((practitioner) => !isDeletedRuleSetEntity(practitioner))
    ) {
      throw new Error(
        "Practitioner with this name already exists in this rule set",
      );
    }

    if (args.lineageKey) {
      const lineageKey = args.lineageKey;
      const existingByLineage = await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
        )
        .first();
      if (existingByLineage && !isDeletedRuleSetEntity(existingByLineage)) {
        throw new Error(
          `[LINEAGE:PRACTITIONER_DUPLICATE] Behandler mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
      if (existingByLineage) {
        await verifyEntityInUnsavedRuleSet(
          ctx.db,
          existingByLineage.ruleSetId,
          "practitioner",
        );
        await ctx.db.patch("practitioners", existingByLineage._id, {
          deleted: false,
          name: args.name,
          tags: args.tags ?? [],
        });

        const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
        return {
          draftRevision,
          entityId: existingByLineage._id,
          ruleSetId,
        };
      }
    }

    // Create the practitioner
    const entityId = await insertSelfLineageEntity(ctx.db, "practitioners", {
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
      ...(args.tags && { tags: args.tags }),
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: practitionerResultValidator,
});

/**
 * Update a practitioner in an unsaved rule set
 */
export const updatePractitioner = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    selectedRuleSetId: v.id("ruleSets"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const practitioner = await resolvePractitionerEntityInRuleSet(
      ctx.db,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );

    // Check name uniqueness if changing name
    if (args.name !== undefined && args.name !== practitioner.name) {
      const newName = args.name; // Narrow type for TypeScript
      const existing = await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", newName),
        )
        .collect();

      if (
        existing.some(
          (candidate) =>
            !isDeletedRuleSetEntity(candidate) &&
            candidate._id !== practitioner._id,
        )
      ) {
        throw new Error(
          "Practitioner with this name already exists in this rule set",
        );
      }
    }

    // Update the practitioner (use the entity in the unsaved rule set)
    const updates: Partial<{ name: string; tags: string[] | undefined }> = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.tags !== undefined) {
      updates.tags = args.tags;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      practitioner.ruleSetId,
      "practitioner",
    );

    await ctx.db.patch("practitioners", practitioner._id, updates);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: practitioner._id, ruleSetId };
  },
  returns: practitionerResultValidator,
});

/**
 * Delete a practitioner from an unsaved rule set
 */
export const deletePractitioner = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const practitioner = await resolvePractitionerEntityInRuleSet(
      ctx.db,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );

    // Delete associated base schedules (using the practitioner ID from unsaved rule set)
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerLineageKey", (q) =>
        q
          .eq("ruleSetId", ruleSetId)
          .eq(
            "practitionerLineageKey",
            requirePractitionerLineageKey(practitioner),
          ),
      )
      .collect();

    // SAFETY: Verify all schedules belong to unsaved rule set before deleting
    for (const schedule of schedules) {
      await verifyEntityInUnsavedRuleSet(
        ctx.db,
        schedule.ruleSetId,
        "base schedule",
      );
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      practitioner.ruleSetId,
      "practitioner",
    );

    await ctx.db.patch("practitioners", practitioner._id, {
      deleted: true,
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: practitioner._id, ruleSetId };
  },
  returns: practitionerResultValidator,
});

/**
 * Delete a practitioner and dependent references atomically.
 *
 * This mutation snapshots and updates all practitioner references so undo can
 * restore the previous state safely in a single transaction.
 */
export const deletePractitionerWithDependencies = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    practitionerLineageKey: v.optional(v.id("practitioners")),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    let practitioner: Awaited<
      ReturnType<typeof resolvePractitionerEntityInRuleSet>
    > | null = null;

    try {
      practitioner = await resolvePractitionerEntityInRuleSet(
        ctx.db,
        args.practitionerId,
        args.practiceId,
        ruleSetId,
      );
    } catch {
      const practitionerLineageKey = args.practitionerLineageKey;
      if (!practitionerLineageKey) {
        throw new Error(
          `[LINEAGE:PRACTITIONER_RESOLVE_FAILED] Behandler ${args.practitionerId} konnte ohne lineageKey nicht aufgelöst werden.`,
        );
      }

      const practitionerByLineage = await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", practitionerLineageKey),
        )
        .first();

      if (practitionerByLineage?.practiceId !== args.practiceId) {
        throw new Error(
          `[LINEAGE:PRACTITIONER_RESOLVE_FAILED] Behandler mit lineageKey ${practitionerLineageKey} wurde in Regelset ${ruleSetId} nicht gefunden.`,
        );
      }

      practitioner = practitionerByLineage;
    }
    if (isDeletedRuleSetEntity(practitioner)) {
      throw new Error(
        `[LINEAGE:PRACTITIONER_ALREADY_DELETED] Behandler ${practitioner._id} ist in Regelset ${ruleSetId} bereits gelöscht.`,
      );
    }

    const practitionerLineageKeyAsString: string =
      requirePractitionerLineageKey(practitioner);
    const now = BigInt(Date.now());

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerLineageKey", (q) =>
        q
          .eq("ruleSetId", ruleSetId)
          .eq(
            "practitionerLineageKey",
            requirePractitionerLineageKey(practitioner),
          ),
      )
      .collect();

    const locationsInRuleSet = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    const locationByLineageKey = new Map(
      locationsInRuleSet.map((location) => [
        requireLocationLineageKey(location),
        location,
      ]),
    );

    const baseScheduleSnapshots = await Promise.all(
      baseSchedules.map(async (schedule) => {
        const displayReferences = await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
          practiceId: args.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            schedule.practitionerLineageKey,
          ),
          ruleSetId,
        });
        const location = locationByLineageKey.get(
          asLocationLineageKey(schedule.locationLineageKey),
        );
        if (!location) {
          throw new Error(
            `[INVARIANT:LOCATION_MISSING] Standort mit lineageKey ${schedule.locationLineageKey} der Arbeitszeit ${schedule._id} fehlt im Regelset ${ruleSetId}.`,
          );
        }

        return {
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          lineageKey: requireBaseScheduleLineageKey(schedule),
          locationId: displayReferences.locationId,
          locationLineageKey: schedule.locationLineageKey,
          locationOriginId: location.parentId ?? displayReferences.locationId,
          startTime: schedule.startTime,
        };
      }),
    );

    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const appointmentTypePatches: {
      action: "delete" | "patch";
      afterAllowedPractitionerLineageKeys: PractitionerLineageKey[];
      appointmentTypeId: Id<"appointmentTypes">;
      beforeAllowedPractitionerLineageKeys: PractitionerLineageKey[];
      duration?: number;
      lineageKey: AppointmentTypeLineageKey;
      name?: string;
    }[] = appointmentTypes
      .filter((appointmentType) =>
        appointmentType.allowedPractitionerLineageKeys.includes(
          requirePractitionerLineageKey(practitioner),
        ),
      )
      .map((appointmentType) => {
        const afterAllowedPractitionerLineageKeys =
          appointmentType.allowedPractitionerLineageKeys
            .filter(
              (lineageKey) =>
                lineageKey !== requirePractitionerLineageKey(practitioner),
            )
            .map((lineageKey) => asPractitionerLineageKey(lineageKey));
        const action: "delete" | "patch" = "patch";

        return {
          action,
          afterAllowedPractitionerLineageKeys,
          appointmentTypeId: appointmentType._id,
          beforeAllowedPractitionerLineageKeys:
            appointmentType.allowedPractitionerLineageKeys.map((lineageKey) =>
              asPractitionerLineageKey(lineageKey),
            ),
          duration: appointmentType.duration,
          lineageKey: requireAppointmentTypeLineageKey(appointmentType),
          name: appointmentType.name,
        };
      });

    for (const patch of appointmentTypePatches) {
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        patch.appointmentTypeId,
      );
      if (appointmentType?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Die Terminart wurde zwischenzeitlich geändert und kann nicht konsistent aktualisiert werden.",
        );
      }

      await ctx.db.patch("appointmentTypes", appointmentType._id, {
        allowedPractitionerLineageKeys:
          patch.afterAllowedPractitionerLineageKeys,
        lastModified: now,
      });
    }

    const ruleConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const practitionerConditionPatches = ruleConditions.flatMap((condition) => {
      if (
        condition.nodeType !== "CONDITION" ||
        condition.conditionType !== "PRACTITIONER"
      ) {
        return [];
      }

      const beforeValueIds = condition.valueIds ?? [];
      if (!beforeValueIds.includes(practitionerLineageKeyAsString)) {
        return [];
      }

      const afterValueIds = beforeValueIds.filter(
        (valueId) => valueId !== practitionerLineageKeyAsString,
      );

      return [
        {
          afterValueIds,
          beforeValueIds,
          conditionId: condition._id,
        },
      ];
    });

    for (const patch of practitionerConditionPatches) {
      const condition = await ctx.db.get("ruleConditions", patch.conditionId);
      if (condition?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Regelbedingungen wurden zwischenzeitlich geändert und können nicht konsistent aktualisiert werden.",
        );
      }

      await ctx.db.patch("ruleConditions", condition._id, {
        lastModified: now,
        valueIds: patch.afterValueIds,
      });
    }

    for (const schedule of baseSchedules) {
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    await ctx.db.patch("practitioners", practitioner._id, {
      deleted: true,
    });

    const reassignmentSimulationIds =
      await createAutomaticReassignmentSimulationsForDeletedPractitioner(ctx, {
        practiceId: args.practiceId,
        practitionerId: practitioner._id,
        practitionerLineageKey: requirePractitionerLineageKey(practitioner),
        ruleSetId,
      });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return {
      draftRevision,
      ruleSetId,
      snapshot: {
        appointmentTypePatches,
        baseSchedules: baseScheduleSnapshots,
        practitioner: {
          id: practitioner._id,
          lineageKey: requirePractitionerLineageKey(practitioner),
          name: practitioner.name,
          ...(practitioner.tags && { tags: practitioner.tags }),
        },
        practitionerConditionPatches,
        reassignmentSimulationIds,
      },
    };
  },
  returns: deletePractitionerWithDependenciesResultValidator,
});

/**
 * Restore a previously deleted practitioner and dependent references atomically.
 */
export const restorePractitionerWithDependencies = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
    snapshot: practitionerDependencySnapshotValidator,
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );
    const now = BigInt(Date.now());

    const existingByLineage = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId_lineageKey", (q) =>
        q
          .eq("ruleSetId", ruleSetId)
          .eq("lineageKey", args.snapshot.practitioner.lineageKey),
      )
      .first();
    const restoredPractitionerId =
      existingByLineage?._id ??
      (await insertSelfLineageEntity(ctx.db, "practitioners", {
        lineageKey: args.snapshot.practitioner.lineageKey,
        name: args.snapshot.practitioner.name,
        practiceId: args.practiceId,
        ruleSetId,
        ...(args.snapshot.practitioner.tags && {
          tags: args.snapshot.practitioner.tags,
        }),
      }));

    if (existingByLineage && isDeletedRuleSetEntity(existingByLineage)) {
      await ctx.db.patch("practitioners", existingByLineage._id, {
        deleted: false,
        name: args.snapshot.practitioner.name,
        tags: args.snapshot.practitioner.tags ?? [],
      });
    }

    for (const schedule of args.snapshot.baseSchedules) {
      const locationInTarget = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", ruleSetId)
            .eq("lineageKey", schedule.locationLineageKey),
        )
        .first();

      if (locationInTarget?.practiceId !== args.practiceId) {
        throw new Error(
          `[LINEAGE:LOCATION_NOT_FOUND] Die Arbeitszeit kann nicht wiederhergestellt werden, weil der referenzierte Standort nicht verfügbar ist (locationLineageKey: ${schedule.locationLineageKey}, Regelset: ${ruleSetId}).`,
        );
      }

      const existingScheduleByLineage = await ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", ruleSetId)
            .eq("lineageKey", asBaseScheduleLineageKey(schedule.lineageKey)),
        )
        .first();

      if (existingScheduleByLineage) {
        await ctx.db.patch("baseSchedules", existingScheduleByLineage._id, {
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
          practitionerLineageKey: asPractitionerLineageKey(
            args.snapshot.practitioner.lineageKey,
          ),
          startTime: schedule.startTime,
        });
        continue;
      }

      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        lineageKey: asBaseScheduleLineageKey(schedule.lineageKey),
        locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
        practiceId: args.practiceId,
        practitionerLineageKey: asPractitionerLineageKey(
          args.snapshot.practitioner.lineageKey,
        ),
        ruleSetId,
        startTime: schedule.startTime,
      });
    }

    for (const patch of args.snapshot.appointmentTypePatches) {
      const resolvedAllowedPractitionerLineageKeys =
        new Set<PractitionerLineageKey>([
          asPractitionerLineageKey(args.snapshot.practitioner.lineageKey),
        ]);

      for (const rawPractitionerLineageKey of patch.beforeAllowedPractitionerLineageKeys) {
        const practitionerLineageKey = asPractitionerLineageKey(
          rawPractitionerLineageKey,
        );
        try {
          await validatePractitionerLineageKeysInRuleSet(
            ctx.db,
            [practitionerLineageKey],
            ruleSetId,
          );
          resolvedAllowedPractitionerLineageKeys.add(practitionerLineageKey);
        } catch {
          // Another practitioner reference may have been deleted in a later action.
          // Keep restoring what is still resolvable.
        }
      }

      const restoredAllowedPractitionerLineageKeys = [
        ...resolvedAllowedPractitionerLineageKeys,
      ];

      const existingByLineage = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", patch.lineageKey),
        )
        .first();

      if (patch.action === "delete") {
        const patchName = patch.name;
        if (!patchName) {
          throw new Error(
            "Gelöschte Terminart konnte nicht wiederhergestellt werden (fehlender Name).",
          );
        }
        const patchDuration = patch.duration;
        if (patchDuration === undefined) {
          throw new Error(
            "Gelöschte Terminart konnte nicht wiederhergestellt werden (fehlende Dauer).",
          );
        }

        if (existingByLineage) {
          const mergedAllowedPractitionerLineageKeys = [
            ...new Set<PractitionerLineageKey>([
              ...existingByLineage.allowedPractitionerLineageKeys.map(
                (lineageKey) => asPractitionerLineageKey(lineageKey),
              ),
              ...restoredAllowedPractitionerLineageKeys,
            ]),
          ];
          await ctx.db.patch("appointmentTypes", existingByLineage._id, {
            allowedPractitionerLineageKeys:
              mergedAllowedPractitionerLineageKeys,
            duration: patchDuration,
            lastModified: now,
            name: patchName,
          });
          continue;
        }

        await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
          allowedPractitionerLineageKeys:
            restoredAllowedPractitionerLineageKeys,
          createdAt: now,
          duration: patchDuration,
          lastModified: now,
          lineageKey: patch.lineageKey,
          name: patchName,
          practiceId: args.practiceId,
          ruleSetId,
        });
        continue;
      }

      if (!existingByLineage) {
        throw new Error(
          `[LINEAGE:APPOINTMENT_TYPE_NOT_FOUND] Terminart mit lineageKey ${patch.lineageKey} kann nicht wiederhergestellt werden (Regelset ${ruleSetId}).`,
        );
      }

      const mergedAllowedPractitionerLineageKeys = [
        ...new Set<PractitionerLineageKey>([
          ...existingByLineage.allowedPractitionerLineageKeys.map(
            (lineageKey) => asPractitionerLineageKey(lineageKey),
          ),
          ...restoredAllowedPractitionerLineageKeys,
        ]),
      ];

      await ctx.db.patch("appointmentTypes", existingByLineage._id, {
        allowedPractitionerLineageKeys: mergedAllowedPractitionerLineageKeys,
        lastModified: now,
      });
    }

    for (const patch of args.snapshot.practitionerConditionPatches) {
      const condition = await ctx.db.get("ruleConditions", patch.conditionId);
      if (condition?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Regelbedingungen wurden zwischenzeitlich geändert und können nicht wiederhergestellt werden.",
        );
      }

      await ctx.db.patch("ruleConditions", condition._id, {
        lastModified: now,
        valueIds: patch.beforeValueIds,
      });
    }

    for (const simulationAppointmentId of args.snapshot
      .reassignmentSimulationIds) {
      const simulationAppointment = await ctx.db.get(
        "appointments",
        simulationAppointmentId,
      );
      if (
        simulationAppointment?.simulationRuleSetId !== ruleSetId ||
        !isActivationBoundSimulation(simulationAppointment)
      ) {
        continue;
      }

      await ctx.db.delete("appointments", simulationAppointmentId);
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return {
      draftRevision,
      restoredPractitionerId,
      ruleSetId,
    };
  },
  returns: restorePractitionerWithDependenciesResultValidator,
});

/**
 * Get all practitioners for a rule set
 */
export const getPractitioners = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return practitioners
      .filter(
        (practitioner) =>
          args.includeDeleted === true || !isDeletedRuleSetEntity(practitioner),
      )
      .map((practitioner) => ({
        ...practitioner,
        lineageKey: requirePractitionerLineageKey(practitioner),
      }));
  },
});

// ================================
// LOCATIONS
// ================================

/**
 * Create a new location in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createLocation = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("locations")),
    name: v.string(),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .collect();

    if (existing.some((location) => !isDeletedRuleSetEntity(location))) {
      throw new Error(
        "Location with this name already exists in this rule set",
      );
    }

    if (args.lineageKey) {
      const lineageKey = args.lineageKey;
      const existingByLineage = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
        )
        .first();
      if (existingByLineage && !isDeletedRuleSetEntity(existingByLineage)) {
        throw new Error(
          `[LINEAGE:LOCATION_DUPLICATE] Standort mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
      if (existingByLineage) {
        await verifyEntityInUnsavedRuleSet(
          ctx.db,
          existingByLineage.ruleSetId,
          "location",
        );
        await ctx.db.patch("locations", existingByLineage._id, {
          deleted: false,
          name: args.name,
        });

        const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
        return {
          draftRevision,
          entityId: existingByLineage._id,
          ruleSetId,
        };
      }
    }

    // Create the location
    const entityId = await insertSelfLineageEntity(ctx.db, "locations", {
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: locationResultValidator,
});

/**
 * Update a location in an unsaved rule set
 */
export const updateLocation = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    locationId: v.id("locations"),
    name: v.string(),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const locationId = await resolveLocationIdInRuleSet(
      ctx.db,
      args.locationId,
      args.practiceId,
      ruleSetId,
    );
    const location = await ctx.db.get("locations", locationId);
    if (!location) {
      throw new Error(
        `[LINEAGE:LOCATION_NOT_FOUND] Standort ${args.locationId} konnte in Regelset ${ruleSetId} nicht geladen werden.`,
      );
    }

    // Check name uniqueness if changing name
    if (args.name !== location.name) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", args.name),
        )
        .collect();

      if (
        existing.some(
          (candidate) =>
            !isDeletedRuleSetEntity(candidate) &&
            candidate._id !== location._id,
        )
      ) {
        throw new Error(
          "Location with this name already exists in this rule set",
        );
      }
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    // Update the location (use the entity in the unsaved rule set)
    await ctx.db.patch("locations", location._id, { name: args.name });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: location._id, ruleSetId };
  },
  returns: locationResultValidator,
});

/**
 * Delete a location from an unsaved rule set
 */
export const deleteLocation = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    locationId: v.id("locations"),
    locationLineageKey: v.optional(v.id("locations")),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    let location: Doc<"locations"> | null = null;
    try {
      const locationId = await resolveLocationIdInRuleSet(
        ctx.db,
        args.locationId,
        args.practiceId,
        ruleSetId,
      );
      location = await ctx.db.get("locations", locationId);
    } catch {
      const lineageKey = args.locationLineageKey;
      if (lineageKey) {
        const byLineage = await ctx.db
          .query("locations")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
          )
          .first();
        if (byLineage?.practiceId === args.practiceId) {
          location = byLineage;
        }
      }
    }

    if (!location) {
      throw new Error(
        `[LINEAGE:LOCATION_NOT_FOUND] Standort konnte über ID ${args.locationId} und lineageKey ${args.locationLineageKey ?? "n/a"} nicht aufgelöst werden (Regelset ${ruleSetId}).`,
      );
    }
    if (isDeletedRuleSetEntity(location)) {
      throw new Error(
        `[LINEAGE:LOCATION_ALREADY_DELETED] Standort ${location._id} ist in Regelset ${ruleSetId} bereits gelöscht.`,
      );
    }

    // Delete associated base schedules (using the location ID from unsaved rule set)
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", location.ruleSetId))
      .collect()
      .then((records) =>
        records.filter(
          (schedule) =>
            schedule.locationLineageKey === requireLocationLineageKey(location),
        ),
      );

    // SAFETY: Verify all schedules belong to unsaved rule set before deleting
    for (const schedule of schedules) {
      await verifyEntityInUnsavedRuleSet(
        ctx.db,
        schedule.ruleSetId,
        "base schedule",
      );
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    await ctx.db.patch("locations", location._id, {
      deleted: true,
    });

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: location._id, ruleSetId };
  },
  returns: locationResultValidator,
});

/**
 * Get all locations for a rule set
 */
export const getLocations = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return locations
      .filter(
        (location) =>
          args.includeDeleted === true || !isDeletedRuleSetEntity(location),
      )
      .map((location) => ({
        ...location,
        lineageKey: requireLocationLineageKey(location),
      }));
  },
});

// ================================
// BASE SCHEDULES
// ================================

/**
 * Create multiple base schedules in an unsaved rule set in a single mutation.
 * This reduces query invalidations and visible day-by-day UI updates when
 * creating schedules for multiple weekdays at once.
 */
export const createBaseScheduleBatch = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    schedules: v.array(baseScheduleCreatePayloadValidator),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const schedules = args.schedules.map((schedule) =>
      asBaseScheduleCreatePayload(schedule),
    );
    if (schedules.length === 0) {
      throw new Error(
        "[VALIDATION:BASE_SCHEDULE_BATCH_EMPTY] Mindestens eine Arbeitszeit muss uebergeben werden.",
      );
    }

    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const existingSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    const existingScheduleIdsByLineage = new Map<
      Id<"baseSchedules">,
      Id<"baseSchedules">
    >(
      existingSchedules.map((schedule) => [
        requireBaseScheduleLineageKey(schedule),
        schedule._id,
      ]),
    );
    const seenLineageKeys = new Set<Id<"baseSchedules">>();
    const createdScheduleIds: Id<"baseSchedules">[] = [];

    for (const schedule of schedules) {
      await resolvePractitionerIdInRuleSet(
        ctx.db,
        schedule.practitionerLineageId,
        args.practiceId,
        ruleSetId,
      );
      await resolveLocationIdForRuleSet(ctx.db, {
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        targetRuleSetId: ruleSetId,
      });

      if (schedule.lineageKey) {
        const lineageKey = asBaseScheduleLineageKey(schedule.lineageKey);
        if (seenLineageKeys.has(lineageKey)) {
          throw new Error(
            `[LINEAGE:BASE_SCHEDULE_DUPLICATE_IN_BATCH] Arbeitszeit mit lineageKey ${schedule.lineageKey} wurde mehrfach in derselben Batch-Anfrage übergeben.`,
          );
        }
        seenLineageKeys.add(lineageKey);

        if (existingScheduleIdsByLineage.has(lineageKey)) {
          throw new Error(
            `[LINEAGE:BASE_SCHEDULE_DUPLICATE] Arbeitszeit mit lineageKey ${schedule.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
          );
        }
      }

      const createdId = await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        ...(schedule.lineageKey && {
          lineageKey: asBaseScheduleLineageKey(schedule.lineageKey),
        }),
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        practitionerLineageKey: asPractitionerLineageKey(
          schedule.practitionerLineageId,
        ),
        ruleSetId,
        startTime: schedule.startTime,
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
      });

      if (schedule.lineageKey) {
        existingScheduleIdsByLineage.set(
          asBaseScheduleLineageKey(schedule.lineageKey),
          createdId,
        );
      } else {
        existingScheduleIdsByLineage.set(
          asBaseScheduleLineageKey(createdId),
          createdId,
        );
      }

      createdScheduleIds.push(createdId);
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { createdScheduleIds, draftRevision, ruleSetId };
  },
  returns: baseScheduleBatchResultValidator,
});

/**
 * Update a base schedule in an unsaved rule set
 */
export const updateBaseSchedule = mutation({
  args: {
    baseScheduleId: v.id("baseSchedules"),
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.optional(v.number()),
    endTime: v.optional(v.string()),
    expectedDraftRevision: expectedDraftRevisionValidator,
    locationId: v.optional(v.id("locations")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    selectedRuleSetId: v.id("ruleSets"),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const scheduleId = await resolveBaseScheduleIdInRuleSet(
      ctx.db,
      args.baseScheduleId,
      ruleSetId,
    );
    if (!scheduleId) {
      throw new Error(
        `[LINEAGE:BASE_SCHEDULE_NOT_FOUND] Arbeitszeit ${args.baseScheduleId} konnte in Regelset ${ruleSetId} nicht aufgelöst werden.`,
      );
    }

    const schedule = await ctx.db.get("baseSchedules", scheduleId);
    if (!schedule) {
      throw new Error(
        `[LINEAGE:BASE_SCHEDULE_NOT_FOUND] Arbeitszeit ${scheduleId} konnte nach Lineage-Auflösung nicht geladen werden.`,
      );
    }

    const resolvedPractitionerLineageKey =
      args.practitionerId === undefined
        ? undefined
        : await resolvePractitionerLineageKey(
            ctx.db,
            asPractitionerId(
              await resolvePractitionerIdInRuleSet(
                ctx.db,
                args.practitionerId,
                args.practiceId,
                ruleSetId,
              ),
            ),
          );

    const resolvedLocationLineageKey =
      args.locationId === undefined
        ? undefined
        : await resolveLocationLineageKey(
            ctx.db,
            asLocationId(
              await resolveLocationIdInRuleSet(
                ctx.db,
                args.locationId,
                args.practiceId,
                ruleSetId,
              ),
            ),
            {
              allowDeleted: true,
            },
          );

    // Update the schedule (use the entity in the unsaved rule set)
    const updates: Partial<{
      breakTimes: undefined | { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey: PractitionerLineageKey;
      startTime: string;
    }> = {};

    if (args.dayOfWeek !== undefined) {
      updates.dayOfWeek = args.dayOfWeek;
    }
    if (args.startTime !== undefined) {
      updates.startTime = args.startTime;
    }
    if (args.endTime !== undefined) {
      updates.endTime = args.endTime;
    }
    if (resolvedPractitionerLineageKey !== undefined) {
      updates.practitionerLineageKey = resolvedPractitionerLineageKey;
    }
    if (resolvedLocationLineageKey !== undefined) {
      updates.locationLineageKey = resolvedLocationLineageKey;
    }
    if (args.breakTimes !== undefined) {
      updates.breakTimes = args.breakTimes;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      schedule.ruleSetId,
      "base schedule",
    );

    await ctx.db.patch("baseSchedules", schedule._id, updates);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: schedule._id, ruleSetId };
  },
  returns: baseScheduleResultValidator,
});

/**
 * Update a set of base schedules in an unsaved rule set while preserving as
 * many existing lineage keys as possible.
 */
export const updateBaseScheduleSet = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    expectedPresentLineageKeys: v.array(v.id("baseSchedules")),
    practiceId: v.id("practices"),
    schedules: v.array(baseScheduleCreatePayloadValidator),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const schedules = args.schedules.map((schedule) =>
      asBaseScheduleCreatePayload(schedule),
    );
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    if (args.expectedPresentLineageKeys.length === 0) {
      throw new Error(
        "Keine Arbeitszeiten ausgewählt. Die Änderung kann nicht angewendet werden.",
      );
    }

    if (schedules.length === 0) {
      throw new Error(
        "Mindestens eine Arbeitszeit muss für die Aktualisierung angegeben werden.",
      );
    }

    const existingSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const existingSchedulesByLineage = new Map<
      Id<"baseSchedules">,
      Doc<"baseSchedules">
    >();
    for (const schedule of existingSchedules) {
      const lineageKey = await ensureBaseScheduleLineageKeyForWrite(
        ctx.db,
        schedule,
      );
      existingSchedulesByLineage.set(lineageKey, {
        ...schedule,
        lineageKey,
      });
    }

    const expectedLineageSet = new Set(args.expectedPresentLineageKeys);
    const selectedSchedules: Doc<"baseSchedules">[] = [];
    for (const lineageKey of args.expectedPresentLineageKeys) {
      const schedule = existingSchedulesByLineage.get(lineageKey);
      if (!schedule) {
        throw new Error(
          "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher aktualisiert werden.",
        );
      }
      selectedSchedules.push(schedule);
    }

    const explicitDesiredSchedules: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      lineageKey: BaseScheduleLineageKey;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey: PractitionerLineageKey;
      startTime: string;
    }[] = [];
    const implicitDesiredSchedules: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      locationLineageKey: LocationLineageKey;
      practitionerLineageKey: PractitionerLineageKey;
      startTime: string;
    }[] = [];
    const seenExplicitLineages = new Set<BaseScheduleLineageKey>();

    for (const schedule of schedules) {
      await resolvePractitionerIdInRuleSet(
        ctx.db,
        schedule.practitionerLineageId,
        args.practiceId,
        ruleSetId,
      );
      await resolveLocationIdForRuleSet(ctx.db, {
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        targetRuleSetId: ruleSetId,
      });
      const normalized = {
        ...(schedule.breakTimes ? { breakTimes: schedule.breakTimes } : {}),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practitionerLineageKey: asPractitionerLineageKey(
          schedule.practitionerLineageId,
        ),
        startTime: schedule.startTime,
      };

      if (schedule.lineageKey) {
        const lineageKey = asBaseScheduleLineageKey(schedule.lineageKey);
        if (!expectedLineageSet.has(lineageKey)) {
          throw new Error(
            "Die Arbeitszeiten können nicht sicher aktualisiert werden, weil eine unbekannte lineageKey übergeben wurde.",
          );
        }
        if (seenExplicitLineages.has(lineageKey)) {
          throw new Error(
            `[LINEAGE:BASE_SCHEDULE_DUPLICATE_IN_UPDATE] Arbeitszeit mit lineageKey ${schedule.lineageKey} wurde mehrfach in derselben Update-Anfrage übergeben.`,
          );
        }
        seenExplicitLineages.add(lineageKey);
        explicitDesiredSchedules.push({
          ...normalized,
          lineageKey,
        });
      } else {
        implicitDesiredSchedules.push(normalized);
      }
    }

    await verifyEntityInUnsavedRuleSet(ctx.db, ruleSetId, "base schedule");

    const appliedSchedules: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      entityId: Id<"baseSchedules">;
      lineageKey: BaseScheduleLineageKey;
      locationId: Id<"locations">;
      locationLineageKey: LocationLineageKey;
      practitionerId: Id<"practitioners">;
      practitionerLineageKey: PractitionerLineageKey;
      startTime: string;
    }[] = [];
    const createdScheduleIds: Id<"baseSchedules">[] = [];
    const deletedScheduleIds: Id<"baseSchedules">[] = [];
    const consumedLineageKeys = new Set<BaseScheduleLineageKey>();

    for (const desired of explicitDesiredSchedules) {
      const existing = existingSchedulesByLineage.get(desired.lineageKey);
      if (!existing) {
        throw new Error(
          "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher aktualisiert werden.",
        );
      }

      await ctx.db.patch("baseSchedules", existing._id, {
        ...(desired.breakTimes ? { breakTimes: desired.breakTimes } : {}),
        ...(desired.breakTimes === undefined ? { breakTimes: undefined } : {}),
        dayOfWeek: desired.dayOfWeek,
        endTime: desired.endTime,
        locationLineageKey: desired.locationLineageKey,
        practitionerLineageKey: desired.practitionerLineageKey,
        startTime: desired.startTime,
      });

      const displayReferences = await resolveBaseScheduleDisplayReferences({
        db: ctx.db,
        locationLineageKey: desired.locationLineageKey,
        practiceId: args.practiceId,
        practitionerLineageKey: desired.practitionerLineageKey,
        ruleSetId,
      });
      consumedLineageKeys.add(desired.lineageKey);
      appliedSchedules.push({
        ...desired,
        entityId: existing._id,
        ...displayReferences,
      });
    }

    const recyclableSchedules = selectedSchedules.filter(
      (
        schedule,
      ): schedule is Doc<"baseSchedules"> & {
        lineageKey: BaseScheduleLineageKey;
      } => {
        const lineageKey = schedule.lineageKey;
        return (
          lineageKey !== undefined &&
          !consumedLineageKeys.has(asBaseScheduleLineageKey(lineageKey))
        );
      },
    );

    for (const desired of implicitDesiredSchedules) {
      const recycled = recyclableSchedules.shift();
      if (recycled) {
        const lineageKey = recycled.lineageKey;
        await ctx.db.patch("baseSchedules", recycled._id, {
          ...(desired.breakTimes ? { breakTimes: desired.breakTimes } : {}),
          ...(desired.breakTimes === undefined
            ? { breakTimes: undefined }
            : {}),
          dayOfWeek: desired.dayOfWeek,
          endTime: desired.endTime,
          locationLineageKey: desired.locationLineageKey,
          practitionerLineageKey: desired.practitionerLineageKey,
          startTime: desired.startTime,
        });
        const displayReferences = await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: desired.locationLineageKey,
          practiceId: args.practiceId,
          practitionerLineageKey: desired.practitionerLineageKey,
          ruleSetId,
        });
        consumedLineageKeys.add(lineageKey);
        appliedSchedules.push({
          ...desired,
          entityId: recycled._id,
          lineageKey,
          ...displayReferences,
        });
        continue;
      }

      const createdId = await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        ...(desired.breakTimes ? { breakTimes: desired.breakTimes } : {}),
        dayOfWeek: desired.dayOfWeek,
        endTime: desired.endTime,
        locationLineageKey: desired.locationLineageKey,
        practiceId: args.practiceId,
        practitionerLineageKey: desired.practitionerLineageKey,
        ruleSetId,
        startTime: desired.startTime,
      });
      const displayReferences = await resolveBaseScheduleDisplayReferences({
        db: ctx.db,
        locationLineageKey: desired.locationLineageKey,
        practiceId: args.practiceId,
        practitionerLineageKey: desired.practitionerLineageKey,
        ruleSetId,
      });
      createdScheduleIds.push(createdId);
      appliedSchedules.push({
        ...desired,
        entityId: createdId,
        lineageKey: asBaseScheduleLineageKey(createdId),
        ...displayReferences,
      });
    }

    for (const schedule of recyclableSchedules) {
      await ctx.db.delete("baseSchedules", schedule._id);
      deletedScheduleIds.push(schedule._id);
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return {
      appliedSchedules,
      createdScheduleIds,
      deletedScheduleIds,
      draftRevision,
      ruleSetId,
    };
  },
  returns: replaceBaseScheduleSetResultValidator,
});

/**
 * Delete a base schedule from an unsaved rule set
 */
export const deleteBaseSchedule = mutation({
  args: {
    baseScheduleId: v.id("baseSchedules"),
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const scheduleId = await resolveBaseScheduleIdInRuleSet(
      ctx.db,
      args.baseScheduleId,
      ruleSetId,
    );
    if (!scheduleId) {
      throw new Error(
        `[LINEAGE:BASE_SCHEDULE_NOT_FOUND] Arbeitszeit ${args.baseScheduleId} konnte in Regelset ${ruleSetId} nicht aufgelöst werden.`,
      );
    }

    const schedule = await ctx.db.get("baseSchedules", scheduleId);
    if (!schedule) {
      throw new Error(
        `[LINEAGE:BASE_SCHEDULE_NOT_FOUND] Arbeitszeit ${scheduleId} konnte nach Lineage-Auflösung nicht geladen werden.`,
      );
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      schedule.ruleSetId,
      "base schedule",
    );

    await ctx.db.delete("baseSchedules", schedule._id);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: schedule._id, ruleSetId };
  },
  returns: baseScheduleResultValidator,
});

/**
 * Replace a set of base schedules atomically in the unsaved rule set.
 *
 * This is used by undo/redo flows to swap one schedule set with another
 * in a single mutation, reducing partial-state windows.
 */
export const replaceBaseScheduleSet = mutation({
  args: {
    expectedAbsentLineageKeys: v.optional(v.array(v.id("baseSchedules"))),
    expectedDraftRevision: expectedDraftRevisionValidator,
    expectedPresentLineageKeys: v.array(v.id("baseSchedules")),
    practiceId: v.id("practices"),
    replacementSchedules: v.array(baseSchedulePayloadValidator),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const replacementSchedules = args.replacementSchedules.map((schedule) =>
      asBaseSchedulePayload(schedule),
    );
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    if (args.expectedPresentLineageKeys.length === 0) {
      throw new Error(
        "Keine Arbeitszeiten ausgewählt. Die Änderung kann nicht angewendet werden.",
      );
    }

    const existingSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    const existingSchedulesByLineage = new Map<
      Id<"baseSchedules">,
      Doc<"baseSchedules">
    >(
      existingSchedules.map((schedule) => [
        requireBaseScheduleLineageKey(schedule),
        schedule,
      ]),
    );
    const expectedPresentIds: Id<"baseSchedules">[] = [];
    for (const lineageKey of args.expectedPresentLineageKeys) {
      const match = existingSchedulesByLineage.get(lineageKey);
      if (!match) {
        throw new Error(
          "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
        );
      }
      expectedPresentIds.push(match._id);
    }

    const expectedAbsentLineageKeys = new Set(args.expectedAbsentLineageKeys);
    const replacementLineageKeys = new Set(
      replacementSchedules.map((schedule) =>
        asBaseScheduleLineageKey(schedule.lineageKey),
      ),
    );
    const expectedPresentLineageKeySet = new Set(
      args.expectedPresentLineageKeys,
    );
    const presentExpectedLineageKeys = new Set(
      args.expectedPresentLineageKeys.filter((lineageKey) =>
        existingSchedulesByLineage.has(lineageKey),
      ),
    );
    const presentExpectedAbsentLineageKeys = new Set(
      [...expectedAbsentLineageKeys].filter((lineageKey) =>
        existingSchedulesByLineage.has(lineageKey),
      ),
    );

    const allExpectedPresentExist =
      presentExpectedLineageKeys.size === expectedPresentLineageKeySet.size;
    const noExpectedAbsentExist = presentExpectedAbsentLineageKeys.size === 0;
    const targetAlreadyApplied =
      presentExpectedLineageKeys.size === 0 &&
      presentExpectedAbsentLineageKeys.size === replacementLineageKeys.size;

    if (targetAlreadyApplied) {
      const appliedSchedules: {
        breakTimes?: { end: string; start: string }[];
        dayOfWeek: number;
        endTime: string;
        entityId: Id<"baseSchedules">;
        lineageKey: BaseScheduleLineageKey;
        locationId: Id<"locations">;
        locationLineageKey: LocationLineageKey;
        practitionerId: Id<"practitioners">;
        practitionerLineageKey: PractitionerLineageKey;
        startTime: string;
      }[] = [];
      const existingCreatedIds: Id<"baseSchedules">[] = [];
      for (const lineageKey of replacementLineageKeys) {
        const existing = existingSchedulesByLineage.get(lineageKey);
        if (!existing) {
          throw new Error(
            "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
          );
        }
        existingCreatedIds.push(existing._id);
        const displayReferences = await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: asLocationLineageKey(existing.locationLineageKey),
          practiceId: args.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            existing.practitionerLineageKey,
          ),
          ruleSetId,
        });
        appliedSchedules.push({
          ...(existing.breakTimes ? { breakTimes: existing.breakTimes } : {}),
          dayOfWeek: existing.dayOfWeek,
          endTime: existing.endTime,
          entityId: existing._id,
          lineageKey,
          startTime: existing.startTime,
          ...displayReferences,
        });
      }
      const currentDraftRevision = await ctx.db.get("ruleSets", ruleSetId);
      if (!currentDraftRevision) {
        throw new Error(
          `[INVARIANT:RULE_SET_NOT_FOUND] Regelset ${ruleSetId} konnte nicht geladen werden.`,
        );
      }
      return {
        appliedSchedules,
        createdScheduleIds: existingCreatedIds,
        deletedScheduleIds: [],
        draftRevision: currentDraftRevision.draftRevision,
        ruleSetId,
      };
    }

    if (!allExpectedPresentExist || !noExpectedAbsentExist) {
      throw new Error(
        "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
      );
    }

    for (const lineageKey of expectedAbsentLineageKeys) {
      if (existingSchedulesByLineage.has(lineageKey)) {
        throw new Error(
          "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
        );
      }
    }

    await verifyEntityInUnsavedRuleSet(ctx.db, ruleSetId, "base schedule");
    for (const scheduleId of expectedPresentIds) {
      await ctx.db.delete("baseSchedules", scheduleId);
    }

    const appliedSchedules: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      entityId: Id<"baseSchedules">;
      lineageKey: BaseScheduleLineageKey;
      locationId: Id<"locations">;
      locationLineageKey: LocationLineageKey;
      practitionerId: Id<"practitioners">;
      practitionerLineageKey: PractitionerLineageKey;
      startTime: string;
    }[] = [];
    const createdScheduleIds: Id<"baseSchedules">[] = [];
    for (const schedule of replacementSchedules) {
      await resolvePractitionerIdInRuleSet(
        ctx.db,
        schedule.practitionerLineageId,
        args.practiceId,
        ruleSetId,
      );
      await resolveLocationIdForRuleSet(ctx.db, {
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        targetRuleSetId: ruleSetId,
      });

      const lineageKey = asBaseScheduleLineageKey(schedule.lineageKey);
      if (existingSchedulesByLineage.has(lineageKey)) {
        throw new Error(
          "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
        );
      }

      const createdId = await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        lineageKey: asBaseScheduleLineageKey(schedule.lineageKey),
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        practitionerLineageKey: asPractitionerLineageKey(
          schedule.practitionerLineageId,
        ),
        ruleSetId,
        startTime: schedule.startTime,
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
      });
      createdScheduleIds.push(createdId);
      const displayReferences = await resolveBaseScheduleDisplayReferences({
        db: ctx.db,
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        practitionerLineageKey: asPractitionerLineageKey(
          schedule.practitionerLineageId,
        ),
        ruleSetId,
      });
      appliedSchedules.push({
        ...(schedule.breakTimes ? { breakTimes: schedule.breakTimes } : {}),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        entityId: createdId,
        lineageKey,
        startTime: schedule.startTime,
        ...displayReferences,
      });
      existingSchedulesByLineage.set(lineageKey, {
        _creationTime: 0,
        _id: createdId,
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        lineageKey,
        locationLineageKey: asLocationLineageKey(schedule.locationLineageId),
        practiceId: args.practiceId,
        practitionerLineageKey: asPractitionerLineageKey(
          schedule.practitionerLineageId,
        ),
        ruleSetId,
        startTime: schedule.startTime,
      });
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return {
      appliedSchedules,
      createdScheduleIds,
      deletedScheduleIds: expectedPresentIds,
      draftRevision,
      ruleSetId,
    };
  },
  returns: replaceBaseScheduleSetResultValidator,
});

/**
 * Get all base schedules for a rule set
 */
export const getBaseSchedules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);
    if (!ruleSet) {
      throw new Error(
        `[INVARIANT:RULE_SET_NOT_FOUND] Regelset ${args.ruleSetId} konnte nicht geladen werden.`,
      );
    }

    return await Promise.all(
      schedules.map(async (schedule) => ({
        ...schedule,
        ...(await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
          practiceId: schedule.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            schedule.practitionerLineageKey,
          ),
          ruleSetId: args.ruleSetId,
        })),
        lineageKey: requireBaseScheduleLineageKey(schedule),
      })),
    );
  },
});

/**
 * Get base schedules for a specific practitioner
 */
export const getBaseSchedulesByPractitioner = query({
  args: {
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const practitioner = await ctx.db.get("practitioners", args.practitionerId);
    if (!practitioner) {
      throw new Error(`Behandler ${args.practitionerId} nicht gefunden.`);
    }
    const practitionerLineageKey = requirePractitionerLineageKey(practitioner);
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerLineageKey", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("practitionerLineageKey", practitionerLineageKey),
      )
      .collect();

    const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);
    if (!ruleSet) {
      throw new Error(
        `[INVARIANT:RULE_SET_NOT_FOUND] Regelset ${args.ruleSetId} konnte nicht geladen werden.`,
      );
    }

    return await Promise.all(
      schedules.map(async (schedule) => ({
        ...schedule,
        ...(await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
          practiceId: schedule.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            schedule.practitionerLineageKey,
          ),
          ruleSetId: args.ruleSetId,
        })),
        lineageKey: requireBaseScheduleLineageKey(schedule),
      })),
    );
  },
});

// ================================
// RULE CONDITIONS (RULES)
// ================================

// conditionTreeNodeValidator and ConditionTreeNode are imported from ruleEngine.ts
// to avoid duplication and ensure consistency

/**
 * Recursively insert a condition tree node and its children.
 * Returns the ID of the created node.
 */
async function insertConditionTreeNode(
  db: DatabaseWriter,
  node: ConditionTreeNode,
  parentConditionId: Id<"ruleConditions"> | null,
  childOrder: number,
  ruleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Id<"ruleConditions">> {
  const now = BigInt(Date.now());

  if (node.nodeType === "CONDITION") {
    // Validate that lineage-based references resolve inside the target rule set.
    if (node.valueIds && node.valueIds.length > 0) {
      switch (node.conditionType) {
        case "APPOINTMENT_TYPE": {
          await validateAppointmentTypeLineageKeysInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
          );

          break;
        }
        case "CONCURRENT_COUNT":
        case "DAILY_CAPACITY": {
          // For CONCURRENT_COUNT and DAILY_CAPACITY, valueIds contains
          // appointment type lineage keys.
          if (node.valueIds.length > 0) {
            await validateAppointmentTypeLineageKeysInRuleSet(
              db,
              node.valueIds,
              ruleSetId,
            );
          }

          break;
        }
        case "LOCATION": {
          await validateLocationLineageKeysInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
          );

          break;
        }
        case "PRACTITIONER": {
          await validatePractitionerLineageKeysInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
          );

          break;
        }
        // No default
      }
    }

    // Leaf node
    const nodeId = await db.insert("ruleConditions", {
      childOrder,
      conditionType: node.conditionType,
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: "CONDITION",
      operator: node.operator,
      ...(parentConditionId && { parentConditionId }),
      practiceId,
      ruleSetId,
      ...(node.scope && { scope: node.scope }),
      ...(node.valueIds && { valueIds: node.valueIds }),
      ...(node.valueNumber !== undefined && { valueNumber: node.valueNumber }),
    });
    return nodeId;
  } else {
    // Logical operator node (AND/NOT)
    const nodeId = await db.insert("ruleConditions", {
      childOrder,
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: node.nodeType,
      ...(parentConditionId && { parentConditionId }),
      practiceId,
      ruleSetId,
    });

    for (const [i, child] of node.children.entries()) {
      await insertConditionTreeNode(
        db,
        child,
        nodeId,
        i,
        ruleSetId,
        practiceId,
      );
    }

    return nodeId;
  }
}

async function resolveValidatedRuleCopyFromId(
  db: DatabaseReader,
  practiceId: Id<"practices">,
  copyFromId: Id<"ruleConditions">,
): Promise<Id<"ruleConditions">> {
  const sourceRule = await db.get("ruleConditions", copyFromId);
  if (!sourceRule) {
    throw new Error(
      `[INVARIANT:RULE_COPY_SOURCE_NOT_FOUND] Regel ${copyFromId} konnte nicht geladen werden.`,
    );
  }
  if (sourceRule.practiceId !== practiceId) {
    throw new Error(
      `[INVARIANT:RULE_COPY_SOURCE_PRACTICE_MISMATCH] Regel ${copyFromId} gehoert nicht zur Praxis ${practiceId}.`,
    );
  }
  if (!sourceRule.isRoot) {
    throw new Error(
      `[INVARIANT:RULE_COPY_SOURCE_NOT_ROOT] copyFromId ${copyFromId} muss auf eine Wurzelregel zeigen.`,
    );
  }

  return sourceRule.copyFromId ?? sourceRule._id;
}

/**
 * Create a new rule with its condition tree in an unsaved rule set.
 * Returns both the created rule ID and the rule set ID.
 */
export const createRule = mutation({
  args: {
    conditionTree: conditionTreeTransportValidator,
    copyFromId: v.optional(v.id("ruleConditions")),
    enabled: v.optional(v.boolean()),
    expectedDraftRevision: expectedDraftRevisionValidator,
    name: v.string(),
    practiceId: v.id("practices"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    const parsedConditionTree = parseConditionTreeTransport(args.conditionTree);
    const validationErrors = validateConditionTree(parsedConditionTree);
    if (validationErrors.length > 0) {
      throw new Error(`Ungueltiger Regelbaum: ${validationErrors.join("; ")}`);
    }

    const now = BigInt(Date.now());
    const canonicalCopyFromId = args.copyFromId
      ? await resolveValidatedRuleCopyFromId(
          ctx.db,
          args.practiceId,
          args.copyFromId,
        )
      : undefined;

    // Create the root node (the rule itself)
    const rootId = await ctx.db.insert("ruleConditions", {
      childOrder: 0, // Root nodes don't have siblings, but we set this for consistency
      ...(canonicalCopyFromId && { copyFromId: canonicalCopyFromId }),
      createdAt: now,
      enabled: args.enabled ?? true,
      isRoot: true,
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId,
    });

    // Insert the condition tree as the first (and only) child of the root
    await insertConditionTreeNode(
      ctx.db,
      parsedConditionTree,
      rootId,
      0,
      ruleSetId,
      args.practiceId,
    );

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: rootId, ruleSetId };
  },
  returns: ruleResultValidator,
});

/**
 * Recursively delete a condition node and all its children.
 */
async function deleteConditionTreeNode(
  db: DatabaseWriter,
  nodeId: Id<"ruleConditions">,
): Promise<void> {
  // Get all children
  const children = await db
    .query("ruleConditions")
    .withIndex("by_parentConditionId", (q) => q.eq("parentConditionId", nodeId))
    .collect();

  // Recursively delete children first
  for (const child of children) {
    await deleteConditionTreeNode(db, child._id);
  }

  // Delete this node
  await db.delete("ruleConditions", nodeId);
}

/**
 * Delete a rule and its entire condition tree from an unsaved rule set.
 */
export const deleteRule = mutation({
  args: {
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    ruleId: v.id("ruleConditions"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );
    const getCurrentDraftRevision = async (): Promise<number> => {
      const ruleSet = await ctx.db.get("ruleSets", ruleSetId);
      if (!ruleSet) {
        throw new Error(
          `[INVARIANT:RULE_SET_NOT_FOUND] Regelset ${ruleSetId} konnte nicht geladen werden.`,
        );
      }
      return ruleSet.draftRevision;
    };

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("ruleConditions", args.ruleId);
    if (!entity) {
      // Idempotent delete: desired end state (rule absent) already reached.
      const draftRevision = await getCurrentDraftRevision();
      return { draftRevision, entityId: args.ruleId, ruleSetId };
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by copyFromId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      // Find the copy in the unsaved rule set
      const copy = await ctx.db
        .query("ruleConditions")
        .withIndex("by_copyFromId_ruleSetId", (q) =>
          q.eq("copyFromId", args.ruleId).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!copy) {
        // Rule exists in the source ruleset but was already deleted in draft.
        // Treat as idempotent no-op.
        const draftRevision = await getCurrentDraftRevision();
        return { draftRevision, entityId: args.ruleId, ruleSetId };
      }
      rule = copy;
    }

    // Verify it's a root node
    if (!rule.isRoot) {
      throw new Error("Can only delete root rule nodes, not condition nodes");
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(ctx.db, rule.ruleSetId, "rule");

    // Recursively delete the entire tree
    await deleteConditionTreeNode(ctx.db, rule._id);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: rule._id, ruleSetId };
  },
  returns: ruleResultValidator,
});

/**
 * Update a rule's metadata (enabled status) in an unsaved rule set.
 * Does NOT support updating the condition tree - use deleteRule + createRule for that.
 */
export const updateRule = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    expectedDraftRevision: expectedDraftRevisionValidator,
    practiceId: v.id("practices"),
    ruleId: v.id("ruleConditions"),
    selectedRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await resolveDraftRuleSetForMutation(
      ctx.db,
      args.practiceId,
      args.expectedDraftRevision,
      args.selectedRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("ruleConditions", args.ruleId);
    if (!entity) {
      throw new Error("Rule not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by copyFromId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      // Find the copy in the unsaved rule set
      const copy = await ctx.db
        .query("ruleConditions")
        .withIndex("by_copyFromId_ruleSetId", (q) =>
          q.eq("copyFromId", args.ruleId).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!copy) {
        throw new Error(
          "Rule copy not found in unsaved rule set. This should not happen.",
        );
      }
      rule = copy;
    }

    // Verify it's a root node
    if (!rule.isRoot) {
      throw new Error("Can only update root rule nodes, not condition nodes");
    }

    // Build updates object
    const updates: Partial<{
      enabled: boolean;
      lastModified: bigint;
    }> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.enabled !== undefined) {
      updates.enabled = args.enabled;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(ctx.db, rule.ruleSetId, "rule");

    await ctx.db.patch("ruleConditions", rule._id, updates);

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId: rule._id, ruleSetId };
  },
  returns: ruleResultValidator,
});

/**
 * Recursively fetch a condition tree node and its children.
 */
async function fetchConditionTreeNode(
  db: DatabaseReader,
  nodeId: Id<"ruleConditions">,
): Promise<ConditionTreeNode> {
  const node = await db.get("ruleConditions", nodeId);
  if (!node) {
    throw new Error("Condition node not found");
  }

  if (node.nodeType === "CONDITION") {
    if (!node.conditionType || !node.operator) {
      throw new Error(
        "Condition node missing conditionType or operator. Data corruption?",
      );
    }
    return {
      conditionType: node.conditionType,
      nodeType: "CONDITION",
      operator: node.operator,
      ...(node.scope && { scope: node.scope }),
      ...(node.valueIds && { valueIds: node.valueIds }),
      ...(node.valueNumber !== undefined && { valueNumber: node.valueNumber }),
    };
  } else {
    // Logical operator node - fetch children
    if (!node.nodeType) {
      throw new Error("Logical node missing nodeType. Data corruption?");
    }
    const children = await db
      .query("ruleConditions")
      .withIndex("by_parentConditionId_childOrder", (q) =>
        q.eq("parentConditionId", nodeId),
      )
      .collect();

    const childNodes = await Promise.all(
      children.map((child) => fetchConditionTreeNode(db, child._id)),
    );

    return {
      children: childNodes,
      nodeType: node.nodeType,
    };
  }
}

/**
 * Get all rules for a rule set with their denormalized condition trees.
 */
export const getRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    // Get all root nodes (rules)
    const roots = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("isRoot", true),
      )
      .collect();

    // Fetch the condition tree for each rule
    const rules = await Promise.all(
      roots.map(async (root) => {
        // Get the first (and only) child which is the root of the condition tree
        const conditionTreeRoot = await ctx.db
          .query("ruleConditions")
          .withIndex("by_parentConditionId_childOrder", (q) =>
            q.eq("parentConditionId", root._id),
          )
          .first();

        if (!conditionTreeRoot) {
          throw new Error(
            `Rule ${root._id} has no condition tree. This should not happen.`,
          );
        }

        const conditionTree = await fetchConditionTreeNode(
          ctx.db,
          conditionTreeRoot._id,
        );

        return {
          _id: root._id,
          conditionTree,
          copyFromId: root.copyFromId,
          createdAt: root.createdAt,
          enabled: root.enabled ?? true,
          lastModified: root.lastModified,
          practiceId: root.practiceId,
          ruleSetId: root.ruleSetId,
        };
      }),
    );

    return rules;
  },
});

// ================================
// ACTIVE RULE SET QUERIES
// These are convenience queries that fetch from the active rule set using practiceId
// ================================

/**
 * Get practitioners from the active rule set
 */
export const getPractitionersFromActive = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    return practitioners.filter(
      (practitioner) =>
        args.includeDeleted === true || !isDeletedRuleSetEntity(practitioner),
    );
  },
});

/**
 * Get locations from the active rule set
 */
export const getLocationsFromActive = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    return locations.filter(
      (location) =>
        args.includeDeleted === true || !isDeletedRuleSetEntity(location),
    );
  },
});

/**
 * Get base schedules from the active rule set
 */
export const getBaseSchedulesFromActive = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    return await Promise.all(
      schedules.map(async (schedule) => ({
        ...schedule,
        ...(await resolveBaseScheduleDisplayReferences({
          db: ctx.db,
          locationLineageKey: asLocationLineageKey(schedule.locationLineageKey),
          practiceId: schedule.practiceId,
          practitionerLineageKey: asPractitionerLineageKey(
            schedule.practitionerLineageKey,
          ),
          ruleSetId,
        })),
        lineageKey: requireBaseScheduleLineageKey(schedule),
      })),
    );
  },
});

/**
 * Get appointment types from the active rule set
 */
export const getAppointmentTypesFromActive = query({
  args: {
    includeDeleted: v.optional(v.boolean()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    return appointmentTypes.filter(
      (appointmentType) =>
        args.includeDeleted === true ||
        !isDeletedRuleSetEntity(appointmentType),
    );
  },
});
