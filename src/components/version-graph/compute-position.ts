/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

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
      versionsMapWithPos.set(versionHash, { ...version, y: index });
    }
  }

  const columns: BranchPathType[][] = [];
  const versionXs = new Map<string, number>();

  function updateColumnEnd(col: number, end: number, endCommitHash: string) {
    const column = columns[col];
    if (column && column.length > 0) {
      const currentEntry = column[column.length - 1];
      if (currentEntry) {
        currentEntry.end = end;
        currentEntry.endCommitHash = endCommitHash;
      }
    }
  }

  let branchOrder = 0;

  for (const [index, versionHash] of orderedVersionHashes.entries()) {
    const version = versionsMapWithPos.get(versionHash);
    if (!version) {
      continue;
    }

    const branchChildren = version.children.filter((child: string) => {
      const childVersion = versionsMapWithPos.get(child);
      return childVersion?.parents[0] === version.hash;
    });

    const isLastVersionOnBranch = version.children.length === 0;
    const isBranchOutVersion = branchChildren.length > 0;
    let versionX = -1;
    const isFirstVersion = version.parents.length === 0;
    const end = isFirstVersion ? index : Infinity;

    if (isLastVersionOnBranch) {
      columns.push([
        { branchOrder, end, endCommitHash: version.hash, start: index },
      ]);
      versionX = columns.length - 1;
      branchOrder++;
    } else if (isBranchOutVersion) {
      const branchChildrenXs = branchChildren
        .map((childHash: string) => versionXs.get(childHash))
        .filter((x): x is number => x !== undefined);

      if (branchChildrenXs.length > 0) {
        versionX = Math.min(...branchChildrenXs);
        updateColumnEnd(versionX, end, version.hash);

        // --- THE FIX IS HERE ---
        for (const childX of branchChildrenXs.filter((x) => x !== versionX)) {
          // Find the specific child commit that corresponds to this column.
          const childToTerminate = branchChildren.find(
            (hash) => versionXs.get(hash) === childX,
          );
          const childVersion = childToTerminate
            ? versionsMapWithPos.get(childToTerminate)
            : undefined;

          if (childVersion) {
            // The branch path should end AT the child commit's Y-coordinate.
            updateColumnEnd(childX, childVersion.y, version.hash);
          } else {
            // Fallback for safety, though it shouldn't be hit with consistent data.
            updateColumnEnd(childX, index - 1, version.hash);
          }
        }
        // --- END OF FIX ---
      }
    } else {
      // This logic handles placing commits with multiple parents ("merge commits")
      // and should now work correctly as children's paths are terminated above.
      let minChildY = Infinity;
      let maxChildX = -1;

      for (const child of version.children) {
        const childY = versionsMapWithPos.get(child)?.y;
        const childX = versionXs.get(child);
        if (childY !== undefined && childX !== undefined) {
          if (childY < minChildY) {
            minChildY = childY;
          }
          if (childX > maxChildX) {
            maxChildX = childX;
          }
        }
      }

      if (minChildY === Infinity) {
        columns.push([
          { branchOrder, end, endCommitHash: version.hash, start: index },
        ]);
        versionX = columns.length - 1;
        branchOrder++;
      } else {
        const colFitAtEnd = columns.slice(maxChildX + 1).findIndex((column) => {
          const lastEntry = column[column.length - 1];
          return lastEntry && minChildY >= lastEntry.end;
        });
        const col = colFitAtEnd === -1 ? -1 : maxChildX + 1 + colFitAtEnd;

        const startY = minChildY + 1;
        if (col === -1) {
          columns.push([
            { branchOrder, end, endCommitHash: version.hash, start: startY },
          ]);
          versionX = columns.length - 1;
          branchOrder++;
        } else {
          versionX = col;
          const column = columns[col];
          if (column) {
            column.push({
              branchOrder,
              end,
              endCommitHash: version.hash,
              start: startY,
            });
          }
          branchOrder++;
        }
      }
    }

    versionXs.set(versionHash, versionX);
    const versionToUpdate = versionsMapWithPos.get(versionHash);
    if (versionToUpdate) {
      versionToUpdate.x = versionX;
      versionToUpdate.y = index;
    }
  }

  return { columns, versionsMapWithPos };
}

function topologicalOrderVersions(
  versions: VersionNode[],
  versionsMap: Map<string, VersionNode>,
): string[] {
  const sortedVersions: string[] = [];
  const seen = new Map<string, boolean>();

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
