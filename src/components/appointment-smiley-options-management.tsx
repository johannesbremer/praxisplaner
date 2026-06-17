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

import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import {
  appliedLedgerResult,
  createRuleSetPracticeSettingsCommand,
} from "../utils/rule-set-replay";
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

const formatSmileyOptionLine = (option: AppointmentSmileyOption) =>
  `${option.emoji} ${option.name}`;

const createDraftOptions = (
  options: readonly AppointmentSmileyOption[],
): DraftSmileyOption[] =>
  options.map((option, index) => ({
    ...option,
    localId: `saved:${index}:${option.emoji}`,
  }));

const toCommittedOptions = (
  rows: readonly DraftSmileyOption[],
): AppointmentSmileyOption[] =>
  rows
    .map((option) => ({
      emoji: option.emoji.trim(),
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
        {options === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Smileys werden geladen...</span>
          </div>
        ) : (
          <AppointmentSmileyOptionsEditor
            initialOptions={options}
            key={options
              .map((option) => `${option.emoji}\u0000${option.name}`)
              .join("\u0001")}
            {...(onRecordCommand && { onRecordCommand })}
            {...(onDraftMutation && { onDraftMutation })}
            {...(onRuleSetCreated && { onRuleSetCreated })}
            practiceId={practiceId}
            ruleSetReplayTarget={ruleSetReplayTarget}
          />
        )}
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
  initialOptions: AppointmentSmileyOption[];
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const nextLocalId = useRef(initialOptions.length);
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
  const [committedOptions, setCommittedOptions] = useState(initialOptions);
  const [draftOptions, setDraftOptions] = useState<DraftSmileyOption[]>(
    createDraftOptions(initialOptions),
  );
  const [error, setError] = useState<null | string>(null);
  const [pending, setPending] = useState(false);

  const completeOptions = useMemo(
    () => toCommittedOptions(draftOptions),
    [draftOptions],
  );
  const duplicateEmojis = useMemo(() => {
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
  }, [completeOptions]);
  const validationMessage =
    duplicateEmojis.size > 0 ? "Jedes Emoji darf nur einmal vorkommen." : null;

  const commitOptions = async (
    nextRows: DraftSmileyOption[],
    label: string,
  ) => {
    const nextOptions = toCommittedOptions(nextRows);
    if (hasDuplicateEmoji(nextOptions)) {
      setError("Jedes Emoji darf nur einmal vorkommen.");
      return;
    }
    if (optionsEqual(committedOptions, nextOptions)) {
      return;
    }

    const beforeOptions = committedOptions;
    setError(null);
    setPending(true);
    try {
      const savedOptions = await updateOptions({
        ...getCowMutationArgs(),
        options: nextOptions,
        practiceId,
      });
      handleDraftMutationResult(savedOptions);
      setCommittedOptions(savedOptions.options);
      setDraftOptions(createDraftOptions(savedOptions.options));
      let replayDraftRevision = savedOptions.draftRevision;
      let replayRuleSetId = savedOptions.ruleSetId;
      onRecordCommand?.(
        createRuleSetPracticeSettingsCommand({
          kind: "practice.appointmentSmileyOptions.update",
          label,
          payload: {
            after: savedOptions.options.map((option) =>
              formatSmileyOptionLine(option),
            ),
            before: beforeOptions.map((option) =>
              formatSmileyOptionLine(option),
            ),
            kind: "practice.appointmentSmileyOptions.update",
          },
          target: { entityId: practiceId },
        }),
        {
          redo: async () => {
            const redoResult = await updateOptions({
              expectedDraftRevision: replayDraftRevision,
              options: savedOptions.options,
              practiceId,
              selectedRuleSetId: replayRuleSetId,
            });
            replayDraftRevision = redoResult.draftRevision;
            replayRuleSetId = redoResult.ruleSetId;
            handleDraftMutationResult(redoResult);
            return appliedLedgerResult();
          },
          undo: async () => {
            const undoResult = await updateOptions({
              expectedDraftRevision: replayDraftRevision,
              options: beforeOptions,
              practiceId,
              selectedRuleSetId: replayRuleSetId,
            });
            replayDraftRevision = undoResult.draftRevision;
            replayRuleSetId = undoResult.ruleSetId;
            handleDraftMutationResult(undoResult);
            return appliedLedgerResult();
          },
        },
      );
    } catch (error_: unknown) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "Termin-Smileys konnten nicht gespeichert werden.",
      );
    } finally {
      setPending(false);
    }
  };

  const addRow = () => {
    const localId = `draft:${nextLocalId.current}`;
    nextLocalId.current += 1;
    setDraftOptions([...draftOptions, { emoji: "", localId, name: "" }]);
  };

  const updateRow = (
    localId: string,
    field: keyof AppointmentSmileyOption,
    value: string,
  ) => {
    setDraftOptions(
      draftOptions.map((option) =>
        option.localId === localId ? { ...option, [field]: value } : option,
      ),
    );
  };

  const commitRow = (localId: string, label: string) => {
    const row = draftOptions.find((option) => option.localId === localId);
    if (!row || row.emoji.trim().length === 0 || row.name.trim().length === 0) {
      return;
    }
    void commitOptions(draftOptions, label);
  };

  const removeRow = (localId: string) => {
    const nextRows = draftOptions.filter(
      (option) => option.localId !== localId,
    );
    setDraftOptions(nextRows);
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
                            {option.emoji || "😀"}
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
                              setDraftOptions(nextRows);
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
