import { describe, expect, test } from "vitest";

import type { Doc } from "../_generated/dataModel";

import {
  getEffectiveAppointmentReplacementView,
  getEffectiveLiveAppointments,
} from "../appointmentConflicts";
import { toTableId } from "../identity";

function appointment(
  id: string,
  args: {
    cancelledAt?: bigint;
    isSimulation?: true;
    replacesAppointmentId?: Doc<"appointments">["_id"];
    simulationRuleSetId?: Doc<"ruleSets">["_id"];
    start?: string;
  } = {},
): Doc<"appointments"> {
  const start = args.start ?? "2025-01-01T09:00:00+01:00[Europe/Berlin]";
  return {
    _creationTime: 0,
    _id: toTableId<"appointments">(id),
    appointmentTypeLineageKey:
      toTableId<"appointmentTypes">("appointment_type"),
    appointmentTypeTitle: "Kontrolle",
    createdAt: 1n,
    end: "2025-01-01T09:30:00+01:00[Europe/Berlin]",
    lastModified: 1n,
    locationLineageKey: toTableId<"locations">("location"),
    practiceId: toTableId<"practices">("practice"),
    start,
    title: "Termin",
    ...(args.cancelledAt === undefined
      ? {}
      : { cancelledAt: args.cancelledAt }),
    ...(args.isSimulation === undefined ? {} : { isSimulation: true }),
    ...(args.replacesAppointmentId === undefined
      ? {}
      : { replacesAppointmentId: args.replacesAppointmentId }),
    ...(args.simulationRuleSetId === undefined
      ? {}
      : { simulationRuleSetId: args.simulationRuleSetId }),
  };
}

describe("getEffectiveLiveAppointments", () => {
  test("keeps only current live replacement tails", () => {
    const original = appointment("original");
    const replacement = appointment("replacement", {
      replacesAppointmentId: original._id,
      start: "2025-01-01T10:00:00+01:00[Europe/Berlin]",
    });

    expect(getEffectiveLiveAppointments([original, replacement])).toEqual([
      replacement,
    ]);
  });

  test("collapses replacement chains to the newest visible tail", () => {
    const original = appointment("original");
    const firstReplacement = appointment("first_replacement", {
      replacesAppointmentId: original._id,
      start: "2025-01-01T10:00:00+01:00[Europe/Berlin]",
    });
    const secondReplacement = appointment("second_replacement", {
      replacesAppointmentId: firstReplacement._id,
      start: "2025-01-01T11:00:00+01:00[Europe/Berlin]",
    });

    expect(
      getEffectiveLiveAppointments([
        original,
        secondReplacement,
        firstReplacement,
      ]),
    ).toEqual([secondReplacement]);
  });

  test("ignores cancelled appointments and simulations", () => {
    const active = appointment("active");
    const cancelled = appointment("cancelled", { cancelledAt: 2n });
    const simulation = appointment("simulation", { isSimulation: true });

    expect(
      getEffectiveLiveAppointments([simulation, cancelled, active]).map(
        (record) => record._id,
      ),
    ).toEqual([active._id]);
  });
});

describe("getEffectiveAppointmentReplacementView", () => {
  test("applies simulations only as an overlay on current live tails", () => {
    const original = appointment("original");
    const liveReplacement = appointment("live_replacement", {
      replacesAppointmentId: original._id,
      start: "2025-01-01T10:00:00+01:00[Europe/Berlin]",
    });
    const staleSimulation = appointment("stale_simulation", {
      isSimulation: true,
      replacesAppointmentId: original._id,
      simulationRuleSetId: toTableId<"ruleSets">("draft"),
      start: "2025-01-01T11:00:00+01:00[Europe/Berlin]",
    });

    expect(
      getEffectiveAppointmentReplacementView(
        [original, liveReplacement, staleSimulation],
        {
          draftRuleSetId: toTableId<"ruleSets">("draft"),
          view: "simulation",
        },
      ).map((record) => record._id),
    ).toEqual([liveReplacement._id]);
  });

  test("simulation replacement wins over its current live source", () => {
    const liveAppointment = appointment("live");
    const simulation = appointment("simulation", {
      isSimulation: true,
      replacesAppointmentId: liveAppointment._id,
      simulationRuleSetId: toTableId<"ruleSets">("draft"),
      start: "2025-01-01T10:00:00+01:00[Europe/Berlin]",
    });

    expect(
      getEffectiveAppointmentReplacementView([liveAppointment, simulation], {
        draftRuleSetId: toTableId<"ruleSets">("draft"),
        view: "simulation",
      }).map((record) => record._id),
    ).toEqual([simulation._id]);
  });
});
