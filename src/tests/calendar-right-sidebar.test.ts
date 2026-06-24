import { describe, expect, test } from "vitest";

import { toTableId } from "@/convex/identity";
import {
  resolveAppointmentSmileyOptionsRuleSetId,
  shouldShowAppointmentSmileyEditor,
  shouldShowAppointmentSmileyInTitle,
} from "@/src/components/calendar-right-sidebar";
import { getSidebarAppointmentCalendarTarget } from "@/src/components/new-calendar";

describe("resolveAppointmentSmileyOptionsRuleSetId", () => {
  test("uses the selected simulation appointment rule set for smiley options", () => {
    const activeRuleSetId = toTableId<"ruleSets">("active-rule-set");
    const simulationRuleSetId = toTableId<"ruleSets">("simulation-rule-set");
    const selectedAppointmentId = toTableId<"appointments">(
      "simulation-appointment",
    );

    expect(
      resolveAppointmentSmileyOptionsRuleSetId({
        defaultRuleSetId: activeRuleSetId,
        patientAppointments: [
          {
            _id: selectedAppointmentId,
            seriesId: "series-1",
            simulationRuleSetId,
          },
        ],
        selectedAppointmentId,
        selectedSeriesId: undefined,
      }),
    ).toBe(simulationRuleSetId);
  });

  test("falls back to the page rule set for real appointments", () => {
    const activeRuleSetId = toTableId<"ruleSets">("active-rule-set");
    const selectedAppointmentId = toTableId<"appointments">("real-appointment");

    expect(
      resolveAppointmentSmileyOptionsRuleSetId({
        defaultRuleSetId: activeRuleSetId,
        patientAppointments: [
          {
            _id: selectedAppointmentId,
            seriesId: "series-1",
          },
        ],
        selectedAppointmentId,
        selectedSeriesId: undefined,
      }),
    ).toBe(activeRuleSetId);
  });
});

describe("shouldShowAppointmentSmileyEditor", () => {
  test("shows the editor only for the exact selected appointment row", () => {
    const rootAppointmentId = toTableId<"appointments">("series-root");
    const followUpAppointmentId = toTableId<"appointments">("series-follow-up");

    expect(
      shouldShowAppointmentSmileyEditor({
        appointmentId: rootAppointmentId,
        selectedAppointmentId: rootAppointmentId,
      }),
    ).toBe(true);
    expect(
      shouldShowAppointmentSmileyEditor({
        appointmentId: followUpAppointmentId,
        selectedAppointmentId: rootAppointmentId,
      }),
    ).toBe(false);
  });
});

describe("shouldShowAppointmentSmileyInTitle", () => {
  test("shows the title marker only when the marked appointment is not exactly selected", () => {
    const selectedAppointmentId = toTableId<"appointments">("selected");
    const otherAppointmentId = toTableId<"appointments">("other");

    expect(
      shouldShowAppointmentSmileyInTitle({
        appointmentId: otherAppointmentId,
        selectedAppointmentId,
        smiley: "👍",
      }),
    ).toBe(true);
    expect(
      shouldShowAppointmentSmileyInTitle({
        appointmentId: selectedAppointmentId,
        selectedAppointmentId,
        smiley: "👍",
      }),
    ).toBe(false);
    expect(
      shouldShowAppointmentSmileyInTitle({
        appointmentId: otherAppointmentId,
        selectedAppointmentId,
        smiley: undefined,
      }),
    ).toBe(false);
  });
});

describe("getSidebarAppointmentCalendarTarget", () => {
  test("keeps the appointment location lineage key when resolving the calendar target", () => {
    const locationLineageKey = toTableId<"locations">(
      "appointment-location-lineage",
    );

    expect(
      getSidebarAppointmentCalendarTarget({
        appointment: {
          locationLineageKey,
          start: "2026-06-24T09:30:00+02:00[Europe/Berlin]",
        },
        businessStartHour: 8,
      }),
    ).toEqual({
      date: expect.objectContaining({ day: 24, month: 6, year: 2026 }),
      locationLineageKey,
      targetScrollTop: 208,
    });
  });
});
