import type { Id } from "@/convex/_generated/dataModel";

// Import CommitGraph and its types
import type { Branch, Commit, CommitNode } from "commit-graph";

import { CommitGraph } from "commit-graph";

interface RuleSetHistoryDemoProps {
  onRuleSetClick?: (ruleSetId: Id<"ruleSets">) => void;
}

export function RuleSetHistoryDemo({
  onRuleSetClick,
}: RuleSetHistoryDemoProps) {
  // Demo data showing a git-like history of rule sets
  const demoCommits: Commit[] = [
    {
      commit: {
        author: {
          date: new Date("2024-01-15T09:00:00Z").toISOString(),
          name: "Dr. Schmidt",
        },
        message: "Initial rule set - Grundregeln",
      },
      parents: [],
      sha: "ruleset-001",
    },
    {
      commit: {
        author: {
          date: new Date("2024-02-10T14:30:00Z").toISOString(),
          name: "Dr. Schmidt",
        },
        message: "Wintersprechzeiten 2024",
      },
      parents: [{ sha: "ruleset-001" }],
      sha: "ruleset-002",
    },
    {
      commit: {
        author: {
          date: new Date("2024-02-15T11:15:00Z").toISOString(),
          name: "Praxis Manager",
        },
        message: "Zusätzliche Urlaubsblockierungen",
      },
      parents: [{ sha: "ruleset-002" }],
      sha: "ruleset-003",
    },
    {
      commit: {
        author: {
          date: new Date("2024-03-01T08:45:00Z").toISOString(),
          name: "Dr. Schmidt",
        },
        message: "Frühlingszeiten - erweiterte Sprechstunden",
      },
      parents: [{ sha: "ruleset-002" }], // Branched from ruleset-002
      sha: "ruleset-004",
    },
    {
      commit: {
        author: {
          date: new Date("2024-03-05T16:20:00Z").toISOString(),
          name: "Dr. Müller",
        },
        message: "Neue Regel für Notfalltermine",
      },
      parents: [{ sha: "ruleset-004" }],
      sha: "ruleset-005",
    },
    {
      commit: {
        author: {
          date: new Date("2024-03-10T13:00:00Z").toISOString(),
          name: "Praxis Manager",
        },
        message: "Arbeitsversion - neue Blockierungsregeln",
      },
      parents: [{ sha: "ruleset-005" }],
      sha: "ruleset-006",
    },
  ];

  // Demo branch heads
  const demoBranchHeads: Branch[] = [
    {
      commit: {
        sha: "ruleset-005", // Active rule set
      },
      name: "active",
    },
    {
      commit: {
        sha: "ruleset-003", // Alternative branch
      },
      name: "winter-branch",
    },
    {
      commit: {
        sha: "ruleset-006", // Draft/working branch
      },
      name: "draft-v6",
    },
  ];

  const handleCommitClick = (commit: CommitNode) => {
    if (onRuleSetClick) {
      onRuleSetClick(commit.hash as Id<"ruleSets">);
    }
    // For demo, just show an alert
    alert(`Clicked on rule set: ${commit.hash}\nMessage: ${commit.message}`);
  };

  return (
    <div className="w-full h-96 overflow-auto border rounded-lg bg-white">
      <CommitGraph
        branchHeads={demoBranchHeads}
        commits={demoCommits}
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
            "#3b82f6", // Blue for alternative branches
            "#f59e0b", // Orange for draft branches
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
