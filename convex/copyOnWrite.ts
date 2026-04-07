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

function requireLineageKey<T extends string>(params: {
  entityId: string;
  entityType:
    | "appointment type"
    | "base schedule"
    | "location"
    | "practitioner";
  lineageKey: T | undefined;
  ruleSetId: Id<"ruleSets">;
}): T {
  if (!params.lineageKey) {
    throw new Error(
      `[INVARIANT:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entityId} in Regelset ${params.ruleSetId} hat keinen lineageKey.`,
    );
  }
  return params.lineageKey;
}

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
 * - Set as the active rule set for the practice
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

  // Set it as the active rule set
  await db.patch("practices", practiceId, {
    currentActiveRuleSetId: ruleSetId,
  });

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

  return await createUnsavedRuleSetFromSource(db, practiceId, sourceRuleSet);
}

export async function resolveDraftForWrite(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
  expectedDraftRevision: null | number,
  selectedRuleSetId: Id<"ruleSets">,
): Promise<{ draftRevision: number; ruleSetId: Id<"ruleSets"> }> {
  const existingUnsavedRuleSet = await findUnsavedRuleSet(db, practiceId);
  if (existingUnsavedRuleSet) {
    const actualRevision = existingUnsavedRuleSet.draftRevision;
    if (expectedDraftRevision !== actualRevision) {
      throw revisionMismatchError({
        actual: actualRevision,
        expected: expectedDraftRevision,
        ruleSetId: existingUnsavedRuleSet._id,
      });
    }
    return {
      draftRevision: actualRevision,
      ruleSetId: existingUnsavedRuleSet._id,
    };
  }

  if (expectedDraftRevision !== null) {
    throw revisionMismatchError({
      actual: null,
      expected: expectedDraftRevision,
      ruleSetId: null,
    });
  }

  const sourceRuleSet = await db.get("ruleSets", selectedRuleSetId);
  if (sourceRuleSet?.practiceId !== practiceId) {
    throw new Error(
      `[COW:SELECTED_RULE_SET_NOT_FOUND] Gewaehltes Regelset ${selectedRuleSetId} der Praxis ${practiceId} konnte nicht geladen werden.`,
    );
  }
  if (!sourceRuleSet.saved) {
    throw new Error(
      `[COW:SELECTED_RULE_SET_MUST_BE_SAVED] Gewaehltes Regelset ${selectedRuleSetId} ist kein gespeichertes Regelset und kann nicht als Draft-Quelle verwendet werden.`,
    );
  }

  const ruleSetId = await createUnsavedRuleSetFromSource(
    db,
    practiceId,
    sourceRuleSet,
  );
  return {
    draftRevision: 0,
    ruleSetId,
  };
}

async function createUnsavedRuleSetFromSource(
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

function revisionMismatchError(params: {
  actual: null | number;
  expected: null | number;
  ruleSetId: Id<"ruleSets"> | null;
}): Error {
  return new Error(
    `[HISTORY:REVISION_MISMATCH] expected=${params.expected ?? "null"} actual=${params.actual ?? "null"} ruleSet=${params.ruleSetId ?? "null"}`,
  );
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
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
): Promise<Map<Id<"appointmentTypes">, Id<"appointmentTypes">>> {
  const sourceTypes = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<Id<"appointmentTypes">, Id<"appointmentTypes">>();

  for (const sourceType of sourceTypes) {
    // Map practitioner IDs to their new versions in the target rule set
    const allowedPractitionerIds: Id<"practitioners">[] = [];

    for (const practitionerId of sourceType.allowedPractitionerIds) {
      const newId = practitionerIdMap.get(practitionerId);
      if (!newId) {
        throw new Error(
          `Failed to copy appointment type "${sourceType.name}": ` +
            `Practitioner ID ${practitionerId} not found in mapping. ` +
            `This indicates data corruption - all practitioners should have been copied.`,
        );
      }
      allowedPractitionerIds.push(newId);
    }

    const newId = await db.insert("appointmentTypes", {
      allowedPractitionerIds,
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
    const newId = await db.insert("practitioners", {
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
): Promise<Map<Id<"mfas">, Id<"mfas">>> {
  const sourceMfas = await db
    .query("mfas")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  const idMap = new Map<Id<"mfas">, Id<"mfas">>();

  for (const source of sourceMfas) {
    const lineageKey = source.lineageKey ?? source._id;
    const newId = await db.insert("mfas", {
      createdAt: source.createdAt,
      lineageKey,
      name: source.name,
      parentId: source._id,
      practiceId,
      ruleSetId: targetRuleSetId,
    });

    idMap.set(source._id, newId);
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
    const newId = await db.insert("locations", {
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
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  locationIdMap: Map<Id<"locations">, Id<"locations">>,
): Promise<void> {
  const sourceSchedules = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const source of sourceSchedules) {
    const newPractitionerId = practitionerIdMap.get(source.practitionerId);
    if (!newPractitionerId) {
      throw new Error(
        `Failed to copy base schedule: ` +
          `Practitioner ID ${source.practitionerId} not found in mapping. ` +
          `This indicates data corruption - all practitioners should have been copied.`,
      );
    }

    const newLocationId = locationIdMap.get(source.locationId);
    if (!newLocationId) {
      throw new Error(
        `Failed to copy base schedule: ` +
          `Location ID ${source.locationId} not found in mapping. ` +
          `This indicates data corruption - all locations should have been copied.`,
      );
    }

    await db.insert("baseSchedules", {
      dayOfWeek: source.dayOfWeek,
      endTime: source.endTime,
      lineageKey: requireLineageKey({
        entityId: source._id,
        entityType: "base schedule",
        lineageKey: source.lineageKey,
        ruleSetId: source.ruleSetId,
      }),
      locationId: newLocationId,
      parentId: source._id, // Track which entity this was copied from
      practiceId,
      practitionerId: newPractitionerId,
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
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  mfaIdMap: Map<Id<"mfas">, Id<"mfas">>,
): Promise<void> {
  const sourceVacations = await db
    .query("vacations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const source of sourceVacations) {
    let practitionerId: Id<"practitioners"> | undefined;
    let mfaId: Id<"mfas"> | undefined;

    if (source.staffType === "practitioner") {
      if (!source.practitionerId) {
        throw new Error(
          `Failed to copy vacation ${source._id}: missing practitionerId.`,
        );
      }
      practitionerId = practitionerIdMap.get(source.practitionerId);
      if (!practitionerId) {
        throw new Error(
          `Failed to copy vacation ${source._id}: practitioner ${source.practitionerId} not found in mapping.`,
        );
      }
    } else {
      if (!source.mfaId) {
        throw new Error(
          `Failed to copy vacation ${source._id}: missing mfaId.`,
        );
      }
      mfaId = mfaIdMap.get(source.mfaId);
      if (!mfaId) {
        throw new Error(
          `Failed to copy vacation ${source._id}: MFA ${source.mfaId} not found in mapping.`,
        );
      }
    }

    await db.insert("vacations", {
      createdAt: source.createdAt,
      date: source.date,
      lineageKey: source.lineageKey ?? source._id,
      ...(mfaId ? { mfaId } : {}),
      portion: source.portion,
      practiceId,
      ...(practitionerId ? { practitionerId } : {}),
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
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  locationIdMap: Map<Id<"locations">, Id<"locations">>,
  appointmentTypeIdMap: Map<Id<"appointmentTypes">, Id<"appointmentTypes">>,
): Promise<Id<"ruleConditions">> {
  // Remap any practitioner/location/appointmentType IDs in the condition values
  let remappedValueIds = sourceNode.valueIds;
  if (sourceNode.valueIds && sourceNode.conditionType) {
    switch (sourceNode.conditionType) {
      case "APPOINTMENT_TYPE": {
        remappedValueIds = [];
        for (const id of sourceNode.valueIds) {
          const appointmentTypeId = id as Id<"appointmentTypes">;
          const newId = appointmentTypeIdMap.get(appointmentTypeId);
          if (!newId) {
            throw new Error(
              `Failed to copy rule condition: ` +
                `Appointment Type ID ${appointmentTypeId} not found in mapping. ` +
                `This indicates data corruption - all appointment types should have been copied.`,
            );
          }
          remappedValueIds.push(newId as string);
        }

        break;
      }
      case "LOCATION": {
        remappedValueIds = [];
        for (const id of sourceNode.valueIds) {
          const locationId = id as Id<"locations">;
          const newId = locationIdMap.get(locationId);
          if (!newId) {
            throw new Error(
              `Failed to copy rule condition: ` +
                `Location ID ${locationId} not found in mapping. ` +
                `This indicates data corruption - all locations should have been copied.`,
            );
          }
          remappedValueIds.push(newId as string);
        }

        break;
      }
      case "PRACTITIONER": {
        remappedValueIds = [];
        for (const id of sourceNode.valueIds) {
          const practitionerId = id as Id<"practitioners">;
          const newId = practitionerIdMap.get(practitionerId);
          if (!newId) {
            throw new Error(
              `Failed to copy rule condition: ` +
                `Practitioner ID ${practitionerId} not found in mapping. ` +
                `This indicates data corruption - all practitioners should have been copied.`,
            );
          }
          remappedValueIds.push(newId as string);
        }

        break;
      }
      // No default
    }
  }

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
    if (remappedValueIds) {
      insertData.valueIds = remappedValueIds;
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
    await copyConditionNode(
      db,
      child,
      targetRuleSetId,
      newNodeId,
      practiceId,
      practitionerIdMap,
      locationIdMap,
      appointmentTypeIdMap,
    );
  }

  return newNodeId;
}

/**
 * Copy all rule conditions (rules and their condition trees) from source rule set to target rule set.
 * This recursively copies entire condition trees while remapping practitioner/location/appointmentType IDs.
 */
export async function copyRuleConditions(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  locationIdMap: Map<Id<"locations">, Id<"locations">>,
  appointmentTypeIdMap: Map<Id<"appointmentTypes">, Id<"appointmentTypes">>,
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
      practitionerIdMap,
      locationIdMap,
      appointmentTypeIdMap,
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
  const practitionerIdMap = await copyPractitioners(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
  );
  const appointmentTypeIdMap = await copyAppointmentTypes(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
    practitionerIdMap,
  );
  const locationIdMap = await copyLocations(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
  );
  const mfaIdMap = await copyMfas(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
  );

  // Copy base schedules with mapped IDs
  await copyBaseSchedules(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
    practitionerIdMap,
    locationIdMap,
  );
  await copyVacations(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
    practitionerIdMap,
    mfaIdMap,
  );

  // Copy rule conditions with mapped IDs
  await copyRuleConditions(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
    practitionerIdMap,
    locationIdMap,
    appointmentTypeIdMap,
  );
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
  for (const id of entityIds) {
    const entity = await db.get(
      "appointmentTypes",
      id as Id<"appointmentTypes">,
    );

    if (!entity) {
      throw new Error(
        `appointmentTypes with ID ${id} not found. ` +
          `This indicates the entity was deleted or the ID is invalid.`,
      );
    }

    if (entity.ruleSetId !== expectedRuleSetId) {
      throw validateEntityInRuleSetError(
        "appointmentTypes",
        id,
        entity.ruleSetId,
        expectedRuleSetId,
      );
    }
  }
}

/**
 * Validates that a list of location IDs all belong to the specified rule set.
 */
export async function validateLocationIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  for (const id of entityIds) {
    const entity = await db.get("locations", id as Id<"locations">);

    if (!entity) {
      throw new Error(
        `locations with ID ${id} not found. ` +
          `This indicates the entity was deleted or the ID is invalid.`,
      );
    }

    if (entity.ruleSetId !== expectedRuleSetId) {
      throw validateEntityInRuleSetError(
        "locations",
        id,
        entity.ruleSetId,
        expectedRuleSetId,
      );
    }
  }
}

/**
 * Validates that a list of practitioner IDs all belong to the specified rule set.
 */
export async function validatePractitionerIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
): Promise<void> {
  for (const id of entityIds) {
    const entity = await db.get("practitioners", id as Id<"practitioners">);

    if (!entity) {
      throw new Error(
        `practitioners with ID ${id} not found. ` +
          `This indicates the entity was deleted or the ID is invalid.`,
      );
    }

    if (entity.ruleSetId !== expectedRuleSetId) {
      throw validateEntityInRuleSetError(
        "practitioners",
        id,
        entity.ruleSetId,
        expectedRuleSetId,
      );
    }
  }
}

// ================================
// ENTITY ID MAPPING HELPERS
// ================================

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
export async function mapEntityIdsBetweenRuleSets<
  T extends
    | "appointmentTypes"
    | "baseSchedules"
    | "locations"
    | "practitioners",
>(
  db: DatabaseReader,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  table: T,
): Promise<Map<Id<T>, Id<T>>> {
  const mapping = new Map<Id<T>, Id<T>>();

  // If rule sets are the same, no mapping needed
  if (sourceRuleSetId === targetRuleSetId) {
    return mapping;
  }

  // Dispatch to table-specific implementation
  switch (table) {
    case "appointmentTypes": {
      return (await mapAppointmentTypeIds(
        db,
        sourceRuleSetId,
        targetRuleSetId,
      )) as Map<Id<T>, Id<T>>;
    }
    case "baseSchedules": {
      return (await mapBaseScheduleIds(
        db,
        sourceRuleSetId,
        targetRuleSetId,
      )) as Map<Id<T>, Id<T>>;
    }
    case "locations": {
      return (await mapLocationIds(
        db,
        sourceRuleSetId,
        targetRuleSetId,
      )) as Map<Id<T>, Id<T>>;
    }
    case "practitioners": {
      return (await mapPractitionerIds(
        db,
        sourceRuleSetId,
        targetRuleSetId,
      )) as Map<Id<T>, Id<T>>;
    }
    default: {
      return mapping;
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
