import type { GenericDatabaseWriter } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import {
  appointmentOverlapsCandidate,
  findConflictingAppointment,
} from "./appointmentConflicts";
import { isActivationBoundSimulation } from "./appointmentSimulation";
import { asLocationLineageKey, asPractitionerLineageKey } from "./identity";

type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export async function activateInitialRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"ruleSetActivations">> {
  await db.patch("practices", args.practiceId, {
    currentActiveRuleSetId: args.ruleSetId,
  });

  return await insertRuleSetActivation(db, {
    activatedRuleSetId: args.ruleSetId,
    practiceId: args.practiceId,
  });
}

export async function activateSavedRuleSet(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Id<"ruleSetActivations">> {
  const ruleSet = await validateRuleSetForActivation(
    db,
    args.ruleSetId,
    args.practiceId,
  );
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
  await db.patch("practices", args.practiceId, {
    currentActiveRuleSetId: args.ruleSetId,
  });

  const activationArgs = {
    activatedRuleSetId: args.ruleSetId,
    practiceId: args.practiceId,
    ...(practice.currentActiveRuleSetId
      ? { previousActiveRuleSetId: practice.currentActiveRuleSetId }
      : {}),
  };
  return await insertRuleSetActivation(db, activationArgs);
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

async function insertRuleSetActivation(
  db: DatabaseWriter,
  args: {
    activatedRuleSetId: Id<"ruleSets">;
    practiceId: Id<"practices">;
    previousActiveRuleSetId?: Id<"ruleSets">;
  },
): Promise<Id<"ruleSetActivations">> {
  return await db.insert("ruleSetActivations", {
    activatedAt: BigInt(Date.now()),
    activatedRuleSetId: args.activatedRuleSetId,
    practiceId: args.practiceId,
    ...(args.previousActiveRuleSetId
      ? { previousActiveRuleSetId: args.previousActiveRuleSetId }
      : {}),
  });
}

async function validateRuleSetForActivation(
  db: DatabaseWriter,
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
