/**
 * Core Copy-on-Write Infrastructure
 *
 * This module provides a generic, type-safe copy-on-write system for entities
 * that are versioned per rule set (appointmentTypes, practitioners, locations, baseSchedules).
 *
 * Key principles:
 * 1. All modifications go through an "unsaved" rule set (saved=false)
 * 2. The unsaved rule set is created by copying from a source rule set
 * 3. Only unsaved rule sets can be modified
 * 4. When ready, the unsaved rule set can be "saved" (saved=true)
 */

import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";

import { recordRuleSetActivation } from "./activeRuleSets";
import { asMfaId, asMfaLineageKey, type MfaId, toTableId } from "./identity";
import { insertSelfLineageEntity, requireLineageKey } from "./lineage";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

// Entity type union for type safety
export type EntityType =
  | "appointment type"
  | "base schedule"
  | "location"
  | "mfa"
  | "practitioner"
  | "rule"
  | "rule condition";
type RuleConditionReferenceTable =
  | "appointmentTypes"
  | "locations"
  | "practitioners";

// ================================
// VALIDATION HELPERS
// ================================

/**
 * Validates that a rule set exists and belongs to the specified practice.
 */
export async function validateRuleSet(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Doc<"ruleSets">> {
  const ruleSet = await db.get("ruleSets", ruleSetId);

  if (!ruleSet) {
    throw new Error("Rule set not found");
  }

  if (ruleSet.practiceId !== practiceId) {
    throw new Error("Rule set does not belong to this practice");
  }

  return ruleSet;
}

/**
 * Ensures that a rule set is unsaved (saved=false) before allowing modifications.
 */
export async function ensureUnsavedRuleSet(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
): Promise<Doc<"ruleSets">> {
  const ruleSet = await db.get("ruleSets", ruleSetId);

  if (!ruleSet) {
    throw new Error("Rule set not found");
  }

  if (ruleSet.saved) {
    throw new Error(
      "Cannot modify a saved rule set. Create an unsaved copy first using createUnsavedRuleSet.",
    );
  }

  return ruleSet;
}

/**
 * Verifies that an entity belongs to an unsaved rule set before allowing modifications.
 * This is a critical safety check to prevent accidentally modifying saved rule sets.
 */
export async function verifyEntityInUnsavedRuleSet(
  db: DatabaseReader,
  entityRuleSetId: Id<"ruleSets">,
  entityType: EntityType,
): Promise<void> {
  const ruleSet = await db.get("ruleSets", entityRuleSetId);

  if (!ruleSet) {
    throw new Error(
      `Rule set not found for ${entityType}. This should not happen.`,
    );
  }

  if (ruleSet.saved) {
    throw new Error(
      `Cannot modify ${entityType}: it belongs to a saved rule set (saved=true). ` +
        `This is a safety violation - entities in saved rule sets must never be modified.`,
    );
  }
}

/**
 * Checks if an unsaved rule set already exists for a practice.
 */
export async function findUnsavedRuleSet(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Doc<"ruleSets"> | null> {
  return await db
    .query("ruleSets")
    .withIndex("by_practiceId_saved", (q) =>
      q.eq("practiceId", practiceId).eq("saved", false),
    )
    .first();
}

/**
 * Creates an initial saved rule set for a brand new practice.
 * This should be called when a practice is first created.
 *
 * The rule set will be:
 * - Saved (saved=true)
 * - Activated for the practice
 * - Version 1 with no parent versions (it's the root)
 * - Empty (no entities yet).
 */
export async function createInitialRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  // Create the initial saved rule set
  const ruleSetId = await db.insert("ruleSets", {
    createdAt: Date.now(),
    description: "Initiale Konfiguration",
    draftRevision: 0,
    // No parentVersion - this is the root
    practiceId,
    saved: true,
    version: 1,
  });

  await recordRuleSetActivation(db, { practiceId, ruleSetId });

  return ruleSetId;
}

/**
 * Gets the unsaved rule set for a practice, or creates one if it doesn't exist.
 * Creates by copying from the active rule set.
 *
 * This is the core function for transparent copy-on-write behavior.
 */
export async function bumpDraftRevision(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<number> {
  const ruleSet = await db.get("ruleSets", ruleSetId);
  if (!ruleSet) {
    throw new Error(`[COW:DRAFT_NOT_FOUND] Draft-Regelset ${ruleSetId} fehlt.`);
  }
  if (ruleSet.saved) {
    throw new Error(
      `[COW:DRAFT_EXPECTED] Regelset ${ruleSetId} ist gespeichert und darf keine Draft-Revision erhöhen.`,
    );
  }
  const nextRevision = ruleSet.draftRevision + 1;
  await db.patch("ruleSets", ruleSetId, { draftRevision: nextRevision });
  return nextRevision;
}

export async function createDraftRuleSetFromSource(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
  sourceRuleSet: Doc<"ruleSets">,
): Promise<Id<"ruleSets">> {
  // Create new unsaved rule set
  const newVersion = sourceRuleSet.version + 1;
  const newRuleSetId = await db.insert("ruleSets", {
    createdAt: Date.now(),
    description: "Ungespeicherte Änderungen",
    draftRevision: 0,
    parentVersion: sourceRuleSet._id, // Single parent reference
    practiceId,
    saved: false,
    version: newVersion,
  });

  // Copy all entities atomically
  await copyAllEntities(db, sourceRuleSet._id, newRuleSetId, practiceId);

  return newRuleSetId;
}

export async function getOrCreateUnsavedRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
  sourceRuleSetId: Id<"ruleSets">,
): Promise<Id<"ruleSets">> {
  // Check if unsaved already exists
  const existing = await findUnsavedRuleSet(db, practiceId);
  if (existing) {
    return existing._id;
  }

  // Get source rule set to copy from
  const sourceRuleSet = await db.get("ruleSets", sourceRuleSetId);
  if (!sourceRuleSet) {
    throw new Error("Source rule set not found");
  }
  if (sourceRuleSet.practiceId !== practiceId) {
    throw new Error("Source rule set does not belong to this practice");
  }

  return await createDraftRuleSetFromSource(db, practiceId, sourceRuleSet);
}

// ================================
// ENTITY COPYING
// ================================

/**
 * Copy all appointment types from source to target rule set.
 */
export async function copyAppointmentTypes(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Map<Id<"appointmentTypes">, Id<"appointmentTypes">>> {
  const sourceTypes = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<Id<"appointmentTypes">, Id<"appointmentTypes">>();

  for (const sourceType of sourceTypes) {
    const newId = await insertSelfLineageEntity(db, "appointmentTypes", {
      allowedPractitionerLineageKeys: sourceType.allowedPractitionerLineageKeys,
      createdAt: sourceType.createdAt,
      duration: sourceType.duration,
      ...(sourceType.followUpPlan && { followUpPlan: sourceType.followUpPlan }),
      lastModified: BigInt(Date.now()),
      lineageKey: requireLineageKey({
        entityId: sourceType._id,
        entityType: "appointment type",
        lineageKey: sourceType.lineageKey,
        ruleSetId: sourceType.ruleSetId,
      }),
      name: sourceType.name,
      parentId: sourceType._id, // Track which entity this was copied from
      practiceId,
      ruleSetId: targetRuleSetId,
    });

    idMap.set(sourceType._id, newId);
  }

  return idMap;
}

/**
 * Copy all practitioners from source to target rule set.
 */
export async function copyPractitioners(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Map<Id<"practitioners">, Id<"practitioners">>> {
  const sourcePractitioners = await db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<Id<"practitioners">, Id<"practitioners">>();

  for (const source of sourcePractitioners) {
    const newId = await insertSelfLineageEntity(db, "practitioners", {
      lineageKey: requireLineageKey({
        entityId: source._id,
        entityType: "practitioner",
        lineageKey: source.lineageKey,
        ruleSetId: source.ruleSetId,
      }),
      name: source.name,
      parentId: source._id, // Track which entity this was copied from
      practiceId,
      ruleSetId: targetRuleSetId,
      ...(source.tags && { tags: source.tags }),
    });

    idMap.set(source._id, newId);
  }

  return idMap;
}

/**
 * Copy all MFAs from source to target rule set.
 */
export async function copyMfas(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Map<MfaId, MfaId>> {
  const sourceMfas = await db
    .query("mfas")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<MfaId, MfaId>();

  for (const source of sourceMfas) {
    const lineageKey = requireLineageKey({
      entityId: source._id,
      entityType: "mfa",
      lineageKey: source.lineageKey,
      ruleSetId: source.ruleSetId,
    });
    const newId = asMfaId(
      await insertSelfLineageEntity(db, "mfas", {
        createdAt: source.createdAt,
        lineageKey: asMfaLineageKey(lineageKey),
        name: source.name,
        parentId: source._id,
        practiceId,
        ruleSetId: targetRuleSetId,
      }),
    );

    idMap.set(asMfaId(source._id), newId);
  }

  return idMap;
}

/**
 * Copy all locations from source to target rule set.
 */
export async function copyLocations(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Map<Id<"locations">, Id<"locations">>> {
  const sourceLocations = await db
    .query("locations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<Id<"locations">, Id<"locations">>();

  for (const source of sourceLocations) {
    const newId = await insertSelfLineageEntity(db, "locations", {
      lineageKey: requireLineageKey({
        entityId: source._id,
        entityType: "location",
        lineageKey: source.lineageKey,
        ruleSetId: source.ruleSetId,
      }),
      name: source.name,
      parentId: source._id, // Track which entity this was copied from
      practiceId,
      ruleSetId: targetRuleSetId,
    });

    idMap.set(source._id, newId);
  }

  return idMap;
}

/**
 * Copy all base schedules from source to target rule set.
 * Requires ID mappings for practitioners and locations.
 */
export async function copyBaseSchedules(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<void> {
  const sourceSchedules = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const source of sourceSchedules) {
    await insertSelfLineageEntity(db, "baseSchedules", {
      dayOfWeek: source.dayOfWeek,
      endTime: source.endTime,
      lineageKey: requireLineageKey({
        entityId: source._id,
        entityType: "base schedule",
        lineageKey: source.lineageKey,
        ruleSetId: source.ruleSetId,
      }),
      locationLineageKey: source.locationLineageKey,
      parentId: source._id, // Track which entity this was copied from
      practiceId,
      practitionerLineageKey: source.practitionerLineageKey,
      ruleSetId: targetRuleSetId,
      startTime: source.startTime,
      ...(source.breakTimes && { breakTimes: source.breakTimes }),
    });
  }
}

/**
 * Copy all vacations from source to target rule set.
 */
export async function copyVacations(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<void> {
  const sourceVacations = await db
    .query("vacations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const source of sourceVacations) {
    await insertSelfLineageEntity(db, "vacations", {
      createdAt: source.createdAt,
      date: source.date,
      lineageKey: requireLineageKey({
        entityId: source._id,
        entityType: "vacation",
        lineageKey: source.lineageKey,
        ruleSetId: source.ruleSetId,
      }),
      ...(source.mfaLineageKey ? { mfaLineageKey: source.mfaLineageKey } : {}),
      portion: source.portion,
      practiceId,
      ...(source.practitionerLineageKey
        ? { practitionerLineageKey: source.practitionerLineageKey }
        : {}),
      ruleSetId: targetRuleSetId,
      staffType: source.staffType,
    });
  }
}

/**
 * Recursively copy a condition node and all its children.
 * Returns the ID of the newly created node.
 */
async function copyConditionNode(
  db: DatabaseWriter,
  sourceNode: Doc<"ruleConditions">,
  targetRuleSetId: Id<"ruleSets">,
  targetParentId: Id<"ruleConditions"> | null,
  practiceId: Id<"practices">,
): Promise<Id<"ruleConditions">> {
  // Build the insert object with explicit isRoot field
  const insertData: {
    childOrder: number;
    conditionType?:
      | "APPOINTMENT_TYPE"
      | "CLIENT_TYPE"
      | "CONCURRENT_COUNT"
      | "DAILY_CAPACITY"
      | "DATE_RANGE"
      | "DAY_OF_WEEK"
      | "DAYS_AHEAD"
      | "HOURS_AHEAD"
      | "LOCATION"
      | "PATIENT_AGE"
      | "PRACTITIONER"
      | "PRACTITIONER_TAG"
      | "TIME_RANGE";
    copyFromId: Id<"ruleConditions">;
    createdAt: bigint;
    enabled?: boolean;
    isRoot: boolean;
    lastModified: bigint;
    nodeType?: "AND" | "CONDITION" | "NOT";
    operator?:
      | "EQUALS"
      | "GREATER_THAN_OR_EQUAL"
      | "IS"
      | "IS_NOT"
      | "LESS_THAN"
      | "LESS_THAN_OR_EQUAL";
    parentConditionId?: Id<"ruleConditions">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
    scope?: "location" | "practice" | "practitioner";
    valueIds?: string[];
    valueNumber?: number;
  } = {
    childOrder: sourceNode.childOrder,
    copyFromId: sourceNode._id,
    createdAt: BigInt(Date.now()),
    isRoot: sourceNode.isRoot,
    lastModified: BigInt(Date.now()),
    practiceId,
    ruleSetId: targetRuleSetId,
  };

  if (targetParentId !== null) {
    insertData.parentConditionId = targetParentId;
  }

  if (sourceNode.isRoot && sourceNode.enabled !== undefined) {
    insertData.enabled = sourceNode.enabled;
  }

  if (!sourceNode.isRoot && sourceNode.nodeType) {
    insertData.nodeType = sourceNode.nodeType;
  }

  if (sourceNode.nodeType === "CONDITION") {
    if (sourceNode.conditionType) {
      insertData.conditionType = sourceNode.conditionType;
    }
    if (sourceNode.operator) {
      insertData.operator = sourceNode.operator;
    }
    if (sourceNode.scope) {
      insertData.scope = sourceNode.scope;
    }
    if (sourceNode.valueIds) {
      insertData.valueIds = sourceNode.valueIds;
    }
    if (sourceNode.valueNumber !== undefined) {
      insertData.valueNumber = sourceNode.valueNumber;
    }
  }

  const newNodeId = await db.insert("ruleConditions", insertData);

  // Recursively copy all children
  const children = await db
    .query("ruleConditions")
    .withIndex("by_parentConditionId_childOrder", (q) =>
      q.eq("parentConditionId", sourceNode._id),
    )
    .collect();

  for (const child of children) {
    await copyConditionNode(db, child, targetRuleSetId, newNodeId, practiceId);
  }

  return newNodeId;
}
/**
 * Copy all rule conditions (rules and their condition trees) from source rule set to target rule set.
 * Rule conditions store stable lineage keys for versioned entity references, so
 * copying the tree is a structural clone with no rule-set-specific ID remapping.
 */
export async function copyRuleConditions(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<void> {
  // Find all root conditions (rules) in the source rule set
  const rootConditions = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId_isRoot", (q) =>
      q.eq("ruleSetId", sourceRuleSetId).eq("isRoot", true),
    )
    .collect();

  // Copy each rule tree
  for (const root of rootConditions) {
    await copyConditionNode(
      db,
      root,
      targetRuleSetId,
      null, // Root nodes have no parent
      practiceId,
    );
  }
}

/**
 * Copy all entities from source rule set to target rule set.
 * This is the main atomic operation that ensures all entities are copied together.
 */
export async function copyAllEntities(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<void> {
  // Copy entities and get ID mappings
  await copyPractitioners(db, sourceRuleSetId, targetRuleSetId, practiceId);
  await copyAppointmentTypes(db, sourceRuleSetId, targetRuleSetId, practiceId);
  await copyLocations(db, sourceRuleSetId, targetRuleSetId, practiceId);
  await copyMfas(db, sourceRuleSetId, targetRuleSetId, practiceId);

  await copyBaseSchedules(db, sourceRuleSetId, targetRuleSetId, practiceId);
  await copyVacations(db, sourceRuleSetId, targetRuleSetId, practiceId);

  // Copy rule conditions with mapped IDs
  await copyRuleConditions(db, sourceRuleSetId, targetRuleSetId, practiceId);
}

// ================================
// VALIDATION HELPERS FOR ENTITY REFERENCES
// ================================

/**
 * Validates that an entity ID belongs to the specified rule set.
 * @throws Error if the entity doesn't exist or doesn't belong to the expected rule set
 */
function validateEntityInRuleSetError(
  entityType: string,
  id: string,
  actualRuleSetId: Id<"ruleSets">,
  expectedRuleSetId: Id<"ruleSets">,
): Error {
  return new Error(
    `${entityType} with ID ${id} belongs to rule set ${actualRuleSetId}, ` +
      `but expected rule set ${expectedRuleSetId}. ` +
      `This is a copy-on-write safety violation - when creating or updating entities ` +
      `in a new rule set, all referenced entities must also belong to that rule set. ` +
      `This bug typically occurs when IDs are not properly remapped during copy-on-write operations.`,
  );
}

/**
 * Validates that a list of appointment type IDs all belong to the specified rule set.
 */
export async function validateAppointmentTypeIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityIdsInRuleSet({
    db,
    entityIds,
    expectedRuleSetId,
    tableName: "appointmentTypes",
  });
}

/**
 * Validates that a list of location IDs all belong to the specified rule set.
 */
export async function validateLocationIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityIdsInRuleSet({
    db,
    entityIds,
    expectedRuleSetId,
    tableName: "locations",
  });
}

/**
 * Validates that a list of practitioner IDs all belong to the specified rule set.
 */
export async function validatePractitionerIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityIdsInRuleSet({
    db,
    entityIds,
    expectedRuleSetId,
    tableName: "practitioners",
  });
}

async function validateEntityIdsInRuleSet(params: {
  db: DatabaseReader;
  entityIds: readonly string[];
  expectedRuleSetId: Id<"ruleSets">;
  tableName: RuleConditionReferenceTable;
}): Promise<void> {
  for (const rawId of params.entityIds) {
    switch (params.tableName) {
      case "appointmentTypes": {
        const entity = await params.db.get(
          "appointmentTypes",
          toTableId<"appointmentTypes">(rawId),
        );
        if (!entity) {
          throw new Error(
            `appointmentTypes with ID ${rawId} not found. ` +
              `This indicates the entity was deleted or the ID is invalid.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `appointmentTypes with ID ${rawId} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        if (entity.ruleSetId !== params.expectedRuleSetId) {
          throw validateEntityInRuleSetError(
            "appointmentTypes",
            rawId,
            entity.ruleSetId,
            params.expectedRuleSetId,
          );
        }
        break;
      }
      case "locations": {
        const entity = await params.db.get(
          "locations",
          toTableId<"locations">(rawId),
        );
        if (!entity) {
          throw new Error(
            `locations with ID ${rawId} not found. ` +
              `This indicates the entity was deleted or the ID is invalid.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `locations with ID ${rawId} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        if (entity.ruleSetId !== params.expectedRuleSetId) {
          throw validateEntityInRuleSetError(
            "locations",
            rawId,
            entity.ruleSetId,
            params.expectedRuleSetId,
          );
        }
        break;
      }
      case "practitioners": {
        const entity = await params.db.get(
          "practitioners",
          toTableId<"practitioners">(rawId),
        );
        if (!entity) {
          throw new Error(
            `practitioners with ID ${rawId} not found. ` +
              `This indicates the entity was deleted or the ID is invalid.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `practitioners with ID ${rawId} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        if (entity.ruleSetId !== params.expectedRuleSetId) {
          throw validateEntityInRuleSetError(
            "practitioners",
            rawId,
            entity.ruleSetId,
            params.expectedRuleSetId,
          );
        }
        break;
      }
    }
  }
}

/**
 * Validates that appointment type lineage keys exist in the specified rule set.
 */
export async function validateAppointmentTypeLineageKeysInRuleSet(
  db: DatabaseReader,
  lineageKeys: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityLineageKeysInRuleSet({
    db,
    expectedRuleSetId,
    lineageKeys,
    tableName: "appointmentTypes",
  });
}

/**
 * Validates that location lineage keys exist in the specified rule set.
 */
export async function validateLocationLineageKeysInRuleSet(
  db: DatabaseReader,
  lineageKeys: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityLineageKeysInRuleSet({
    db,
    expectedRuleSetId,
    lineageKeys,
    tableName: "locations",
  });
}

/**
 * Validates that practitioner lineage keys exist in the specified rule set.
 */
export async function validatePractitionerLineageKeysInRuleSet(
  db: DatabaseReader,
  lineageKeys: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  await validateEntityLineageKeysInRuleSet({
    db,
    expectedRuleSetId,
    lineageKeys,
    tableName: "practitioners",
  });
}

// ================================
// ENTITY ID MAPPING HELPERS
// ================================

async function validateEntityLineageKeysInRuleSet(params: {
  db: DatabaseReader;
  expectedRuleSetId: Id<"ruleSets">;
  lineageKeys: readonly string[];
  tableName: RuleConditionReferenceTable;
}): Promise<void> {
  for (const rawLineageKey of params.lineageKeys) {
    switch (params.tableName) {
      case "appointmentTypes": {
        const entity = await params.db
          .query("appointmentTypes")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q
              .eq("ruleSetId", params.expectedRuleSetId)
              .eq("lineageKey", toTableId<"appointmentTypes">(rawLineageKey)),
          )
          .first();
        if (!entity) {
          throw new Error(
            `appointmentTypes with lineageKey ${rawLineageKey} not found in rule set ${params.expectedRuleSetId}.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `appointmentTypes with lineageKey ${rawLineageKey} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        break;
      }
      case "locations": {
        const entity = await params.db
          .query("locations")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q
              .eq("ruleSetId", params.expectedRuleSetId)
              .eq("lineageKey", toTableId<"locations">(rawLineageKey)),
          )
          .first();
        if (!entity) {
          throw new Error(
            `locations with lineageKey ${rawLineageKey} not found in rule set ${params.expectedRuleSetId}.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `locations with lineageKey ${rawLineageKey} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        break;
      }
      case "practitioners": {
        const entity = await params.db
          .query("practitioners")
          .withIndex("by_ruleSetId_lineageKey", (q) =>
            q
              .eq("ruleSetId", params.expectedRuleSetId)
              .eq("lineageKey", toTableId<"practitioners">(rawLineageKey)),
          )
          .first();
        if (!entity) {
          throw new Error(
            `practitioners with lineageKey ${rawLineageKey} not found in rule set ${params.expectedRuleSetId}.`,
          );
        }
        if (isRuleSetEntityDeleted(entity)) {
          throw new Error(
            `practitioners with lineageKey ${rawLineageKey} was soft-deleted and can no longer be referenced for writes.`,
          );
        }
        break;
      }
    }
  }
}

/**
 * Maps entity IDs from a source rule set to a target rule set by following parent/child relationships.
 * This is useful for displaying simulation data (from a different rule set) in the context of
 * the active rule set.
 *
 * The function works bidirectionally:
 * - If sourceRuleSetId is an ancestor of targetRuleSetId, it maps children to source.
 * - If targetRuleSetId is an ancestor of sourceRuleSetId, it maps parents to target.
 * - If they're on different branches, returns empty map.
 * @param db Database reader.
 * @param sourceRuleSetId The rule set ID we're mapping FROM.
 * @param targetRuleSetId The rule set ID we're mapping TO.
 * @param table The entity table to map.
 * @returns Map of source entity ID to target entity ID.
 */
export function mapEntityIdsBetweenRuleSets(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: "appointmentTypes",
): Promise<Map<Id<"appointmentTypes">, Id<"appointmentTypes">>>;
export function mapEntityIdsBetweenRuleSets(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: "baseSchedules",
): Promise<Map<Id<"baseSchedules">, Id<"baseSchedules">>>;
export function mapEntityIdsBetweenRuleSets(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: "locations",
): Promise<Map<Id<"locations">, Id<"locations">>>;
export function mapEntityIdsBetweenRuleSets(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: "practitioners",
): Promise<Map<Id<"practitioners">, Id<"practitioners">>>;
export async function mapEntityIdsBetweenRuleSets(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: "appointmentTypes" | "baseSchedules" | "locations" | "practitioners",
): Promise<
  | Map<Id<"appointmentTypes">, Id<"appointmentTypes">>
  | Map<Id<"baseSchedules">, Id<"baseSchedules">>
  | Map<Id<"locations">, Id<"locations">>
  | Map<Id<"practitioners">, Id<"practitioners">>
> {
  const emptyMapping = new Map();

  // If rule sets are the same, no mapping needed
  if (sourceRuleSetId === targetRuleSetId) {
    return emptyMapping;
  }

  // Dispatch to table-specific implementation
  switch (table) {
    case "appointmentTypes": {
      return await mapAppointmentTypeIds(db, sourceRuleSetId, targetRuleSetId);
    }
    case "baseSchedules": {
      return await mapBaseScheduleIds(db, sourceRuleSetId, targetRuleSetId);
    }
    case "locations": {
      return await mapLocationIds(db, sourceRuleSetId, targetRuleSetId);
    }
    case "practitioners": {
      return await mapPractitionerIds(db, sourceRuleSetId, targetRuleSetId);
    }
    default: {
      return emptyMapping;
    }
  }
}

/**
 * Maps appointment type IDs between rule sets.
 */
async function mapAppointmentTypeIds(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Map<Id<"appointmentTypes">, Id<"appointmentTypes">>> {
  const mapping = new Map<Id<"appointmentTypes">, Id<"appointmentTypes">>();

  const sourceEntities = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const sourceEntity of sourceEntities) {
    const targetEntity = await findCorrespondingAppointmentType(
      db,
      sourceEntity,
      targetRuleSetId,
    );
    if (targetEntity) {
      mapping.set(sourceEntity._id, targetEntity._id);
    }
  }

  return mapping;
}

/**
 * Maps location IDs between rule sets.
 */
async function mapLocationIds(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Map<Id<"locations">, Id<"locations">>> {
  const mapping = new Map<Id<"locations">, Id<"locations">>();

  const sourceEntities = await db
    .query("locations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const sourceEntity of sourceEntities) {
    const targetEntity = await findCorrespondingLocation(
      db,
      sourceEntity,
      targetRuleSetId,
    );
    if (targetEntity) {
      mapping.set(sourceEntity._id, targetEntity._id);
    }
  }

  return mapping;
}

/**
 * Maps practitioner IDs between rule sets.
 */
async function mapPractitionerIds(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Map<Id<"practitioners">, Id<"practitioners">>> {
  const mapping = new Map<Id<"practitioners">, Id<"practitioners">>();

  const sourceEntities = await db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const sourceEntity of sourceEntities) {
    const targetEntity = await findCorrespondingPractitioner(
      db,
      sourceEntity,
      targetRuleSetId,
    );
    if (targetEntity) {
      mapping.set(sourceEntity._id, targetEntity._id);
    }
  }

  return mapping;
}

/**
 * Maps base schedule IDs between rule sets.
 */
async function mapBaseScheduleIds(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Map<Id<"baseSchedules">, Id<"baseSchedules">>> {
  const mapping = new Map<Id<"baseSchedules">, Id<"baseSchedules">>();

  const sourceEntities = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const sourceEntity of sourceEntities) {
    const targetEntity = await findCorrespondingBaseSchedule(
      db,
      sourceEntity,
      targetRuleSetId,
    );
    if (targetEntity) {
      mapping.set(sourceEntity._id, targetEntity._id);
    }
  }

  return mapping;
}

/**
 * Finds the corresponding appointment type in a target rule set.
 */
async function findCorrespondingAppointmentType(
  db: DatabaseReader,
  sourceEntity: Doc<"appointmentTypes">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"appointmentTypes"> | null> {
  const lineageKey = requireLineageKey({
    entityId: sourceEntity._id,
    entityType: "appointment type",
    lineageKey: sourceEntity.lineageKey,
    ruleSetId: sourceEntity.ruleSetId,
  });

  return await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}

/**
 * Finds the corresponding location in a target rule set.
 */
async function findCorrespondingLocation(
  db: DatabaseReader,
  sourceEntity: Doc<"locations">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"locations"> | null> {
  const lineageKey = requireLineageKey({
    entityId: sourceEntity._id,
    entityType: "location",
    lineageKey: sourceEntity.lineageKey,
    ruleSetId: sourceEntity.ruleSetId,
  });

  return await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}

/**
 * Finds the corresponding practitioner in a target rule set.
 */
async function findCorrespondingPractitioner(
  db: DatabaseReader,
  sourceEntity: Doc<"practitioners">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"practitioners"> | null> {
  const lineageKey = requireLineageKey({
    entityId: sourceEntity._id,
    entityType: "practitioner",
    lineageKey: sourceEntity.lineageKey,
    ruleSetId: sourceEntity.ruleSetId,
  });

  return await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}

/**
 * Finds the corresponding base schedule in a target rule set.
 */
async function findCorrespondingBaseSchedule(
  db: DatabaseReader,
  sourceEntity: Doc<"baseSchedules">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"baseSchedules"> | null> {
  const lineageKey = requireLineageKey({
    entityId: sourceEntity._id,
    entityType: "base schedule",
    lineageKey: sourceEntity.lineageKey,
    ruleSetId: sourceEntity.ruleSetId,
  });

  return await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", targetRuleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}
