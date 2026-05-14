import { describe, expect, test, vi } from "vitest";

import { executeTelefonkiSearch } from "./search-execution";

const baseArgs = {
  integrationSecret: "secret",
  practiceId: "practice_1",
  simulatedContext: {
    appointmentTypeLineageKey: "appointmentType_1",
    locationLineageKey: "location_1",
    patient: {
      dateOfBirth: "1980-01-01",
      isNew: false,
    },
    practitionerLineageKey: "practitioner_1",
  },
} as const;

function createExecutor() {
  return {
    availableSlotsOnDate: vi.fn(() => Promise.resolve(["date-slot"])),
    nextAvailableAfternoonSlot: vi.fn(() => Promise.resolve("afternoon-slot")),
    nextAvailableAfternoonSlots: vi.fn(() =>
      Promise.resolve(["afternoon-slot-1", "afternoon-slot-2"]),
    ),
    nextAvailableSlot: vi.fn(() => Promise.resolve("next-slot")),
    nextAvailableSlots: vi.fn(() =>
      Promise.resolve(["next-slot-1", "next-slot-2"]),
    ),
  };
}

describe("executeTelefonkiSearch", () => {
  test("reuses the date-constrained search shape", async () => {
    const executor = createExecutor();

    const result = await executeTelefonkiSearch({
      ...baseArgs,
      executor,
      searchRequest: {
        date: "2026-05-11",
        kind: "availableSlotsOnDate",
        limit: 10,
      },
    });

    expect(result).toEqual(["date-slot"]);
    expect(executor.availableSlotsOnDate).toHaveBeenCalledWith({
      date: "2026-05-11",
      integrationSecret: "secret",
      limit: 10,
      practiceId: "practice_1",
      simulatedContext: baseArgs.simulatedContext,
    });
    expect(executor.nextAvailableSlot).not.toHaveBeenCalled();
  });

  test("reuses the afternoon-only search shape", async () => {
    const executor = createExecutor();

    const result = await executeTelefonkiSearch({
      ...baseArgs,
      executor,
      searchRequest: {
        kind: "nextAvailableAfternoonSlot",
      },
    });

    expect(result).toEqual(["afternoon-slot"]);
    expect(executor.nextAvailableAfternoonSlot).toHaveBeenCalledWith({
      integrationSecret: "secret",
      practiceId: "practice_1",
      simulatedContext: baseArgs.simulatedContext,
    });
    expect(executor.nextAvailableSlot).not.toHaveBeenCalled();
  });
});
