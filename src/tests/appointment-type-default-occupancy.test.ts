import { describe, expect, test } from "vitest";

import { sameAppointmentTypeDefaultOccupancy } from "../utils/appointment-type-default-occupancy";

describe("appointment type default occupancy comparison", () => {
  test("treats missing occupancy as selected practitioner", () => {
    expect(
      sameAppointmentTypeDefaultOccupancy(undefined, {
        kind: "selectedPractitioner",
      }),
    ).toBe(true);
  });

  test("distinguishes practitioner and room occupancy", () => {
    expect(
      sameAppointmentTypeDefaultOccupancy(
        { kind: "selectedPractitioner" },
        { calendarResourceColumn: "ekg", kind: "resourceColumn" },
      ),
    ).toBe(false);
  });

  test("distinguishes EKG and Labor resource occupancy", () => {
    expect(
      sameAppointmentTypeDefaultOccupancy(
        { calendarResourceColumn: "ekg", kind: "resourceColumn" },
        { calendarResourceColumn: "labor", kind: "resourceColumn" },
      ),
    ).toBe(false);
  });
});
