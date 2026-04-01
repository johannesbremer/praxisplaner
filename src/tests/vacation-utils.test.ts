import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import { getPractitionerVacationRangesForDate } from "../../lib/vacation-utils";

describe("vacation utils", () => {
  it("splits half-day vacations across actual working time including breaks", () => {
    const date = Temporal.PlainDate.from("2026-04-06");
    const schedules = [
      {
        breakTimes: [{ end: "12:00", start: "11:00" }],
        dayOfWeek: 1,
        endTime: "16:00",
        locationId: "loc-1",
        practitionerId: "doc-1",
        startTime: "08:00",
      },
    ];

    const morningRanges = getPractitionerVacationRangesForDate(
      date,
      "doc-1",
      schedules,
      [
        {
          date: "2026-04-06",
          portion: "morning",
          practitionerId: "doc-1",
          staffType: "practitioner",
        },
      ],
      "loc-1",
    );

    const afternoonRanges = getPractitionerVacationRangesForDate(
      date,
      "doc-1",
      schedules,
      [
        {
          date: "2026-04-06",
          portion: "afternoon",
          practitionerId: "doc-1",
          staffType: "practitioner",
        },
      ],
      "loc-1",
    );

    expect(morningRanges).toEqual([
      { endMinutes: 660, startMinutes: 480 },
      { endMinutes: 750, startMinutes: 720 },
    ]);
    expect(afternoonRanges).toEqual([{ endMinutes: 960, startMinutes: 750 }]);
  });
});
