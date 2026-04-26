import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { findUnsavedRuleSet, validateRuleSet } from "./copyOnWrite";
import { validateRuleSetDescriptionSync } from "./ruleSetValidation";

export type EquivalentDraftDiscardResult =
  | {
      deleted: false;
      parentRuleSetId?: Id<"ruleSets">;
      reason: "has_changes" | "no_parent" | "not_unsaved" | "parent_missing";
    }
  | {
      deleted: true;
      parentRuleSetId: Id<"ruleSets">;
      reason: "discarded";
    };
export interface RuleSetCanonicalSnapshot {
  appointmentCoverage: string[];
  appointmentTypes: string[];
  baseSchedules: string[];
  locations: string[];
  mfas: string[];
  practitioners: string[];
  rules: string[];
  vacations: string[];
}

export interface RuleSetDiffSection {
  added: string[];
  key: keyof RuleSetCanonicalSnapshot;
  removed: string[];
  title: string;
}

export interface RuleSetDiffSummary {
  draftRuleSet: {
    _id: Id<"ruleSets">;
    description: string;
    version: number;
  };
  parentRuleSet: {
    _id: Id<"ruleSets">;
    description: string;
    version: number;
  };
  sections: RuleSetDiffSection[];
  totals: {
    added: number;
    changed: number;
    removed: number;
  };
}

type DatabaseReader = GenericDatabaseReader<DataModel>;

type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export async function activateSavedRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
  lifecycle: {
    applyPendingSimulationAppointments: (
      db: DatabaseWriter,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<void>;
  },
): Promise<void> {
  const ruleSet = await validateRuleSet(db, args.ruleSetId, args.practiceId);
  if (!ruleSet.saved) {
    throw new Error("Cannot set an unsaved rule set as active");
  }

  const practice = await db.get("practices", args.practiceId);
  if (practice?.currentActiveRuleSetId === args.ruleSetId) {
    throw new Error("Cannot activate the already active rule set");
  }

  await lifecycle.applyPendingSimulationAppointments(db, args.ruleSetId);
  await db.patch("practices", args.practiceId, {
    currentActiveRuleSetId: args.ruleSetId,
  });
}

export async function discardCurrentDraftRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
  lifecycle: {
    deleteDraftContents: (
      db: DatabaseWriter,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<void>;
  },
): Promise<void> {
  const draftRuleSet = await selectCurrentDraftRuleSet(db, practiceId);
  if (!draftRuleSet) {
    throw new Error("No unsaved rule set exists for this practice");
  }

  await lifecycle.deleteDraftContents(db, draftRuleSet._id);
  await db.delete("ruleSets", draftRuleSet._id);
}

export async function discardDraftRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
  lifecycle: {
    deleteDraftContents: (
      db: DatabaseWriter,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<void>;
  },
): Promise<void> {
  const draftRuleSet = await requireDraftRuleSet(db, args);
  await lifecycle.deleteDraftContents(db, draftRuleSet._id);
  await db.delete("ruleSets", draftRuleSet._id);
}

export async function discardDraftRuleSetIfEquivalentToParent(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
  lifecycle: {
    buildRuleSetCanonicalSnapshot: (
      db: DatabaseReader,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<RuleSetCanonicalSnapshot>;
    deleteDraftContents: (
      db: DatabaseWriter,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<void>;
    hasPendingSimulationAppointments: (
      db: DatabaseReader,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<boolean>;
  },
): Promise<EquivalentDraftDiscardResult> {
  const ruleSet = await db.get("ruleSets", args.ruleSetId);

  if (!ruleSet) {
    throw new Error("Rule set not found");
  }

  if (ruleSet.practiceId !== args.practiceId) {
    throw new Error("Rule set does not belong to this practice");
  }

  if (ruleSet.saved) {
    return {
      deleted: false,
      reason: "not_unsaved",
    };
  }

  if (!ruleSet.parentVersion) {
    return {
      deleted: false,
      reason: "no_parent",
    };
  }

  const parentRuleSet = await db.get("ruleSets", ruleSet.parentVersion);
  if (parentRuleSet?.practiceId !== args.practiceId) {
    return {
      deleted: false,
      reason: "parent_missing",
    };
  }

  if (await lifecycle.hasPendingSimulationAppointments(db, ruleSet._id)) {
    return {
      deleted: false,
      parentRuleSetId: parentRuleSet._id,
      reason: "has_changes",
    };
  }

  const [draftSnapshot, parentSnapshot] = await Promise.all([
    lifecycle.buildRuleSetCanonicalSnapshot(db, ruleSet._id),
    lifecycle.buildRuleSetCanonicalSnapshot(db, parentRuleSet._id),
  ]);

  const isEquivalent =
    JSON.stringify(draftSnapshot) === JSON.stringify(parentSnapshot);

  if (!isEquivalent) {
    return {
      deleted: false,
      parentRuleSetId: parentRuleSet._id,
      reason: "has_changes",
    };
  }

  await lifecycle.deleteDraftContents(db, ruleSet._id);
  await db.delete("ruleSets", ruleSet._id);

  return {
    deleted: true,
    parentRuleSetId: parentRuleSet._id,
    reason: "discarded",
  };
}

export async function saveDraftRuleSet(
  db: DatabaseWriter,
  args: {
    description: string;
    existingSavedDescriptions: string[];
    practiceId: Id<"practices">;
    setAsActive?: boolean;
  },
  lifecycle: {
    activateSavedRuleSet: (
      db: DatabaseWriter,
      args: {
        practiceId: Id<"practices">;
        ruleSetId: Id<"ruleSets">;
      },
    ) => Promise<void>;
  },
): Promise<Id<"ruleSets">> {
  const trimmedDescription = args.description.trim();
  const validationResult = validateRuleSetDescriptionSync(
    trimmedDescription,
    args.existingSavedDescriptions,
  );

  if (!validationResult.isValid) {
    throw new Error(validationResult.error);
  }

  const draftRuleSet = await selectCurrentDraftRuleSet(db, args.practiceId);
  if (!draftRuleSet) {
    throw new Error("No unsaved rule set exists for this practice");
  }
  if (draftRuleSet.saved) {
    throw new Error("Cannot save a rule set that is already saved");
  }

  await db.patch("ruleSets", draftRuleSet._id, {
    description: trimmedDescription,
    draftRevision: 0,
    saved: true,
  });

  if (args.setAsActive) {
    await lifecycle.activateSavedRuleSet(db, {
      practiceId: args.practiceId,
      ruleSetId: draftRuleSet._id,
    });
  }

  return draftRuleSet._id;
}

export async function selectCurrentDraftRuleSet(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Doc<"ruleSets"> | null> {
  return await findUnsavedRuleSet(db, practiceId);
}

export async function summarizeDraftRuleSetDiff(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
  lifecycle: {
    buildAppointmentCoverageDiffSection: (
      db: DatabaseReader,
      args: {
        practiceId: Id<"practices">;
        ruleSetId: Id<"ruleSets">;
      },
    ) => Promise<RuleSetDiffSection>;
    buildRuleSetCanonicalSnapshot: (
      db: DatabaseReader,
      ruleSetId: Id<"ruleSets">,
    ) => Promise<RuleSetCanonicalSnapshot>;
    getMultisetDifference: (values: string[], comparison: string[]) => string[];
    sectionTitles: Record<keyof RuleSetCanonicalSnapshot, string>;
  },
): Promise<null | RuleSetDiffSummary> {
  const draftRuleSet = await db.get("ruleSets", args.ruleSetId);
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

  const parentRuleSet = await db.get("ruleSets", draftRuleSet.parentVersion);
  if (parentRuleSet?.practiceId !== args.practiceId) {
    throw new Error("Parent rule set not found");
  }

  const [draftSnapshot, parentSnapshot, appointmentCoverageSection] =
    await Promise.all([
      lifecycle.buildRuleSetCanonicalSnapshot(db, draftRuleSet._id),
      lifecycle.buildRuleSetCanonicalSnapshot(db, parentRuleSet._id),
      lifecycle.buildAppointmentCoverageDiffSection(db, {
        practiceId: args.practiceId,
        ruleSetId: draftRuleSet._id,
      }),
    ]);

  const sectionKeys = Object.keys(
    lifecycle.sectionTitles,
  ) as (keyof RuleSetCanonicalSnapshot)[];

  const sections = sectionKeys.map((key) => {
    const added = lifecycle.getMultisetDifference(
      draftSnapshot[key],
      parentSnapshot[key],
    );
    const removed = lifecycle.getMultisetDifference(
      parentSnapshot[key],
      draftSnapshot[key],
    );

    return {
      added,
      key,
      removed,
      title: lifecycle.sectionTitles[key],
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
}

async function requireDraftRuleSet(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"ruleSets">> {
  const ruleSet = await db.get("ruleSets", args.ruleSetId);

  if (!ruleSet) {
    throw new Error("Rule set not found");
  }

  if (ruleSet.practiceId !== args.practiceId) {
    throw new Error("Rule set does not belong to this practice");
  }

  if (ruleSet.saved) {
    throw new Error(
      "Cannot delete saved rule sets. Only unsaved rule sets can be deleted.",
    );
  }

  return ruleSet;
}
