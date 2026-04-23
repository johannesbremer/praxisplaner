import { describe, expect, it } from "vitest";

import { diffCalendarAppointments } from "../../components/calendar/use-calendar-devtools";

describe("calendar devtools diffing", () => {
  it("emits added, removed, and updated ids only when snapshots differ", () => {
    expect(
      diffCalendarAppointments(
        [
          {
            column: "practitioner_1",
            duration: 30,
            id: "appointment_1",
            startTime: "09:00",
          },
          {
            column: "practitioner_1",
            duration: 30,
            id: "appointment_2",
            startTime: "10:00",
          },
        ],
        [
          {
            column: "practitioner_2",
            duration: 45,
            id: "appointment_1",
            startTime: "09:15",
          },
          {
            column: "practitioner_1",
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
        column: "practitioner_1",
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
