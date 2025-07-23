/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

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
