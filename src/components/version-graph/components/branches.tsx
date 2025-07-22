import type { BranchPathType, VersionNode } from "../types";

import BranchPath from "./branch-path";

interface Props {
  branchSpacing: number;
  columns: BranchPathType[][];
  commitSpacing: number;
  nodeRadius: number;
  versionsMap: Map<string, VersionNode>;
}

export default function Branches({
  branchSpacing,
  columns,
  commitSpacing,
  nodeRadius,
  versionsMap,
}: Props) {
  const currentLastCommits =
    Math.max(...[...versionsMap.values()].map((c) => c.y)) * commitSpacing +
    nodeRadius * 4;

  return (
    <>
      {columns.map((column, i) => {
        return column.map((c) => {
          const end = c.end === Infinity ? currentLastCommits : c.end;
          const color = c.color ?? "#000000";
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
