/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import React from "react";

import type { VersionNode } from "../types";

interface Props {
  branchSpacing: number;
  commitSpacing: number;
  nodeRadius: number;
  versionsMap: Map<string, VersionNode>;
}

export default function ConnectionLines({
  branchSpacing,
  commitSpacing,
  nodeRadius,
  versionsMap,
}: Props) {
  const connections: React.ReactElement[] = [];

  // For each version, draw lines to its parents
  for (const [, version] of versionsMap.entries()) {
    for (const parentId of version.parents) {
      const parent = versionsMap.get(parentId);
      if (!parent) {
        continue;
      }

      const childX = nodeRadius * 4 + version.x * branchSpacing;
      const childY = version.y * commitSpacing + nodeRadius * 4;
      const parentX = nodeRadius * 4 + parent.x * branchSpacing;
      const parentY = parent.y * commitSpacing + nodeRadius * 4;

      // If parent and child are in the same column, no connection line needed (vertical branch line handles it)
      if (version.x === parent.x) {
        continue;
      }

      // Create a path that branches off at 90 degrees then goes straight up
      const key = `connection-${version.hash}-${parentId}`;

      // For horizontal branching, create a path that:
      // 1. Goes vertically down from parent for a short distance
      // 2. Makes a 90-degree turn horizontally toward the child
      // 3. Goes horizontally to align with child column
      // 4. Goes vertically up to reach the child
      const branchDistance = commitSpacing * 0.2; // How far down to go before branching
      const horizontalMidY = parentY + branchDistance;
      const pathData = `M ${parentX} ${parentY} L ${parentX} ${horizontalMidY} L ${childX} ${horizontalMidY} L ${childX} ${childY}`;

      // Use child's color for the connection when it's a new branch, otherwise use parent's color
      // This ensures that when a new branch starts, the connection line matches the branch color
      const strokeColor =
        version.commitColor || parent.commitColor || "#666666";

      connections.push(
        <path
          d={pathData}
          fill="none"
          key={key}
          opacity="0.7"
          stroke={strokeColor}
          strokeWidth="2"
        />,
      );
    }
  }

  return <>{connections}</>;
}
