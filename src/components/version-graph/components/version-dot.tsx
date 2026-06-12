/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { VersionNode } from "../types";

import { getVersionDotPosition } from "./version-dot-utils";

interface Props {
  branchSpacing: number;
  commitSpacing: number;
  nodeRadius: number;
  version: VersionNode;
}

export default function VersionDot({
  branchSpacing,
  commitSpacing,
  nodeRadius,
  version,
}: Props) {
  const { x, y } = getVersionDotPosition(
    branchSpacing,
    commitSpacing,
    nodeRadius,
    version,
  );
  const filterId = `filter_${version.hash}_node`;

  return (
    <>
      <g
        aria-hidden="true"
        className="pointer-events-none"
        fill={version.commitColor}
        filter={`url(#${filterId})`}
      >
        <circle
          cx={x}
          cy={y}
          r={nodeRadius * 2 + 0.25}
          stroke="white"
          strokeWidth="2"
        />
        {version.isActive && (
          <circle
            cx={x}
            cy={y}
            fill="none"
            r={nodeRadius * 3}
            stroke={version.commitColor}
            strokeWidth="2"
          />
        )}
      </g>
      <defs>
        <filter
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          height={nodeRadius * 8}
          id={filterId}
          width={nodeRadius * 8}
          x={x - nodeRadius * 4}
          y={y - nodeRadius * 4}
        >
          <feDropShadow
            dx="0"
            dy="0"
            floodColor={version.commitColor}
            floodOpacity="0.5"
            stdDeviation="1"
          />
        </filter>
      </defs>
    </>
  );
}
