import { describe, expect, it, vi } from "vitest";

import {
  executeRuleSetCommand,
  recordRuleSetCommand,
} from "../utils/rule-set-command-executor";
import { registerRuleSetReplayAdapter } from "../utils/rule-set-command-executor-internal";
import {
  createRuleSetAbsenceCommand,
  createRuleSetNamedLineageCommand,
  createRuleSetSchedulingRuleCommand,
  createRuleSetSnapshotCommand,
  type RuleSetCommand,
  withSerializableRuleSetPayload,
} from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";

describe("rule set replay commands", () => {
  it("preserves command kind, target, snapshots, and executes through the rule set adapter", async () => {
    const redo = vi.fn(() => ({ status: "applied" as const }));
    const undo = vi.fn(() => ({ status: "applied" as const }));
    const snapshot = encodeRuleSetSnapshot({
      lineageKey: "practitioner-lineage",
      name: "Dr. Test",
    });

    let recordedCommand: RuleSetCommand = createRuleSetNamedLineageCommand({
      kind: "practitioner.update",
      label: "unrecorded",
      payload: {
        after: { name: "Dr. Test" },
        before: { name: "Dr. Old" },
        kind: "practitioner.update",
        lineageKey: "practitioner-lineage",
      },
      target: {
        entityId: "practitioner-entity",
        lineageKey: "practitioner-lineage",
      },
    });

    const command = createRuleSetNamedLineageCommand({
      kind: "practitioner.update",
      label: "Arzt aktualisiert",
      payload: {
        after: { name: "Dr. Test" },
        before: { name: "Dr. Old" },
        kind: "practitioner.update",
        lineageKey: "practitioner-lineage",
      },
      snapshots: {
        after: snapshot,
      },
      target: {
        entityId: "practitioner-entity",
        lineageKey: "practitioner-lineage",
      },
    });
    registerRuleSetReplayAdapter(command, { redo, undo });
    recordRuleSetCommand((recorded) => {
      recordedCommand = recorded;
    }, command);

    expect(recordedCommand.kind).toBe("practitioner.update");
    if (recordedCommand.kind !== "practitioner.update") {
      throw new Error("Expected practitioner.update command");
    }
    expect(recordedCommand.payload).toEqual({
      after: { name: "Dr. Test" },
      before: { name: "Dr. Old" },
      kind: "practitioner.update",
      lineageKey: "practitioner-lineage",
    });
    expect(recordedCommand.target.lineageKey).toBe("practitioner-lineage");
    expect(recordedCommand.snapshots?.after).toBe(snapshot);

    await expect(
      Promise.resolve(executeRuleSetCommand(recordedCommand, "redo")),
    ).resolves.toEqual({
      status: "applied",
    });
    await expect(
      Promise.resolve(executeRuleSetCommand(recordedCommand, "undo")),
    ).resolves.toEqual({
      status: "applied",
    });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("adds a snapshot payload for legacy executable commands", () => {
    const snapshot = encodeRuleSetSnapshot({
      lineageKey: "appointment-type-lineage",
      name: "Checkup",
    });
    const command = createRuleSetSnapshotCommand({
      kind: "appointmentType.update",
      label: "Terminart aktualisiert",
      snapshots: {
        before: snapshot,
      },
      target: {
        lineageKey: "appointment-type-lineage",
      },
    });

    expect(withSerializableRuleSetPayload(command).payload).toEqual({
      kind: "appointmentType.update",
      snapshots: {
        before: snapshot,
      },
      target: {
        lineageKey: "appointment-type-lineage",
      },
    });
  });

  it("records absence commands as a typed command family", async () => {
    const redo = vi.fn(() => ({ status: "applied" as const }));
    const undo = vi.fn(() => ({ status: "applied" as const }));
    const before = encodeRuleSetSnapshot({
      date: "2026-04-21",
      portions: [],
      staff: { lineageKey: "staff-lineage" },
    });
    const after = encodeRuleSetSnapshot({
      date: "2026-04-21",
      portions: [{ portion: "full-day" }],
      staff: { lineageKey: "staff-lineage" },
    });

    const command = createRuleSetAbsenceCommand({
      kind: "absence.create",
      label: "Abwesenheit eingetragen",
      payload: {
        afterPortionCount: 1,
        beforePortionCount: 0,
        date: "2026-04-21",
        kind: "absence.create",
        staffLineageKey: "staff-lineage",
      },
      snapshots: { after, before },
      target: { lineageKey: "staff-lineage" },
    });
    registerRuleSetReplayAdapter(command, { redo, undo });

    await expect(
      Promise.resolve(executeRuleSetCommand(command, "redo")),
    ).resolves.toEqual({
      status: "applied",
    });
    expect(command.payload.staffLineageKey).toBe("staff-lineage");
    expect(command.snapshots.before).toBe(before);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("records scheduling rule commands as a typed command family", async () => {
    const redo = vi.fn(() => ({ status: "applied" as const }));
    const undo = vi.fn(() => ({ status: "applied" as const }));
    const after = encodeRuleSetSnapshot({
      conditionTree: { type: "group" },
      enabled: true,
    });

    const command = createRuleSetSchedulingRuleCommand({
      kind: "schedulingRule.create",
      label: "Regel erstellt",
      payload: {
        hasAfterSnapshot: true,
        hasBeforeSnapshot: false,
        kind: "schedulingRule.create",
        ruleName: "Check-up nur vormittags",
      },
      snapshots: { after },
      target: { entityId: "rule-1" },
    });
    registerRuleSetReplayAdapter(command, { redo, undo });

    await expect(
      Promise.resolve(executeRuleSetCommand(command, "redo")),
    ).resolves.toEqual({
      status: "applied",
    });
    expect(command.payload.ruleName).toBe("Check-up nur vormittags");
    expect(command.target.entityId).toBe("rule-1");
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });
});
