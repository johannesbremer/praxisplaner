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
import type { ConditionTree } from "./ruleEngine/types";

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

// Entity type union for type safety
export type EntityType =
  | "appointment type"
  | "base schedule"
  | "location"
  | "practitioner"
  | "rule";

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
    const allowedPractitionerIds = sourceType.allowedPractitionerIds
      .map((practitionerId) => practitionerIdMap.get(practitionerId))
      .filter((id): id is Id<"practitioners"> => id !== undefined);

    // Ensure we have at least one practitioner (should always be true if source was valid)
    if (allowedPractitionerIds.length === 0) {
      throw new Error(
        `Appointment type "${sourceType.name}" has no valid practitioners after mapping`,
      );
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
    const newLocationId = locationIdMap.get(source.locationId);

    if (!newPractitionerId || !newLocationId) {
      console.warn(`Skipping schedule copy - missing mapped IDs`);
      continue;
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
 * Recursively remap practitioner and location IDs in a condition tree.
 * This walks the lambda calculus condition tree and updates any references
 * to practitioners or locations to their new copied IDs.
 */
function remapConditionTree(
  condition: unknown,
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  locationIdMap: Map<Id<"locations">, Id<"locations">>,
): unknown {
  if (!condition || typeof condition !== "object") {
    return condition;
  }

  const node = condition as Record<string, unknown>;
  const result: Record<string, unknown> = { ...node };

  // Handle different condition types
  switch (node["type"]) {
    case "Adjacent":
    case "Count":
    case "TimeRangeFree": {
      // All three types have filter objects that may need remapping
      // Recursively remap filter objects
      if (node["filter"] && typeof node["filter"] === "object") {
        const filter = node["filter"] as Record<string, unknown>;
        const remappedFilter: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(filter)) {
          if (typeof value === "string") {
            remappedFilter[key] =
              practitionerIdMap.get(value as Id<"practitioners">) ||
              locationIdMap.get(value as Id<"locations">) ||
              value;
          } else if (Array.isArray(value)) {
            remappedFilter[key] = (value as unknown[]).map((val: unknown) => {
              if (typeof val === "string") {
                return (
                  practitionerIdMap.get(val as Id<"practitioners">) ||
                  locationIdMap.get(val as Id<"locations">) ||
                  val
                );
              }
              return val;
            });
          } else {
            remappedFilter[key] = value;
          }
        }
        result["filter"] = remappedFilter;
      }
      break;
    }
    case "AND":
    case "OR": {
      // Both AND and OR recursively process children arrays
      // Recursively process children
      if (Array.isArray(node["children"])) {
        result["children"] = (node["children"] as unknown[]).map((child) =>
          remapConditionTree(child, practitionerIdMap, locationIdMap),
        );
      }
      break;
    }
    case "NOT": {
      // Recursively process child
      if (node["child"]) {
        result["child"] = remapConditionTree(
          node["child"],
          practitionerIdMap,
          locationIdMap,
        );
      }
      break;
    }

    case "Property": {
      // Check if the value is a practitioner or location ID that needs remapping
      if (typeof node["value"] === "string") {
        // Try to remap as practitioner ID
        const practitionerId = practitionerIdMap.get(
          node["value"] as Id<"practitioners">,
        );
        if (practitionerId) {
          result["value"] = practitionerId;
        }
        // Try to remap as location ID
        const locationId = locationIdMap.get(node["value"] as Id<"locations">);
        if (locationId) {
          result["value"] = locationId;
        }
      }
      // Handle array values that might contain IDs
      if (Array.isArray(node["value"])) {
        result["value"] = (node["value"] as unknown[]).map((val) => {
          if (typeof val === "string") {
            return (
              practitionerIdMap.get(val as Id<"practitioners">) ||
              locationIdMap.get(val as Id<"locations">) ||
              val
            );
          }
          return val;
        });
      }
      break;
    }
  }

  return result;
}

/**
 * Copy all rules from source to target rule set.
 * Remaps practitioner and location IDs in the condition trees to the new rule set's entities.
 */
export async function copyRules(
  db: DatabaseWriter,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
  practitionerIdMap: Map<Id<"practitioners">, Id<"practitioners">>,
  locationIdMap: Map<Id<"locations">, Id<"locations">>,
): Promise<void> {
  const sourceRules = await db
    .query("rules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", sourceRuleSetId))
    .collect();

  for (const source of sourceRules) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _creationTime, _id, ruleSetId, ...ruleData } = source;

    // Remap IDs in the condition tree
    const remappedCondition = remapConditionTree(
      source.condition,
      practitionerIdMap,
      locationIdMap,
    );

    // Remap IDs in zones if present
    let remappedZones: unknown = source.zones;
    if (source.zones && typeof source.zones === "object") {
      const zones = source.zones as Record<string, unknown>;
      if (zones["createZone"]) {
        const createZone = zones["createZone"] as Record<string, unknown>;
        remappedZones = {
          ...zones,
          createZone: {
            ...createZone,
            condition: createZone["condition"]
              ? remapConditionTree(
                  createZone["condition"],
                  practitionerIdMap,
                  locationIdMap,
                )
              : createZone["condition"],
          },
        };
      }
    }

    const insertData = {
      ...ruleData,
      condition: remappedCondition as ConditionTree,
      parentId: source._id,
      ruleSetId: targetRuleSetId,
      ...(remappedZones ? { zones: remappedZones } : {}),
    };

    await db.insert("rules", insertData as never);
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
  await copyAppointmentTypes(
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

  // Copy rules with mapped IDs
  await copyRules(
    db,
    sourceRuleSetId,
    targetRuleSetId,
    practitionerIdMap,
    locationIdMap,
  );
}
