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
import { requireLineageKey } from "./lineage";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
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
async function applyPendingSimulationAppointmentsForRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
) {
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

async function deleteSimulationAppointmentsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("appointments")
    .withIndex("by_simulationRuleSetId", (q) =>
      q.eq("simulationRuleSetId", ruleSetId),
    )
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("appointments", item._id);
    }
    batch = await db
      .query("appointments")
      .withIndex("by_simulationRuleSetId", (q) =>
        q.eq("simulationRuleSetId", ruleSetId),
      )
      .take(batchSize);
  }
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

async function deleteMfasByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("mfas")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("mfas", item._id);
    }
    batch = await db
      .query("mfas")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

async function deleteVacationsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("vacations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("vacations", item._id);
    }
    batch = await db
      .query("vacations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete rule conditions by ruleSetId in batches.
 */
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

  const practice = await db.get("practices", args.practiceId);
  if (!practice) {
    throw new Error("Practice not found");
  }
  if (practice.currentActiveRuleSetId === args.ruleSetId) {
    throw new Error("Cannot activate the already active rule set");
  }

  await applyPendingSimulationAppointmentsForRuleSet(db, args.ruleSetId);
  await db.insert("ruleSetActivations", {
    activatedAt: Date.now(),
    practiceId: args.practiceId,
    ...(practice.currentActiveRuleSetId
      ? { previousRuleSetId: practice.currentActiveRuleSetId }
      : {}),
    ruleSetId: args.ruleSetId,
  });
  await db.patch("practices", args.practiceId, {
    currentActiveRuleSetId: args.ruleSetId,
  });
}

export async function discardCurrentDraftRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
): Promise<void> {
  const draftRuleSet = await selectCurrentDraftRuleSet(db, practiceId);
  if (!draftRuleSet) {
    throw new Error("No unsaved rule set exists for this practice");
  }

  await deleteDraftRuleSetContents(db, draftRuleSet._id);
  await db.delete("ruleSets", draftRuleSet._id);
}

export async function discardDraftRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<void> {
  const draftRuleSet = await requireDraftRuleSet(db, args);
  await deleteDraftRuleSetContents(db, draftRuleSet._id);
  await db.delete("ruleSets", draftRuleSet._id);
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

  if (await hasPendingSimulationAppointmentsForRuleSet(db, ruleSet._id)) {
    return {
      deleted: false,
      parentRuleSetId: parentRuleSet._id,
      reason: "has_changes",
    };
  }

  const [draftSnapshot, parentSnapshot] = await Promise.all([
    buildRuleSetCanonicalSnapshot(db, ruleSet._id),
    buildRuleSetCanonicalSnapshot(db, parentRuleSet._id),
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

  await deleteDraftRuleSetContents(db, ruleSet._id);
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

  return existingRuleSets.map((rs) => rs.description);
}

export async function saveDraftRuleSet(
  db: DatabaseWriter,
  args: {
    description: string;
    existingSavedDescriptions: string[];
    practiceId: Id<"practices">;
    setAsActive?: boolean;
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
    await activateSavedRuleSet(db, {
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
      buildRuleSetCanonicalSnapshot(db, draftRuleSet._id),
      buildRuleSetCanonicalSnapshot(db, parentRuleSet._id),
      buildAppointmentCoverageDiffSection(db, {
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
}

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
      key: "appointmentCoverage" as const,
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
    key: "appointmentCoverage" as const,
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

async function deleteDraftRuleSetContents(
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
