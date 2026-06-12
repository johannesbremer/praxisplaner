/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

interface Props {
  branchColor: string;
  branchOrder: number;
  branchSpacing: number;
  commitSpacing: number;
  end: number;
  nodeRadius: number;
  start: number;
}

export default function BranchPath({
  branchColor,
  branchOrder,
  branchSpacing,
  commitSpacing,
  end,
  nodeRadius,
  start,
}: Props) {
  const height = Math.abs(end - start) * commitSpacing;
  const x = nodeRadius * 4 + branchOrder * branchSpacing - 1;

  return (
    <>
      <g filter={`url(#filter${branchOrder}-${start}-${end})`}>
        <rect
          fill={branchColor}
          height={height}
          width={2}
          x={x}
          y={start * commitSpacing + nodeRadius * 4}
        />
      </g>
      <defs>
        <filter
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          height={height}
          id={`filter${branchOrder}-${start}-${end}`}
          width={12}
          x={x}
          y={start * commitSpacing + nodeRadius * 4}
        >
          <feDropShadow
            dx="0"
            dy="0"
            floodColor={branchColor}
            floodOpacity="0.5"
            stdDeviation="2.5"
          />
        </filter>
      </defs>
    </>
  );
}
