import { describe, expect, it } from "vitest";

import { asPractitionerLineageKey, toTableId } from "../../../convex/identity";
import {
  calendarColumnScopeFromPractitioner,
  calendarColumnScopeKey,
} from "../../../lib/calendar-occupancy";
import { diffCalendarAppointments } from "../../components/calendar/use-calendar-devtools";

describe("calendar devtools diffing", () => {
  const practitioner1 = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_1"),
  );
  const practitioner2 = asPractitionerLineageKey(
    toTableId<"practitioners">("practitioner_2"),
  );
  const practitionerColumn1 =
    calendarColumnScopeFromPractitioner(practitioner1);
  const practitionerColumn2 =
    calendarColumnScopeFromPractitioner(practitioner2);
  const practitionerColumnKey1 = calendarColumnScopeKey(practitionerColumn1);
  const practitionerColumnKey2 = calendarColumnScopeKey(practitionerColumn2);

  it("emits added, removed, and updated ids only when snapshots differ", () => {
    expect(
      diffCalendarAppointments(
        [
          {
            column: practitionerColumnKey1,
            duration: 30,
            id: "appointment_1",
            startTime: "09:00",
          },
          {
            column: practitionerColumnKey1,
            duration: 30,
            id: "appointment_2",
            startTime: "10:00",
          },
        ],
        [
          {
            column: practitionerColumnKey2,
            duration: 45,
            id: "appointment_1",
            startTime: "09:15",
          },
          {
            column: practitionerColumnKey1,
            duration: 30,
            id: "appointment_3",
            startTime: "11:00",
          },
        ],
      ),
    ).toEqual({
      added: ["appointment_3"],
      removed: ["appointment_2"],
      updated: ["appointment_1"],
    });
  });

  it("returns an empty diff for identical snapshots", () => {
    const snapshot = [
      {
        column: practitionerColumnKey1,
        duration: 30,
        id: "appointment_1",
        startTime: "09:00",
      },
    ];

    expect(diffCalendarAppointments(snapshot, snapshot)).toEqual({
      added: [],
      removed: [],
      updated: [],
    });
  });
});
