import { useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import { api } from "@/convex/_generated/api";

// Import CommitGraph and its types
import type { Branch, Commit, CommitNode } from "commit-graph";

import { CommitGraph } from "commit-graph";

interface RuleSetHistoryGraphProps {
  onRuleSetClick?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
}

export function RuleSetHistoryGraph({
  onRuleSetClick,
  practiceId,
}: RuleSetHistoryGraphProps) {
  const historyQuery = useQuery(api.rules.getRuleSetHistory, { practiceId });

  if (!historyQuery) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-muted-foreground">Lade Regelset-Historie...</div>
      </div>
    );
  }

  if (historyQuery.ruleSets.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-muted-foreground">
          Keine Regelsets vorhanden. Erstellen Sie Ihr erstes Regelset.
        </div>
      </div>
    );
  }

  // Convert rule sets to commits for CommitGraph
  const commits: Commit[] = historyQuery.ruleSets.map((ruleSet) => ({
    commit: {
      author: {
        date: new Date(ruleSet.createdAt).toISOString(),
        name: ruleSet.createdBy,
      },
      message: ruleSet.description,
    },
    parents: ruleSet.parentRuleSetId ? [{ sha: ruleSet.parentRuleSetId }] : [], // Root commits have no parents
    sha: ruleSet._id,
  }));

  // Create branch heads - the active rule set is the main branch
  const branchHeads: Branch[] = [];
  if (historyQuery.activeRuleSetId) {
    branchHeads.push({
      commit: {
        sha: historyQuery.activeRuleSetId,
      },
      name: "active",
    });
  }

  // Add any rule sets without children as branch heads (leaf nodes)
  const parentIds = new Set(
    historyQuery.ruleSets
      .map((rs) => rs.parentRuleSetId)
      .filter(Boolean) as string[],
  );

  for (const ruleSet of historyQuery.ruleSets) {
    // If this rule set is not a parent of any other rule set, it's a leaf
    const isLeaf = !parentIds.has(ruleSet._id);
    const isNotActive = ruleSet._id !== historyQuery.activeRuleSetId;

    if (isLeaf && isNotActive) {
      branchHeads.push({
        commit: {
          sha: ruleSet._id,
        },
        name: `draft-v${ruleSet.version}`,
      });
    }
  }

  const handleCommitClick = (commit: CommitNode) => {
    if (onRuleSetClick) {
      onRuleSetClick(commit.hash as Id<"ruleSets">);
    }
  };

  return (
    <div className="w-full h-96 overflow-auto border rounded-lg">
      <CommitGraph
        branchHeads={branchHeads}
        commits={commits}
        currentBranch="active"
        dateFormatFn={(date: Date | number | string) =>
          new Date(date).toLocaleDateString("de-DE", {
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        }
        graphStyle={{
          branchColors: [
            "#22c55e", // Green for active
            "#3b82f6", // Blue for drafts
            "#f59e0b", // Orange for other branches
            "#ef4444", // Red for additional branches
            "#8b5cf6", // Purple for additional branches
          ],
          branchSpacing: 30,
          commitSpacing: 60,
          nodeRadius: 3,
        }}
        onCommitClick={handleCommitClick}
      />
    </div>
  );
}
