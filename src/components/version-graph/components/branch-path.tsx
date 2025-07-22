import { convertColorToMatrixVariant } from "../utils";

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
  const height = Math.abs(end - start) * (commitSpacing + nodeRadius * 4);
  const x = nodeRadius * 4 + branchOrder * branchSpacing - 1;
  const matrixColor = convertColorToMatrixVariant(branchColor);

  return (
    <>
      <g filter={`url(#filter${branchOrder}-${start}-${end})`}>
        <rect
          fill={branchColor}
          height={height}
          width={2}
          x={x}
          y={start * commitSpacing}
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
          y={start * commitSpacing}
        >
          <feColorMatrix
            in="SourceAlpha"
            result="hardAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="2.5" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values={matrixColor} />
          <feBlend
            in2="BackgroundImageFix"
            mode="normal"
            result="effect1_dropShadow_2_590"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow_2_590"
            mode="normal"
            result="shape"
          />
        </filter>
      </defs>
    </>
  );
}
