import type { BranchPathType, VersionNode } from "./types";

export function computePosition(versions: VersionNode[]) {
  const versionsMap = new Map<string, VersionNode>(
    versions.map((version) => [version.hash, version]),
  );
  const orderedVersionHashes = topologicalOrderVersions(versions, versionsMap);
  const { columns, versionsMapWithPos } = computeColumns(
    orderedVersionHashes,
    versionsMap,
  );

  const columnsWithEndCommit = columns.map((column) =>
    column.map((branchPath) => ({
      ...branchPath,
      endCommit: versionsMapWithPos.get(branchPath.endCommitHash),
    })),
  );
  return { columns: columnsWithEndCommit, versionsMap: versionsMapWithPos };
}

function computeColumns(
  orderedVersionHashes: string[],
  versionsMap: Map<string, VersionNode>,
) {
  const versionsMapWithPos = new Map<string, VersionNode>();
  for (const [index, versionHash] of orderedVersionHashes.entries()) {
    const version = versionsMap.get(versionHash);
    if (version) {
      versionsMapWithPos.set(versionHash, {
        ...version,
        y: index,
      } as VersionNode);
    }
  }

  const columns: BranchPathType[][] = [];
  const versionXs = new Map<string, number>();

  function updateColumnEnd(col: number, end: number, endCommitHash: string) {
    if (columns[col] && columns[col].length > 0) {
      const currentEntry = columns[col][columns[col].length - 1];
      if (currentEntry) {
        columns[col][columns[col].length - 1] = {
          branchOrder: currentEntry.branchOrder,
          end,
          endCommitHash,
          start: currentEntry.start,
        };
      }
    }
  }

  let branchOrder = 0;

  for (const [index, versionHash] of orderedVersionHashes.entries()) {
    const version = versionsMap.get(versionHash);
    if (!version) continue;
    const branchChildren = version.children.filter(
      (child: string) => {
        const childVersion = versionsMap.get(child);
        return childVersion && childVersion.parents[0] === version.hash;
      },
    );

    const isLastVersionOnBranch = version.children.length === 0;
    const isBranchOutVersion = branchChildren.length > 0;
    let versionX = -1;
    const isFirstVersion = version.parents.length === 0;
    const end = isFirstVersion ? index : Infinity;

    if (isLastVersionOnBranch) {
      columns.push([
        { branchOrder, end, endCommitHash: version.hash, start: index },
      ]);
      branchOrder++;
      versionX = columns.length - 1;
    } else if (isBranchOutVersion) {
      const branchChildrenXs = branchChildren
        .map((childHash: string) => versionXs.get(childHash))
        .filter((x): x is number => x !== undefined);

      versionX = Math.min(...branchChildrenXs);
      updateColumnEnd(versionX, end, version.hash);
      for (const childX of branchChildrenXs
        .filter((childX) => childX !== versionX)) {
          updateColumnEnd(childX, index - 1, version.hash);
        }
    } else {
      let minChildY = Infinity;
      let maxChildX = -1;

      for (const child of version.children) {
        const childY = versionsMapWithPos.get(child)?.y;
        const childX = versionXs.get(child);
        if (childY !== undefined && childX !== undefined) {
          if (childY < minChildY) minChildY = childY;
          if (childX > maxChildX) maxChildX = childX;
        }
      }

      const colFitAtEnd = columns
        .slice(maxChildX + 1)
        .findIndex((column) => {
          const lastEntry = column[column.length - 1];
          return lastEntry && minChildY >= lastEntry.end;
        });
      const col = colFitAtEnd === -1 ? -1 : maxChildX + 1 + colFitAtEnd;

      if (col === -1) {
        columns.push([
          {
            branchOrder,
            end,
            endCommitHash: version.hash,
            start: minChildY + 1,
          },
        ]);
        branchOrder++;
        versionX = columns.length - 1;
      } else {
        versionX = col;
        if (columns[col]) {
          columns[col].push({
            branchOrder,
            end,
            endCommitHash: version.hash,
            start: minChildY + 1,
          });
          branchOrder++;
        }
      }
    }

    versionXs.set(versionHash, versionX);
    versionsMapWithPos.set(versionHash, { ...version, x: versionX, y: index });
  }

  return { columns, versionsMapWithPos };
}

function topologicalOrderVersions(
  versions: VersionNode[],
  versionsMap: Map<string, VersionNode>,
): string[] {
  // Assumes input versions are sorted newest to oldest.
  const sortedVersions: string[] = [];
  const seen = new Map();

  function dfs(version: VersionNode) {
    const versionHash = version.hash;
    if (seen.get(versionHash)) {
      return;
    }
    seen.set(versionHash, true);
    for (const childId of version.children) {
      const child = versionsMap.get(childId);
      if (child) {
        dfs(child);
      }
    }
    sortedVersions.push(versionHash);
  }

  for (const version of versions) {
    dfs(version);
  }

  return sortedVersions;
}