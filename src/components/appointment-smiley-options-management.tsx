import type { Emoji } from "frimousse";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";

import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { RecordRuleSetCommand } from "../utils/rule-set-replay";

import { recordAppointmentSmileyOptionsCommand } from "../utils/appointment-smiley-options-replay";
import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "./ui/emoji-picker";

type AppointmentSmileyOption =
  (typeof api.ruleSets.getAppointmentSmileyOptionsForRuleSet)["_returnType"][number];

interface AppointmentSmileyOptionsManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

interface DraftSmileyOption extends AppointmentSmileyOption {
  localId: string;
}

interface SmileyOptionsEditorState {
  committedOptions: AppointmentSmileyOption[];
  draftOptions: DraftSmileyOption[];
  error: null | string;
  sourceKey: string;
}

const EMPTY_APPOINTMENT_SMILEY_OPTIONS: AppointmentSmileyOption[] = [];
const EMPTY_DRAFT_SMILEY_OPTIONS: DraftSmileyOption[] = [];

const formatSmileyOptionLine = (option: AppointmentSmileyOption) =>
  `${option.emoji} ${option.name}`;

const createOptionsSourceKey = (options: readonly AppointmentSmileyOption[]) =>
  options
    .map((option) => `${option.id}\u0000${option.emoji}\u0000${option.name}`)
    .join("\u0001");

const createDraftOptions = (
  options: readonly AppointmentSmileyOption[],
): DraftSmileyOption[] =>
  options.map((option, index) => ({
    ...option,
    id: option.id ?? `legacy:${option.emoji}`,
    localId: `saved:${index}:${option.emoji}`,
  }));

const toCommittedOptions = (
  rows: readonly DraftSmileyOption[],
): AppointmentSmileyOption[] =>
  rows
    .map((option) => ({
      emoji: option.emoji.trim(),
      id: option.id?.trim() || option.localId,
      name: option.name.trim(),
    }))
    .filter((option) => option.emoji.length > 0 && option.name.length > 0);

const optionsEqual = (
  left: readonly AppointmentSmileyOption[],
  right: readonly AppointmentSmileyOption[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((option, index) => {
    const rightOption = right[index];
    return (
      option.emoji === rightOption?.emoji && option.name === rightOption.name
    );
  });
};

const hasDuplicateEmoji = (options: readonly AppointmentSmileyOption[]) => {
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.emoji)) {
      return true;
    }
    seen.add(option.emoji);
  }
  return false;
};

const createEditorState = (
  options: AppointmentSmileyOption[],
  sourceKey = createOptionsSourceKey(options),
): SmileyOptionsEditorState => ({
  committedOptions: options,
  draftOptions: createDraftOptions(options),
  error: null,
  sourceKey,
});

const createInitialEditorState = (
  initialOptions: AppointmentSmileyOption[] | undefined,
  initialOptionsKey: null | string,
) => {
  if (initialOptions === undefined || initialOptionsKey === null) {
    return null;
  }
  return createEditorState(initialOptions, initialOptionsKey);
};

const resolveActiveEditorState = (args: {
  currentState: null | SmileyOptionsEditorState;
  initialOptions: AppointmentSmileyOption[] | undefined;
  initialOptionsKey: null | string;
}) => {
  if (args.initialOptions === undefined || args.initialOptionsKey === null) {
    return args.currentState;
  }
  if (args.currentState?.sourceKey === args.initialOptionsKey) {
    return args.currentState;
  }
  return createEditorState(args.initialOptions, args.initialOptionsKey);
};

export function AppointmentSmileyOptionsManagement({
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: AppointmentSmileyOptionsManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const options = useQuery(api.ruleSets.getAppointmentSmileyOptionsForRuleSet, {
    practiceId,
    ruleSetId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termin-Smileys</CardTitle>
        <CardDescription>
          Eine praxisweite Auswahl für Markierungen im Kalender.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AppointmentSmileyOptionsEditor
          initialOptions={options}
          {...(onRecordCommand && { onRecordCommand })}
          {...(onDraftMutation && { onDraftMutation })}
          {...(onRuleSetCreated && { onRuleSetCreated })}
          practiceId={practiceId}
          ruleSetReplayTarget={ruleSetReplayTarget}
        />
      </CardContent>
    </Card>
  );
}

function AppointmentSmileyOptionsEditor({
  initialOptions,
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: {
  initialOptions: AppointmentSmileyOption[] | undefined;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const rowRemovalIntentRef = useRef(new Set<string>());
  const updateOptions = useMutation(
    api.ruleSets.updateAppointmentSmileyOptionsForRuleSet,
  );
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });
  const [pending, setPending] = useState(false);
  const initialOptionsKey = useMemo(
    () =>
      initialOptions === undefined
        ? null
        : createOptionsSourceKey(initialOptions),
    [initialOptions],
  );
  const [editorState, setEditorState] = useState(() =>
    createInitialEditorState(initialOptions, initialOptionsKey),
  );
  const activeEditorState = resolveActiveEditorState({
    currentState: editorState,
    initialOptions,
    initialOptionsKey,
  });
  const committedOptions =
    activeEditorState?.committedOptions ?? EMPTY_APPOINTMENT_SMILEY_OPTIONS;
  const draftOptions =
    activeEditorState?.draftOptions ?? EMPTY_DRAFT_SMILEY_OPTIONS;
  const error = activeEditorState?.error ?? null;

  const updateActiveEditorState = (
    update: (state: SmileyOptionsEditorState) => SmileyOptionsEditorState,
  ) => {
    setEditorState((currentState) => {
      const baseState = resolveActiveEditorState({
        currentState,
        initialOptions,
        initialOptionsKey,
      });
      if (baseState === null) {
        return baseState;
      }
      return update(baseState);
    });
  };

  const setEditorError = (nextError: null | string) => {
    updateActiveEditorState((state) => ({ ...state, error: nextError }));
  };

  const completeOptions = toCommittedOptions(draftOptions);
  const duplicateEmojis = (() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const option of completeOptions) {
      if (seen.has(option.emoji)) {
        duplicates.add(option.emoji);
      } else {
        seen.add(option.emoji);
      }
    }
    return duplicates;
  })();
  const validationMessage =
    duplicateEmojis.size > 0 ? "Jedes Emoji darf nur einmal vorkommen." : null;

  if (activeEditorState === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Smileys werden geladen...</span>
      </div>
    );
  }

  const commitOptions = async (
    nextRows: DraftSmileyOption[],
    label: string,
  ) => {
    const nextOptions = toCommittedOptions(nextRows);
    if (hasDuplicateEmoji(nextOptions)) {
      setEditorError("Jedes Emoji darf nur einmal vorkommen.");
      return;
    }
    if (optionsEqual(committedOptions, nextOptions)) {
      return;
    }

    const beforeOptions = committedOptions;
    setEditorError(null);
    setPending(true);
    try {
      const savedOptions = await updateOptions({
        ...getCowMutationArgs(),
        options: nextOptions,
        practiceId,
      });
      handleDraftMutationResult(savedOptions);
      setEditorState(
        createEditorState(savedOptions.options, initialOptionsKey ?? undefined),
      );
      recordAppointmentSmileyOptionsCommand({
        afterOptions: savedOptions.options,
        beforeOptions,
        formatOption: formatSmileyOptionLine,
        getCowMutationArgs,
        handleDraftMutationResult,
        label,
        onRecordCommand,
        practiceId,
        updateOptions,
      });
    } catch (error_: unknown) {
      setEditorError(
        error_ instanceof Error
          ? error_.message
          : "Termin-Smileys konnten nicht gespeichert werden.",
      );
    } finally {
      setPending(false);
    }
  };

  const addRow = () => {
    updateActiveEditorState((state) => ({
      ...state,
      draftOptions: [
        ...state.draftOptions,
        {
          emoji: "",
          id: crypto.randomUUID(),
          localId: `draft:${crypto.randomUUID()}`,
          name: "",
        },
      ],
    }));
  };

  const updateRow = (
    localId: string,
    field: keyof AppointmentSmileyOption,
    value: string,
  ) => {
    updateActiveEditorState((state) => ({
      ...state,
      draftOptions: state.draftOptions.map((option) =>
        option.localId === localId ? { ...option, [field]: value } : option,
      ),
    }));
  };

  const commitRow = (localId: string, label: string) => {
    const row = draftOptions.find((option) => option.localId === localId);
    if (!row || row.emoji.trim().length === 0 || row.name.trim().length === 0) {
      return;
    }
    void commitOptions(draftOptions, label);
  };

  const removeRow = (localId: string) => {
    rowRemovalIntentRef.current.delete(localId);
    const nextRows = draftOptions.filter(
      (option) => option.localId !== localId,
    );
    updateActiveEditorState((state) => ({
      ...state,
      draftOptions: nextRows,
    }));
    void commitOptions(nextRows, "Termin-Smiley entfernt");
  };

  return (
    <div className="space-y-3">
      <div className="overflow-visible rounded-md border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="w-16 px-2 py-2">Emoji</th>
              <th className="px-2 py-2">Name</th>
              <th className="w-10 px-1 py-2">
                <span className="sr-only">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draftOptions.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={3}
                >
                  Keine Smileys konfiguriert.
                </td>
              </tr>
            ) : (
              draftOptions.map((option) => {
                const isDuplicate = duplicateEmojis.has(option.emoji.trim());
                return (
                  <tr className="border-t" key={option.localId}>
                    <td className="px-2 py-2 align-top">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            aria-label="Emoji auswählen"
                            className="h-9 w-12 px-0 text-lg"
                            disabled={pending}
                            type="button"
                            variant="outline"
                          >
                            {option.emoji || <Plus className="h-4 w-4" />}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="h-80 w-80 p-0">
                          <EmojiPicker
                            className="h-full w-full"
                            locale="de"
                            onEmojiSelect={(emoji: Emoji) => {
                              const nextRows = draftOptions.map((candidate) =>
                                candidate.localId === option.localId
                                  ? { ...candidate, emoji: emoji.emoji }
                                  : candidate,
                              );
                              updateActiveEditorState((state) => ({
                                ...state,
                                draftOptions: nextRows,
                              }));
                              const nextRow = nextRows.find(
                                (candidate) =>
                                  candidate.localId === option.localId,
                              );
                              if (nextRow && nextRow.name.trim().length > 0) {
                                void commitOptions(
                                  nextRows,
                                  "Termin-Smiley geändert",
                                );
                              }
                            }}
                          >
                            <EmojiPickerSearch />
                            <EmojiPickerContent />
                            <EmojiPickerFooter />
                          </EmojiPicker>
                        </PopoverContent>
                      </Popover>
                    </td>
                    <td className="min-w-0 px-2 py-2 align-top">
                      <Input
                        aria-invalid={
                          option.name.trim().length === 0 || isDuplicate
                        }
                        aria-label="Name"
                        disabled={pending}
                        onBlur={() => {
                          if (rowRemovalIntentRef.current.has(option.localId)) {
                            return;
                          }
                          commitRow(option.localId, "Termin-Smiley geändert");
                        }}
                        onChange={(event) => {
                          updateRow(option.localId, "name", event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder="Patient ist angekommen"
                        value={option.name}
                      />
                    </td>
                    <td className="px-1 py-2 align-top">
                      <Button
                        aria-label="Smiley entfernen"
                        className="h-9 w-9"
                        disabled={pending}
                        onClick={() => {
                          removeRow(option.localId);
                        }}
                        onPointerDown={() => {
                          rowRemovalIntentRef.current.add(option.localId);
                        }}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {validationMessage || error ? (
        <p className="text-sm text-destructive">{error ?? validationMessage}</p>
      ) : null}
      <Button
        disabled={pending}
        onClick={addRow}
        type="button"
        variant="outline"
      >
        <Plus className="h-4 w-4" />
        Zeile hinzufügen
      </Button>
    </div>
  );
}
