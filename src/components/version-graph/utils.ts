/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { BranchPathType, Version, VersionNode } from "./types";

export const defaultStyle = {
  branchColors: [
    "#010A40",
    "#FC42C9",
    "#3D91F0",
    "#29E3C1",
    "#C5A15A",
    "#FA7978",
    "#5D6280",
    "#5AC58D",
    "#5C5AC5",
    "#EB7340",
  ],
  branchSpacing: 20,
  commitSpacing: 50,
  nodeRadius: 2,
};

export function convertColorToMatrixVariant(color: string): string {
  if (color.startsWith("#")) {
    return hexToColorMatrixVariant(color);
  }
  return rgbColorToMatrixVariant(color);
}

export function formatVersions(versions: Version[]): VersionNode[] {
  const childrenMap = new Map<string, string[]>();
  for (const version of versions) {
    for (const parent of version.parents) {
      const parentStr = String(parent); // Convert Id<"ruleSets"> to string
      if (childrenMap.has(parentStr)) {
        childrenMap.get(parentStr)?.push(version.id);
      } else {
        childrenMap.set(parentStr, [version.id]);
      }
    }
  }

  return versions.map((version) => ({
    children: childrenMap.get(version.id) ?? [],
    commitColor: "",
    createdAt: version.createdAt,
    hash: version.id,
    isActive: version.isActive ?? false,
    message: version.message,
    parents: version.parents.map(String), // Convert Id<"ruleSets"> to string
    x: -1,
    y: -1,
  }));
}

export function setBranchAndVersionColor(
  columns: BranchPathType[][],
  branchColors: string[],
  versionsMap: Map<string, VersionNode>,
) {
  // To ensure stable colors, we create a canonical ordering for the columns
  // by generating a unique, sortable "signature" for each one. This makes
  // color assignment deterministic, even if the upstream `computePosition`
  // function returns columns in an unstable order between renders.

  const indexedColumns = columns
    .map((columnData, index) => {
      // The signature is a sorted list of all endCommitHashes in the column's path segments.
      // This is more robust as it doesn't rely on the separate versionsMap.
      const signatureHashes = columnData
        .map((pathSegment) => pathSegment.endCommitHash)
        .sort();

      return {
        columnData,
        originalIndex: index,
        signature: signatureHashes.join(","),
      };
    })
    .filter((c) => c.signature); // Ensure we don't process empty columns

  // Sort the columns by their signature to get a stable, canonical order.
  indexedColumns.sort((a, b) => a.signature.localeCompare(b.signature));

  // Assign colors based on the new stable order.
  for (const [stableIndex, indexedCol] of indexedColumns.entries()) {
    const branchColor = branchColors[stableIndex % branchColors.length];
    if (!branchColor) {
      continue;
    }

    // Assign the determined color to the branch path segments.
    for (const pathSegment of indexedCol.columnData) {
      pathSegment.color = branchColor;
    }

    // Assign the same color to all versions within that original column.
    for (const version of versionsMap.values()) {
      if (version.x === indexedCol.originalIndex) {
        version.commitColor = branchColor;
      }
    }
  }
}

function hexToColorMatrixVariant(hex?: string): string {
  if (!hex) {
    return "";
  }
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 0.5 0`;
}

function rgbColorToMatrixVariant(rgb: string): string {
  const [r, g, b] = rgb
    .toLowerCase()
    .replace("rgb(", "")
    .replace(")", "")
    .split(",")
    .map((x) => Number.parseInt(x) / 255);
  return `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 0.5 0`;
}
