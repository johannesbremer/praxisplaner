import { describe, expect, it } from "vitest";

import type {
  BranchPathType,
  VersionNode,
} from "../components/version-graph/types";

import { setBranchAndVersionColor } from "../components/version-graph/utils";

describe("Version Graph Colors", () => {
  it("should assign colors based on a stable, sorted order of branch signatures, not array index", () => {
    // Setup test data
    const branchColors = [
      "#8F00FF", // Color 0
      "#FC42C9", // Color 1
      "#3D91F0", // Color 2
    ];
    const versionsMap = new Map<string, VersionNode>();

    // Create mock columns where the alphabetical order of commit hashes
    // is different from the column's array index.
    const columns: BranchPathType[][] = [
      [
        {
          branchOrder: 0,
          end: 1,
          endCommitHash: "z-commit", // Should be sorted last
          start: 0,
        },
      ],
      [
        {
          branchOrder: 1,
          end: 1,
          endCommitHash: "a-commit", // Should be sorted first
          start: 0,
        },
      ],
      [
        {
          branchOrder: 2,
          end: 1,
          endCommitHash: "m-commit", // Should be sorted second
          start: 0,
        },
      ],
    ];

    // Add version nodes for color assignment
    versionsMap.set("z-commit", { hash: "z-commit", x: 0 } as VersionNode);
    versionsMap.set("a-commit", { hash: "a-commit", x: 1 } as VersionNode);
    versionsMap.set("m-commit", { hash: "m-commit", x: 2 } as VersionNode);

    // Apply color assignment
    setBranchAndVersionColor(columns, branchColors, versionsMap);

    // Assert that colors are assigned based on the sorted order of hashes ("a", "m", "z")
    // The column with "a-commit" (original index 1) should get the FIRST color.
    expect(columns[1]?.[0]?.color).toBe(branchColors[0]);
    expect(versionsMap.get("a-commit")?.commitColor).toBe(branchColors[0]);

    // The column with "m-commit" (original index 2) should get the SECOND color.
    expect(columns[2]?.[0]?.color).toBe(branchColors[1]);
    expect(versionsMap.get("m-commit")?.commitColor).toBe(branchColors[1]);

    // The column with "z-commit" (original index 0) should get the THIRD color.
    expect(columns[0]?.[0]?.color).toBe(branchColors[2]);
    expect(versionsMap.get("z-commit")?.commitColor).toBe(branchColors[2]);
  });

  it("should cycle through colors when there are more branches than colors", () => {
    const branchColors = ["#8F00FF", "#FC42C9"];
    const versionsMap = new Map<string, VersionNode>();

    const columns: BranchPathType[][] = [
      [{ branchOrder: 0, end: 1, endCommitHash: "commitA", start: 0 }], // -> Color 0
      [{ branchOrder: 1, end: 1, endCommitHash: "commitB", start: 0 }], // -> Color 1
      [{ branchOrder: 2, end: 1, endCommitHash: "commitC", start: 0 }], // -> Should cycle back to Color 0
    ];

    setBranchAndVersionColor(columns, branchColors, versionsMap);

    // The sorting order of signatures is "commitA", "commitB", "commitC".
    expect(columns[0]?.[0]?.color).toBe(branchColors[0]);
    expect(columns[1]?.[0]?.color).toBe(branchColors[1]);
    expect(columns[2]?.[0]?.color).toBe(branchColors[0]); // Cycles correctly
  });

  it("should produce a deterministic color assignment", () => {
    const branchColors = ["#8F00FF", "#FC42C9", "#3D91F0"];

    // Define a consistent data structure
    const createColumns = (): BranchPathType[][] => [
      [{ branchOrder: 0, end: 1, endCommitHash: "z-hash", start: 0 }],
      [{ branchOrder: 1, end: 1, endCommitHash: "a-hash", start: 0 }],
    ];
    const createVersionsMap = (): Map<string, VersionNode> =>
      new Map([
        ["a-hash", { hash: "a-hash", x: 1 } as VersionNode],
        ["z-hash", { hash: "z-hash", x: 0 } as VersionNode],
      ]);

    // Run the assignment on the first set of data
    const columns1 = createColumns();
    const versionsMap1 = createVersionsMap();
    setBranchAndVersionColor(columns1, branchColors, versionsMap1);

    // Run the assignment on a second, identical set of data
    const columns2 = createColumns();
    const versionsMap2 = createVersionsMap();
    setBranchAndVersionColor(columns2, branchColors, versionsMap2);

    // Assert that the color assignments are identical because the underlying data is identical.
    // The branch with "a-hash" should always get the first color, and "z-hash" the second.
    expect(columns1[0]?.[0]?.color).toBe(columns2[0]?.[0]?.color); // z-hash color
    expect(columns1[1]?.[0]?.color).toBe(columns2[1]?.[0]?.color); // a-hash color
    expect(columns1[0]?.[0]?.color).not.toBe(columns1[1]?.[0]?.color); // ensure they are different
  });
});
