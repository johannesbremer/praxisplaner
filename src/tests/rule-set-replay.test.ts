import { describe, expect, it, vi } from "vitest";

import {
  executeRuleSetCommand,
  recordRuleSetCommand,
} from "../utils/rule-set-command-executor";
import {
  createRuleSetCommandDescription,
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

    let recordedCommand: ReturnType<typeof createRuleSetCommandDescription> =
      createRuleSetCommandDescription({
        kind: "practitioner.update",
        label: "unrecorded",
      });

    recordRuleSetCommand(
      (command) => {
        recordedCommand = command;
      },
      createRuleSetCommandDescription({
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
          lineageKey: "practitioner-lineage",
        },
      }),
      { redo, undo },
    );

    expect(recordedCommand.kind).toBe("practitioner.update");
    expect(recordedCommand.payload).toEqual({
      after: { name: "Dr. Test" },
      before: { name: "Dr. Old" },
      kind: "practitioner.update",
      lineageKey: "practitioner-lineage",
    });
    expect(recordedCommand.target?.lineageKey).toBe("practitioner-lineage");
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
    const command = createRuleSetCommandDescription({
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
});
