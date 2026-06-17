import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { RuleSetDiff } from "../routes/regeln/-rule-set-diff";

import {
  __getProjectedRuleSetDiffSectionsForTests,
  RuleSetDiffView,
  SaveDialogForm,
} from "../routes/regeln/-rule-set-diff";

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

  test("renders added and removed rules with German rule descriptions", () => {
    const addedRule = JSON.stringify({
      __diffKey: "new-rule",
      children: [
        {
          conditionType: "DAY_OF_WEEK",
          nodeType: "CONDITION",
          operator: "IS",
          valueNumber: 1,
        },
      ],
    });
    const removedRule = JSON.stringify({
      __diffKey: "old-rule",
      children: [
        {
          conditionType: "DAY_OF_WEEK",
          nodeType: "CONDITION",
          operator: "IS",
          valueNumber: 5,
        },
      ],
    });
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
          added: [addedRule],
          key: "rules",
          removed: [removedRule],
          title: "Regeln",
        },
      ],
      totals: {
        added: 1,
        changed: 0,
        removed: 1,
      },
    } satisfies RuleSetDiff;

    const projectedSections = __getProjectedRuleSetDiffSectionsForTests(diff);
    const ruleRows = projectedSections.flatMap((section) => section.rows);

    expect(ruleRows).toContainEqual(
      expect.objectContaining({
        after: "Wenn es  Montag ist, darf der Termin nicht vergeben werden.",
        before: "",
        kind: "added",
      }),
    );
    expect(ruleRows).toContainEqual(
      expect.objectContaining({
        after: "",
        before: "Wenn es  Freitag ist, darf der Termin nicht vergeben werden.",
        kind: "removed",
      }),
    );
    const serializedRows = JSON.stringify(ruleRows);
    expect(serializedRows).not.toContain("conditionType");
    expect(serializedRows).not.toContain("valueNumber");
  });

  test("renders canonical appointment-type rule snapshots with German descriptions", () => {
    const addedRule = JSON.stringify({
      __diffKey: "new-rule",
      childOrder: 0,
      children: [
        {
          childOrder: 0,
          children: [],
          conditionType: "APPOINTMENT_TYPE",
          nodeType: "CONDITION",
          operator: "IS",
          scope: null,
          valueIds: ["Akut-2"],
          valueNumber: null,
        },
      ],
      conditionType: null,
      nodeType: null,
      operator: null,
      scope: null,
      valueIds: [],
      valueNumber: null,
    });
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
          added: [addedRule],
          key: "rules",
          removed: [],
          title: "Regeln",
        },
      ],
      totals: {
        added: 1,
        changed: 0,
        removed: 0,
      },
    } satisfies RuleSetDiff;

    const projectedSections = __getProjectedRuleSetDiffSectionsForTests(diff);
    const ruleRows = projectedSections.flatMap((section) => section.rows);

    expect(ruleRows).toEqual([
      expect.objectContaining({
        after:
          "Wenn der Termintyp  Akut-2 ist, darf der Termin nicht vergeben werden.",
        before: "",
        kind: "added",
        path: "Regel",
      }),
    ]);
    expect(JSON.stringify(ruleRows)).not.toContain("APPOINTMENT_TYPE");
  });

  test("renders smiley option line diffs without requiring structured JSON", async () => {
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
          added: ["👍 Patient ist angekommen"],
          key: "appointmentSmileyOptions",
          removed: [],
          title: "Termin-Smileys",
        },
      ],
      totals: {
        added: 1,
        changed: 1,
        removed: 0,
      },
    } satisfies RuleSetDiff;

    const { container } = render(<RuleSetDiffView diff={diff} />);

    await waitFor(() => {
      expect(container.querySelector("diffs-container")).toBeInTheDocument();
    });
  });
});

describe("SaveDialogForm", () => {
  test("places the ruleset name field after the diff review", () => {
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
      sections: [],
      totals: {
        added: 0,
        changed: 0,
        removed: 0,
      },
    } satisfies RuleSetDiff;

    render(
      <SaveDialogForm
        activationName="Wintersprechzeiten 2024"
        existingSavedDescriptions={[]}
        onDiscard={null}
        onSaveAndActivate={vi.fn()}
        onSaveOnly={vi.fn()}
        ruleSetDiff={diff}
        setActivationName={vi.fn()}
      />,
    );

    const diffMessage = screen.getByText(
      "Keine sichtbaren Änderungen zum übergeordneten Regelset.",
    );
    const nameInput = screen.getByLabelText("Name für das Regelset");
    const saveButton = screen.getByRole("button", { name: "Speichern" });

    expect(
      diffMessage.compareDocumentPosition(nameInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nameInput.compareDocumentPosition(saveButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
