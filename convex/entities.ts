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

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  bumpDraftRevision,
  type EntityType,
  resolveDraftForWrite,
  validateAppointmentTypeIdsInRuleSet,
  validateLocationIdsInRuleSet,
  validatePractitionerIdsInRuleSet,
  verifyEntityInUnsavedRuleSet,
} from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import {
  type ConditionTreeNode,
  conditionTreeNodeValidator,
  getTypedChildren,
  isLogicalNode,
} from "./ruleEngine";
import { ensureAuthenticatedIdentity } from "./userIdentity";

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

// ================================
// SHARED TYPES
// ================================

const appointmentTypeResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("appointmentTypes"),
  ruleSetId: v.id("ruleSets"),
});

const practitionerResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("practitioners"),
  ruleSetId: v.id("ruleSets"),
});

const locationResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("locations"),
  ruleSetId: v.id("ruleSets"),
});

const baseScheduleResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("baseSchedules"),
  ruleSetId: v.id("ruleSets"),
});

const ruleResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("ruleConditions"),
  ruleSetId: v.id("ruleSets"),
});

const baseSchedulePayloadValidator = v.object({
  breakTimes: v.optional(
    v.array(
      v.object({
        end: v.string(),
        start: v.string(),
      }),
    ),
  ),
  dayOfWeek: v.number(),
  endTime: v.string(),
  locationId: v.id("locations"),
  practitionerId: v.id("practitioners"),
  startTime: v.string(),
});

const replaceBaseScheduleSetResultValidator = v.object({
  createdScheduleIds: v.array(v.id("baseSchedules")),
  deletedScheduleIds: v.array(v.id("baseSchedules")),
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
});

const practitionerBaseScheduleSnapshotValidator = v.object({
  breakTimes: v.optional(
    v.array(
      v.object({
        end: v.string(),
        start: v.string(),
      }),
    ),
  ),
  dayOfWeek: v.number(),
  endTime: v.string(),
  lineageKey: v.id("baseSchedules"),
  locationId: v.id("locations"),
  locationLineageKey: v.id("locations"),
  locationOriginId: v.optional(v.id("locations")),
  startTime: v.string(),
});

const practitionerSnapshotValidator = v.object({
  id: v.id("practitioners"),
  lineageKey: v.id("practitioners"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
});

const practitionerAppointmentTypePatchValidator = v.object({
  action: v.union(v.literal("delete"), v.literal("patch")),
  afterAllowedPractitionerIds: v.array(v.id("practitioners")),
  appointmentTypeId: v.id("appointmentTypes"),
  beforeAllowedPractitionerIds: v.array(v.id("practitioners")),
  duration: v.optional(v.number()),
  lineageKey: v.id("appointmentTypes"),
  name: v.optional(v.string()),
});

const practitionerConditionPatchValidator = v.object({
  afterValueIds: v.array(v.string()),
  beforeValueIds: v.array(v.string()),
  conditionId: v.id("ruleConditions"),
});

const practitionerDependencySnapshotValidator = v.object({
  appointmentTypePatches: v.array(practitionerAppointmentTypePatchValidator),
  baseSchedules: v.array(practitionerBaseScheduleSnapshotValidator),
  practitioner: practitionerSnapshotValidator,
  practitionerConditionPatches: v.array(practitionerConditionPatchValidator),
});

const deletePractitionerWithDependenciesResultValidator = v.object({
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
  snapshot: practitionerDependencySnapshotValidator,
});

const restorePractitionerWithDependenciesResultValidator = v.object({
  draftRevision: v.number(),
  restoredPractitionerId: v.id("practitioners"),
  ruleSetId: v.id("ruleSets"),
});

const expectedDraftRevisionValidator = v.union(v.number(), v.null());

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
): Id<"appointmentTypes"> {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "appointment type",
      ruleSetId: entity.ruleSetId,
    });
  }
  return entity.lineageKey;
}

function requireBaseScheduleLineageKey(
  entity: Pick<Doc<"baseSchedules">, "_id" | "lineageKey" | "ruleSetId">,
): Id<"baseSchedules"> {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "base schedule",
      ruleSetId: entity.ruleSetId,
    });
  }
  return entity.lineageKey;
}

function requireLocationLineageKey(
  entity: Pick<Doc<"locations">, "_id" | "lineageKey" | "ruleSetId">,
): Id<"locations"> {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "location",
      ruleSetId: entity.ruleSetId,
    });
  }
  return entity.lineageKey;
}

function requirePractitionerLineageKey(
  entity: Pick<Doc<"practitioners">, "_id" | "lineageKey" | "ruleSetId">,
): Id<"practitioners"> {
  if (!entity.lineageKey) {
    throw missingLineageKeyError({
      entityId: entity._id,
      entityType: "practitioner",
      ruleSetId: entity.ruleSetId,
    });
  }
  return entity.lineageKey;
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
    throw new Error(
      `[LINEAGE:PRACTITIONER_SOURCE_NOT_FOUND] Behandler ${practitionerId} konnte nicht geladen werden. ` +
        "Die Änderung referenziert vermutlich eine veraltete ID oder einen nicht mehr verfügbaren Herkunftsdatensatz.",
    );
  }
  if (practitionerEntity.practiceId !== practiceId) {
    throw new Error("Practitioner does not belong to this practice");
  }

  if (practitionerEntity.ruleSetId === ruleSetId) {
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

  return practitionerCopy;
}

/**
 * Resolve practitioner IDs to their unsaved rule set versions.
 * Validates that practitioners exist, belong to the practice, and resolves them
 * to their copies in the unsaved rule set.
 * @throws Error if practitionerIds is undefined, empty, or contains invalid practitioners
 * @returns Array of resolved practitioner IDs (never undefined when practitioners are required)
 */
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required: true,
): Promise<Id<"practitioners">[]>;
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required?: false,
): Promise<Id<"practitioners">[] | undefined>;
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required = false,
): Promise<Id<"practitioners">[] | undefined> {
  if (!practitionerIds) {
    if (required) {
      throw new Error("At least one practitioner must be selected");
    }
    return undefined;
  }

  // Validate at least one practitioner is provided when required
  if (required && practitionerIds.length === 0) {
    throw new Error("At least one practitioner must be selected");
  }

  const seen = new Set<Id<"practitioners">>();
  const resolved: Id<"practitioners">[] = [];

  for (const practitionerId of practitionerIds) {
    const resolvedPractitionerId = await resolvePractitionerIdInRuleSet(
      db,
      practitionerId,
      practiceId,
      ruleSetId,
    );

    if (!seen.has(resolvedPractitionerId)) {
      seen.add(resolvedPractitionerId);
      resolved.push(resolvedPractitionerId);
    }
  }

  return resolved;
}

const APPOINTMENT_TYPE_RULE_CONDITION_TYPES = new Set([
  "APPOINTMENT_TYPE",
  "CONCURRENT_COUNT",
  "DAILY_CAPACITY",
]);

async function remapConditionValueIdsInRuleSet(params: {
  db: DatabaseWriter;
  fromId: string;
  ruleSetId: Id<"ruleSets">;
  toId: string;
}): Promise<void> {
  const { db, fromId, ruleSetId, toId } = params;
  if (fromId === toId) {
    return;
  }

  const conditions = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .collect();

  for (const condition of conditions) {
    if (
      !condition.conditionType ||
      !condition.valueIds ||
      !APPOINTMENT_TYPE_RULE_CONDITION_TYPES.has(condition.conditionType)
    ) {
      continue;
    }

    if (!condition.valueIds.includes(fromId)) {
      continue;
    }

    const remappedValueIds: string[] = [];
    const seen = new Set<string>();
    for (const valueId of condition.valueIds) {
      const nextValueId = valueId === fromId ? toId : valueId;
      if (seen.has(nextValueId)) {
        continue;
      }
      seen.add(nextValueId);
      remappedValueIds.push(nextValueId);
    }

    await db.patch("ruleConditions", condition._id, {
      lastModified: BigInt(Date.now()),
      valueIds: remappedValueIds,
    });
  }
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
    lineageKey: v.optional(v.id("appointmentTypes")),
    name: v.string(),
    practiceId: v.id("practices"),
    practitionerIds: v.array(v.id("practitioners")), // Required: at least one practitioner
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

    const allowedPractitionerIds = await resolvePractitionerIds(
      ctx.db,
      args.practitionerIds,
      args.practiceId,
      ruleSetId,
      true, // Required: at least one practitioner
    );

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
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
      if (existingByLineage) {
        throw new Error(
          `[LINEAGE:APPOINTMENT_TYPE_DUPLICATE] Terminart mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
    }

    // Create the appointment type
    const entityId = await ctx.db.insert("appointmentTypes", {
      allowedPractitionerIds,
      createdAt: BigInt(Date.now()),
      duration: args.duration,
      lastModified: BigInt(Date.now()),
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    if (args.lineageKey) {
      await remapConditionValueIdsInRuleSet({
        db: ctx.db,
        fromId: args.lineageKey,
        ruleSetId,
        toId: entityId,
      });
    } else {
      await ctx.db.patch("appointmentTypes", entityId, {
        lineageKey: entityId,
      });
    }

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
        .first();

      if (existing) {
        throw new Error(
          "Appointment type with this name already exists in this rule set",
        );
      }
    }

    // Build updates object
    const updates: Partial<{
      allowedPractitionerIds: Id<"practitioners">[];
      duration: number;
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
      // Use the shared helper with required=true to validate at least one practitioner
      const resolved = await resolvePractitionerIds(
        ctx.db,
        args.practitionerIds,
        args.practiceId,
        ruleSetId,
        true, // Required: at least one practitioner
      );
      updates.allowedPractitionerIds = resolved;
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

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      appointmentType.ruleSetId,
      "appointment type",
    );

    const appointmentTypeLineageKey =
      requireAppointmentTypeLineageKey(appointmentType);
    await remapConditionValueIdsInRuleSet({
      db: ctx.db,
      fromId: appointmentType._id,
      ruleSetId,
      toId: appointmentTypeLineageKey,
    });

    await ctx.db.delete("appointmentTypes", appointmentType._id);

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
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return appointmentTypes.map((appointmentType) => ({
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
      .first();

    if (existing) {
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
      if (existingByLineage) {
        throw new Error(
          `[LINEAGE:PRACTITIONER_DUPLICATE] Behandler mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
    }

    // Create the practitioner
    const entityId = await ctx.db.insert("practitioners", {
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
      ...(args.tags && { tags: args.tags }),
    });

    if (!args.lineageKey) {
      await ctx.db.patch("practitioners", entityId, { lineageKey: entityId });
    }

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
        .first();

      if (existing) {
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
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("practitionerId", practitioner._id),
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

    await ctx.db.delete("practitioners", practitioner._id);

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

    const practitionerIdAsString = practitioner._id as string;
    const now = BigInt(Date.now());

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("practitionerId", practitioner._id),
      )
      .collect();

    const locationsInRuleSet = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    const locationById = new Map(
      locationsInRuleSet.map((location) => [location._id, location]),
    );

    const baseScheduleSnapshots = baseSchedules.map((schedule) => {
      const location = locationById.get(schedule.locationId);
      if (!location) {
        throw new Error(
          `[INVARIANT:LOCATION_MISSING] Standort ${schedule.locationId} der Arbeitszeit ${schedule._id} fehlt im Regelset ${ruleSetId}.`,
        );
      }

      return {
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        lineageKey: requireBaseScheduleLineageKey(schedule),
        locationId: schedule.locationId,
        locationLineageKey: requireLocationLineageKey(location),
        locationOriginId: location.parentId ?? schedule.locationId,
        startTime: schedule.startTime,
      };
    });

    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const appointmentTypePatches: {
      action: "delete" | "patch";
      afterAllowedPractitionerIds: Id<"practitioners">[];
      appointmentTypeId: Id<"appointmentTypes">;
      beforeAllowedPractitionerIds: Id<"practitioners">[];
      duration?: number;
      lineageKey: Id<"appointmentTypes">;
      name?: string;
    }[] = appointmentTypes
      .filter((appointmentType) =>
        appointmentType.allowedPractitionerIds.includes(practitioner._id),
      )
      .map((appointmentType) => {
        const afterAllowedPractitionerIds =
          appointmentType.allowedPractitionerIds.filter(
            (id) => id !== practitioner._id,
          );
        const action: "delete" | "patch" = "patch";

        return {
          action,
          afterAllowedPractitionerIds,
          appointmentTypeId: appointmentType._id,
          beforeAllowedPractitionerIds: appointmentType.allowedPractitionerIds,
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
        allowedPractitionerIds: patch.afterAllowedPractitionerIds,
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
      if (!beforeValueIds.includes(practitionerIdAsString)) {
        return [];
      }

      const afterValueIds = beforeValueIds.filter(
        (valueId) => valueId !== practitionerIdAsString,
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

    await ctx.db.delete("practitioners", practitioner._id);

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
    const previousPractitionerId = args.snapshot.practitioner.id;
    const previousPractitionerIdAsString = previousPractitionerId as string;

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
      (await ctx.db.insert("practitioners", {
        lineageKey: args.snapshot.practitioner.lineageKey,
        name: args.snapshot.practitioner.name,
        practiceId: args.practiceId,
        ruleSetId,
        ...(args.snapshot.practitioner.tags && {
          tags: args.snapshot.practitioner.tags,
        }),
      }));

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
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", schedule.lineageKey),
        )
        .first();

      if (existingScheduleByLineage) {
        await ctx.db.patch("baseSchedules", existingScheduleByLineage._id, {
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          locationId: locationInTarget._id,
          practitionerId: restoredPractitionerId,
          startTime: schedule.startTime,
        });
        continue;
      }

      await ctx.db.insert("baseSchedules", {
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        lineageKey: schedule.lineageKey,
        locationId: locationInTarget._id,
        practiceId: args.practiceId,
        practitionerId: restoredPractitionerId,
        ruleSetId,
        startTime: schedule.startTime,
      });
    }

    for (const patch of args.snapshot.appointmentTypePatches) {
      const resolvedAllowedPractitionerIds = new Set<Id<"practitioners">>([
        restoredPractitionerId,
      ]);

      for (const practitionerId of patch.beforeAllowedPractitionerIds) {
        if (practitionerId === previousPractitionerId) {
          continue;
        }

        const existingPractitioner = await ctx.db.get(
          "practitioners",
          practitionerId,
        );
        if (
          existingPractitioner?.practiceId === args.practiceId &&
          existingPractitioner.ruleSetId === ruleSetId
        ) {
          resolvedAllowedPractitionerIds.add(existingPractitioner._id);
          continue;
        }

        try {
          const remappedPractitionerId = await resolvePractitionerIdInRuleSet(
            ctx.db,
            practitionerId,
            args.practiceId,
            ruleSetId,
          );
          resolvedAllowedPractitionerIds.add(remappedPractitionerId);
        } catch {
          // Another practitioner reference may have been deleted in a later action.
          // Keep restoring what is still resolvable.
        }
      }

      const restoredAllowedPractitionerIds = [
        ...resolvedAllowedPractitionerIds,
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
          const mergedAllowedPractitionerIds = [
            ...new Set<Id<"practitioners">>([
              ...existingByLineage.allowedPractitionerIds,
              ...restoredAllowedPractitionerIds,
            ]),
          ];
          await ctx.db.patch("appointmentTypes", existingByLineage._id, {
            allowedPractitionerIds: mergedAllowedPractitionerIds,
            duration: patchDuration,
            lastModified: now,
            name: patchName,
          });
          continue;
        }

        await ctx.db.insert("appointmentTypes", {
          allowedPractitionerIds: restoredAllowedPractitionerIds,
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

      const mergedAllowedPractitionerIds = [
        ...new Set<Id<"practitioners">>([
          ...existingByLineage.allowedPractitionerIds,
          ...restoredAllowedPractitionerIds,
        ]),
      ];

      await ctx.db.patch("appointmentTypes", existingByLineage._id, {
        allowedPractitionerIds: mergedAllowedPractitionerIds,
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

      const restoredValueIds = patch.beforeValueIds.map((valueId) =>
        valueId === previousPractitionerIdAsString
          ? (restoredPractitionerId as string)
          : valueId,
      );

      await ctx.db.patch("ruleConditions", condition._id, {
        lastModified: now,
        valueIds: restoredValueIds,
      });
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
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return practitioners.map((practitioner) => ({
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
      .first();

    if (existing) {
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
      if (existingByLineage) {
        throw new Error(
          `[LINEAGE:LOCATION_DUPLICATE] Standort mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
    }

    // Create the location
    const entityId = await ctx.db.insert("locations", {
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    if (!args.lineageKey) {
      await ctx.db.patch("locations", entityId, { lineageKey: entityId });
    }

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
        .first();

      if (existing) {
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

    // Delete associated base schedules (using the location ID from unsaved rule set)
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_locationId", (q) => q.eq("locationId", location._id))
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
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    await ctx.db.delete("locations", location._id);

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
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return locations.map((location) => ({
      ...location,
      lineageKey: requireLocationLineageKey(location),
    }));
  },
});

// ================================
// BASE SCHEDULES
// ================================

/**
 * Create a new base schedule in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createBaseSchedule = mutation({
  args: {
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.number(),
    endTime: v.string(),
    expectedDraftRevision: expectedDraftRevisionValidator,
    lineageKey: v.optional(v.id("baseSchedules")),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    selectedRuleSetId: v.id("ruleSets"),
    startTime: v.string(),
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

    const practitionerId = await resolvePractitionerIdInRuleSet(
      ctx.db,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );
    const locationId = await resolveLocationIdInRuleSet(
      ctx.db,
      args.locationId,
      args.practiceId,
      ruleSetId,
    );

    if (args.lineageKey) {
      const lineageKey = args.lineageKey;
      const existingByLineage = await ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
        )
        .first();
      if (existingByLineage) {
        throw new Error(
          `[LINEAGE:BASE_SCHEDULE_DUPLICATE] Arbeitszeit mit lineageKey ${args.lineageKey} existiert bereits in Regelset ${ruleSetId}.`,
        );
      }
    }

    // Create the base schedule with IDs from unsaved rule set
    const entityId = await ctx.db.insert("baseSchedules", {
      dayOfWeek: args.dayOfWeek,
      endTime: args.endTime,
      ...(args.lineageKey && { lineageKey: args.lineageKey }),
      locationId,
      practiceId: args.practiceId,
      practitionerId,
      ruleSetId,
      startTime: args.startTime,
      ...(args.breakTimes && { breakTimes: args.breakTimes }),
    });

    if (!args.lineageKey) {
      await ctx.db.patch("baseSchedules", entityId, { lineageKey: entityId });
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return { draftRevision, entityId, ruleSetId };
  },
  returns: baseScheduleResultValidator,
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

    const resolvedPractitionerId =
      args.practitionerId === undefined
        ? undefined
        : await resolvePractitionerIdInRuleSet(
            ctx.db,
            args.practitionerId,
            args.practiceId,
            ruleSetId,
          );

    const resolvedLocationId =
      args.locationId === undefined
        ? undefined
        : await resolveLocationIdInRuleSet(
            ctx.db,
            args.locationId,
            args.practiceId,
            ruleSetId,
          );

    // Update the schedule (use the entity in the unsaved rule set)
    const updates: Partial<{
      breakTimes: undefined | { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      locationId: typeof args.locationId;
      practitionerId: typeof args.practitionerId;
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
    if (resolvedPractitionerId !== undefined) {
      updates.practitionerId = resolvedPractitionerId;
    }
    if (resolvedLocationId !== undefined) {
      updates.locationId = resolvedLocationId;
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
    expectedAbsentIds: v.optional(v.array(v.id("baseSchedules"))),
    expectedDraftRevision: expectedDraftRevisionValidator,
    expectedPresentIds: v.array(v.id("baseSchedules")),
    practiceId: v.id("practices"),
    replacementSchedules: v.array(baseSchedulePayloadValidator),
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

    if (args.expectedPresentIds.length === 0) {
      throw new Error(
        "Keine Arbeitszeiten ausgewählt. Die Änderung kann nicht angewendet werden.",
      );
    }

    const resolvedExpectedPresentIds = await Promise.all(
      args.expectedPresentIds.map((id) =>
        resolveBaseScheduleIdInRuleSet(ctx.db, id, ruleSetId),
      ),
    );
    const expectedPresentIds = [
      ...new Set(
        resolvedExpectedPresentIds.filter(
          (id): id is Id<"baseSchedules"> => id !== null,
        ),
      ),
    ];

    if (expectedPresentIds.length !== args.expectedPresentIds.length) {
      throw new Error(
        "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
      );
    }

    const resolvedExpectedAbsentIds = await Promise.all(
      (args.expectedAbsentIds ?? []).map((id) =>
        resolveBaseScheduleIdInRuleSet(ctx.db, id, ruleSetId),
      ),
    );
    const expectedAbsentIds = [
      ...new Set(
        resolvedExpectedAbsentIds.filter(
          (id): id is Id<"baseSchedules"> => id !== null,
        ),
      ),
    ];

    const expectedPresentSet = new Set(expectedPresentIds);
    if (expectedAbsentIds.some((id) => expectedPresentSet.has(id))) {
      throw new Error(
        "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
      );
    }

    for (const absentId of expectedAbsentIds) {
      const existing = await ctx.db.get("baseSchedules", absentId);
      if (existing?.ruleSetId === ruleSetId) {
        throw new Error(
          "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
        );
      }
    }

    for (const presentId of expectedPresentIds) {
      const existing = await ctx.db.get("baseSchedules", presentId);
      if (existing?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
        );
      }
    }

    for (const scheduleId of expectedPresentIds) {
      await verifyEntityInUnsavedRuleSet(ctx.db, ruleSetId, "base schedule");
      await ctx.db.delete("baseSchedules", scheduleId);
    }

    const createdScheduleIds: Id<"baseSchedules">[] = [];
    for (const schedule of args.replacementSchedules) {
      const practitionerId = await resolvePractitionerIdInRuleSet(
        ctx.db,
        schedule.practitionerId,
        args.practiceId,
        ruleSetId,
      );
      const locationId = await resolveLocationIdInRuleSet(
        ctx.db,
        schedule.locationId,
        args.practiceId,
        ruleSetId,
      );

      const createdId = await ctx.db.insert("baseSchedules", {
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        locationId,
        practiceId: args.practiceId,
        practitionerId,
        ruleSetId,
        startTime: schedule.startTime,
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
      });
      await ctx.db.patch("baseSchedules", createdId, { lineageKey: createdId });
      createdScheduleIds.push(createdId);
    }

    const draftRevision = await finalizeDraftMutation(ctx.db, ruleSetId);
    return {
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

    return schedules.map((schedule) => ({
      ...schedule,
      lineageKey: requireBaseScheduleLineageKey(schedule),
    }));
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
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("practitionerId", args.practitionerId),
      )
      .collect();

    return schedules.map((schedule) => ({
      ...schedule,
      lineageKey: requireBaseScheduleLineageKey(schedule),
    }));
  },
});

// ================================
// RULE CONDITIONS (RULES)
// ================================

// conditionTreeNodeValidator and ConditionTreeNode are imported from ruleEngine.ts
// to avoid duplication and ensure consistency

/**
 * Recursively remap entity IDs in a condition tree from source rule set to target rule set.
 * This is needed when the UI passes entity IDs from a different rule set than the target.
 */
async function remapConditionTreeEntityIds(
  db: DatabaseReader,
  node: ConditionTreeNode,
  targetRuleSetId: Id<"ruleSets">,
): Promise<ConditionTreeNode> {
  if (node.nodeType === "CONDITION") {
    if (!node.valueIds || node.valueIds.length === 0) {
      return node;
    }

    const remappedIds: string[] = [];
    for (const rawId of node.valueIds) {
      if (
        node.conditionType === "APPOINTMENT_TYPE" ||
        node.conditionType === "CONCURRENT_COUNT" ||
        node.conditionType === "DAILY_CAPACITY"
      ) {
        const sourceEntity = await db.get(
          "appointmentTypes",
          rawId as Id<"appointmentTypes">,
        );
        if (!sourceEntity) {
          throw new Error(
            `[LINEAGE:APPOINTMENT_TYPE_SOURCE_NOT_FOUND] Terminart ${rawId} konnte nicht geladen werden.`,
          );
        }
        const lineageKey = requireAppointmentTypeLineageKey(sourceEntity);
        const targetEntity = await db
          .query("appointmentTypes")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
          )
          .first();
        if (!targetEntity) {
          throw new Error(
            `[LINEAGE:APPOINTMENT_TYPE_NOT_FOUND] Terminart mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${targetRuleSetId} nicht gefunden.`,
          );
        }
        remappedIds.push(targetEntity._id);
        continue;
      }

      if (node.conditionType === "PRACTITIONER") {
        const sourceEntity = await db.get(
          "practitioners",
          rawId as Id<"practitioners">,
        );
        if (!sourceEntity) {
          throw new Error(
            `[LINEAGE:PRACTITIONER_SOURCE_NOT_FOUND] Behandler ${rawId} konnte nicht geladen werden.`,
          );
        }
        const lineageKey = requirePractitionerLineageKey(sourceEntity);
        const targetEntity = await db
          .query("practitioners")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
          )
          .first();
        if (!targetEntity) {
          throw new Error(
            `[LINEAGE:PRACTITIONER_NOT_FOUND] Behandler mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${targetRuleSetId} nicht gefunden.`,
          );
        }
        remappedIds.push(targetEntity._id);
        continue;
      }

      if (node.conditionType === "LOCATION") {
        const sourceEntity = await db.get(
          "locations",
          rawId as Id<"locations">,
        );
        if (!sourceEntity) {
          throw new Error(
            `[LINEAGE:LOCATION_SOURCE_NOT_FOUND] Standort ${rawId} konnte nicht geladen werden.`,
          );
        }
        const lineageKey = requireLocationLineageKey(sourceEntity);
        const targetEntity = await db
          .query("locations")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
          )
          .first();
        if (!targetEntity) {
          throw new Error(
            `[LINEAGE:LOCATION_NOT_FOUND] Standort mit lineageKey ${lineageKey} wurde im Ziel-Regelset ${targetRuleSetId} nicht gefunden.`,
          );
        }
        remappedIds.push(targetEntity._id);
      }
    }

    return {
      ...node,
      valueIds: remappedIds,
    };
  }

  if (isLogicalNode(node)) {
    const typedChildren = getTypedChildren(node);
    const remappedChildren: ConditionTreeNode[] = [];
    for (const child of typedChildren) {
      const remappedChild = await remapConditionTreeEntityIds(
        db,
        child,
        targetRuleSetId,
      );
      remappedChildren.push(remappedChild);
    }

    return {
      ...node,
      children: remappedChildren,
    };
  }

  return node;
}

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
    // Validate that any referenced entity IDs belong to the correct rule set
    if (node.valueIds && node.valueIds.length > 0) {
      switch (node.conditionType) {
        case "APPOINTMENT_TYPE": {
          await validateAppointmentTypeIdsInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
          );

          break;
        }
        case "CONCURRENT_COUNT":
        case "DAILY_CAPACITY": {
          // For CONCURRENT_COUNT and DAILY_CAPACITY, valueIds contains appointment type IDs
          // (scope is now a separate field)
          if (node.valueIds.length > 0) {
            await validateAppointmentTypeIdsInRuleSet(
              db,
              node.valueIds,
              ruleSetId,
            );
          }

          break;
        }
        case "LOCATION": {
          await validateLocationIdsInRuleSet(db, node.valueIds, ruleSetId);

          break;
        }
        case "PRACTITIONER": {
          await validatePractitionerIdsInRuleSet(db, node.valueIds, ruleSetId);

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

    // Recursively insert children (getTypedChildren validates all children exist)
    const typedChildren = getTypedChildren(node);
    for (const [i, child] of typedChildren.entries()) {
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

/**
 * Create a new rule with its condition tree in an unsaved rule set.
 * Returns both the created rule ID and the rule set ID.
 */
export const createRule = mutation({
  args: {
    conditionTree: conditionTreeNodeValidator,
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

    // Remap entity IDs in the condition tree if the source and target rule sets differ
    // This handles the case where the UI passes entity IDs from the source rule set
    // but we need to use entity IDs from the target (unsaved) rule set
    const remappedConditionTree = await remapConditionTreeEntityIds(
      ctx.db,
      args.conditionTree,
      ruleSetId,
    );

    const now = BigInt(Date.now());

    // Create the root node (the rule itself)
    const rootId = await ctx.db.insert("ruleConditions", {
      childOrder: 0, // Root nodes don't have siblings, but we set this for consistency
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
      remappedConditionTree,
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
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      rule.ruleSetId,
      "rule" as EntityType,
    );

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
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      rule.ruleSetId,
      "rule" as EntityType,
    );

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
    return await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});

/**
 * Get locations from the active rule set
 */
export const getLocationsFromActive = query({
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
    return await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
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
    return await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});

/**
 * Get appointment types from the active rule set
 */
export const getAppointmentTypesFromActive = query({
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
    return await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});
