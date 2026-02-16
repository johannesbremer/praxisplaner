/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { BranchPathType, VersionNode } from "../types";

import BranchPath from "./branch-path";

interface Props {
  branchColors: string[];
  branchSpacing: number;
  columns: BranchPathType[][];
  commitSpacing: number;
  nodeRadius: number;
  versionsMap: Map<string, VersionNode>;
}

export default function Branches({
  branchColors,
  branchSpacing,
  columns,
  commitSpacing,
  nodeRadius,
  versionsMap,
}: Props) {
  // `BranchPath` expects `start`/`end` in commit-row units, not pixels.
  // If we pass a pixel value here, height gets multiplied by `commitSpacing`
  // again and the line can extend far beyond the graph.
  const currentLastCommitY = Math.max(
    0,
    ...[...versionsMap.values()].map((c) => c.y),
  );

  return (
    <>
      {columns.map((column, i) => {
        return column.map((c) => {
          const end = c.end === Infinity ? currentLastCommitY : c.end;
          const color =
            c.color ?? branchColors[i % branchColors.length] ?? "#000000";
          return (
            <BranchPath
              branchColor={color}
              branchOrder={i}
              branchSpacing={branchSpacing}
              commitSpacing={commitSpacing}
              end={end}
              key={`branch-path-${i}-${c.start}-${end}`}
              nodeRadius={nodeRadius}
              start={c.start}
            />
          );
        });
      })}
    </>
  );
}
