import { describe, expect, it } from "vitest";

import { toTableId } from "../../../convex/identity";
import {
  getCurrentCalendarRecordById,
  hasCalendarOccupancyConflictInRecords,
  mergeConflictRecordsById,
  mergeConflictRecordsByIdExcluding,
  mergeCurrentConflictRecordsByIdExcluding,
} from "../../components/calendar/use-calendar-logic-helpers";
import { isOptimisticId } from "../../utils/convex-ids";

const toEpochMilliseconds = (iso: string) =>
  new Date(iso.replace("[Europe/Berlin]", "")).getTime();

describe("calendar conflict detection", () => {
  const location1 = toTableId<"locations">("location_1");
  const location2 = toTableId<"locations">("location_2");
  const practitioner1 = toTableId<"practitioners">("practitioner_1");
  const practitioner2 = toTableId<"practitioners">("practitioner_2");

  it("detects blocked-slot replay conflicts against appointments outside the active day cache", () => {
    expect(
      hasCalendarOccupancyConflictInRecords({
        appointments: [
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location1,
            practitionerLineageKey: practitioner1,
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
        blockedSlots: [],
        candidate: {
          end: "2026-04-24T09:45:00+02:00[Europe/Berlin]",
          isSimulation: false,
          locationLineageKey: location1,
          practitionerLineageKey: practitioner1,
          start: "2026-04-24T09:15:00+02:00[Europe/Berlin]",
        },
        toEpochMilliseconds,
      }),
    ).toBe(true);
  });

  it("detects blocked-slot replay conflicts against blocked slots outside the active location cache", () => {
    expect(
      hasCalendarOccupancyConflictInRecords({
        appointments: [],
        blockedSlots: [
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location2,
            practitionerLineageKey: practitioner2,
            start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
          },
        ],
        candidate: {
          end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
          isSimulation: false,
          locationLineageKey: location2,
          practitionerLineageKey: practitioner2,
          start: "2026-04-25T09:15:00+02:00[Europe/Berlin]",
        },
        toEpochMilliseconds,
      }),
    ).toBe(true);
  });

  it("detects appointment replay conflicts against blocked slots", () => {
    expect(
      hasCalendarOccupancyConflictInRecords({
        appointments: [],
        blockedSlots: [
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location2,
            practitionerLineageKey: practitioner2,
            start: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
          },
        ],
        candidate: {
          end: "2026-04-25T09:45:00+02:00[Europe/Berlin]",
          isSimulation: false,
          locationLineageKey: location2,
          practitionerLineageKey: practitioner2,
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
            locationLineageKey: location1,
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
            locationLineageKey: location1,
            start: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.start).toBe("2026-04-24T09:30:00+02:00[Europe/Berlin]");
  });

  it("prefers refreshed current records over stale history snapshots for undo lookups", () => {
    const resolved = getCurrentCalendarRecordById({
      allPracticeMap: new Map([
        [
          "appointment_1",
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location1,
            practitionerLineageKey: practitioner1,
            start: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
      historyMap: new Map([
        [
          "appointment_1",
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location1,
            practitionerLineageKey: practitioner1,
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
      id: "appointment_1",
    });

    expect(resolved?.start).toBe("2026-04-24T09:30:00+02:00[Europe/Berlin]");
  });

  it("prefers refreshed current records over stale history snapshots for conflict preflight", () => {
    const merged = mergeCurrentConflictRecordsByIdExcluding({
      allPracticeMap: new Map([
        [
          "blocked_slot_1",
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location1,
            start: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
      historyMap: new Map([
        [
          "blocked_slot_1",
          {
            _id: toTableId<"blockedSlots">("blocked_slot_1"),
            end: "2026-04-24T09:30:00+02:00[Europe/Berlin]",
            isSimulation: false,
            locationLineageKey: location1,
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
      ]),
    });

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
              locationLineageKey: location1,
              start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
            },
          ],
        ]),
      ],
    });

    expect(merged).toHaveLength(0);
  });

  it("recognizes optimistic ids generated from uuids", () => {
    expect(isOptimisticId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isOptimisticId("blocked_slot_1")).toBe(false);
  });

  it("ignores the appointment being replaced when checking appointment conflicts", () => {
    expect(
      hasCalendarOccupancyConflictInRecords({
        appointments: [
          {
            _id: toTableId<"appointments">("appointment_1"),
            end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
            isSimulation: true,
            locationLineageKey: location1,
            practitionerLineageKey: practitioner1,
            start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
          },
        ],
        blockedSlots: [],
        candidate: {
          end: "2026-04-24T10:00:00+02:00[Europe/Berlin]",
          isSimulation: true,
          locationLineageKey: location1,
          practitionerLineageKey: practitioner1,
          replacesAppointmentId: toTableId<"appointments">("appointment_1"),
          start: "2026-04-24T09:00:00+02:00[Europe/Berlin]",
        },
        toEpochMilliseconds,
      }),
    ).toBe(false);
  });
});
