import { describe, expect, it } from "vitest";

import {
  decodeRuleSetSnapshot,
  encodeRuleSetSnapshot,
  snapshotsMatch,
  snapshotValueMatches,
} from "../utils/rule-set-snapshot-codecs";

describe("rule set snapshot codecs", () => {
  it("encodes object keys deterministically", () => {
    const left = encodeRuleSetSnapshot({
      conditionTree: { a: 1, b: 2 },
      enabled: true,
    });
    const right = encodeRuleSetSnapshot({
      conditionTree: { a: 1, b: 2 },
      enabled: true,
    });

    expect(left.stableKey).toBe(right.stableKey);
    expect(snapshotsMatch(left, right)).toBe(true);
  });

  it("preserves array order", () => {
    const left = encodeRuleSetSnapshot({
      lineageKeys: ["first", "second"],
    });
    const right = encodeRuleSetSnapshot({
      lineageKeys: ["second", "first"],
    });

    expect(snapshotsMatch(left, right)).toBe(false);
  });

  it("decodes snapshots and compares current values against encoded state", () => {
    const encoded = encodeRuleSetSnapshot({
      lineageKey: "lineage:one",
      name: "Dr. Snapshot",
    });

    expect(decodeRuleSetSnapshot(encoded)).toEqual({
      lineageKey: "lineage:one",
      name: "Dr. Snapshot",
    });
    expect(
      snapshotValueMatches(encoded, {
        lineageKey: "lineage:one",
        name: "Dr. Snapshot",
      }),
    ).toBe(true);
    expect(
      snapshotValueMatches(encoded, {
        lineageKey: "lineage:one",
        name: "Dr. Changed",
      }),
    ).toBe(false);
  });
});
