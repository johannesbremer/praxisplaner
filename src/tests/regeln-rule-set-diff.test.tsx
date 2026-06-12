import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { RuleSetDiff } from "../routes/regeln/-rule-set-diff";

import { RuleSetDiffView } from "../routes/regeln/-rule-set-diff";

describe("RuleSetDiffView", () => {
  test("renders modified save diff rows with the package diff viewer", async () => {
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
            JSON.stringify({
              __diffKey: "appointment-type",
              duration: 45,
              name: "Kontrolle",
            }),
          ],
          key: "appointmentTypes",
          removed: [
            JSON.stringify({
              __diffKey: "appointment-type",
              duration: 30,
              name: "Kontrolle",
            }),
          ],
          title: "Terminarten",
        },
      ],
      totals: {
        added: 1,
        changed: 2,
        removed: 1,
      },
    } satisfies RuleSetDiff;

    const { container } = render(<RuleSetDiffView diff={diff} />);

    await waitFor(() => {
      expect(container.querySelector("diffs-container")).toBeInTheDocument();
    });
    expect(screen.queryByText("Geändert")).not.toBeInTheDocument();
  });

  test("uses the package diff viewer for added and removed rows", async () => {
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

    await waitFor(() => {
      expect(container.querySelectorAll("diffs-container")).toHaveLength(2);
    });
    expect(screen.queryByText("Hinzugefügt")).not.toBeInTheDocument();
    expect(screen.queryByText("Entfernt")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-diff-added")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-diff-removed")).not.toBeInTheDocument();
  });
});
