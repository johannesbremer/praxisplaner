import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  findUnsavedRuleSet,
  getOrCreateUnsavedRuleSet,
  validateRuleSet,
} from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import { validateRuleSetDescriptionSync } from "./ruleSetValidation";

// ================================
// HELPER FUNCTIONS
// ================================

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

/**
 * Get existing saved descriptions for a practice.
 * Used for validation.
 */
async function getExistingSavedDescriptions(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<string[]> {
  const existingRuleSets = await db
    .query("ruleSets")
    .withIndex("by_practiceId_saved", (q) =>
      q.eq("practiceId", practiceId).eq("saved", true),
    )
    .collect();

  return existingRuleSets.map((rs) => rs.description);
}

/**
 * Delete appointment types by ruleSetId in batches.
 */
async function deleteAppointmentTypesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("appointmentTypes", item._id);
    }
    batch = await db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete practitioners by ruleSetId in batches.
 */
async function deletePractitionersByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("practitioners", item._id);
    }
    batch = await db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete locations by ruleSetId in batches.
 */
async function deleteLocationsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("locations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("locations", item._id);
    }
    batch = await db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete base schedules by ruleSetId in batches.
 */
async function deleteBaseSchedulesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("baseSchedules", item._id);
    }
    batch = await db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete rule conditions by ruleSetId in batches.
 */
interface CanonicalRuleConditionNode {
  childOrder: number;
  children: CanonicalRuleConditionNode[];
  conditionType: null | string;
  enabled: boolean | null;
  nodeType: null | string;
  operator: null | string;
  scope: null | string;
  valueIds: null | string[];
  valueNumber: null | number;
}

interface RuleSetCanonicalSnapshot {
  appointmentTypes: string[];
  baseSchedules: string[];
  locations: string[];
  practitioners: string[];
  rules: string[];
}

async function buildRuleSetCanonicalSnapshot(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
): Promise<RuleSetCanonicalSnapshot> {
  const [appointmentTypes, baseSchedules, locations, practitioners, rules] =
    await Promise.all([
      db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      db
        .query("locations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      db
        .query("ruleConditions")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
    ]);

  const practitionerNameById = new Map(
    practitioners.map((practitioner) => [practitioner._id, practitioner.name]),
  );
  const locationNameById = new Map(
    locations.map((location) => [location._id, location.name]),
  );
  const appointmentTypeNameById = new Map(
    appointmentTypes.map((appointmentType) => [
      appointmentType._id,
      appointmentType.name,
    ]),
  );

  const canonicalPractitioners = practitioners
    .map((practitioner) =>
      JSON.stringify({
        name: practitioner.name,
        tags: toSortedStrings(practitioner.tags ?? []),
      }),
    )
    .toSorted();

  const canonicalLocations = locations
    .map((location) => JSON.stringify({ name: location.name }))
    .toSorted();

  const canonicalAppointmentTypes = appointmentTypes
    .map((appointmentType) =>
      JSON.stringify({
        allowedPractitioners: toSortedStrings(
          appointmentType.allowedPractitionerIds.map(
            (id) => practitionerNameById.get(id) ?? id,
          ),
        ),
        duration: appointmentType.duration,
        name: appointmentType.name,
      }),
    )
    .toSorted();

  const canonicalBaseSchedules = baseSchedules
    .map((baseSchedule) =>
      JSON.stringify({
        breakTimes: normalizeBreakTimes(baseSchedule.breakTimes),
        dayOfWeek: baseSchedule.dayOfWeek,
        endTime: baseSchedule.endTime,
        locationName:
          locationNameById.get(baseSchedule.locationId) ??
          baseSchedule.locationId,
        practitionerName:
          practitionerNameById.get(baseSchedule.practitionerId) ??
          baseSchedule.practitionerId,
        startTime: baseSchedule.startTime,
      }),
    )
    .toSorted();

  const childrenByParentId = new Map<
    Id<"ruleConditions">,
    Doc<"ruleConditions">[]
  >();
  for (const rule of rules) {
    if (!rule.parentConditionId) {
      continue;
    }
    const siblings = childrenByParentId.get(rule.parentConditionId) ?? [];
    siblings.push(rule);
    childrenByParentId.set(rule.parentConditionId, siblings);
  }

  const rootRules = rules
    .filter((rule) => rule.isRoot && !rule.parentConditionId)
    .toSorted((a, b) => a._id.localeCompare(b._id));

  const canonicalRules = rootRules
    .map((rootRule) =>
      JSON.stringify(
        serializeRuleConditionTree(
          rootRule,
          childrenByParentId,
          appointmentTypeNameById,
          locationNameById,
          practitionerNameById,
        ),
      ),
    )
    .toSorted();

  return {
    appointmentTypes: canonicalAppointmentTypes,
    baseSchedules: canonicalBaseSchedules,
    locations: canonicalLocations,
    practitioners: canonicalPractitioners,
    rules: canonicalRules,
  };
}

async function deleteRuleConditionsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("ruleConditions", item._id);
    }
    batch = await db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

function normalizeBreakTimes(
  breakTimes: undefined | { end: string; start: string }[],
): { end: string; start: string }[] {
  if (!breakTimes || breakTimes.length === 0) {
    return [];
  }

  return [...breakTimes].toSorted((a, b) =>
    `${a.start}|${a.end}`.localeCompare(`${b.start}|${b.end}`),
  );
}

function normalizeValueIds(
  node: Doc<"ruleConditions">,
  appointmentTypeNameById: Map<string, string>,
  locationNameById: Map<string, string>,
  practitionerNameById: Map<string, string>,
): null | string[] {
  if (!node.valueIds || node.valueIds.length === 0) {
    return null;
  }

  const lookupMapped = (id: string, map: Map<string, string>) =>
    map.get(id) ?? id;

  switch (node.conditionType) {
    case "APPOINTMENT_TYPE":
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY": {
      return toSortedStrings(
        node.valueIds.map((id) => lookupMapped(id, appointmentTypeNameById)),
      );
    }
    case "LOCATION": {
      return toSortedStrings(
        node.valueIds.map((id) => lookupMapped(id, locationNameById)),
      );
    }
    case "PRACTITIONER": {
      return toSortedStrings(
        node.valueIds.map((id) => lookupMapped(id, practitionerNameById)),
      );
    }
    default: {
      return toSortedStrings(node.valueIds);
    }
  }
}

function serializeRuleConditionTree(
  node: Doc<"ruleConditions">,
  childrenByParentId: Map<Id<"ruleConditions">, Doc<"ruleConditions">[]>,
  appointmentTypeNameById: Map<string, string>,
  locationNameById: Map<string, string>,
  practitionerNameById: Map<string, string>,
): CanonicalRuleConditionNode {
  const children = childrenByParentId.get(node._id) ?? [];
  const orderedChildren = [...children].toSorted(
    (a, b) => a.childOrder - b.childOrder,
  );

  return {
    childOrder: node.childOrder,
    children: orderedChildren.map((child) =>
      serializeRuleConditionTree(
        child,
        childrenByParentId,
        appointmentTypeNameById,
        locationNameById,
        practitionerNameById,
      ),
    ),
    conditionType: node.conditionType ?? null,
    enabled: node.isRoot ? (node.enabled ?? true) : null,
    nodeType: node.nodeType ?? null,
    operator: node.operator ?? null,
    scope: node.scope ?? null,
    valueIds: normalizeValueIds(
      node,
      appointmentTypeNameById,
      locationNameById,
      practitionerNameById,
    ),
    valueNumber: node.valueNumber ?? null,
  };
}

function toSortedStrings(values: string[]): string[] {
  return [...values].toSorted();
}

// ================================
// RULE SET MANAGEMENT - SIMPLIFIED COW WORKFLOW
// ================================

/**
 * Saves an unsaved rule set by setting saved=true and updating the description.
 *
 * This is the EXIT POINT after making all desired changes.
 * - Validates that the description is valid and unique
 * - Validates that the rule set is currently unsaved
 * - Updates description and sets saved=true
 * - Optionally sets this as the active rule set for the practice
 */
export const saveUnsavedRuleSet = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
    setAsActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const trimmedDescription = args.description.trim();

    // Get existing saved descriptions for validation
    const existingDescriptions = await getExistingSavedDescriptions(
      ctx.db,
      args.practiceId,
    );

    // Validate the description using shared validation logic
    const validationResult = validateRuleSetDescriptionSync(
      trimmedDescription,
      existingDescriptions,
    );

    if (!validationResult.isValid) {
      throw new Error(validationResult.error);
    }

    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Validate it's actually unsaved
    if (unsavedRuleSet.saved) {
      throw new Error("Cannot save a rule set that is already saved");
    }

    // Update to saved state
    await ctx.db.patch("ruleSets", unsavedRuleSet._id, {
      description: trimmedDescription,
      saved: true,
    });

    // Optionally set as active
    if (args.setAsActive) {
      await ctx.db.patch("practices", args.practiceId, {
        currentActiveRuleSetId: unsavedRuleSet._id,
      });
    }

    return unsavedRuleSet._id;
  },
  returns: v.id("ruleSets"),
});

/**
 * Discards the unsaved rule set (delete it and all its entities).
 * This is useful for discarding unwanted changes.
 */
export const discardUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Delete the rule set (entities will cascade via Convex deletion rules)
    // Note: We manually delete entities in batches for explicit cleanup
    const ruleSetId = unsavedRuleSet._id;

    // Delete all entities belonging to this rule set using batch processing
    await deleteAppointmentTypesByRuleSet(ctx.db, ruleSetId);
    await deletePractitionersByRuleSet(ctx.db, ruleSetId);
    await deleteLocationsByRuleSet(ctx.db, ruleSetId);
    await deleteBaseSchedulesByRuleSet(ctx.db, ruleSetId);
    await deleteRuleConditionsByRuleSet(ctx.db, ruleSetId);

    // Finally, delete the rule set itself
    await ctx.db.delete("ruleSets", ruleSetId);
  },
});

/**
 * Get the unsaved rule set for a practice (if it exists)
 */
export const getUnsavedRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await findUnsavedRuleSet(ctx.db, args.practiceId);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("ruleSets"),
      createdAt: v.number(),
      description: v.string(),
      parentVersion: v.optional(v.id("ruleSets")),
      practiceId: v.id("practices"),
      saved: v.boolean(),
      version: v.number(),
    }),
    v.null(),
  ),
});

/**
 * Get all saved rule sets for a practice
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getSavedRuleSets = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId_saved", (q) =>
        q.eq("practiceId", args.practiceId).eq("saved", true),
      )
      .collect();
  },
});

/**
 * Get all rule sets (saved and unsaved) for a practice.
 * Used for navigation and URL slug resolution.
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getAllRuleSets = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();
  },
});

/**
 * Get a specific rule set by ID
 */
export const getRuleSet = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
    return await ctx.db.get("ruleSets", args.ruleSetId);
  },
});

/**
 * Set a rule set as the active rule set for a practice
 */
export const setActiveRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Validate the rule set exists and belongs to practice
    const ruleSet = await validateRuleSet(
      ctx.db,
      args.ruleSetId,
      args.practiceId,
    );

    // Only saved rule sets can be set as active
    if (!ruleSet.saved) {
      throw new Error("Cannot set an unsaved rule set as active");
    }

    // Update the practice
    await ctx.db.patch("practices", args.practiceId, {
      currentActiveRuleSetId: args.ruleSetId,
    });
  },
});

/**
 * Get the active rule set for a practice
 */
export const getActiveRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return null;
    }
    return await ctx.db.get("ruleSets", practice.currentActiveRuleSetId);
  },
});

// ================================
// VERSION HISTORY FUNCTIONS
// ================================

/**
 * Get version history for a practice.
 * Returns all saved rule sets with metadata about which is active.
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getVersionHistory = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const ruleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      // Include all rule sets (saved and unsaved) for complete version history
      .collect();

    const practice = await ctx.db.get("practices", args.practiceId);

    return ruleSets.map((ruleSet) => ({
      createdAt: ruleSet.createdAt,
      id: ruleSet._id,
      isActive: practice?.currentActiveRuleSetId === ruleSet._id,
      message: ruleSet.description,
      parents: ruleSet.parentVersion ? [ruleSet.parentVersion] : [], // Convert single parent to array for visualization
    }));
  },
  returns: v.array(
    v.object({
      createdAt: v.number(),
      id: v.id("ruleSets"),
      isActive: v.boolean(),
      message: v.string(),
      parents: v.array(v.id("ruleSets")),
    }),
  ),
});

/**
 * Delete an unsaved rule set.
 * This is the ONLY way to delete a rule set - we never delete saved rule sets
 * (equivalent of rewriting git history).
 *
 * Use case: User wants to discard all unsaved changes and start fresh.
 */
export const deleteUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);

    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    // Verify it belongs to the practice
    if (ruleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }

    // CRITICAL: Only allow deleting unsaved rule sets
    if (ruleSet.saved) {
      throw new Error(
        "Cannot delete saved rule sets. Only unsaved rule sets can be deleted.",
      );
    }

    // Delete all entities associated with this rule set using batch processing
    await deleteRuleConditionsByRuleSet(ctx.db, args.ruleSetId);
    await deletePractitionersByRuleSet(ctx.db, args.ruleSetId);
    await deleteLocationsByRuleSet(ctx.db, args.ruleSetId);
    await deleteAppointmentTypesByRuleSet(ctx.db, args.ruleSetId);
    await deleteBaseSchedulesByRuleSet(ctx.db, args.ruleSetId);

    // Finally, delete the rule set itself
    await ctx.db.delete("ruleSets", args.ruleSetId);
  },
});

/**
 * Ensure there is an unsaved rule set for the given source.
 * Useful when redo needs a writable draft after the previous draft was discarded.
 */
export const ensureUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    return await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );
  },
  returns: v.id("ruleSets"),
});

/**
 * Discard an unsaved rule set only when it is semantically equivalent to its parent.
 * This prevents accidental deletion of drafts that still contain changes.
 */
export const discardUnsavedRuleSetIfEquivalentToParent = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);

    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    if (ruleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }

    if (ruleSet.saved) {
      return {
        deleted: false,
        reason: "not_unsaved" as const,
      };
    }

    if (!ruleSet.parentVersion) {
      return {
        deleted: false,
        reason: "no_parent" as const,
      };
    }

    const parentRuleSet = await ctx.db.get("ruleSets", ruleSet.parentVersion);
    if (parentRuleSet?.practiceId !== args.practiceId) {
      return {
        deleted: false,
        reason: "parent_missing" as const,
      };
    }

    const [unsavedSnapshot, parentSnapshot] = await Promise.all([
      buildRuleSetCanonicalSnapshot(ctx.db, ruleSet._id),
      buildRuleSetCanonicalSnapshot(ctx.db, parentRuleSet._id),
    ]);

    const isEquivalent =
      JSON.stringify(unsavedSnapshot) === JSON.stringify(parentSnapshot);

    if (!isEquivalent) {
      return {
        deleted: false,
        parentRuleSetId: parentRuleSet._id,
        reason: "has_changes" as const,
      };
    }

    await deleteRuleConditionsByRuleSet(ctx.db, ruleSet._id);
    await deletePractitionersByRuleSet(ctx.db, ruleSet._id);
    await deleteLocationsByRuleSet(ctx.db, ruleSet._id);
    await deleteAppointmentTypesByRuleSet(ctx.db, ruleSet._id);
    await deleteBaseSchedulesByRuleSet(ctx.db, ruleSet._id);
    await ctx.db.delete("ruleSets", ruleSet._id);

    return {
      deleted: true,
      parentRuleSetId: parentRuleSet._id,
      reason: "discarded" as const,
    };
  },
  returns: v.object({
    deleted: v.boolean(),
    parentRuleSetId: v.optional(v.id("ruleSets")),
    reason: v.union(
      v.literal("discarded"),
      v.literal("has_changes"),
      v.literal("no_parent"),
      v.literal("not_unsaved"),
      v.literal("parent_missing"),
    ),
  }),
});
