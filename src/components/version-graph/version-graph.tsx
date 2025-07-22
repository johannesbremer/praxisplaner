import React from "react";

import type { GraphStyle, Version, VersionNode } from "./types";

import Branches from "./components/branches";
import ConnectionLines from "./components/connection-lines";
import VersionDot from "./components/version-dot";
import { computePosition } from "./compute-position";
import {
  defaultStyle,
  formatVersions,
  setBranchAndVersionColor,
} from "./utils";

interface Props {
  className?: string;
  graphStyle?: Partial<GraphStyle>;
  onVersionClick?: (version: VersionNode) => void;
  selectedVersionId?: string;
  versions: Version[];
}

export default function VersionGraph({
  className,
  graphStyle,
  onVersionClick,
  selectedVersionId,
  versions,
}: Props) {
  const style = { ...defaultStyle, ...graphStyle };

  // Sort versions by creation time (newest first)
  const sortedVersions = React.useMemo(() => {
    return [...versions].sort((a, b) => b.createdAt - a.createdAt);
  }, [versions]);

  const formattedVersions = React.useMemo(() => {
    return formatVersions(sortedVersions);
  }, [sortedVersions]);

  const { columns, versionsMap } = React.useMemo(() => {
    if (formattedVersions.length === 0) {
      return { columns: [], versionsMap: new Map() };
    }
    return computePosition(formattedVersions);
  }, [formattedVersions]);

  React.useEffect(() => {
    setBranchAndVersionColor(columns, style.branchColors, versionsMap);
  }, [columns, style.branchColors, versionsMap]);

  if (versions.length === 0) {
    return (
      <div
        className={`text-center py-8 text-muted-foreground ${className || ""}`}
      >
        Keine Versionen vorhanden
      </div>
    );
  }

  const versionValues = [...versionsMap.values()];
  const maxX = Math.max(...versionValues.map((v: VersionNode) => v.x));
  const maxY = Math.max(...versionValues.map((v: VersionNode) => v.y));

  const width = (maxX + 1) * style.branchSpacing + style.nodeRadius * 8 + 300; // Extra space for labels
  const height = (maxY + 1) * style.commitSpacing + style.nodeRadius * 8;

  return (
    <div className={className}>
      <svg
        height={height}
        style={{ overflow: "visible" }}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <Branches
          branchColors={style.branchColors}
          branchSpacing={style.branchSpacing}
          columns={columns}
          commitSpacing={style.commitSpacing}
          nodeRadius={style.nodeRadius}
          versionsMap={versionsMap}
        />
        <ConnectionLines
          branchSpacing={style.branchSpacing}
          commitSpacing={style.commitSpacing}
          nodeRadius={style.nodeRadius}
          versionsMap={versionsMap}
        />
        {versionValues.map((version: VersionNode) => (
          <VersionDot
            branchSpacing={style.branchSpacing}
            commitSpacing={style.commitSpacing}
            key={version.hash}
            nodeRadius={style.nodeRadius}
            version={version}
            {...(onVersionClick && { onClick: onVersionClick })}
          />
        ))}

        {/* Inline version labels next to each node */}
        {versionValues.map((version: VersionNode) => {
          const x = style.nodeRadius * 4 + version.x * style.branchSpacing;
          const y = version.y * style.commitSpacing + style.nodeRadius * 4;
          const isSelected = selectedVersionId === version.hash;

          return (
            <g key={`label-${version.hash}`}>
              <foreignObject
                height={30}
                width={300}
                x={x + style.nodeRadius * 4}
                y={y - 15}
              >
                <div
                  className={`flex items-center gap-2 text-sm cursor-pointer p-1 rounded ${
                    isSelected
                      ? "bg-primary text-primary-foreground border border-primary"
                      : "hover:bg-background border border-border bg-background"
                  }`}
                  onClick={() => onVersionClick?.(version)}
                  style={{ fontSize: "12px" }}
                >
                  <span className="font-medium">
                    {version.message.replaceAll(
                      /^(?:Aktivierung von\s*)+/g,
                      "",
                    )}
                  </span>
                  {version.isActive && (
                    <span className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded text-xs leading-none">
                      AKTIV
                    </span>
                  )}
                  {typeof version.createdAt === "number" && (
                    <span className="text-muted-foreground text-xs">
                      {new Date(version.createdAt).toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}{" "}
                      {new Date(version.createdAt).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
