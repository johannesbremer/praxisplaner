import { describe, expect, it, vi } from "vitest";

import { createLocationDependencyDeleteReplayAdapter } from "../utils/location-dependency-delete-replay";

describe("location dependency delete replay", () => {
  it("conflicts before restoring schedules when an already-restored location was renamed", async () => {
    const createBaseSchedules = vi.fn();
    const replay = createLocationDependencyDeleteReplayAdapter({
      createBaseSchedules,
      createLocation: vi.fn(() => Promise.resolve("location-restored")),
      deleteLocation: vi.fn(() => Promise.resolve()),
      findLocationByLineage: () => ({
        _id: "location-restored",
        name: "Renamed location",
      }),
      findPractitionerByLineage: () => ({ _id: "practitioner-current" }),
      hasBaseScheduleLineage: () => false,
      hasLocationName: () => false,
      initialEntityId: "location-original",
      isMissingEntityError: () => false,
      snapshot: {
        baseSchedules: [
          {
            dayOfWeek: 1,
            endTime: "17:00",
            lineageKey: "schedule-lineage",
            practitionerLineageKey: "practitioner-lineage",
            startTime: "09:00",
          },
        ],
        location: {
          lineageKey: "location-lineage",
          name: "Original location",
        },
      },
      toSchedulePayload: ({ locationId, locationLineageKey, practitionerId }) =>
        ({
          locationId,
          locationLineageKey,
          practitionerId,
        }) satisfies {
          locationId: string;
          locationLineageKey: string;
          practitionerId: string;
        },
    });

    await expect(replay.undo()).resolves.toEqual({
      message:
        "[HISTORY:LOCATION_LINEAGE_CONFLICT] Der Standort mit lineageKey location-lineage existiert bereits, hat aber abweichende Einstellungen.",
      status: "conflict",
    });
    expect(createBaseSchedules).not.toHaveBeenCalled();
  });
});
