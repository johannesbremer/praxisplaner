import React from "react";

import type { GraphStyle, Version, VersionNode } from "./types";

import Branches from "./components/branches";
import VersionDot from "./components/version-dot";
import { computePosition } from "./compute-position";
import { defaultStyle, formatVersions, setBranchAndVersionColor } from "./utils";

interface Props {
  className?: string;
  graphStyle?: Partial<GraphStyle>;
  onVersionClick?: (version: VersionNode) => void;
  versions: Version[];
}

export default function VersionGraph({
  className,
  graphStyle,
  onVersionClick,
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
      <div className={`text-center py-8 text-muted-foreground ${className || ""}`}>
        Keine Versionen vorhanden
      </div>
    );
  }

  const versionValues = [...versionsMap.values()];
  const maxX = Math.max(...versionValues.map((v: VersionNode) => v.x));
  const maxY = Math.max(...versionValues.map((v: VersionNode) => v.y));
  
  const width = (maxX + 1) * style.branchSpacing + style.nodeRadius * 8;
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
      </svg>
      
      {/* Version labels */}
      <div className="mt-4 space-y-2">
        {versionValues
          .sort((a: VersionNode, b: VersionNode) => a.y - b.y)
          .map((version: VersionNode) => (
            <div className="flex items-center gap-2 text-sm" key={version.hash}>
              <div
                className="w-3 h-3 rounded-full border-2 border-white"
                style={{ backgroundColor: version.commitColor }}
              />
              <span className="font-mono text-xs text-muted-foreground">
                {version.hash.slice(0, 7)}
              </span>
              <span>{version.message}</span>
              {version.isActive && (
                <span className="bg-primary text-primary-foreground px-2 py-0.5 rounded text-xs">
                  AKTIV
                </span>
              )}
              {typeof version.createdAt === 'number' && (
                <span className="text-muted-foreground text-xs">
                  {new Date(version.createdAt).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}