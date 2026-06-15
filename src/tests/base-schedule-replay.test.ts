import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { SchedulePayload } from "../components/base-schedule-management-shared";

import {
  asBaseScheduleId,
  asBaseScheduleLineageKey,
  toTableId,
} from "../../convex/identity";
import { createBaseScheduleReplaceSetReplay } from "../utils/base-schedule-replay";

const practiceId = toTableId<"practices">("practice_1");
const ruleSetId = toTableId<"ruleSets">("rule_set_1");
const locationLineageId = toTableId<"locations">("location_lineage_1");
const practitionerLineageId = toTableId<"practitioners">(
  "practitioner_lineage_1",
);

const schedulePayload = (
  lineageKey: Id<"baseSchedules">,
  dayOfWeek: number,
): SchedulePayload => ({
  dayOfWeek,
  endTime: "17:00",
  lineageKey,
  locationLineageId,
  practitionerLineageId,
  startTime: "09:00",
});

const materializedSchedule = (payload: SchedulePayload) => ({
  _creationTime: 0,
  _id: asBaseScheduleId(payload.lineageKey),
  dayOfWeek: payload.dayOfWeek,
  endTime: payload.endTime,
  lineageKey: asBaseScheduleLineageKey(payload.lineageKey),
  locationLineageKey: payload.locationLineageId,
  practiceId,
  practitionerLineageKey: payload.practitionerLineageId,
  ruleSetId,
  startTime: payload.startTime,
});

describe("base schedule replay", () => {
  it("undoes a grouped add by replacing the complete expected after-set", async () => {
    const monday = schedulePayload(toTableId<"baseSchedules">("monday"), 1);
    const tuesday = schedulePayload(toTableId<"baseSchedules">("tuesday"), 2);
    const schedulesRef = {
      current: [materializedSchedule(monday), materializedSchedule(tuesday)],
    };
    const replaceScheduleSet = vi.fn(() =>
      Promise.resolve({
        appliedSchedules: [
          {
            ...monday,
            entityId: monday.lineageKey,
            locationId: toTableId<"locations">("location_1"),
            locationLineageKey: monday.locationLineageId,
            practitionerId: toTableId<"practitioners">("practitioner_1"),
            practitionerLineageKey: monday.practitionerLineageId,
          },
        ],
        createdScheduleIds: [monday.lineageKey],
        draftRevision: 2,
        ruleSetId,
      }),
    );

    const replay = createBaseScheduleReplaceSetReplay({
      after: [monday, tuesday],
      before: [monday],
      getCowMutationArgs: () => ({
        expectedDraftRevision: 1,
        selectedRuleSetId: ruleSetId,
      }),
      handleDraftMutationResult: vi.fn(),
      isBaseScheduleMissingError: () => false,
      label: "Arbeitszeiten",
      practiceId,
      replaceScheduleSet,
      runCreateScheduleBatch: vi.fn(),
      schedulesRef,
    });

    await expect(replay.undo()).resolves.toEqual({ status: "applied" });
    expect(replaceScheduleSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPresentLineageKeys: [monday.lineageKey, tuesday.lineageKey],
        replacementSchedules: [
          expect.objectContaining({ lineageKey: monday.lineageKey }),
        ],
      }),
    );
  });

  it("rejects partial grouped replacements before calling the mutation", async () => {
    const monday = schedulePayload(toTableId<"baseSchedules">("monday"), 1);
    const staleTuesday = schedulePayload(
      toTableId<"baseSchedules">("tuesday"),
      2,
    );
    const editedTuesday = {
      ...staleTuesday,
      endTime: "18:00" as const,
    };
    const schedulesRef = {
      current: [
        materializedSchedule(monday),
        materializedSchedule(editedTuesday),
      ],
    };
    const replaceScheduleSet = vi.fn();

    const replay = createBaseScheduleReplaceSetReplay({
      after: [monday],
      before: [monday, staleTuesday],
      getCowMutationArgs: () => ({
        expectedDraftRevision: 1,
        selectedRuleSetId: ruleSetId,
      }),
      handleDraftMutationResult: vi.fn(),
      isBaseScheduleMissingError: () => false,
      label: "Arbeitszeiten",
      practiceId,
      replaceScheduleSet,
      runCreateScheduleBatch: vi.fn(),
      schedulesRef,
    });

    await expect(replay.redo()).resolves.toEqual({
      message: "Arbeitszeiten konnten nicht erneut angewendet werden.",
      status: "conflict",
    });
    expect(replaceScheduleSet).not.toHaveBeenCalled();
  });

  it("treats already removed created schedules as an applied undo", async () => {
    const monday = schedulePayload(toTableId<"baseSchedules">("monday"), 1);
    const schedulesRef = {
      current: [],
    };
    const replaceScheduleSet = vi.fn();

    const replay = createBaseScheduleReplaceSetReplay({
      after: [monday],
      before: [],
      getCowMutationArgs: () => ({
        expectedDraftRevision: 1,
        selectedRuleSetId: ruleSetId,
      }),
      handleDraftMutationResult: vi.fn(),
      isBaseScheduleMissingError: () => false,
      label: "Arbeitszeiten",
      practiceId,
      replaceScheduleSet,
      runCreateScheduleBatch: vi.fn(),
      schedulesRef,
    });

    await expect(replay.undo()).resolves.toEqual({ status: "applied" });
    expect(replaceScheduleSet).not.toHaveBeenCalled();
  });

  it("deletes remaining created schedules when only part of a created batch is already gone", async () => {
    const monday = schedulePayload(toTableId<"baseSchedules">("monday"), 1);
    const tuesday = schedulePayload(toTableId<"baseSchedules">("tuesday"), 2);
    const schedulesRef = {
      current: [materializedSchedule(monday)],
    };
    const replaceScheduleSet = vi.fn(() =>
      Promise.resolve({
        appliedSchedules: [],
        createdScheduleIds: [],
        draftRevision: 2,
        ruleSetId,
      }),
    );

    const replay = createBaseScheduleReplaceSetReplay({
      after: [monday, tuesday],
      before: [],
      getCowMutationArgs: () => ({
        expectedDraftRevision: 1,
        selectedRuleSetId: ruleSetId,
      }),
      handleDraftMutationResult: vi.fn(),
      isBaseScheduleMissingError: () => false,
      label: "Arbeitszeiten",
      practiceId,
      replaceScheduleSet,
      runCreateScheduleBatch: vi.fn(),
      schedulesRef,
    });

    await expect(replay.undo()).resolves.toEqual({ status: "applied" });
    expect(replaceScheduleSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPresentLineageKeys: [monday.lineageKey],
        replacementSchedules: [],
      }),
    );
  });
});
