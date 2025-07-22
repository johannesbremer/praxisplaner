import { useQuery } from "convex/react";
import React from "react";

import type { Id } from "@/convex/_generated/dataModel";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

// Import CommitGraph with proper typing
import { CommitGraph } from "commit-graph";

interface RuleSetHistoryVisualizationProps {
  onRuleSetClick?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
}

export function RuleSetHistoryVisualization({
  onRuleSetClick,
  practiceId,
}: RuleSetHistoryVisualizationProps) {
  const ruleSetHistoryQuery = useQuery(api.rules.getRuleSetHistory, {
    practiceId,
  });

  // Transform rule sets into commit graph format
  const { branchHeads, commits } = React.useMemo(() => {
    if (!ruleSetHistoryQuery) {
      return { branchHeads: [], commits: [] };
    }

    // Convert rule sets to commits
    const commits = ruleSetHistoryQuery.map((ruleSet) => ({
      commit: {
        author: {
          date: new Date(ruleSet.createdAt),
          name: ruleSet.createdBy,
        },
        message: ruleSet.description,
      },
      parents: ruleSet.parentId ? [{ sha: ruleSet.parentId }] : [], // Only include parent if it exists
      sha: ruleSet._id,
    }));

    // Find branch heads (rule sets with no children or active rule set)
    const hasChildren = new Set<string>();
    for (const ruleSet of ruleSetHistoryQuery) {
      if (ruleSet.parentId) {
        hasChildren.add(ruleSet.parentId);
      }
    }

    const branchHeads = ruleSetHistoryQuery
      .filter((rs) => !hasChildren.has(rs._id) || rs.isActive)
      .map((ruleSet) => ({
        commit: {
          sha: ruleSet._id,
        },
        name: ruleSet.isActive ? "main" : `v${ruleSet.version}`,
      }));

    return { branchHeads, commits };
  }, [ruleSetHistoryQuery]);

  const handleCommitClick = React.useCallback(
    (commitNode: { hash: string }) => {
      if (onRuleSetClick) {
        onRuleSetClick(commitNode.hash as Id<"ruleSets">);
      }
    },
    [onRuleSetClick],
  );

  // Custom date formatter for German locale
  const dateFormatFn = React.useCallback((d: Date | number | string) => {
    return new Date(d).toLocaleString("de-DE", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regelset-Historie</CardTitle>
        <CardDescription>
          Visualisierung der Regelset-Entwicklung im Git-Stil. Klicken Sie auf
          einen Commit, um zu diesem Regelset zu wechseln.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {commits.length > 0 ? (
          <div className="min-h-[400px]">
            <CommitGraph
              branchHeads={branchHeads}
              commits={commits}
              dateFormatFn={dateFormatFn}
              graphStyle={{
                branchColors: [
                  "#2563eb", // blue-600
                  "#dc2626", // red-600
                  "#16a34a", // green-600
                  "#ca8a04", // yellow-600
                  "#9333ea", // violet-600
                  "#c2410c", // orange-600
                ],
                branchSpacing: 25,
                commitSpacing: 60,
                nodeRadius: 3,
              }}
              onCommitClick={handleCommitClick}
            />
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Keine Regelsets gefunden. Erstellen Sie Ihr erstes Regelset, um die
            Historie anzuzeigen.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
