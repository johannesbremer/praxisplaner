import { describe, expect, it, vi } from "vitest";

import {
  createRuleSetCommand,
  withSerializableRuleSetPayload,
} from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";

describe("rule set replay commands", () => {
  it("preserves command kind, target, snapshots, and replay adapter", async () => {
    const redo = vi.fn(() => ({ status: "applied" as const }));
    const undo = vi.fn(() => ({ status: "applied" as const }));
    const snapshot = encodeRuleSetSnapshot({
      lineageKey: "practitioner-lineage",
      name: "Dr. Test",
    });

    const command = createRuleSetCommand({
      kind: "practitioner.update",
      label: "Arzt aktualisiert",
      payload: {
        after: { name: "Dr. Test" },
        before: { name: "Dr. Old" },
        kind: "practitioner.update",
        lineageKey: "practitioner-lineage",
      },
      replay: { redo, undo },
      snapshots: {
        after: snapshot,
      },
      target: {
        lineageKey: "practitioner-lineage",
      },
    });

    expect(command.kind).toBe("practitioner.update");
    expect(command.payload).toEqual({
      after: { name: "Dr. Test" },
      before: { name: "Dr. Old" },
      kind: "practitioner.update",
      lineageKey: "practitioner-lineage",
    });
    expect(command.target?.lineageKey).toBe("practitioner-lineage");
    expect(command.snapshots?.after).toBe(snapshot);

    await expect(Promise.resolve(command.redo())).resolves.toEqual({
      status: "applied",
    });
    await expect(Promise.resolve(command.undo())).resolves.toEqual({
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
    const command = createRuleSetCommand({
      kind: "appointmentType.update",
      label: "Terminart aktualisiert",
      replay: {
        redo: () => ({ status: "applied" }),
        undo: () => ({ status: "applied" }),
      },
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
