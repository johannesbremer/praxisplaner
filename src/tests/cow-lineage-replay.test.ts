import type { RefObject } from "react";

import { describe, expect, it } from "vitest";

import type { RuleSetCommand } from "../utils/rule-set-replay";

import {
  recordLineageCreateRuleSetCommand,
  recordLineageUpdateRuleSetCommand,
} from "../utils/cow-lineage-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";

interface TestEntity {
  _id: TestEntityId;
  lineageKey?: TestLineageKey;
  name: string;
}
type TestEntityId = `entity:${string}`;

type TestLineageKey = `lineage:${string}`;

describe("cow history actions", () => {
  it("preserves create snapshots and target on recorded commands", () => {
    const recorded: RuleSetCommand[] = [];
    const entitiesRef: RefObject<TestEntity[]> = {
      current: [],
    };

    recordLineageCreateRuleSetCommand<TestEntityId, TestLineageKey, TestEntity>(
      {
        entitiesRef,
        initialEntityId: "entity:initial",
        isMissingEntityError: () => false,
        kind: "appointmentType.create",
        label: "Terminart erstellt",
        lineageKey: "lineage:created",
        onRecordCommand: (command) => recorded.push(command),
        runCreate: () => Promise.resolve({ entityId: "entity:created" }),
        runDelete: (entityId) => Promise.resolve({ entityId }),
        snapshots: {
          after: encodeRuleSetSnapshot({
            lineageKey: "lineage:created",
            name: "Checkup",
          }),
        },
      },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      kind: "appointmentType.create",
      snapshots: {
        after: encodeRuleSetSnapshot({
          lineageKey: "lineage:created",
          name: "Checkup",
        }),
      },
      target: {
        entityId: "entity:initial",
        lineageKey: "lineage:created",
      },
    });
  });

  it("preserves update snapshots and target on recorded commands", () => {
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

    recordLineageUpdateRuleSetCommand<TestEntityId, TestLineageKey, TestEntity>(
      {
        entitiesRef,
        initialEntityId: "entity:initial",
        kind: "appointmentType.update",
        label: "Terminart aktualisiert",
        lineageKey: "lineage:updated",
        onRecordCommand: (command) => recorded.push(command),
        redoMissingMessage: "missing redo",
        runRedo: (entityId) => Promise.resolve({ entityId }),
        runUndo: (entityId) => Promise.resolve({ entityId }),
        snapshots: {
          after: encodeRuleSetSnapshot({
            lineageKey: "lineage:updated",
            name: "Checkup long",
          }),
          before: encodeRuleSetSnapshot({
            lineageKey: "lineage:updated",
            name: "Checkup",
          }),
        },
        undoMissingMessage: "missing undo",
        validateRedo: () => null,
        validateUndo: () => null,
      },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      kind: "appointmentType.update",
      snapshots: {
        after: encodeRuleSetSnapshot({
          lineageKey: "lineage:updated",
          name: "Checkup long",
        }),
        before: encodeRuleSetSnapshot({
          lineageKey: "lineage:updated",
          name: "Checkup",
        }),
      },
      target: {
        entityId: "entity:initial",
        lineageKey: "lineage:updated",
      },
    });
  });
});
