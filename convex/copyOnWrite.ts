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
  | "practitioner"
  | "rule"
  | "rule condition";

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
  const ruleSet = await db.get(ruleSetId);

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
  const ruleSet = await db.get(ruleSetId);

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
  const ruleSet = await db.get(entityRuleSetId);

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
    // No parentVersion - this is the root
    practiceId,
    saved: true,
    version: 1,
  });

  // Set it as the active rule set
  await db.patch(practiceId, {
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
  const sourceRuleSet = await db.get(sourceRuleSetId);
  if (!sourceRuleSet) {
    throw new Error("Source rule set not found");
  }
  if (sourceRuleSet.practiceId !== practiceId) {
    throw new Error("Source rule set does not belong to this practice");
  }

  // Create new unsaved rule set
  const newVersion = sourceRuleSet.version + 1;
  const newRuleSetId = await db.insert("ruleSets", {
    createdAt: Date.now(),
    description: "Ungespeicherte Änderungen",
    parentVersion: sourceRuleSet._id, // Single parent reference
    practiceId,
    saved: false,
    version: newVersion,
  });

  // Copy all entities atomically
  await copyAllEntities(db, sourceRuleSet._id, newRuleSetId, practiceId);

  return newRuleSetId;
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
      lastModified: BigInt(Date.now()),
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
      | "LOCATION"
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

  // Copy base schedules with mapped IDs
  await copyBaseSchedules(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practiceId,
    practitionerIdMap,
    locationIdMap,
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
 * Validates that a list of entity IDs all belong to the specified rule set.
 * This is a critical safety check to prevent bugs where entity IDs from an old
 * rule set are accidentally used when creating/updating entities in a new rule set.
 * @throws Error if any entity ID doesn't belong to the expected rule set
 */
export async function validateEntityIdsInRuleSet(
  db: DatabaseReader,
  entityIds: string[],
  expectedRuleSetId: Id<"ruleSets">,
  entityType: "appointmentTypes" | "locations" | "practitioners",
): Promise<void> {
  for (const id of entityIds) {
    const entity = await db.get(id as Id<typeof entityType>);

    if (!entity) {
      throw new Error(
        `${entityType} with ID ${id} not found. ` +
          `This indicates the entity was deleted or the ID is invalid.`,
      );
    }

    if (entity.ruleSetId !== expectedRuleSetId) {
      throw new Error(
        `${entityType} with ID ${id} belongs to rule set ${entity.ruleSetId}, ` +
          `but expected rule set ${expectedRuleSetId}. ` +
          `This is a copy-on-write safety violation - when creating or updating entities ` +
          `in a new rule set, all referenced entities must also belong to that rule set. ` +
          `This bug typically occurs when IDs are not properly remapped during copy-on-write operations.`,
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
  // Check if source entity has children in target rule set
  const childInTarget = await db
    .query("appointmentTypes")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", sourceEntity._id).eq("ruleSetId", targetRuleSetId),
    )
    .first();

  if (childInTarget) {
    return childInTarget;
  }

  // Check if source entity has a parent that might lead to target rule set
  if (sourceEntity.parentId) {
    const parent = await db.get(sourceEntity.parentId);
    if (parent) {
      if (parent.ruleSetId === targetRuleSetId) {
        return parent;
      }
      return await findCorrespondingAppointmentType(
        db,
        parent,
        targetRuleSetId,
      );
    }
  }

  return null;
}

/**
 * Finds the corresponding location in a target rule set.
 */
async function findCorrespondingLocation(
  db: DatabaseReader,
  sourceEntity: Doc<"locations">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"locations"> | null> {
  const childInTarget = await db
    .query("locations")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", sourceEntity._id).eq("ruleSetId", targetRuleSetId),
    )
    .first();

  if (childInTarget) {
    return childInTarget;
  }

  if (sourceEntity.parentId) {
    const parent = await db.get(sourceEntity.parentId);
    if (parent) {
      if (parent.ruleSetId === targetRuleSetId) {
        return parent;
      }
      return await findCorrespondingLocation(db, parent, targetRuleSetId);
    }
  }

  return null;
}

/**
 * Finds the corresponding practitioner in a target rule set.
 */
async function findCorrespondingPractitioner(
  db: DatabaseReader,
  sourceEntity: Doc<"practitioners">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"practitioners"> | null> {
  const childInTarget = await db
    .query("practitioners")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", sourceEntity._id).eq("ruleSetId", targetRuleSetId),
    )
    .first();

  if (childInTarget) {
    return childInTarget;
  }

  if (sourceEntity.parentId) {
    const parent = await db.get(sourceEntity.parentId);
    if (parent) {
      if (parent.ruleSetId === targetRuleSetId) {
        return parent;
      }
      return await findCorrespondingPractitioner(db, parent, targetRuleSetId);
    }
  }

  return null;
}

/**
 * Finds the corresponding base schedule in a target rule set.
 */
async function findCorrespondingBaseSchedule(
  db: DatabaseReader,
  sourceEntity: Doc<"baseSchedules">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Doc<"baseSchedules"> | null> {
  const childInTarget = await db
    .query("baseSchedules")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", sourceEntity._id).eq("ruleSetId", targetRuleSetId),
    )
    .first();

  if (childInTarget) {
    return childInTarget;
  }

  if (sourceEntity.parentId) {
    const parent = await db.get(sourceEntity.parentId);
    if (parent) {
      if (parent.ruleSetId === targetRuleSetId) {
        return parent;
      }
      return await findCorrespondingBaseSchedule(db, parent, targetRuleSetId);
    }
  }

  return null;
}
