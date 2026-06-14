import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReplayableLedgerCommand } from "../utils/command-ledger";

import { useCommandLedger } from "../utils/command-ledger";

const applied = { status: "applied" } as const;
const conflict = { message: "stale", status: "conflict" } as const;

function command(
  label: string,
  overrides?: Partial<ReplayableLedgerCommand>,
): ReplayableLedgerCommand {
  return {
    label,
    redo: vi.fn(() => applied),
    undo: vi.fn(() => applied),
    ...overrides,
  };
}

describe("useCommandLedger", () => {
  it("record clears the redo stack", async () => {
    const { result } = renderHook(() => useCommandLedger());
    const first = command("first");
    const second = command("second");

    act(() => {
      result.current.record(first);
    });
    await act(() => result.current.undo());
    act(() => {
      result.current.record(second);
    });

    expect(result.current.canRedo).toBe(false);
    expect(result.current.redoDepth).toBe(0);
    expect(result.current.undoDepth).toBe(1);
  });

  it("undo and redo move commands between stacks", async () => {
    const { result } = renderHook(() => useCommandLedger());
    const recorded = command("change");

    act(() => {
      result.current.record(recorded);
    });
    await act(() => result.current.undo());

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(() => result.current.redo());

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(recorded.undo).toHaveBeenCalledTimes(1);
    expect(recorded.redo).toHaveBeenCalledTimes(1);
  });

  it("conflicts keep commands on their original stack", async () => {
    const { result } = renderHook(() => useCommandLedger());
    const recorded = command("conflicting", {
      undo: vi.fn(() => conflict),
    });

    act(() => {
      result.current.record(recorded);
    });
    const undoResult = await act(() => result.current.undo());

    expect(undoResult.status).toBe("conflict");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("normalizes legacy history name conflicts to typed conflicts", async () => {
    const { result } = renderHook(() => useCommandLedger());
    const recorded = command("restore location", {
      undo: vi.fn(() => ({
        message:
          '[HISTORY:LOCATION_NAME_CONFLICT] Standort "Berlin" existiert bereits.',
        status: "conflict" as const,
      })),
    });

    act(() => {
      result.current.record(recorded);
    });
    const undoResult = await act(() => result.current.undo());

    expect(undoResult).toMatchObject({
      conflict: { code: "nameConflict" },
      conflictCode: "nameConflict",
      status: "conflict",
    });
  });

  it("normalizes legacy history reference misses to typed conflicts", async () => {
    const { result } = renderHook(() => useCommandLedger());
    const recorded = command("restore schedule", {
      undo: vi.fn(() => ({
        message:
          "[HISTORY:LOCATION_DELETE_PRACTITIONER_LINEAGE_MISSING] Behandler fehlt.",
        status: "conflict" as const,
      })),
    });

    act(() => {
      result.current.record(recorded);
    });
    const undoResult = await act(() => result.current.undo());

    expect(undoResult).toMatchObject({
      conflict: { code: "referenceMissing" },
      conflictCode: "referenceMissing",
      status: "conflict",
    });
  });

  it("queued operations execute sequentially", async () => {
    const order: string[] = [];
    const { result } = renderHook(() => useCommandLedger());
    const first = command("first", {
      undo: vi.fn(() => {
        order.push("first");
        return applied;
      }),
    });
    const second = command("second", {
      undo: vi.fn(() => {
        order.push("second");
        return applied;
      }),
    });

    act(() => {
      result.current.record(first);
      result.current.record(second);
    });
    await act(async () => {
      await Promise.all([result.current.undo(), result.current.undo()]);
    });

    expect(order).toEqual(["second", "first"]);
    expect(result.current.undoDepth).toBe(0);
    expect(result.current.redoDepth).toBe(2);
  });

  it("scoped clear removes only matching commands", () => {
    const { result } = renderHook(() => useCommandLedger());

    act(() => {
      result.current.record(command("rule set", { scope: "rules" }));
      result.current.record(command("calendar", { scope: "calendar" }));
      result.current.clear("rules");
    });

    expect(result.current.undoDepth).toBe(1);
    expect(result.current.canUndo).toBe(true);
  });
});
