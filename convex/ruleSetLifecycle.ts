import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import {
  appointmentOverlapsCandidate,
  findConflictingAppointment,
} from "./appointmentConflicts";
import { isActivationBoundSimulation } from "./appointmentSimulation";
import { findUnsavedRuleSet, validateRuleSet } from "./copyOnWrite";
import { asLocationLineageKey, asPractitionerLineageKey } from "./identity";
import { validateRuleSetDescriptionSync } from "./ruleSetValidation";

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
export type RuleSetSnapshotBuilder<TSnapshot> = (
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
) => Promise<TSnapshot>;

type DatabaseReader = GenericDatabaseReader<DataModel>;

type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export async function activateSavedRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<void> {
  const ruleSet = await validateRuleSet(db, args.ruleSetId, args.practiceId);
  if (!ruleSet.saved) {
    throw new Error("Cannot set an unsaved rule set as active");
  }

  await applyPendingSimulationAppointmentsForRuleSet(db, args.ruleSetId);
  await db.patch("practices", args.practiceId, {
    currentActiveRuleSetId: args.ruleSetId,
  });
}

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

export async function discardDraftRuleSetIfEquivalentToParent<TSnapshot>(
  db: DatabaseWriter,
  args: {
    buildSnapshot: RuleSetSnapshotBuilder<TSnapshot>;
    isEquivalent: (draft: TSnapshot, parent: TSnapshot) => boolean;
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

  const [draftSnapshot, parentSnapshot] = await Promise.all([
    args.buildSnapshot(db, ruleSet._id),
    args.buildSnapshot(db, parentRuleSet._id),
  ]);

  if (!args.isEquivalent(draftSnapshot, parentSnapshot)) {
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

async function applyPendingSimulationAppointmentsForRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
): Promise<void> {
  const activatedRuleSet = await db.get("ruleSets", ruleSetId);
  if (!activatedRuleSet) {
    throw new Error(`Regelset ${ruleSetId} nicht gefunden.`);
  }
  const simulationAppointments = await db
    .query("appointments")
    .withIndex("by_simulationRuleSetId", (q) =>
      q.eq("simulationRuleSetId", ruleSetId),
    )
    .collect();

  const activationBoundSimulations = simulationAppointments.filter(
    isActivationBoundSimulation,
  );

  for (const simulationAppointment of simulationAppointments) {
    if (
      !isActivationBoundSimulation(simulationAppointment) ||
      !simulationAppointment.replacesAppointmentId
    ) {
      await db.delete("appointments", simulationAppointment._id);
    }
  }

  const replacedAppointmentIds = new Set<Id<"appointments">>();
  const replacedAppointments = new Map<
    Id<"appointments">,
    Doc<"appointments">
  >();

  for (const simulationAppointment of activationBoundSimulations) {
    const replacedAppointmentId = simulationAppointment.replacesAppointmentId;
    if (!replacedAppointmentId) {
      continue;
    }
    if (replacedAppointmentIds.has(replacedAppointmentId)) {
      throw new Error(
        "Ein echter Termin wird mehrfach durch vorgemerkte Simulationen ersetzt. Bitte Vorschläge neu berechnen.",
      );
    }
    replacedAppointmentIds.add(replacedAppointmentId);

    const replacedAppointment = await db.get(
      "appointments",
      replacedAppointmentId,
    );
    if (!replacedAppointment) {
      await db.delete("appointments", simulationAppointment._id);
      continue;
    }

    replacedAppointments.set(replacedAppointmentId, replacedAppointment);

    const simulationValidatedAt =
      simulationAppointment.simulationValidatedAt ??
      simulationAppointment.createdAt;
    if (replacedAppointment.lastModified > simulationValidatedAt) {
      throw new Error(
        "Ein vorgemerkter Termin wurde nach der Simulation geändert. Bitte Vorschläge neu berechnen.",
      );
    }
  }

  const validActivationSimulations = activationBoundSimulations.filter(
    (simulationAppointment) =>
      simulationAppointment.replacesAppointmentId !== undefined &&
      replacedAppointments.has(simulationAppointment.replacesAppointmentId),
  );

  for (let index = 0; index < validActivationSimulations.length; index += 1) {
    const currentSimulation = validActivationSimulations[index];
    if (!currentSimulation) {
      continue;
    }
    const currentCandidate = {
      end: currentSimulation.end,
      locationLineageKey: asLocationLineageKey(
        currentSimulation.locationLineageKey,
      ),
      ...(currentSimulation.practitionerLineageKey
        ? {
            practitionerLineageKey: asPractitionerLineageKey(
              currentSimulation.practitionerLineageKey,
            ),
          }
        : {}),
      start: currentSimulation.start,
    };

    for (
      let otherIndex = index + 1;
      otherIndex < validActivationSimulations.length;
      otherIndex += 1
    ) {
      const otherSimulation = validActivationSimulations[otherIndex];
      if (!otherSimulation) {
        continue;
      }
      if (
        appointmentOverlapsCandidate(
          {
            end: otherSimulation.end,
            locationLineageKey: asLocationLineageKey(
              otherSimulation.locationLineageKey,
            ),
            ...(otherSimulation.practitionerLineageKey
              ? {
                  practitionerLineageKey: asPractitionerLineageKey(
                    otherSimulation.practitionerLineageKey,
                  ),
                }
              : {}),
            start: otherSimulation.start,
          },
          currentCandidate,
        )
      ) {
        throw new Error(
          "Zwei vorgemerkte Terminverschiebungen kollidieren miteinander. Bitte Vorschläge neu berechnen.",
        );
      }
    }
  }

  const excludeAppointmentIds = [...replacedAppointmentIds];

  for (const simulationAppointment of validActivationSimulations) {
    const replacedAppointmentId = simulationAppointment.replacesAppointmentId;
    if (!replacedAppointmentId) {
      continue;
    }
    const replacedAppointment = replacedAppointments.get(replacedAppointmentId);
    if (!replacedAppointment) {
      continue;
    }

    const conflictingAppointment = await findConflictingAppointment(db, {
      candidate: {
        end: simulationAppointment.end,
        locationLineageKey: asLocationLineageKey(
          simulationAppointment.locationLineageKey,
        ),
        ...(simulationAppointment.practitionerLineageKey
          ? {
              practitionerLineageKey: asPractitionerLineageKey(
                simulationAppointment.practitionerLineageKey,
              ),
            }
          : {}),
        start: simulationAppointment.start,
      },
      excludeAppointmentIds,
      occupancyView: "live",
      practiceId: simulationAppointment.practiceId,
    });

    if (conflictingAppointment) {
      throw new Error(
        "Ein vorgemerkter Termin kollidiert inzwischen mit einem echten Termin. Bitte Vorschläge neu berechnen.",
      );
    }
  }

  for (const simulationAppointment of validActivationSimulations) {
    const replacedAppointmentId = simulationAppointment.replacesAppointmentId;
    if (!replacedAppointmentId) {
      continue;
    }

    await db.patch("appointments", replacedAppointmentId, {
      appointmentTypeLineageKey:
        simulationAppointment.appointmentTypeLineageKey,
      appointmentTypeTitle: simulationAppointment.appointmentTypeTitle,
      end: simulationAppointment.end,
      lastModified: BigInt(Date.now()),
      locationLineageKey: simulationAppointment.locationLineageKey,
      ...(simulationAppointment.patientId
        ? { patientId: simulationAppointment.patientId }
        : {}),
      practitionerLineageKey: simulationAppointment.practitionerLineageKey,
      start: simulationAppointment.start,
      title: simulationAppointment.title,
      ...(simulationAppointment.userId
        ? { userId: simulationAppointment.userId }
        : {}),
    });
    await db.delete("appointments", simulationAppointment._id);
  }
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
