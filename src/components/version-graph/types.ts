/*
This file is forked from the following Apache-2.0 licensed repo:
https://github.com/liuliu-dev/CommitGraph/tree/0f89c35fa53003ed8b66b409230566a455d85202
*/

import type { Id } from "@/convex/_generated/dataModel";

/** Represents one saved state in the version history. */
export interface Version {
  createdAt: number; // Creation timestamp
  id: Id<"ruleSets">; // A unique identifier for this version.
  isActive?: boolean; // Whether this version is currently active
  message: string; // The message or name provided when saving.
  parents: Id<"ruleSets">[]; // An array of parent version IDs.
}

/** Represents a named pointer to a specific version, like a git tag. */
export interface Tag {
  link?: string; // Optional link for the tag
  name: string; // The name of the tag.
  versionId: Id<"ruleSets">; // The ID of the version this tag points to.
}

/** Internal representation of a version node in the graph. */
export interface VersionNode {
  children: string[];
  commitColor: string; // Sticking with original name for simplicity
  createdAt?: number;
  hash: string; // Corresponds to Version.id
  isActive?: boolean;
  message: string;
  parents: string[];
  x: number;
  y: number;
}

/** Style properties for the graph. */
export interface GraphStyle {
  branchColors: string[];
  branchSpacing: number;
  commitSpacing: number;
  nodeRadius: number;
}

/** Path segment for a branch in a column. */
export interface BranchPathType {
  branchOrder: number;
  color?: string | undefined;
  end: number;
  endCommit?: undefined | VersionNode;
  endCommitHash: string;
  start: number;
}

/** Props for the ConnectionLines component. */
export interface ConnectionLinesProps {
  branchSpacing: number;
  commitSpacing: number;
  nodeRadius: number;
  versionsMap: Map<string, VersionNode>;
}

/** Intermediate connection data for rendering connection lines. */
export interface ConnectionData {
  childX: number;
  childY: number;
  key: string;
  pathData: string;
  strokeColor: string;
}
