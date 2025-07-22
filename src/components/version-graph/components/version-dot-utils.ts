import type { VersionNode } from "../types";

export function getVersionDotPosition(
  branchSpacing: number,
  commitSpacing: number,
  nodeRadius: number,
  version: VersionNode,
) {
  const x = branchSpacing * version.x + nodeRadius * 4;
  const y = commitSpacing * version.y + nodeRadius * 4;
  return { x, y };
}
