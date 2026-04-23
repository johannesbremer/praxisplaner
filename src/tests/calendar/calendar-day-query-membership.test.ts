import { describe, expect, it } from "vitest";

import type { CalendarDayQueryArgs } from "../../components/calendar/calendar-query-args";

import { toTableId } from "../../../convex/identity";
import {
  matchesCalendarDayQueryEntity,
  shouldCollapseOptimisticReplacementInDayQuery,
} from "../../components/calendar/calendar-day-query-membership";

const baseQueryArgs: CalendarDayQueryArgs = {
  dayEnd: "2026-04-24T00:00:00+02:00[Europe/Berlin]",
  dayStart: "2026-04-23T00:00:00+02:00[Europe/Berlin]",
  practiceId: toTableId<"practices">("practice_1"),
  scope: "real",
};

describe("calendar day query membership", () => {
  it("excludes optimistic appointments outside the active day window", () => {
    expect(
      matchesCalendarDayQueryEntity(baseQueryArgs, {
        isSimulation: false,
        locationId: toTableId<"locations">("location_1"),
        practiceId: toTableId<"practices">("practice_1"),
        start: "2026-04-22T09:00:00+02:00[Europe/Berlin]",
      }),
    ).toBe(false);
  });

  it("excludes optimistic blocked slots outside the active location filter", () => {
    expect(
      matchesCalendarDayQueryEntity(
        {
          ...baseQueryArgs,
          locationId: toTableId<"locations">("location_1"),
          scope: "all",
        },
        {
          isSimulation: false,
          locationId: toTableId<"locations">("location_2"),
          practiceId: toTableId<"practices">("practice_1"),
          start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
        },
      ),
    ).toBe(false);
  });

  it("excludes simulated inserts from a real-scope day query", () => {
    expect(
      matchesCalendarDayQueryEntity(baseQueryArgs, {
        isSimulation: true,
        locationId: toTableId<"locations">("location_1"),
        practiceId: toTableId<"practices">("practice_1"),
        start: "2026-04-23T09:00:00+02:00[Europe/Berlin]",
      }),
    ).toBe(false);
  });

  it("keeps simulation-scope replacement collapse limited to simulation queries", () => {
    expect(
      shouldCollapseOptimisticReplacementInDayQuery({
        isSimulation: true,
        scope: "simulation",
      }),
    ).toBe(true);
    expect(
      shouldCollapseOptimisticReplacementInDayQuery({
        isSimulation: true,
        scope: "real",
      }),
    ).toBe(false);
    expect(
      shouldCollapseOptimisticReplacementInDayQuery({
        isSimulation: true,
        scope: "all",
      }),
    ).toBe(false);
  });
});
