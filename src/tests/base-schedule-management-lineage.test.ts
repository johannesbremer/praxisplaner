import { describe, expect, test } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";

import {
  buildScheduleLineageKeyByDayMap,
  resolveCreatedScheduleLineageKey,
} from "../components/base-schedule-management";

describe("base schedule lineage helpers", () => {
  test("prefers the persisted lineage key over the created entity id", () => {
    const lineageKey = "bs_lineage" as Id<"baseSchedules">;
    const entityId = "bs_entity" as Id<"baseSchedules">;

    expect(
      resolveCreatedScheduleLineageKey({ lineageKey }, entityId),
    ).toEqual(lineageKey);
  });

  test("falls back to the created entity id for brand-new schedules", () => {
    const entityId = "bs_entity" as Id<"baseSchedules">;

    expect(resolveCreatedScheduleLineageKey({}, entityId)).toEqual(entityId);
  });

  test("maps existing weekday snapshots to validator-safe lineage ids", () => {
    const mondayLineage = "bs_monday" as Id<"baseSchedules">;
    const tuesdayLineage = "bs_tuesday" as Id<"baseSchedules">;

    const result = buildScheduleLineageKeyByDayMap([
      {
        _id: "bs_doc_1" as Id<"baseSchedules">,
        dayOfWeek: 1,
        lineageKey: mondayLineage,
      },
      {
        _id: "bs_doc_2" as Id<"baseSchedules">,
        dayOfWeek: 2,
        lineageKey: tuesdayLineage,
      },
    ]);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().get(1)).toEqual(mondayLineage);
    expect(result._unsafeUnwrap().get(2)).toEqual(tuesdayLineage);
  });
});
