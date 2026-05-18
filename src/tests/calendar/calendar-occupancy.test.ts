import { describe, expect, expectTypeOf, test } from "vitest";

import type {
  AppointmentOccupancyScope,
  BlockedSlotOccupancyScope,
  CalendarColumnScope,
  CalendarOccupancyScope,
} from "../../../lib/calendar-occupancy";

import {
  appointmentOccupancyFromCalendarColumn,
  blockedSlotOccupancyScopeFromPractitioner,
  calendarColumnScopeFromAppointmentOccupancy,
  calendarColumnScopeFromOccupancy,
  calendarColumnScopeFromPractitioner,
  calendarColumnScopeFromResourceColumn,
  calendarColumnScopeKey,
  calendarOccupancyScopeKey,
  calendarOccupancyScopesConflict,
  createCalendarPlacement,
  getCalendarResourceColumnFromColumn,
  getCalendarResourceColumnFromOccupancy,
  getPractitionerLineageKeyFromColumn,
  getPractitionerLineageKeyFromOccupancy,
  isLocationWideOccupancyScope,
  isPractitionerOccupancyScope,
  isResourceOccupancyScope,
  sameCalendarColumnScope,
  sameCalendarOccupancyScope,
} from "../../../lib/calendar-occupancy";

type LocationKey = "location-1";
type PractitionerKey = "doc-1" | "doc-2";

const practitioner1 =
  calendarColumnScopeFromPractitioner<PractitionerKey>("doc-1");
const practitioner2 =
  calendarColumnScopeFromPractitioner<PractitionerKey>("doc-2");
const ekg = calendarColumnScopeFromResourceColumn("ekg");
const labor = calendarColumnScopeFromResourceColumn("labor");
const locationWide = { kind: "location-wide" } satisfies CalendarOccupancyScope;

describe("calendar occupancy", () => {
  test("classifies practitioner, resource, and location-wide scopes", () => {
    expect(isPractitionerOccupancyScope(practitioner1)).toBe(true);
    expect(isResourceOccupancyScope(practitioner1)).toBe(false);
    expect(isLocationWideOccupancyScope(practitioner1)).toBe(false);

    expect(isPractitionerOccupancyScope(ekg)).toBe(false);
    expect(isResourceOccupancyScope(ekg)).toBe(true);
    expect(isLocationWideOccupancyScope(ekg)).toBe(false);

    expect(isPractitionerOccupancyScope(locationWide)).toBe(false);
    expect(isResourceOccupancyScope(locationWide)).toBe(false);
    expect(isLocationWideOccupancyScope(locationWide)).toBe(true);
  });

  test("converts explicit columns to appointment occupancy without changing identity", () => {
    expect(appointmentOccupancyFromCalendarColumn(practitioner1)).toEqual({
      kind: "practitioner",
      practitionerLineageKey: "doc-1",
    });
    expect(appointmentOccupancyFromCalendarColumn(labor)).toEqual({
      calendarResourceColumn: "labor",
      kind: "resource",
    });
    expect(calendarColumnScopeFromAppointmentOccupancy(practitioner2)).toEqual(
      practitioner2,
    );
    expect(calendarColumnScopeFromOccupancy(locationWide)).toBeNull();
    expect(calendarColumnScopeFromOccupancy(ekg)).toEqual(ekg);
  });

  test("creates blocked slot occupancy from explicit practitioner intent", () => {
    const noPractitioner: PractitionerKey | undefined = undefined;

    expect(blockedSlotOccupancyScopeFromPractitioner("doc-1")).toEqual({
      kind: "practitioner",
      practitionerLineageKey: "doc-1",
    });
    expect(blockedSlotOccupancyScopeFromPractitioner(noPractitioner)).toEqual({
      kind: "location-wide",
    });
  });

  test("extracts resource and practitioner identifiers only from matching scopes", () => {
    expect(getPractitionerLineageKeyFromColumn(practitioner1)).toBe("doc-1");
    expect(getPractitionerLineageKeyFromColumn(ekg)).toBeUndefined();
    expect(getPractitionerLineageKeyFromOccupancy(practitioner2)).toBe("doc-2");
    expect(
      getPractitionerLineageKeyFromOccupancy(locationWide),
    ).toBeUndefined();

    expect(getCalendarResourceColumnFromColumn(ekg)).toBe("ekg");
    expect(getCalendarResourceColumnFromColumn(practitioner1)).toBeUndefined();
    expect(getCalendarResourceColumnFromOccupancy(labor)).toBe("labor");
    expect(
      getCalendarResourceColumnFromOccupancy(locationWide),
    ).toBeUndefined();
  });

  test("uses stable keys and equality for all occupancy kinds", () => {
    expect(calendarColumnScopeKey(practitioner1)).toBe("practitioner:doc-1");
    expect(calendarColumnScopeKey(ekg)).toBe("resource:ekg");
    expect(calendarOccupancyScopeKey(locationWide)).toBe("location-wide");

    expect(
      sameCalendarColumnScope(
        practitioner1,
        calendarColumnScopeFromPractitioner<PractitionerKey>("doc-1"),
      ),
    ).toBe(true);
    expect(sameCalendarColumnScope(practitioner1, practitioner2)).toBe(false);
    expect(sameCalendarOccupancyScope(ekg, labor)).toBe(false);
    expect(
      sameCalendarOccupancyScope(locationWide, {
        kind: "location-wide",
      } satisfies CalendarOccupancyScope),
    ).toBe(true);
  });

  test("matches conflicts by same occupancy or location-wide occupancy", () => {
    expect(
      calendarOccupancyScopesConflict(
        practitioner1,
        calendarColumnScopeFromPractitioner<PractitionerKey>("doc-1"),
      ),
    ).toBe(true);
    expect(calendarOccupancyScopesConflict(practitioner1, practitioner2)).toBe(
      false,
    );
    expect(calendarOccupancyScopesConflict(practitioner1, ekg)).toBe(false);
    expect(calendarOccupancyScopesConflict(ekg, labor)).toBe(false);
    expect(
      calendarOccupancyScopesConflict(
        ekg,
        calendarColumnScopeFromResourceColumn("ekg"),
      ),
    ).toBe(true);
    expect(calendarOccupancyScopesConflict(locationWide, practitioner1)).toBe(
      true,
    );
    expect(calendarOccupancyScopesConflict(labor, locationWide)).toBe(true);
  });

  test("creates placements while preserving narrow location and occupancy types", () => {
    const placement = createCalendarPlacement({
      locationLineageKey: "location-1",
      occupancyScope: practitioner1,
    });

    expect(placement).toEqual({
      locationLineageKey: "location-1",
      occupancyScope: practitioner1,
    });
    expectTypeOf(placement.locationLineageKey).toEqualTypeOf<LocationKey>();
    expectTypeOf(placement.occupancyScope).toEqualTypeOf<
      typeof practitioner1
    >();
  });

  test("keeps appointment, blocked-slot, and column scope types distinct", () => {
    expectTypeOf(locationWide).not.toExtend<
      AppointmentOccupancyScope<PractitionerKey>
    >();
    expectTypeOf(ekg).not.toExtend<
      BlockedSlotOccupancyScope<PractitionerKey>
    >();
    expectTypeOf(locationWide).not.toExtend<
      CalendarColumnScope<PractitionerKey>
    >();
    expectTypeOf(practitioner1).toExtend<
      AppointmentOccupancyScope<PractitionerKey>
    >();
    expectTypeOf(practitioner1).toExtend<
      BlockedSlotOccupancyScope<PractitionerKey>
    >();
    expectTypeOf(ekg).toExtend<AppointmentOccupancyScope<PractitionerKey>>();
    expectTypeOf(ekg).toExtend<CalendarColumnScope<PractitionerKey>>();
  });
});
