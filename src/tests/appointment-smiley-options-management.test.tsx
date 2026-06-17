import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import type { DraftMutationResult } from "@/src/utils/cow-history";
import type {
  RecordRuleSetCommand,
  RuleSetCommand,
  RuleSetCommandRuntimeAdapter,
} from "@/src/utils/rule-set-replay";

import { toTableId } from "@/convex/identity";
import { AppointmentSmileyOptionsManagement } from "@/src/components/appointment-smiley-options-management";

interface AppointmentSmileyOption {
  emoji: string;
  id: string;
  name: string;
}

let nextDraftRevision = 1;
const updateOptionsMock = vi.fn(
  (args: {
    expectedDraftRevision: null | number;
    options: AppointmentSmileyOption[];
    practiceId: Id<"practices">;
    selectedRuleSetId: Id<"ruleSets">;
  }): DraftMutationResult & { options: AppointmentSmileyOption[] } => {
    const draftRevision = nextDraftRevision;
    nextDraftRevision = 6;
    return {
      draftRevision,
      options: args.options,
      ruleSetId: toTableId<"ruleSets">("draft-rule-set"),
    };
  },
);

const useQueryMock = vi.fn((): AppointmentSmileyOption[] | undefined => [
  {
    emoji: "👍",
    id: "arrived",
    name: "Patient ist angekommen",
  },
]);

vi.mock("convex/react", () => ({
  useMutation: () => updateOptionsMock,
  useQuery: (queryRef: unknown, args: unknown) => {
    void queryRef;
    void args;
    return useQueryMock();
  },
}));

describe("AppointmentSmileyOptionsManagement", () => {
  const parentRuleSetId = toTableId<"ruleSets">("parent-rule-set");
  const draftRuleSetId = toTableId<"ruleSets">("draft-rule-set");
  const practiceId = toTableId<"practices">("practice");

  beforeEach(() => {
    vi.clearAllMocks();
    nextDraftRevision = 1;
  });

  test("replays undo with the current CoW draft revision", async () => {
    let replay: RuleSetCommandRuntimeAdapter | undefined;
    const recordCommand: RecordRuleSetCommand = (
      _command: RuleSetCommand,
      runtime: RuleSetCommandRuntimeAdapter,
    ) => {
      replay = runtime;
    };
    const { rerender } = render(
      <AppointmentSmileyOptionsManagement
        onRecordCommand={recordCommand}
        practiceId={practiceId}
        ruleSetReplayTarget={{
          kind: "saved-parent",
          parentRuleSetId,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Patient wartet" },
    });
    fireEvent.blur(screen.getByLabelText("Name"));

    await waitFor(() => {
      expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    });
    expect(updateOptionsMock).toHaveBeenLastCalledWith({
      expectedDraftRevision: null,
      options: [
        {
          emoji: "👍",
          id: "arrived",
          name: "Patient wartet",
        },
      ],
      practiceId,
      selectedRuleSetId: parentRuleSetId,
    });

    rerender(
      <AppointmentSmileyOptionsManagement
        onRecordCommand={recordCommand}
        practiceId={practiceId}
        ruleSetReplayTarget={{
          draftRevision: 5,
          draftRuleSetId,
          kind: "draft",
          parentRuleSetId,
        }}
      />,
    );

    if (!replay) {
      throw new Error("Expected smiley options replay to be recorded");
    }
    await replay.undo();

    expect(updateOptionsMock).toHaveBeenCalledTimes(2);
    expect(updateOptionsMock).toHaveBeenLastCalledWith({
      expectedDraftRevision: 5,
      options: [
        {
          emoji: "👍",
          id: "arrived",
          name: "Patient ist angekommen",
        },
      ],
      practiceId,
      selectedRuleSetId: draftRuleSetId,
    });
  });

  test("syncs visible rows when smiley options refetch after replay", async () => {
    useQueryMock
      .mockReturnValueOnce([
        {
          emoji: "👍",
          id: "arrived",
          name: "Patient wartet",
        },
      ])
      .mockReturnValueOnce([
        {
          emoji: "👍",
          id: "arrived",
          name: "Patient ist angekommen",
        },
      ]);

    const { rerender } = render(
      <AppointmentSmileyOptionsManagement
        practiceId={practiceId}
        ruleSetReplayTarget={{
          draftRevision: 5,
          draftRuleSetId,
          kind: "draft",
          parentRuleSetId,
        }}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Patient wartet");

    rerender(
      <AppointmentSmileyOptionsManagement
        practiceId={practiceId}
        ruleSetReplayTarget={{
          draftRevision: 6,
          draftRuleSetId,
          kind: "draft",
          parentRuleSetId,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue(
        "Patient ist angekommen",
      );
    });
  });

  test("keeps replay CoW args fresh while smiley options refetch", async () => {
    let replay: RuleSetCommandRuntimeAdapter | undefined;
    const recordCommand: RecordRuleSetCommand = (
      _command: RuleSetCommand,
      runtime: RuleSetCommandRuntimeAdapter,
    ) => {
      replay = runtime;
    };
    useQueryMock.mockReturnValueOnce([
      {
        emoji: "👍",
        id: "arrived",
        name: "Patient ist angekommen",
      },
    ]);

    const { rerender } = render(
      <AppointmentSmileyOptionsManagement
        onRecordCommand={recordCommand}
        practiceId={practiceId}
        ruleSetReplayTarget={{
          kind: "saved-parent",
          parentRuleSetId,
        }}
      />,
    );

    expect(screen.queryByText("Smileys werden geladen...")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Patient wartet" },
    });
    fireEvent.blur(screen.getByLabelText("Name"));

    await waitFor(() => {
      expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    });

    if (!replay) {
      throw new Error("Expected smiley options replay to be recorded");
    }

    const loadingResults: (AppointmentSmileyOption[] | undefined)[] = [];
    useQueryMock.mockImplementationOnce(() => loadingResults[0]);
    rerender(
      <AppointmentSmileyOptionsManagement
        onRecordCommand={recordCommand}
        practiceId={practiceId}
        ruleSetReplayTarget={{
          draftRevision: 3,
          draftRuleSetId,
          kind: "draft",
          parentRuleSetId,
        }}
      />,
    );

    expect(screen.queryByText("Smileys werden geladen...")).toBeNull();
    await replay.undo();

    expect(updateOptionsMock).toHaveBeenCalledTimes(2);
    expect(updateOptionsMock).toHaveBeenLastCalledWith({
      expectedDraftRevision: 3,
      options: [
        {
          emoji: "👍",
          id: "arrived",
          name: "Patient ist angekommen",
        },
      ],
      practiceId,
      selectedRuleSetId: draftRuleSetId,
    });
  });

  test("shows a plus icon for empty emoji rows", () => {
    render(
      <AppointmentSmileyOptionsManagement
        practiceId={practiceId}
        ruleSetReplayTarget={{
          kind: "saved-parent",
          parentRuleSetId,
        }}
      />,
    );

    fireEvent.click(screen.getByText("Zeile hinzufügen"));

    expect(screen.queryByText("😀")).toBeNull();
  });
});
