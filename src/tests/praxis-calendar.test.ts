import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../convex/identity";
import { createCalendarPlacement } from "../../lib/calendar-occupancy";
import { buildCalendarDayQueryArgs } from "../components/calendar/calendar-query-args";
import { buildCalendarAppointmentRequest } from "../components/calendar/use-calendar-booking";

describe("calendar day query args", () => {
  it("builds stable day-scoped args for the selected date", () => {
    const selectedDate = Temporal.PlainDate.from("2026-04-23");

    expect(
      buildCalendarDayQueryArgs({
        activeRuleSetId: toTableId<"ruleSets">("rules_active"),
        locationId: toTableId<"locations">("location_main"),
        practiceId: toTableId<"practices">("practice_main"),
        ruleSetId: toTableId<"ruleSets">("rules_display"),
        scope: "real",
        selectedDate,
      }),
    ).toEqual({
      activeRuleSetId: "rules_active",
      dayEnd: "2026-04-24T00:00:00+02:00[Europe/Berlin]",
      dayStart: "2026-04-23T00:00:00+02:00[Europe/Berlin]",
      locationId: "location_main",
      practiceId: "practice_main",
      scope: "real",
      selectedRuleSetId: "rules_display",
    });
  });

  it("omits optional ids when they are not provided", () => {
    const selectedDate = Temporal.PlainDate.from("2026-12-01");

    expect(
      buildCalendarDayQueryArgs({
        activeRuleSetId: undefined,
        locationId: undefined,
        practiceId: toTableId<"practices">("practice_main"),
        ruleSetId: undefined,
        scope: "simulation",
        selectedDate,
      }),
    ).toEqual({
      dayEnd: "2026-12-02T00:00:00+01:00[Europe/Berlin]",
      dayStart: "2026-12-01T00:00:00+01:00[Europe/Berlin]",
      practiceId: "practice_main",
      scope: "simulation",
    });
  });

  it("returns null when the practice id is missing", () => {
    expect(
      buildCalendarDayQueryArgs({
        activeRuleSetId: undefined,
        locationId: undefined,
        practiceId: undefined,
        ruleSetId: undefined,
        scope: "real",
        selectedDate: Temporal.PlainDate.from("2026-04-23"),
      }),
    ).toBeNull();
  });
});

describe("calendar appointment request builder", () => {
  const selectedDate = Temporal.PlainDate.from("2026-04-23");
  const practitionerPlacement = createCalendarPlacement({
    locationLineageKey: asLocationLineageKey(
      toTableId<"locations">("location_lineage_main"),
    ),
    occupancyScope: {
      kind: "practitioner",
      practitionerLineageKey: asPractitionerLineageKey(
        toTableId<"practitioners">("practitioner_lineage_1"),
      ),
    },
  });
  const resourcePlacement = createCalendarPlacement({
    locationLineageKey: asLocationLineageKey(
      toTableId<"locations">("location_lineage_main"),
    ),
    occupancyScope: {
      calendarResourceColumn: "ekg",
      kind: "resource",
    },
  });
  const sharedArgs = {
    appointmentTypeId: toTableId<"appointmentTypes">(
      "appointment_type_checkup",
    ),
    appointmentTypeLineageKey: toTableId<"appointmentTypes">(
      "appointment_type_lineage_checkup",
    ),
    appointmentTypeName: "Checkup",
    businessStartHour: 8,
    isNewPatient: false,
    locationId: toTableId<"locations">("location_main"),
    patient: undefined,
    pendingAppointmentTitle: undefined,
    placement: practitionerPlacement,
    practiceId: toTableId<"practices">("practice_main"),
    selectedDate,
    slot: 12,
    slotDurationMinutes: 5,
  } as const;

  it("builds the same payload shape for real and simulation modes", () => {
    const patient = {
      dateOfBirth: "1980-01-01",
      userId: toTableId<"users">("user_1"),
    } as const;

    const realResult = buildCalendarAppointmentRequest({
      ...sharedArgs,
      mode: "real",
      patient,
    });
    const simulationResult = buildCalendarAppointmentRequest({
      ...sharedArgs,
      mode: "simulation",
      patient,
    });

    expect(realResult).toMatchObject({
      kind: "ok",
      request: {
        appointmentTypeId: "appointment_type_checkup",
        isNewPatient: false,
        isSimulation: false,
        patientDateOfBirth: "1980-01-01",
        placement: practitionerPlacement,
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "Checkup",
        userId: "user_1",
      },
    });
    expect(simulationResult).toMatchObject({
      kind: "ok",
      request: {
        appointmentTypeId: "appointment_type_checkup",
        isNewPatient: false,
        isSimulation: true,
        patientDateOfBirth: "1980-01-01",
        placement: practitionerPlacement,
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "Checkup",
        userId: "user_1",
      },
    });
  });

  it("returns a missing-patient branch with the request context", () => {
    expect(
      buildCalendarAppointmentRequest({
        ...sharedArgs,
        mode: "real",
        patient: undefined,
        pendingAppointmentTitle: "EKG Follow-up",
      }),
    ).toEqual({
      kind: "missing-patient",
      requestContext: {
        appointmentTypeLineageKey: "appointment_type_lineage_checkup",
        isSimulation: false,
        placement: practitionerPlacement,
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "EKG Follow-up",
      },
    });
  });

  it("keeps resource placements in the missing-patient request context", () => {
    expect(
      buildCalendarAppointmentRequest({
        ...sharedArgs,
        mode: "real",
        patient: undefined,
        placement: resourcePlacement,
      }),
    ).toEqual({
      kind: "missing-patient",
      requestContext: {
        appointmentTypeLineageKey: "appointment_type_lineage_checkup",
        isSimulation: false,
        placement: resourcePlacement,
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "Checkup",
      },
    });
  });

  it("uses temporary-patient fields when no persisted patient exists yet", () => {
    expect(
      buildCalendarAppointmentRequest({
        ...sharedArgs,
        isNewPatient: true,
        mode: "simulation",
        patient: {
          isNewPatient: true,
          name: "Grace Hopper",
          phoneNumber: "+491709999999",
          recordType: "temporary",
        },
      }),
    ).toEqual({
      kind: "ok",
      request: {
        appointmentTypeId: "appointment_type_checkup",
        isNewPatient: true,
        isSimulation: true,
        placement: practitionerPlacement,
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        temporaryPatientName: "Grace Hopper",
        temporaryPatientPhoneNumber: "+491709999999",
        title: "Checkup",
      },
    });
  });

  it("keeps resource placements in the appointment request", () => {
    expect(
      buildCalendarAppointmentRequest({
        ...sharedArgs,
        mode: "real",
        patient: {
          dateOfBirth: "1980-01-01",
          isNewPatient: false,
          userId: toTableId<"users">("user_1"),
        },
        placement: {
          ...resourcePlacement,
          occupancyScope: {
            calendarResourceColumn: "labor",
            kind: "resource",
          },
        },
      }),
    ).toEqual({
      kind: "ok",
      request: {
        appointmentTypeId: "appointment_type_checkup",
        isNewPatient: false,
        isSimulation: false,
        patientDateOfBirth: "1980-01-01",
        placement: {
          ...resourcePlacement,
          occupancyScope: {
            calendarResourceColumn: "labor",
            kind: "resource",
          },
        },
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "Checkup",
        userId: "user_1",
      },
    });
  });
});
