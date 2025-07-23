import { describe, expect, it } from "vitest";

import type {
  BranchPathType,
  VersionNode,
} from "../components/version-graph/types";

import { setBranchAndVersionColor } from "../components/version-graph/utils";

describe("Version Graph Colors", () => {
  it("should assign unique colors to each branch based on column index", () => {
    // Setup test data
    const branchColors = [
      "#010A40",
      "#FC42C9",
      "#3D91F0",
      "#29E3C1",
      "#C5A15A",
    ];
    const versionsMap = new Map<string, VersionNode>();

    // Create mock columns with different branch paths
    const columns: BranchPathType[][] = [
      [
        {
          branchOrder: 0,
          end: 5,
          endCommitHash: "commit1",
          start: 0,
        },
      ],
      [
        {
          branchOrder: 1,
          end: 3,
          endCommitHash: "commit2",
          start: 1,
        },
      ],
      [
        {
          branchOrder: 2,
          end: 2,
          endCommitHash: "commit3",
          start: 2,
        },
      ],
    ];

    // Add some version nodes to the map
    versionsMap.set("commit1", {
      children: [],
      commitColor: "",
      hash: "commit1",
      message: "Initial commit",
      parents: [],
      x: 0,
      y: 0,
    });
    versionsMap.set("commit2", {
      children: [],
      commitColor: "",
      hash: "commit2",
      message: "Second commit",
      parents: ["commit1"],
      x: 1,
      y: 1,
    });
    versionsMap.set("commit3", {
      children: [],
      commitColor: "",
      hash: "commit3",
      message: "Third commit",
      parents: ["commit2"],
      x: 2,
      y: 2,
    });

    // Apply color assignment
    setBranchAndVersionColor(columns, branchColors, versionsMap);

    // Assert that each column gets its own color based on index
    expect(columns[0]?.[0]?.color).toBe(branchColors[0]); // First column gets first color
    expect(columns[1]?.[0]?.color).toBe(branchColors[1]); // Second column gets second color
    expect(columns[2]?.[0]?.color).toBe(branchColors[2]); // Third column gets third color

    // Assert that the version nodes got the correct colors too
    expect(versionsMap.get("commit1")?.commitColor).toBe(branchColors[0]);
    expect(versionsMap.get("commit2")?.commitColor).toBe(branchColors[1]);
    expect(versionsMap.get("commit3")?.commitColor).toBe(branchColors[2]);
  });

  it("should cycle through colors when there are more branches than colors", () => {
    const branchColors = ["#010A40", "#FC42C9"];
    const versionsMap = new Map<string, VersionNode>();

    const columns: BranchPathType[][] = [
      [{ branchOrder: 0, end: 1, endCommitHash: "commit1", start: 0 }],
      [{ branchOrder: 1, end: 1, endCommitHash: "commit2", start: 0 }],
      [{ branchOrder: 2, end: 1, endCommitHash: "commit3", start: 0 }], // Should cycle back to first color
    ];

    setBranchAndVersionColor(columns, branchColors, versionsMap);

    // First two branches get their own colors
    expect(columns[0]?.[0]?.color).toBe(branchColors[0]);
    expect(columns[1]?.[0]?.color).toBe(branchColors[1]);
    // Third branch cycles back to first color
    expect(columns[2]?.[0]?.color).toBe(branchColors[0]);
  });

  it("should maintain consistent colors independent of commit content", () => {
    const branchColors = ["#010A40", "#FC42C9", "#3D91F0"];
    const versionsMap = new Map<string, VersionNode>();

    // Create two identical column structures but with different commit hashes and content
    const columns1: BranchPathType[][] = [
      [{ branchOrder: 0, end: 1, endCommitHash: "different-hash-1", start: 0 }],
      [{ branchOrder: 1, end: 1, endCommitHash: "different-hash-2", start: 0 }],
    ];

    const columns2: BranchPathType[][] = [
      [{ branchOrder: 0, end: 1, endCommitHash: "another-hash-1", start: 0 }],
      [{ branchOrder: 1, end: 1, endCommitHash: "another-hash-2", start: 0 }],
    ];

    setBranchAndVersionColor(columns1, branchColors, versionsMap);
    setBranchAndVersionColor(columns2, branchColors, versionsMap);

    // Both should get the same colors based on column index, not hash content
    expect(columns1[0]?.[0]?.color).toBe(columns2[0]?.[0]?.color);
    expect(columns1[1]?.[0]?.color).toBe(columns2[1]?.[0]?.color);

    // Should be the expected colors based on index
    expect(columns1[0]?.[0]?.color).toBe(branchColors[0]);
    expect(columns1[1]?.[0]?.color).toBe(branchColors[1]);
  });
});
