/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { BranchPathType, Version, VersionNode } from "./types";

export const defaultStyle = {
  branchColors: [
    "var(--version-graph-branch-1)",
    "var(--version-graph-branch-2)",
    "var(--version-graph-branch-3)",
    "var(--version-graph-branch-4)",
    "var(--version-graph-branch-5)",
    "var(--version-graph-branch-6)",
    "var(--version-graph-branch-7)",
    "var(--version-graph-branch-8)",
    "var(--version-graph-branch-9)",
    "var(--version-graph-branch-10)",
  ],
  branchSpacing: 20,
  commitSpacing: 50,
  nodeRadius: 2,
};

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
        .toSorted();

      return {
        columnData,
        originalIndex: index,
        signature: signatureHashes.join(","),
      };
    })
    .filter((c) => c.signature); // Ensure we don't process empty columns

  // Sort the columns by their signature to get a stable, canonical order.
  const sortedIndexedColumns = indexedColumns.toSorted((a, b) =>
    a.signature.localeCompare(b.signature),
  );

  // Assign colors based on the new stable order.
  for (const [stableIndex, indexedCol] of sortedIndexedColumns.entries()) {
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
