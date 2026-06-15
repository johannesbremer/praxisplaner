import { Result } from "neverthrow";

import type { Id } from "@/convex/_generated/dataModel";

import type {
  BaseScheduleMutationAppliedSchedule,
  BatchCreateScheduleInput,
  SchedulePayload,
  SchedulesRef,
} from "../components/base-schedule-management-shared";
import type {
  RecordRuleSetCommand,
  RuleSetCommandDescription,
  RuleSetCommandRuntimeAdapter,
} from "./rule-set-replay";

import {
  applyBatchCreateResultToRef,
  applyReplaceResultToRef,
  getAbsentLineageKeysForReplacement,
  removeSchedulesFromRef,
  toBatchCreateScheduleInput,
  toMutationSchedulePayload,
} from "../components/base-schedule-management-shared";
import { captureFrontendError } from "./frontend-errors";
import { recordRuleSetCommand } from "./rule-set-command-executor";

interface CreateScheduleBatchResult {
  createdScheduleIds: Id<"baseSchedules">[];
  draftRevision: number;
  ruleSetId: Id<"ruleSets">;
}

interface ReplaceScheduleSetResult {
  appliedSchedules: BaseScheduleMutationAppliedSchedule[];
  createdScheduleIds: Id<"baseSchedules">[];
  draftRevision: number;
  ruleSetId: Id<"ruleSets">;
}

const breakTimesMatch = (
  left: undefined | { end: string; start: string }[],
  right: undefined | { end: string; start: string }[],
) => {
  const leftBreakTimes = left ?? [];
  const rightBreakTimes = right ?? [];
  return (
    leftBreakTimes.length === rightBreakTimes.length &&
    leftBreakTimes.every((breakTime, index) => {
      const rightBreakTime = rightBreakTimes[index];
      return (
        breakTime.start === rightBreakTime?.start &&
        breakTime.end === rightBreakTime.end
      );
    })
  );
};

const currentScheduleMatchesPayload = (
  scheduleItem: SchedulesRef["current"][number],
  payload: SchedulePayload,
) =>
  scheduleItem.lineageKey === payload.lineageKey &&
  scheduleItem.dayOfWeek === payload.dayOfWeek &&
  scheduleItem.startTime === payload.startTime &&
  scheduleItem.endTime === payload.endTime &&
  scheduleItem.locationLineageKey === payload.locationLineageId &&
  scheduleItem.practitionerLineageKey === payload.practitionerLineageId &&
  breakTimesMatch(scheduleItem.breakTimes, payload.breakTimes);

export function createBaseScheduleReplaceSetReplay(params: {
  after: SchedulePayload[];
  before: SchedulePayload[];
  getCowMutationArgs: () => {
    expectedDraftRevision: null | number;
    selectedRuleSetId: Id<"ruleSets">;
  };
  handleDraftMutationResult: (result: {
    draftRevision: number;
    ruleSetId: Id<"ruleSets">;
  }) => void;
  isBaseScheduleMissingError: (error: unknown) => boolean;
  label: string;
  practiceId: Id<"practices">;
  replaceScheduleSet: (args: {
    expectedAbsentLineageKeys?: Id<"baseSchedules">[];
    expectedDraftRevision: null | number;
    expectedPresentLineageKeys: Id<"baseSchedules">[];
    practiceId: Id<"practices">;
    replacementSchedules: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      lineageKey: Id<"baseSchedules">;
      locationLineageId: Id<"locations">;
      practitionerLineageId: Id<"practitioners">;
      startTime: string;
    }[];
    selectedRuleSetId: Id<"ruleSets">;
  }) => Promise<ReplaceScheduleSetResult>;
  runCreateScheduleBatch: (
    schedules: BatchCreateScheduleInput[],
  ) => Promise<CreateScheduleBatchResult>;
  schedulesRef: SchedulesRef;
}): RuleSetCommandRuntimeAdapter {
  const applyState = async (
    expectedPayloads: SchedulePayload[],
    replacementPayloads: SchedulePayload[],
    conflictMessage: string,
  ) => {
    const expectedPresentLineageKeys =
      replacementPayloads.length === 0
        ? expectedPayloads
            .filter((payload) =>
              params.schedulesRef.current.some((scheduleItem) =>
                currentScheduleMatchesPayload(scheduleItem, payload),
              ),
            )
            .map((payload) => payload.lineageKey)
        : expectedPayloads.map((payload) => payload.lineageKey);
    const expectedLineageKeySet = new Set(expectedPresentLineageKeys);
    const hasEditedExpectedPayload = expectedPayloads.some((payload) =>
      params.schedulesRef.current.some(
        (scheduleItem) =>
          scheduleItem.lineageKey === payload.lineageKey &&
          !currentScheduleMatchesPayload(scheduleItem, payload),
      ),
    );
    const hasPresentExpectedPayload = params.schedulesRef.current.some(
      (scheduleItem) => expectedLineageKeySet.has(scheduleItem.lineageKey),
    );
    const replacementMissingPayloads = replacementPayloads.filter(
      (payload) =>
        !params.schedulesRef.current.some((scheduleItem) =>
          currentScheduleMatchesPayload(scheduleItem, payload),
        ),
    );

    if (hasEditedExpectedPayload) {
      return { message: conflictMessage, status: "conflict" as const };
    }

    if (!hasPresentExpectedPayload && replacementMissingPayloads.length === 0) {
      return { status: "applied" as const };
    }

    if (expectedPayloads.length === 0) {
      const batchSchedules = Result.combine(
        replacementMissingPayloads.map((payload) =>
          toBatchCreateScheduleInput(payload),
        ),
      ).match(
        (value) => value,
        (error) => {
          captureFrontendError(error, {
            context: "base_schedule_replay_create_payload",
            practiceId: params.practiceId,
          });
          return null;
        },
      );
      if (!batchSchedules) {
        return { message: conflictMessage, status: "conflict" as const };
      }
      const result = await params.runCreateScheduleBatch(batchSchedules);
      params.handleDraftMutationResult(result);
      applyBatchCreateResultToRef({
        createdScheduleIds: result.createdScheduleIds,
        practiceId: params.practiceId,
        ruleSetId: result.ruleSetId,
        schedules: batchSchedules,
        schedulesRef: params.schedulesRef,
      });
      return { status: "applied" as const };
    }

    const replacementSchedules = Result.combine(
      replacementPayloads.map((payload) => toMutationSchedulePayload(payload)),
    ).match(
      (value) => value,
      () => null,
    );
    if (!replacementSchedules) {
      return { message: conflictMessage, status: "conflict" as const };
    }

    try {
      const expectedAbsentLineageKeys = getAbsentLineageKeysForReplacement(
        expectedPayloads.map((payload) => payload.lineageKey),
        replacementPayloads.map((payload) => payload.lineageKey),
      );
      const result = await params.replaceScheduleSet({
        expectedAbsentLineageKeys,
        expectedPresentLineageKeys,
        practiceId: params.practiceId,
        replacementSchedules,
        ...params.getCowMutationArgs(),
      });
      params.handleDraftMutationResult(result);
      removeSchedulesFromRef(params.schedulesRef, expectedPresentLineageKeys);
      applyReplaceResultToRef({
        appliedSchedules: result.appliedSchedules,
        practiceId: params.practiceId,
        ruleSetId: result.ruleSetId,
        schedulesRef: params.schedulesRef,
      });
    } catch (error: unknown) {
      if (
        replacementPayloads.length === 0 &&
        expectedPresentLineageKeys.length === 0 &&
        params.isBaseScheduleMissingError(error)
      ) {
        return { status: "applied" as const };
      }
      return {
        message: error instanceof Error ? error.message : conflictMessage,
        status: "conflict" as const,
      };
    }

    return { status: "applied" as const };
  };

  return {
    redo: () =>
      applyState(
        params.before,
        params.after,
        `${params.label} konnten nicht erneut angewendet werden.`,
      ),
    undo: () =>
      applyState(
        params.after,
        params.before,
        `${params.label} konnten nicht wiederhergestellt werden.`,
      ),
  };
}

export function recordBaseScheduleReplayCommand(
  record: RecordRuleSetCommand | undefined,
  command: RuleSetCommandDescription,
  params: Parameters<typeof createBaseScheduleReplaceSetReplay>[0],
): void {
  const replay = createBaseScheduleReplaceSetReplay(params);
  recordRuleSetCommand(record, command, replay);
}
