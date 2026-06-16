import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
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
import { api } from "@/convex/_generated/api";

type AppointmentSmileyOption =
  (typeof api.practices.getAppointmentSmileyOptions)["_returnType"][number];

interface AppointmentSmileyOptionsManagementProps {
  practiceId: Id<"practices">;
}

interface DraftSmileyOption extends AppointmentSmileyOption {
  localId: string;
}

export function AppointmentSmileyOptionsManagement({
  practiceId,
}: AppointmentSmileyOptionsManagementProps) {
  const options = useQuery(api.practices.getAppointmentSmileyOptions, {
    practiceId,
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
            practiceId={practiceId}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AppointmentSmileyOptionsEditor({
  initialOptions,
  practiceId,
}: {
  initialOptions: AppointmentSmileyOption[];
  practiceId: Id<"practices">;
}) {
  const nextLocalId = useRef(initialOptions.length);
  const updateOptions = useMutation(
    api.practices.updateAppointmentSmileyOptions,
  );
  const [draftOptions, setDraftOptions] = useState<DraftSmileyOption[]>(
    initialOptions.map((option, index) => ({
      ...option,
      localId: `saved:${index}:${option.emoji}`,
    })),
  );
  const [error, setError] = useState<null | string>(null);
  const [isSaving, setIsSaving] = useState(false);

  const trimmedOptions = useMemo(
    () =>
      draftOptions.map((option) => ({
        emoji: option.emoji.trim(),
        name: option.name.trim(),
      })),
    [draftOptions],
  );
  const duplicateEmojis = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const option of trimmedOptions) {
      if (option.emoji.length === 0) {
        continue;
      }
      if (seen.has(option.emoji)) {
        duplicates.add(option.emoji);
      } else {
        seen.add(option.emoji);
      }
    }
    return duplicates;
  }, [trimmedOptions]);
  const hasIncompleteRow = trimmedOptions.some(
    (option) => option.emoji.length === 0 || option.name.length === 0,
  );
  const hasDuplicateEmoji = duplicateEmojis.size > 0;
  const validationMessage = hasIncompleteRow
    ? "Jede Zeile braucht Emoji und Name."
    : hasDuplicateEmoji
      ? "Jedes Emoji darf nur einmal vorkommen."
      : null;

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

  const removeRow = (localId: string) => {
    setDraftOptions(
      draftOptions.filter((option) => option.localId !== localId),
    );
  };

  const saveOptions = () => {
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setError(null);
    setIsSaving(true);
    updateOptions({ options: trimmedOptions, practiceId })
      .catch((error_: unknown) => {
        setError(
          error_ instanceof Error
            ? error_.message
            : "Termin-Smileys konnten nicht gespeichert werden.",
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="w-24 px-3 py-2">Emoji</th>
              <th className="px-3 py-2">Name</th>
              <th className="w-12 px-3 py-2">
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
                    <td className="px-3 py-2 align-top">
                      <Input
                        aria-label="Emoji"
                        className="h-9 w-16 text-center text-lg"
                        onChange={(event) => {
                          updateRow(
                            option.localId,
                            "emoji",
                            event.target.value,
                          );
                        }}
                        placeholder="😀"
                        value={option.emoji}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Input
                        aria-invalid={
                          option.name.trim().length === 0 || isDuplicate
                        }
                        aria-label="Name"
                        onChange={(event) => {
                          updateRow(option.localId, "name", event.target.value);
                        }}
                        placeholder="Patient ist angekommen"
                        value={option.name}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Button
                        aria-label="Smiley entfernen"
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={addRow} type="button" variant="outline">
          <Plus className="h-4 w-4" />
          Zeile hinzufügen
        </Button>
        <Button
          disabled={isSaving || validationMessage !== null}
          onClick={saveOptions}
          type="button"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </div>
  );
}
