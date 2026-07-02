import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  getPractitionerVacationRangesForDate,
  getPractitionerVacationReasonForMinute,
} from "../../lib/vacation-utils";

describe("vacation utils", () => {
  it("uses the largest break as the split between morning and afternoon", () => {
    const date = Temporal.PlainDate.from("2026-04-06");
    const schedules = [
      {
        breakTimes: [{ end: "12:00", start: "11:00" }],
        dayOfWeek: 1,
        endTime: "16:00",
        locationLineageKey: "loc-1",
        practitionerLineageKey: "doc-1",
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
          practitionerLineageKey: "doc-1",
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
          practitionerLineageKey: "doc-1",
          staffType: "practitioner",
        },
      ],
      "loc-1",
    );

    expect(morningRanges).toEqual([{ endMinutes: 660, startMinutes: 480 }]);
    expect(afternoonRanges).toEqual([{ endMinutes: 960, startMinutes: 720 }]);
  });

  it("resolves the single absence reason for blocked vacation minutes", () => {
    const date = Temporal.PlainDate.from("2026-04-06");
    const schedules = [
      {
        breakTimes: [{ end: "12:00", start: "11:00" }],
        dayOfWeek: 1,
        endTime: "16:00",
        locationLineageKey: "loc-1",
        practitionerLineageKey: "doc-1",
        startTime: "08:00",
      },
    ];
    const vacations = [
      {
        date: "2026-04-06",
        portion: "morning" as const,
        practitionerLineageKey: "doc-1",
        reason: "sick" as const,
        staffType: "practitioner" as const,
      },
    ];

    expect(
      getPractitionerVacationReasonForMinute(
        date,
        "doc-1",
        schedules,
        vacations,
        600,
        "loc-1",
      ),
    ).toBe("sick");
    expect(
      getPractitionerVacationReasonForMinute(
        date,
        "doc-1",
        schedules,
        vacations,
        780,
        "loc-1",
      ),
    ).toBeUndefined();
  });

  it("uses the equally large break closest to the center as the split", () => {
    const date = Temporal.PlainDate.from("2026-04-06");
    const schedules = [
      {
        breakTimes: [
          { end: "10:00", start: "09:00" },
          { end: "13:00", start: "12:00" },
        ],
        dayOfWeek: 1,
        endTime: "17:00",
        practitionerLineageKey: "doc-1",
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
          practitionerLineageKey: "doc-1",
          staffType: "practitioner",
        },
      ],
    );

    const afternoonRanges = getPractitionerVacationRangesForDate(
      date,
      "doc-1",
      schedules,
      [
        {
          date: "2026-04-06",
          portion: "afternoon",
          practitionerLineageKey: "doc-1",
          staffType: "practitioner",
        },
      ],
    );

    expect(morningRanges).toEqual([
      { endMinutes: 540, startMinutes: 480 },
      { endMinutes: 720, startMinutes: 600 },
    ]);
    expect(afternoonRanges).toEqual([{ endMinutes: 1020, startMinutes: 780 }]);
  });

  it("falls back to duration-based splitting when there are no breaks", () => {
    const date = Temporal.PlainDate.from("2026-04-06");
    const schedules = [
      {
        dayOfWeek: 1,
        endTime: "16:00",
        practitionerLineageKey: "doc-1",
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
          practitionerLineageKey: "doc-1",
          staffType: "practitioner",
        },
      ],
    );

    const afternoonRanges = getPractitionerVacationRangesForDate(
      date,
      "doc-1",
      schedules,
      [
        {
          date: "2026-04-06",
          portion: "afternoon",
          practitionerLineageKey: "doc-1",
          staffType: "practitioner",
        },
      ],
    );

    expect(morningRanges).toEqual([{ endMinutes: 720, startMinutes: 480 }]);
    expect(afternoonRanges).toEqual([{ endMinutes: 960, startMinutes: 720 }]);
  });
});
