import type { RefObject } from "react";

import { describe, expect, it } from "vitest";

import type { RuleSetCommand } from "../utils/rule-set-replay";

import {
  registerLineageCreateHistoryAction,
  registerLineageUpdateHistoryAction,
} from "../utils/cow-history-actions";

interface TestEntity {
  _id: TestEntityId;
  lineageKey?: TestLineageKey;
  name: string;
}
type TestEntityId = `entity:${string}`;

type TestLineageKey = `lineage:${string}`;

describe("cow history actions", () => {
  it("preserves serializable create payloads on recorded commands", () => {
    const recorded: RuleSetCommand[] = [];
    const entitiesRef: RefObject<TestEntity[]> = {
      current: [],
    };

    registerLineageCreateHistoryAction<
      TestEntityId,
      TestLineageKey,
      TestEntity
    >({
      entitiesRef,
      initialEntityId: "entity:initial",
      isMissingEntityError: () => false,
      kind: "practitioner.create",
      label: "Arzt erstellt",
      lineageKey: "lineage:created",
      onRecordCommand: (command) => recorded.push(command),
      payload: {
        kind: "practitioner.create",
        lineageKey: "lineage:created",
        name: "Dr. Create",
      },
      runCreate: () => Promise.resolve({ entityId: "entity:created" }),
      runDelete: (entityId) => Promise.resolve({ entityId }),
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toEqual({
      kind: "practitioner.create",
      lineageKey: "lineage:created",
      name: "Dr. Create",
    });
  });

  it("preserves serializable update payloads on recorded commands", () => {
    const recorded: RuleSetCommand[] = [];
    const entitiesRef: RefObject<TestEntity[]> = {
      current: [
        {
          _id: "entity:initial",
          lineageKey: "lineage:updated",
          name: "Dr. Before",
        },
      ],
    };

    registerLineageUpdateHistoryAction<
      TestEntityId,
      TestLineageKey,
      TestEntity
    >({
      entitiesRef,
      initialEntityId: "entity:initial",
      kind: "practitioner.update",
      label: "Arzt aktualisiert",
      lineageKey: "lineage:updated",
      onRecordCommand: (command) => recorded.push(command),
      payload: {
        after: { name: "Dr. After" },
        before: { name: "Dr. Before" },
        kind: "practitioner.update",
        lineageKey: "lineage:updated",
      },
      redoMissingMessage: "missing redo",
      runRedo: (entityId) => Promise.resolve({ entityId }),
      runUndo: (entityId) => Promise.resolve({ entityId }),
      undoMissingMessage: "missing undo",
      validateRedo: () => null,
      validateUndo: () => null,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toEqual({
      after: { name: "Dr. After" },
      before: { name: "Dr. Before" },
      kind: "practitioner.update",
      lineageKey: "lineage:updated",
    });
  });
});
