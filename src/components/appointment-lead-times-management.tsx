import { useMutation, useQuery } from "convex/react";
import { Loader2, Save } from "lucide-react";
import { useMemo, useState } from "react";

import type { Id } from "@/convex/_generated/dataModel";
import type { AppointmentLeadTimes } from "@/convex/appointmentLeadTimes";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { DEFAULT_APPOINTMENT_LEAD_TIMES } from "@/convex/appointmentLeadTimes";

import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { RecordRuleSetCommand } from "../utils/rule-set-replay";

import { recordAppointmentLeadTimesCommand } from "../utils/appointment-lead-times-replay";
import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";

interface AppointmentLeadTimesManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

type LeadTimeField = keyof AppointmentLeadTimes;

interface LeadTimeRow {
  description: string;
  field: LeadTimeField;
  label: string;
}

interface LeadTimesEditorState {
  draftLeadTimes: AppointmentLeadTimes;
  sourceKey: string;
  sourceLeadTimes: AppointmentLeadTimes;
}

const LEAD_TIME_ROWS: LeadTimeRow[] = [
  {
    description: "Termine, die in der Praxis eingetragen werden.",
    field: "staffMinutes",
    label: "Mitarbeiter",
  },
  {
    description: "Termine aus der öffentlichen Online-Buchung.",
    field: "onlineMinutes",
    label: "Online",
  },
  {
    description: "Termine, die TelefonKI vorschlägt oder bucht.",
    field: "telefonkiMinutes",
    label: "TelefonKI",
  },
];

const leadTimesEqual = (
  left: AppointmentLeadTimes,
  right: AppointmentLeadTimes,
) =>
  left.onlineMinutes === right.onlineMinutes &&
  left.staffMinutes === right.staffMinutes &&
  left.telefonkiMinutes === right.telefonkiMinutes;

const createLeadTimesKey = (leadTimes: AppointmentLeadTimes) =>
  `${leadTimes.staffMinutes}:${leadTimes.onlineMinutes}:${leadTimes.telefonkiMinutes}`;

const normalizeInputLeadTimes = (
  leadTimes: AppointmentLeadTimes,
): AppointmentLeadTimes => ({
  onlineMinutes: normalizeInputMinutes(leadTimes.onlineMinutes),
  staffMinutes: normalizeInputMinutes(leadTimes.staffMinutes),
  telefonkiMinutes: normalizeInputMinutes(leadTimes.telefonkiMinutes),
});

export function AppointmentLeadTimesManagement({
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: AppointmentLeadTimesManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const savedLeadTimes = useQuery(
    api.ruleSets.getAppointmentLeadTimesForRuleSet,
    {
      practiceId,
      ruleSetId,
    },
  );
  const updateLeadTimes = useMutation(
    api.ruleSets.updateAppointmentLeadTimesForRuleSet,
  );
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });
  const effectiveSavedLeadTimes =
    savedLeadTimes ?? DEFAULT_APPOINTMENT_LEAD_TIMES;
  const savedLeadTimesKey = useMemo(
    () => createLeadTimesKey(effectiveSavedLeadTimes),
    [effectiveSavedLeadTimes],
  );
  const [editorState, setEditorState] = useState<LeadTimesEditorState>({
    draftLeadTimes: effectiveSavedLeadTimes,
    sourceKey: savedLeadTimesKey,
    sourceLeadTimes: effectiveSavedLeadTimes,
  });
  const [error, setError] = useState<null | string>(null);
  const [pending, setPending] = useState(false);
  const activeEditorState = resolveActiveEditorState({
    currentState: editorState,
    savedLeadTimes: effectiveSavedLeadTimes,
    savedLeadTimesKey,
  });
  if (activeEditorState !== editorState) {
    setEditorState(activeEditorState);
  }
  const draftLeadTimes = activeEditorState.draftLeadTimes;

  const normalizedDraftLeadTimes = normalizeInputLeadTimes(draftLeadTimes);
  const hasChanges = !leadTimesEqual(
    normalizedDraftLeadTimes,
    effectiveSavedLeadTimes,
  );

  const updateField = (field: LeadTimeField, value: string) => {
    const parsed = Number(value);
    setEditorState((current) => ({
      ...current,
      draftLeadTimes: {
        ...current.draftLeadTimes,
        [field]: Number.isFinite(parsed) ? parsed : 0,
      },
    }));
    setError(null);
  };

  const saveLeadTimes = async () => {
    if (!hasChanges) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const beforeLeadTimes = effectiveSavedLeadTimes;
      const result = await updateLeadTimes({
        ...getCowMutationArgs(),
        leadTimes: normalizedDraftLeadTimes,
        practiceId,
      });
      handleDraftMutationResult(result);
      setEditorState({
        draftLeadTimes: result.leadTimes,
        sourceKey: createLeadTimesKey(result.leadTimes),
        sourceLeadTimes: result.leadTimes,
      });
      recordAppointmentLeadTimesCommand({
        afterLeadTimes: result.leadTimes,
        beforeLeadTimes,
        getCowMutationArgs,
        handleDraftMutationResult,
        label: "Termin-Vorlaufzeiten geändert",
        onRecordCommand,
        practiceId,
        updateLeadTimes,
      });
    } catch (error_: unknown) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "Termin-Vorlaufzeiten konnten nicht gespeichert werden.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termin-Vorlaufzeiten</CardTitle>
        <CardDescription>
          Mindestabstand zwischen Buchung und Terminbeginn nach Quelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {savedLeadTimes === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Vorlaufzeiten werden geladen...</span>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {LEAD_TIME_ROWS.map((row) => (
                <div
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
                  key={row.field}
                >
                  <div className="min-w-0">
                    <Label htmlFor={`lead-time-${row.field}`}>
                      {row.label}
                    </Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      className="text-right"
                      disabled={pending}
                      id={`lead-time-${row.field}`}
                      min={0}
                      onChange={(event) => {
                        updateField(row.field, event.target.value);
                      }}
                      type="number"
                      value={draftLeadTimes[row.field]}
                    />
                    <span className="w-10 text-sm text-muted-foreground">
                      min
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button
              disabled={pending || !hasChanges}
              onClick={() => {
                void saveLeadTimes();
              }}
              type="button"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Speichern
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function normalizeInputMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function resolveActiveEditorState(args: {
  currentState: LeadTimesEditorState;
  savedLeadTimes: AppointmentLeadTimes;
  savedLeadTimesKey: string;
}): LeadTimesEditorState {
  if (args.currentState.sourceKey === args.savedLeadTimesKey) {
    return args.currentState;
  }
  if (
    !leadTimesEqual(
      args.currentState.draftLeadTimes,
      args.currentState.sourceLeadTimes,
    )
  ) {
    return args.currentState;
  }
  return {
    draftLeadTimes: args.savedLeadTimes,
    sourceKey: args.savedLeadTimesKey,
    sourceLeadTimes: args.savedLeadTimes,
  };
}
