import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { RuleSetDiff } from "../routes/regeln/-rule-set-diff";

import { RuleSetDiffView } from "../routes/regeln/-rule-set-diff";

describe("RuleSetDiffView", () => {
  test("uses semantic diff color tokens for added and removed rows", () => {
    const diff = {
      draftRuleSet: {
        _id: "draft-rule-set",
        description: "Draft",
        version: 2,
      },
      parentRuleSet: {
        _id: "parent-rule-set",
        description: "Parent",
        version: 1,
      },
      sections: [
        {
          added: [
            JSON.stringify({ __diffKey: "new-rule", name: "Neue Regel" }),
          ],
          key: "rules",
          removed: [],
          title: "Regeln",
        },
        {
          added: [],
          key: "appointmentTypes",
          removed: [
            JSON.stringify({ __diffKey: "old-type", name: "Alte Regel" }),
          ],
          title: "Terminarten",
        },
      ],
      totals: {
        added: 1,
        changed: 0,
        removed: 1,
      },
    } satisfies RuleSetDiff;

    const { container } = render(<RuleSetDiffView diff={diff} />);

    expect(screen.getByText("Hinzugefügt")).toHaveClass(
      "bg-diff-added",
      "text-diff-added-foreground",
    );
    expect(screen.getByText("Entfernt")).toHaveClass(
      "bg-diff-removed",
      "text-diff-removed-foreground",
    );
    expect(container.querySelector(".bg-diff-added")).toBeInTheDocument();
    expect(container.querySelector(".bg-diff-removed")).toBeInTheDocument();
  });
});
