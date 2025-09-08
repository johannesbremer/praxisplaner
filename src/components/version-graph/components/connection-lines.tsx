/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { ConnectionData, ConnectionLinesProps } from "../types";

export default function ConnectionLines({
  branchSpacing,
  commitSpacing,
  nodeRadius,
  versionsMap,
}: ConnectionLinesProps) {
  // 1. Collect all connection data before rendering
  const connectionDataList: ConnectionData[] = [];

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
      const branchDistance = commitSpacing * 0.4; // How far down to go before branching
      const horizontalMidY = parentY + branchDistance;
      const pathData = `M ${parentX} ${parentY} L ${parentX} ${horizontalMidY} L ${childX} ${horizontalMidY} L ${childX} ${childY}`;

      // Use child's color for the connection when it's a new branch, otherwise use parent's color
      // This ensures that when a new branch starts, the connection line matches the branch color
      const strokeColor =
        version.commitColor || parent.commitColor || "#666666";

      connectionDataList.push({
        childX: version.x,
        childY: version.y,
        key,
        pathData,
        strokeColor,
      });
    }
  }

  // 2. Sort the connections to control the Z-order (stacking)
  // Elements drawn later appear on top.
  const sortedConnectionDataList = connectionDataList.toSorted((a, b) => {
    // Primary sort: Draw connections to higher commits (smaller y) on top.
    // To do this, we sort by 'y' in descending order, so smaller 'y' values are later in the array.
    if (a.childY !== b.childY) {
      return b.childY - a.childY;
    }
    // Secondary sort (tie-breaker): Draw branches further to the right (larger x) on top.
    // We sort by 'x' in descending order, so larger 'x' values are later in the array.
    return b.childX - a.childX;
  });

  // 3. Map the sorted data to React elements
  const connections = sortedConnectionDataList.map((data) => (
    <path
      d={data.pathData}
      fill="none"
      key={data.key}
      stroke={data.strokeColor}
      strokeWidth="2"
    />
  ));

  return <>{connections}</>;
}
