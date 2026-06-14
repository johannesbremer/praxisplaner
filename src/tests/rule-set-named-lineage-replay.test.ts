import type { RefObject } from "react";

import { describe, expect, it, vi } from "vitest";

import {
  createNamedLineageCreateReplayAdapter,
  createNamedLineageUpdateReplayAdapter,
} from "../utils/rule-set-named-lineage-replay";
import { createRuleSetCommandDescription } from "../utils/rule-set-replay";

interface TestEntity {
  _id: TestEntityId;
  lineageKey?: TestLineageKey;
  name: string;
}
type TestEntityId = `entity:${string}`;

type TestLineageKey = `lineage:${string}`;

describe("named lineage rule set replay adapter", () => {
  it("replays create commands from serializable payloads", async () => {
    const entitiesRef: RefObject<TestEntity[]> = { current: [] };
    const command = createRuleSetCommandDescription({
      kind: "practitioner.create",
      label: "Arzt erstellt",
      payload: {
        kind: "practitioner.create",
        lineageKey: "lineage:created",
        name: "Dr. Created",
      },
      target: {
        entityId: "entity:created",
        lineageKey: "lineage:created",
      },
    });
    const runCreate = vi.fn(() =>
      Promise.resolve({ entityId: "entity:recreated" as const }),
    );
    const runDelete = vi.fn((entityId: TestEntityId) =>
      Promise.resolve({ entityId }),
    );

    const replay = createNamedLineageCreateReplayAdapter<
      TestEntityId,
      TestLineageKey,
      TestEntity
    >({
      command,
      entitiesRef,
      initialEntityId: "entity:created",
      isMissingEntityError: () => false,
      lineageKey: "lineage:created",
      payload: {
        kind: "practitioner.create",
        lineageKey: "lineage:created",
        name: "Dr. Created",
      },
      runCreate,
      runDelete,
    });

    await expect(replay.redo()).resolves.toEqual({ status: "applied" });
    await expect(replay.undo()).resolves.toEqual({ status: "applied" });
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(runDelete).toHaveBeenCalledWith("entity:recreated");
  });

  it("returns a stale conflict when update source state differs", async () => {
    const entitiesRef: RefObject<TestEntity[]> = {
      current: [
        {
          _id: "entity:updated",
          lineageKey: "lineage:updated",
          name: "Dr. Changed Elsewhere",
        },
      ],
    };
    const command = createRuleSetCommandDescription({
      kind: "practitioner.update",
      label: "Arzt aktualisiert",
      payload: {
        after: { name: "Dr. After" },
        before: { name: "Dr. Before" },
        kind: "practitioner.update",
        lineageKey: "lineage:updated",
      },
      target: {
        entityId: "entity:updated",
        lineageKey: "lineage:updated",
      },
    });
    const runRedo = vi.fn((entityId: TestEntityId) =>
      Promise.resolve({ entityId }),
    );

    const replay = createNamedLineageUpdateReplayAdapter<
      TestEntityId,
      TestLineageKey,
      TestEntity
    >({
      command,
      entitiesRef,
      initialEntityId: "entity:updated",
      lineageKey: "lineage:updated",
      payload: {
        after: { name: "Dr. After" },
        before: { name: "Dr. Before" },
        kind: "practitioner.update",
        lineageKey: "lineage:updated",
      },
      redoMissingMessage: "missing redo",
      runRedo,
      runUndo: (entityId) => Promise.resolve({ entityId }),
      undoMissingMessage: "missing undo",
    });

    await expect(replay.redo()).resolves.toMatchObject({
      conflict: { code: "staleState" },
      status: "conflict",
    });
    expect(runRedo).not.toHaveBeenCalled();
  });

  it("returns a typed name conflict when recreating a duplicate", async () => {
    const entitiesRef: RefObject<TestEntity[]> = {
      current: [
        {
          _id: "entity:other",
          lineageKey: "lineage:other",
          name: "Dr. Duplicate",
        },
      ],
    };
    const command = createRuleSetCommandDescription({
      kind: "practitioner.create",
      label: "Arzt erstellt",
      payload: {
        kind: "practitioner.create",
        lineageKey: "lineage:created",
        name: "Dr. Duplicate",
      },
      target: {
        entityId: "entity:created",
        lineageKey: "lineage:created",
      },
    });
    const runCreate = vi.fn(() =>
      Promise.resolve({ entityId: "entity:created" as const }),
    );

    const replay = createNamedLineageCreateReplayAdapter<
      TestEntityId,
      TestLineageKey,
      TestEntity
    >({
      command,
      entitiesRef,
      initialEntityId: "entity:created",
      isMissingEntityError: () => false,
      lineageKey: "lineage:created",
      payload: {
        kind: "practitioner.create",
        lineageKey: "lineage:created",
        name: "Dr. Duplicate",
      },
      runCreate,
      runDelete: (entityId) => Promise.resolve({ entityId }),
    });

    await expect(replay.redo()).resolves.toMatchObject({
      conflict: {
        code: "nameConflict",
        name: "Dr. Duplicate",
      },
      status: "conflict",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });
});
