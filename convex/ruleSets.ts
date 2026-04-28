import type { GenericDatabaseReader } from "convex/server";

import { v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { isActivationBoundSimulation } from "./appointmentSimulation";
import { findUnsavedRuleSet } from "./copyOnWrite";
import { requireLineageKey } from "./lineage";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  activateSavedRuleSet,
  deleteDraftRuleSet,
  discardCurrentDraftRuleSet,
  discardDraftRuleSetIfEquivalentToParent,
  saveDraftRuleSet,
} from "./ruleSetLifecycle";

// ================================
// HELPER FUNCTIONS
// ================================

// Type aliases for cleaner code
interface CanonicalRuleConditionNode {
  __diffKey?: string;
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

type DatabaseReader = GenericDatabaseReader<DataModel>;

interface RuleSetCanonicalSnapshot {
  appointmentCoverage: string[];
  appointmentTypes: string[];
  baseSchedules: string[];
  locations: string[];
  mfas: string[];
  practitioners: string[];
  rules: string[];
  vacations: string[];
}

const canonicalSnapshotSectionTitles = {
  appointmentCoverage: "Terminverschiebungen",
  appointmentTypes: "Terminarten",
  baseSchedules: "Arbeitszeiten",
  locations: "Standorte",
  mfas: "MFAs",
  practitioners: "Behandler",
  rules: "Regeln",
  vacations: "Urlaub",
} satisfies Record<keyof RuleSetCanonicalSnapshot, string>;

async function buildAppointmentCoverageDiffSection(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const simulationAppointments = await db
    .query("appointments")
    .withIndex("by_simulationRuleSetId", (q) =>
      q.eq("simulationRuleSetId", args.ruleSetId),
    )
    .collect();

  if (simulationAppointments.length === 0) {
    return {
      added: [],
      key: "appointmentCoverage",
      removed: [],
      title: canonicalSnapshotSectionTitles.appointmentCoverage,
    };
  }

  const [patients, users, practitioners] = await Promise.all([
    db
      .query("patients")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect(),
    db.query("users").collect(),
    db.query("practitioners").collect(),
  ]);

  const patientById = new Map(
    patients.map((patient) => [patient._id, patient]),
  );
  const userById = new Map(users.map((user) => [user._id, user]));
  const practitionerNameById = new Map(
    practitioners.flatMap((practitioner) => [
      [practitioner._id, practitioner.name] as const,
      ...(practitioner.lineageKey
        ? ([[practitioner.lineageKey, practitioner.name]] as const)
        : []),
    ]),
  );

  const added: string[] = [];
  const removed: string[] = [];

  for (const simulationAppointment of simulationAppointments) {
    if (
      !isActivationBoundSimulation(simulationAppointment) ||
      !simulationAppointment.replacesAppointmentId
    ) {
      continue;
    }

    const replacedAppointment = await db.get(
      "appointments",
      simulationAppointment.replacesAppointmentId,
    );
    if (!replacedAppointment) {
      continue;
    }

    const patientLabel = simulationAppointment.patientId
      ? (patientById.get(simulationAppointment.patientId)?.lastName ??
        `Patient ${simulationAppointment.patientId}`)
      : simulationAppointment.userId
        ? (userById.get(simulationAppointment.userId)?.lastName ??
          userById.get(simulationAppointment.userId)?.email ??
          `Benutzer ${simulationAppointment.userId}`)
        : "Unbekannt";

    const beforePractitioner =
      (replacedAppointment.practitionerLineageKey
        ? practitionerNameById.get(replacedAppointment.practitionerLineageKey)
        : undefined) ?? "Unzugewiesen";
    const afterPractitioner =
      (simulationAppointment.practitionerLineageKey
        ? practitionerNameById.get(simulationAppointment.practitionerLineageKey)
        : undefined) ?? "Unzugewiesen";

    removed.push(
      JSON.stringify({
        __diffKey: replacedAppointment._id,
        patientLastName: patientLabel,
        practitionerName: beforePractitioner,
      }),
    );
    added.push(
      JSON.stringify({
        __diffKey: replacedAppointment._id,
        patientLastName: patientLabel,
        practitionerName: afterPractitioner,
      }),
    );
  }

  return {
    added: added.toSorted(),
    key: "appointmentCoverage",
    removed: removed.toSorted(),
    title: canonicalSnapshotSectionTitles.appointmentCoverage,
  };
}

async function buildRuleSetCanonicalSnapshot(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
): Promise<RuleSetCanonicalSnapshot> {
  const [
    appointmentTypesRaw,
    baseSchedules,
    locationsRaw,
    mfas,
    practitionersRaw,
    rules,
    vacations,
  ] = await Promise.all([
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
      .query("mfas")
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
    db
      .query("vacations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
  ]);
  const appointmentTypes = appointmentTypesRaw.filter(
    (appointmentType) => !isRuleSetEntityDeleted(appointmentType),
  );
  const locations = locationsRaw.filter(
    (location) => !isRuleSetEntityDeleted(location),
  );
  const practitioners = practitionersRaw.filter(
    (practitioner) => !isRuleSetEntityDeleted(practitioner),
  );

  const practitionerNameByReference = createEntityNameLookup(
    practitionersRaw,
    "practitioner",
  );
  const locationNameByReference = createEntityNameLookup(
    locationsRaw,
    "location",
  );
  const appointmentTypeNameByReference = createEntityNameLookup(
    appointmentTypesRaw,
    "appointment type",
  );
  const mfaNameByReference = createEntityNameLookup(mfas, "mfa");

  const canonicalPractitioners = practitioners
    .map((practitioner) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(
          practitioner.lineageKey,
          practitioner._id,
          "Behandler",
        ),
        name: practitioner.name,
        tags: toSortedStrings(practitioner.tags ?? []),
      }),
    )
    .toSorted();

  const canonicalLocations = locations
    .map((location) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(
          location.lineageKey,
          location._id,
          "Standort",
        ),
        name: location.name,
      }),
    )
    .toSorted();

  const canonicalMfas = mfas
    .map((mfa) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(mfa.lineageKey, mfa._id, "MFA"),
        name: mfa.name,
      }),
    )
    .toSorted();

  const canonicalAppointmentTypes = appointmentTypes
    .map((appointmentType) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(
          appointmentType.lineageKey,
          appointmentType._id,
          "Terminart",
        ),
        allowedPractitioners: toSortedStrings(
          appointmentType.allowedPractitionerLineageKeys.map(
            (id) => practitionerNameByReference.get(id) ?? id,
          ),
        ),
        duration: appointmentType.duration,
        followUpPlan:
          appointmentType.followUpPlan?.map((step) => ({
            appointmentTypeName:
              appointmentTypeNameByReference.get(
                step.appointmentTypeLineageKey,
              ) ?? step.appointmentTypeLineageKey,
            locationMode: step.locationMode,
            note: step.note ?? null,
            offsetUnit: step.offsetUnit,
            offsetValue: step.offsetValue,
            practitionerMode: step.practitionerMode,
            required: step.required,
            searchMode: step.searchMode,
            stepId: step.stepId,
          })) ?? [],
        name: appointmentType.name,
      }),
    )
    .toSorted();

  const canonicalBaseSchedules = baseSchedules
    .map((baseSchedule) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(
          baseSchedule.lineageKey,
          baseSchedule._id,
          "Arbeitszeit",
        ),
        breakTimes: normalizeBreakTimes(baseSchedule.breakTimes),
        dayOfWeek: baseSchedule.dayOfWeek,
        endTime: baseSchedule.endTime,
        locationName:
          locationNameByReference.get(baseSchedule.locationLineageKey) ??
          baseSchedule.locationLineageKey,
        practitionerName:
          practitionerNameByReference.get(
            baseSchedule.practitionerLineageKey,
          ) ?? baseSchedule.practitionerLineageKey,
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
          appointmentTypeNameByReference,
          locationNameByReference,
          practitionerNameByReference,
          rootRule.copyFromId ?? rootRule._id,
        ),
      ),
    )
    .toSorted();

  const canonicalVacations = vacations
    .map((vacation) =>
      JSON.stringify({
        __diffKey: requireStableDiffKey(
          vacation.lineageKey,
          vacation._id,
          "Urlaub",
        ),
        date: vacation.date,
        portion: vacation.portion,
        staffName:
          vacation.staffType === "practitioner"
            ? vacation.practitionerLineageKey
              ? practitionerNameByReference.get(vacation.practitionerLineageKey)
              : undefined
            : vacation.mfaLineageKey
              ? mfaNameByReference.get(vacation.mfaLineageKey)
              : undefined,
        staffType: vacation.staffType,
      }),
    )
    .toSorted();

  return {
    appointmentCoverage: [],
    appointmentTypes: canonicalAppointmentTypes,
    baseSchedules: canonicalBaseSchedules,
    locations: canonicalLocations,
    mfas: canonicalMfas,
    practitioners: canonicalPractitioners,
    rules: canonicalRules,
    vacations: canonicalVacations,
  };
}

function createEntityNameLookup(
  entities: {
    _id: string;
    lineageKey?: string;
    name: string;
    ruleSetId: Id<"ruleSets">;
  }[],
  entityType: "appointment type" | "location" | "mfa" | "practitioner",
) {
  const entries = entities.flatMap((entity) => {
    const lineageKey = requireLineageKey({
      entityId: entity._id,
      entityType,
      lineageKey: entity.lineageKey,
      ruleSetId: entity.ruleSetId,
    });
    return [
      [entity._id, entity.name] as const,
      [lineageKey, entity.name] as const,
    ];
  });
  return new Map(entries);
}

function getMultisetDifference(values: string[], comparison: string[]) {
  const counts = new Map<string, number>();
  for (const value of comparison) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const difference: string[] = [];
  for (const value of values) {
    const remaining = counts.get(value) ?? 0;
    if (remaining > 0) {
      counts.set(value, remaining - 1);
      continue;
    }
    difference.push(value);
  }

  return difference.toSorted();
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
  appointmentTypeNameByReference: Map<string, string>,
  locationNameByReference: Map<string, string>,
  practitionerNameByReference: Map<string, string>,
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
        node.valueIds.map((id) =>
          lookupMapped(id, appointmentTypeNameByReference),
        ),
      );
    }
    case "LOCATION": {
      return toSortedStrings(
        node.valueIds.map((id) => lookupMapped(id, locationNameByReference)),
      );
    }
    case "PRACTITIONER": {
      return toSortedStrings(
        node.valueIds.map((id) =>
          lookupMapped(id, practitionerNameByReference),
        ),
      );
    }
    default: {
      return toSortedStrings(node.valueIds);
    }
  }
}

function requireStableDiffKey(
  lineageKey: string | undefined,
  entityId: string,
  entityType: string,
) {
  if (!lineageKey) {
    throw new Error(
      `[INVARIANT:DIFF_KEY_MISSING] ${entityType} ${entityId} hat keinen stabilen Diff-Schluessel.`,
    );
  }

  return lineageKey;
}

function serializeRuleConditionTree(
  node: Doc<"ruleConditions">,
  childrenByParentId: Map<Id<"ruleConditions">, Doc<"ruleConditions">[]>,
  appointmentTypeNameByReference: Map<string, string>,
  locationNameByReference: Map<string, string>,
  practitionerNameByReference: Map<string, string>,
  diffKey?: string,
): CanonicalRuleConditionNode {
  const children = childrenByParentId.get(node._id) ?? [];
  const orderedChildren = [...children].toSorted(
    (a, b) => a.childOrder - b.childOrder,
  );

  return {
    ...(diffKey ? { __diffKey: diffKey } : {}),
    childOrder: node.childOrder,
    children: orderedChildren.map((child) =>
      serializeRuleConditionTree(
        child,
        childrenByParentId,
        appointmentTypeNameByReference,
        locationNameByReference,
        practitionerNameByReference,
      ),
    ),
    conditionType: node.conditionType ?? null,
    enabled: node.isRoot ? (node.enabled ?? true) : null,
    nodeType: node.nodeType ?? null,
    operator: node.operator ?? null,
    scope: node.scope ?? null,
    valueIds: normalizeValueIds(
      node,
      appointmentTypeNameByReference,
      locationNameByReference,
      practitionerNameByReference,
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

export const getUnsavedRuleSetDiff = query({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const draftRuleSet = await ctx.db.get("ruleSets", args.ruleSetId);
    if (!draftRuleSet) {
      return null;
    }
    if (draftRuleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }
    if (draftRuleSet.saved) {
      return null;
    }
    if (!draftRuleSet.parentVersion) {
      throw new Error("Unsaved rule set has no parent");
    }

    const parentRuleSet = await ctx.db.get(
      "ruleSets",
      draftRuleSet.parentVersion,
    );
    if (parentRuleSet?.practiceId !== args.practiceId) {
      throw new Error("Parent rule set not found");
    }

    const [draftSnapshot, parentSnapshot, appointmentCoverageSection] =
      await Promise.all([
        buildRuleSetCanonicalSnapshot(ctx.db, draftRuleSet._id),
        buildRuleSetCanonicalSnapshot(ctx.db, parentRuleSet._id),
        buildAppointmentCoverageDiffSection(ctx.db, {
          practiceId: args.practiceId,
          ruleSetId: draftRuleSet._id,
        }),
      ]);

    const sectionKeys = Object.keys(
      canonicalSnapshotSectionTitles,
    ) as (keyof RuleSetCanonicalSnapshot)[];

    const sections = sectionKeys.map((key) => {
      const added = getMultisetDifference(
        draftSnapshot[key],
        parentSnapshot[key],
      );
      const removed = getMultisetDifference(
        parentSnapshot[key],
        draftSnapshot[key],
      );

      return {
        added,
        key,
        removed,
        title: canonicalSnapshotSectionTitles[key],
      };
    });
    const sectionsWithCoverage = [
      ...sections.filter((section) => section.key !== "appointmentCoverage"),
      appointmentCoverageSection,
    ];

    const totalAdded = sectionsWithCoverage.reduce(
      (sum, section) => sum + section.added.length,
      0,
    );
    const totalRemoved = sectionsWithCoverage.reduce(
      (sum, section) => sum + section.removed.length,
      0,
    );

    return {
      draftRuleSet: {
        _id: draftRuleSet._id,
        description: draftRuleSet.description,
        version: draftRuleSet.version,
      },
      parentRuleSet: {
        _id: parentRuleSet._id,
        description: parentRuleSet.description,
        version: parentRuleSet.version,
      },
      sections: sectionsWithCoverage,
      totals: {
        added: totalAdded,
        changed: totalAdded + totalRemoved,
        removed: totalRemoved,
      },
    };
  },
});

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
    return await saveDraftRuleSet(ctx.db, args);
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
    await discardCurrentDraftRuleSet(ctx.db, args.practiceId);
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
      draftRevision: v.number(),
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
    await activateSavedRuleSet(ctx.db, args);
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
    await deleteDraftRuleSet(ctx.db, args);
  },
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
    return await discardDraftRuleSetIfEquivalentToParent(ctx.db, {
      buildSnapshot: buildRuleSetCanonicalSnapshot,
      isEquivalent: (draftSnapshot, parentSnapshot) =>
        JSON.stringify(draftSnapshot) === JSON.stringify(parentSnapshot),
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });
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
