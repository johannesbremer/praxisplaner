import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import { toTableId } from "../../convex/identity";
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
    locationLineageKey: toTableId<"locations">("location_lineage_main"),
    patient: undefined,
    pendingAppointmentTitle: undefined,
    practiceId: toTableId<"practices">("practice_main"),
    practitionerId: undefined,
    practitionerLineageKey: undefined,
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
      practitionerId: toTableId<"practitioners">("practitioner_1"),
      practitionerLineageKey: toTableId<"practitioners">(
        "practitioner_lineage_1",
      ),
    });
    const simulationResult = buildCalendarAppointmentRequest({
      ...sharedArgs,
      mode: "simulation",
      patient,
      practitionerId: toTableId<"practitioners">("practitioner_1"),
      practitionerLineageKey: toTableId<"practitioners">(
        "practitioner_lineage_1",
      ),
    });

    expect(realResult).toMatchObject({
      kind: "ok",
      request: {
        appointmentTypeId: "appointment_type_checkup",
        isNewPatient: false,
        isSimulation: false,
        locationId: "location_main",
        patientDateOfBirth: "1980-01-01",
        practiceId: "practice_main",
        practitionerId: "practitioner_1",
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
        locationId: "location_main",
        patientDateOfBirth: "1980-01-01",
        practiceId: "practice_main",
        practitionerId: "practitioner_1",
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
        locationLineageKey: "location_lineage_main",
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        title: "EKG Follow-up",
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
        locationId: "location_main",
        practiceId: "practice_main",
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        temporaryPatientName: "Grace Hopper",
        temporaryPatientPhoneNumber: "+491709999999",
        title: "Checkup",
      },
    });
  });
});
