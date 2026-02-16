import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  BranchPathType,
  VersionNode,
} from "../components/version-graph/types";

import Branches from "../components/version-graph/components/branches";
import { assertElement } from "./test-utils";

function createVersionNode({
  hash,
  x,
  y,
}: {
  hash: string;
  x: number;
  y: number;
}): VersionNode {
  return {
    children: [],
    commitColor: "#8F00FF",
    hash,
    message: hash,
    parents: [],
    x,
    y,
  };
}

describe("Version Graph Branches", () => {
  it("uses the last commit row index for Infinity branch ends", () => {
    const versionsMap = new Map<string, VersionNode>([
      ["v1", createVersionNode({ hash: "v1", x: 0, y: 0 })],
      ["v2", createVersionNode({ hash: "v2", x: 0, y: 1 })],
    ]);

    const columns: BranchPathType[][] = [
      [{ branchOrder: 0, end: Infinity, endCommitHash: "v2", start: 0 }],
    ];

    const { container } = render(
      <svg>
        <Branches
          branchColors={["#8F00FF"]}
          branchSpacing={20}
          columns={columns}
          commitSpacing={50}
          nodeRadius={2}
          versionsMap={versionsMap}
        />
      </svg>,
    );

    const branchRect = container.querySelector("rect");
    assertElement(branchRect);

    // start=0 and end=1 (last commit row) => 1 * commitSpacing (50)
    expect(Number(branchRect.getAttribute("height"))).toBe(50);
  });

  it("keeps explicit finite branch ends unchanged", () => {
    const versionsMap = new Map<string, VersionNode>([
      ["v1", createVersionNode({ hash: "v1", x: 0, y: 0 })],
      ["v2", createVersionNode({ hash: "v2", x: 0, y: 3 })],
    ]);

    const columns: BranchPathType[][] = [
      [{ branchOrder: 0, end: 2, endCommitHash: "v2", start: 0 }],
    ];

    const { container } = render(
      <svg>
        <Branches
          branchColors={["#8F00FF"]}
          branchSpacing={20}
          columns={columns}
          commitSpacing={50}
          nodeRadius={2}
          versionsMap={versionsMap}
        />
      </svg>,
    );

    const branchRect = container.querySelector("rect");
    assertElement(branchRect);

    // start=0 and end=2 => 2 * commitSpacing (100)
    expect(Number(branchRect.getAttribute("height"))).toBe(100);
  });
});
