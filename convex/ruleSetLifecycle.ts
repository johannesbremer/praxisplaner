import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel, Id } from "./_generated/dataModel";

import {
  createDraftRuleSetFromSource,
  findUnsavedRuleSet,
} from "./copyOnWrite";
import { activateSavedRuleSet } from "./ruleSetActivation";
import { draftRuleSetHasSemanticChanges } from "./ruleSetDiff";
import { validateRuleSetDescriptionSync } from "./ruleSetValidation";

export interface DraftRuleSetForEdit {
  draftRevision: number;
  ruleSetId: Id<"ruleSets">;
}
export type EquivalentDraftDiscardResult =
  | {
      deleted: false;
      parentRuleSetId: Id<"ruleSets">;
      reason: "has_changes";
    }
  | {
      deleted: false;
      reason: "no_parent" | "not_unsaved" | "parent_missing";
    }
  | {
      deleted: true;
      parentRuleSetId: Id<"ruleSets">;
      reason: "discarded";
    };

type DatabaseReader = GenericDatabaseReader<DataModel>;

type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export async function deleteDraftRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<void> {
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

  await deleteRuleSetContents(db, args.ruleSetId);
  await db.delete("ruleSets", args.ruleSetId);
}

export async function discardCurrentDraftRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
): Promise<void> {
  const draftRuleSet = await findUnsavedRuleSet(db, practiceId);
  if (!draftRuleSet) {
    throw new Error("No unsaved rule set exists for this practice");
  }

  await deleteDraftRuleSet(db, {
    practiceId,
    ruleSetId: draftRuleSet._id,
  });
}

export async function discardDraftRuleSetIfEquivalentToParent(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
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
    return { deleted: false, reason: "not_unsaved" };
  }
  if (!ruleSet.parentVersion) {
    return { deleted: false, reason: "no_parent" };
  }

  const parentRuleSet = await db.get("ruleSets", ruleSet.parentVersion);
  if (parentRuleSet?.practiceId !== args.practiceId) {
    return { deleted: false, reason: "parent_missing" };
  }

  if (await hasPendingSimulationAppointmentsForRuleSet(db, ruleSet._id)) {
    return {
      deleted: false,
      parentRuleSetId: parentRuleSet._id,
      reason: "has_changes",
    };
  }

  if (
    await draftRuleSetHasSemanticChanges(db, {
      draftRuleSetId: ruleSet._id,
      parentRuleSetId: parentRuleSet._id,
    })
  ) {
    return {
      deleted: false,
      parentRuleSetId: parentRuleSet._id,
      reason: "has_changes",
    };
  }

  await deleteRuleSetContents(db, ruleSet._id);
  await db.delete("ruleSets", ruleSet._id);

  return {
    deleted: true,
    parentRuleSetId: parentRuleSet._id,
    reason: "discarded",
  };
}

export async function getExistingSavedRuleSetDescriptions(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<string[]> {
  const existingRuleSets = await db
    .query("ruleSets")
    .withIndex("by_practiceId_saved", (q) =>
      q.eq("practiceId", practiceId).eq("saved", true),
    )
    .collect();

  return existingRuleSets.map((ruleSet) => ruleSet.description);
}

export async function saveDraftRuleSet(
  db: DatabaseWriter,
  args: {
    description: string;
    practiceId: Id<"practices">;
    setAsActive?: boolean;
  },
): Promise<Id<"ruleSets">> {
  const trimmedDescription = args.description.trim();
  const existingDescriptions = await getExistingSavedRuleSetDescriptions(
    db,
    args.practiceId,
  );
  const validationResult = validateRuleSetDescriptionSync(
    trimmedDescription,
    existingDescriptions,
  );

  if (!validationResult.isValid) {
    throw new Error(validationResult.error);
  }

  const draftRuleSet = await findUnsavedRuleSet(db, args.practiceId);
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
    await activateSavedRuleSet(db, {
      practiceId: args.practiceId,
      ruleSetId: draftRuleSet._id,
    });
  }

  return draftRuleSet._id;
}

export async function selectDraftRuleSetForEdit(
  db: DatabaseWriter,
  args: {
    expectedDraftRevision: null | number;
    practiceId: Id<"practices">;
    selectedRuleSetId: Id<"ruleSets">;
  },
): Promise<DraftRuleSetForEdit> {
  const existingDraftRuleSet = await findUnsavedRuleSet(db, args.practiceId);
  if (existingDraftRuleSet) {
    const actualRevision = existingDraftRuleSet.draftRevision;
    if (args.expectedDraftRevision !== actualRevision) {
      throw revisionMismatchError({
        actual: actualRevision,
        expected: args.expectedDraftRevision,
        ruleSetId: existingDraftRuleSet._id,
      });
    }
    return {
      draftRevision: actualRevision,
      ruleSetId: existingDraftRuleSet._id,
    };
  }

  if (args.expectedDraftRevision !== null) {
    throw revisionMismatchError({
      actual: null,
      expected: args.expectedDraftRevision,
      ruleSetId: null,
    });
  }

  const sourceRuleSet = await db.get("ruleSets", args.selectedRuleSetId);
  if (sourceRuleSet?.practiceId !== args.practiceId) {
    throw new Error(
      `[COW:SELECTED_RULE_SET_NOT_FOUND] Gewaehltes Regelset ${args.selectedRuleSetId} der Praxis ${args.practiceId} konnte nicht geladen werden.`,
    );
  }
  if (!sourceRuleSet.saved) {
    throw new Error(
      `[COW:SELECTED_RULE_SET_MUST_BE_SAVED] Gewaehltes Regelset ${args.selectedRuleSetId} ist kein gespeichertes Regelset und kann nicht als Draft-Quelle verwendet werden.`,
    );
  }

  return {
    draftRevision: 0,
    ruleSetId: await createDraftRuleSetFromSource(
      db,
      args.practiceId,
      sourceRuleSet,
    ),
  };
}

async function deleteAppointmentTypesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("appointmentTypes", item._id);
    },
  );
}

async function deleteBaseSchedulesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("baseSchedules", item._id);
    },
  );
}

async function deleteByRuleSetQuery<T>(
  takeBatch: () => Promise<T[]>,
  deleteItem: (item: T) => Promise<void>,
): Promise<void> {
  let batch = await takeBatch();

  while (batch.length > 0) {
    for (const item of batch) {
      await deleteItem(item);
    }
    batch = await takeBatch();
  }
}

async function deleteLocationsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("locations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("locations", item._id);
    },
  );
}

async function deleteMfasByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("mfas")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("mfas", item._id);
    },
  );
}

async function deletePractitionersByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("practitioners", item._id);
    },
  );
}

async function deleteRuleConditionsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("ruleConditions")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("ruleConditions", item._id);
    },
  );
}

async function deleteRuleSetContents(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteRuleConditionsByRuleSet(db, ruleSetId);
  await deletePractitionersByRuleSet(db, ruleSetId);
  await deleteLocationsByRuleSet(db, ruleSetId);
  await deleteAppointmentTypesByRuleSet(db, ruleSetId);
  await deleteBaseSchedulesByRuleSet(db, ruleSetId);
  await deleteVacationsByRuleSet(db, ruleSetId);
  await deleteMfasByRuleSet(db, ruleSetId);
  await deleteSimulationAppointmentsByRuleSet(db, ruleSetId);
}

async function deleteSimulationAppointmentsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("appointments")
        .withIndex("by_simulationRuleSetId", (q) =>
          q.eq("simulationRuleSetId", ruleSetId),
        )
        .take(100),
    async (item) => {
      await db.delete("appointments", item._id);
    },
  );
}

async function deleteVacationsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  await deleteByRuleSetQuery(
    () =>
      db
        .query("vacations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .take(100),
    async (item) => {
      await db.delete("vacations", item._id);
    },
  );
}

async function hasPendingSimulationAppointmentsForRuleSet(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
): Promise<boolean> {
  const simulationAppointments = await db
    .query("appointments")
    .withIndex("by_simulationRuleSetId", (q) =>
      q.eq("simulationRuleSetId", ruleSetId),
    )
    .take(1);

  return simulationAppointments.length > 0;
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
