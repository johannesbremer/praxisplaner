import type { VersionNode } from "../types";

import { convertColorToMatrixVariant } from "../utils";
import { getVersionDotPosition } from "./version-dot-utils";

interface Props {
  branchSpacing: number;
  commitSpacing: number;
  nodeRadius: number;
  onClick?: (version: VersionNode) => void;
  version: VersionNode;
}

export default function VersionDot({
  branchSpacing,
  commitSpacing,
  nodeRadius,
  onClick,
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
        fill={version.commitColor}
        filter={`url(#${filterId})`}
        onClick={() => onClick?.(version)}
        style={{ cursor: onClick ? "pointer" : "default" }}
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
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            result="hardAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values={convertColorToMatrixVariant(version.commitColor)}
          />
          <feBlend
            in2="BackgroundImageFix"
            mode="normal"
            result="effect1_dropShadow_46_47"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow_46_47"
            mode="normal"
            result="shape"
          />
        </filter>
      </defs>
    </>
  );
}
