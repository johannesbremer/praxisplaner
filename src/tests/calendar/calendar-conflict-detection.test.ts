import { describe, expect, it } from "vitest";

import { toTableId } from "../../../convex/identity";
import {
  hasAppointmentConflictInRecords,
  hasBlockedSlotConflictInRecords,
  mergeConflictRecordsById,
  mergeConflictRecordsByIdExcluding,
} from "../../components/calendar/use-calendar-logic-helpers";

const toEpochMilliseconds = (iso: string) =>
  new Date(iso.replace("[Europe/Berlin]", "")).getTime();

describe("calendar conflict detection", () => {
  it("detects blocked-slot replay conflicts against appointments outside the active day cache", () => {
    expect(
      hasBlockedSlotConflictInRecords({
        appointments: [
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationId: toTableId<"locations">("location_1"),
            practitionerId: toTableId<"practitioners">("practitioner_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
        blockedSlots: [],
        candidate: {
          end: "2026-04-24T09:45:00+02:00[Europe/Berlin]",
          isSimulation: false,
          locationId: toTableId<"locations">("location_1"),
          practitionerId: toTableId<"practitioners">("practitioner_1"),
          start: "2026-04-24T09:15:00+02:00[Europe/Berlin]",
        },
        toEpochMilliseconds,
      }),
    ).toBe(true);
  });

  it("detects blocked-slot replay conflicts against blocked slots outside the active location cache", () => {
    expect(
      hasBlockedSlotConflictInRecords({
        appointments: [],
        blockedSlots: [
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationId: toTableId<"locations">("location_2"),
            practitionerId: toTableId<"practitioners">("practitioner_2"),
            start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
          },
        ],
        candidate: {
          end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
          isSimulation: false,
          locationId: toTableId<"locations">("location_2"),
          practitionerId: toTableId<"practitioners">("practitioner_2"),
          start: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
        },
        toEpochMilliseconds,
      }),
    ).toBe(true);
  });

  it("prefers newer history snapshots over stale full-query records with the same id", () => {
    const merged = mergeConflictRecordsById(
      new Map([
        [
          "blocked_slot_1",
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationId: toTableId<"locations">("location_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
      new Map([
        [
          "blocked_slot_1",
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationId: toTableId<"locations">("location_1"),
            start: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.start).toBe("2026-04-24T09:30:00+02:00[Europe/Berlin]");
  });

  it("excludes locally deleted records while queries are still stale", () => {
    const merged = mergeConflictRecordsByIdExcluding({
      excludedIds: new Set(["blocked_slot_1"]),
      maps: [
        new Map([
          [
            "blocked_slot_1",
            {
              _id: toTableId<"blockedSlots">("blocked_slot_1"),
              end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
              isSimulation: false,
              locationId: toTableId<"locations">("location_1"),
              start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
            },
          ],
        ]),
      ],
    });

    expect(merged).toHaveLength(0);
  });

  it("ignores the appointment being replaced when checking appointment conflicts", () => {
    expect(
      hasAppointmentConflictInRecords(
        {
          end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
          isSimulation: true,
          locationId: toTableId<"locations">("location_1"),
          practitionerId: toTableId<"practitioners">("practitioner_1"),
          replacesAppointmentId: toTableId<"appointments">("appointment_1"),
          start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
        },
        [
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
            isSimulation: true,
            locationId: toTableId<"locations">("location_1"),
            practitionerId: toTableId<"practitioners">("practitioner_1"),
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
        undefined,
        toEpochMilliseconds,
      ),
    ).toBe(false);
  });
});
