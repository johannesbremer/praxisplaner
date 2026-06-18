import type { ContextMenuItem, FileTreeDropResult } from "@pierre/trees";
import type { CSSProperties } from "react";

import { FileTree, useFileTree } from "@pierre/trees/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  FolderPlus,
  Package2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { err, ok, Result } from "neverthrow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import type {
  AppointmentTypeId,
  AppointmentTypeLineageKey,
  PractitionerLineageKey,
} from "@/convex/identity";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import {
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
} from "@/convex/identity";
import { APPOINTMENT_TYPE_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";
import type { RecordRuleSetCommand } from "../utils/rule-set-replay";

import { recordAppointmentTypeDeleteReplayCommand } from "../utils/appointment-type-delete-replay";
import { recordAppointmentTypeFolderSubtreeReplayCommand } from "../utils/appointment-type-folder-subtree-replay";
import {
  type AppointmentTypeTreeOverlay,
  createAppointmentTypeTreeDeleteOverlay,
  createAppointmentTypeTreeRestoreOverlay,
  getActiveAppointmentTypeTreeOverlay,
  mergeAppointmentTypeFoldersByLineage,
  mergeAppointmentTypesByLineage,
} from "../utils/appointment-type-tree-overlay";
import { findIdInList } from "../utils/convex-ids";
import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import {
  recordLineageCreateRuleSetCommand,
  recordLineageUpdateRuleSetCommand,
} from "../utils/cow-lineage-replay";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import {
  findFrontendEntityByEntityId,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
import { createRuleSetSnapshotCommand } from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";
interface AppointmentPlanFormStep {
  anchorStepId: string;
  appointmentTypeLineageKey: AppointmentPlanTargetSelection;
  occupancyKind: AppointmentPlanOccupancyKind;
  offsetUnit: AppointmentPlanOffsetUnit;
  offsetValue: number;
  timingKind: AppointmentPlanTimingKind;
}
type AppointmentPlanOccupancyKind =
  | "inheritRootPractitioner"
  | "resource-ekg"
  | "resource-labor";

type AppointmentPlanOffsetUnit = "days" | "minutes" | "months" | "weeks";
type AppointmentPlanStep = NonNullable<
  AppointmentType["appointmentPlan"]
>["steps"][number];
type AppointmentPlanTargetSelection = "" | AppointmentTypeLineageKey;
type AppointmentPlanTimingKind = AppointmentPlanStep["timing"]["kind"];
type AppointmentTreeItem =
  | {
      appointmentType: AppointmentType;
      id: Id<"appointmentTypes">;
      kind: "appointmentType";
    }
  | {
      folder: AppointmentTypeFolder;
      id: Id<"appointmentTypeFolders">;
      kind: "folder";
    };
interface AppointmentTreeModel {
  expandedPaths: string[];
  itemByPath: ReadonlyMap<string, AppointmentTreeItem>;
  paths: string[];
  rootPath: string;
}
type AppointmentTreeStyle = CSSProperties & Record<`--trees-${string}`, string>;
type AppointmentType = FrontendLineageEntity<
  "appointmentTypes",
  AppointmentTypeQueryResult[number]
>;
type AppointmentTypeDefaultOccupancyKind =
  | "resource-ekg"
  | "resource-labor"
  | "selectedPractitioner";
type AppointmentTypeFolder = AppointmentTypeFolderQueryResult[number];

type AppointmentTypeFolderHistoryTarget =
  | { kind: "folder"; lineageKey: AppointmentTypeFolderLineageKey }
  | { kind: "root" };

type AppointmentTypeFolderLineageKey = Id<"appointmentTypeFolders">;
type AppointmentTypeFolderQueryResult =
  (typeof api.entities.getAppointmentTypeFolders)["_returnType"];
interface AppointmentTypeFormValues {
  appointmentPlan: AppointmentPlanFormStep[];
  defaultOccupancyKind: AppointmentTypeDefaultOccupancyKind;
  duration: number;
  name: string;
  practitionerIds: Id<"practitioners">[];
}
type AppointmentTypeQueryResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];
interface AppointmentTypesManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}
interface DeletedAppointmentTypeFolderSnapshot {
  lineageKey: AppointmentTypeFolderLineageKey;
  name: string;
  parentLineageKey: AppointmentTypeFolderLineageKey | undefined;
}

interface DeletedAppointmentTypeSnapshot {
  appointmentPlan: AppointmentType["appointmentPlan"];
  defaultOccupancy: NonNullable<AppointmentType["defaultOccupancy"]>;
  duration: number;
  lineageKey: AppointmentTypeLineageKey;
  name: string;
  practitionerSnapshots: PractitionerHistorySnapshot[];
  treeFolderLineageKey: AppointmentTypeFolderLineageKey;
}

type OptimisticAppointmentTypeTreeRestore = AppointmentTypeTreeOverlay<
  AppointmentType,
  AppointmentTypeFolder,
  AppointmentTypeLineageKey,
  AppointmentTypeFolderLineageKey
>;

type Practitioner = FrontendLineageEntity<
  "practitioners",
  PractitionerQueryResult[number]
>;

type PractitionerQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];

const defaultAppointmentTypeFormValues: AppointmentTypeFormValues = {
  appointmentPlan: [],
  defaultOccupancyKind: "selectedPractitioner",
  duration: 30,
  name: "",
  practitionerIds: [],
};

const createEmptyAppointmentPlanStep = (): AppointmentPlanFormStep => ({
  anchorStepId: "root",
  appointmentTypeLineageKey: "",
  occupancyKind: "inheritRootPractitioner",
  offsetUnit: "days",
  offsetValue: 1,
  timingKind: "afterPreviousEnd",
});

const normalizeAppointmentPlanForSubmit = (
  steps: AppointmentPlanFormStep[],
): Result<AppointmentPlanStep[], string> => {
  if (steps.length === 0) {
    return ok([]);
  }

  return Result.combine(
    steps.map((step, index) =>
      Result.combine([
        resolveSelectedAppointmentTypeLineageKey(step),
        normalizeAppointmentPlanOccupancy(step.occupancyKind),
      ]).map(([appointmentTypeLineageKey, occupancy]) => ({
        appointmentTypeLineageKey,
        occupancy,
        required: true,
        stepId: `step-${index + 1}`,
        timing: normalizeAppointmentPlanTiming(step),
      })),
    ),
  );
};

const createAppointmentPlanCreateArgs = (
  appointmentPlan: AppointmentPlanStep[] | undefined,
) =>
  appointmentPlan === undefined
    ? {}
    : { appointmentPlan: { steps: appointmentPlan } };

const createAppointmentPlanUpdateArgs = (
  appointmentPlan: AppointmentPlanStep[] | undefined,
) => ({ appointmentPlan: { steps: appointmentPlan ?? [] } });

const parseNumberInput = (valueAsNumber: number, fallback = 0) =>
  Number.isNaN(valueAsNumber) ? fallback : valueAsNumber;

const normalizeAppointmentPlanOffsetValue = (
  offsetUnit: AppointmentPlanFormStep["offsetUnit"],
  rawValue: number,
) => {
  const normalizedInteger = Number.isFinite(rawValue)
    ? Math.trunc(rawValue)
    : 0;

  if (offsetUnit === "minutes") {
    return Math.max(0, Math.round(normalizedInteger / 5) * 5);
  }

  return Math.max(1, normalizedInteger);
};

const normalizeAppointmentPlanTiming = (
  step: AppointmentPlanFormStep,
): AppointmentPlanStep["timing"] => {
  if (step.timingKind === "sameStartAs") {
    return {
      anchorStepId: step.anchorStepId,
      kind: "sameStartAs",
    };
  }

  if (step.timingKind === "firstAvailableOnOrAfter") {
    const offsetUnit = step.offsetUnit === "minutes" ? "days" : step.offsetUnit;
    return {
      anchorStepId: step.anchorStepId,
      kind: "firstAvailableOnOrAfter",
      offsetUnit,
      offsetValue: normalizeAppointmentPlanOffsetValue(
        offsetUnit,
        step.offsetValue,
      ),
    };
  }

  return {
    kind: step.timingKind,
    offsetMinutes: normalizeAppointmentPlanOffsetValue(
      "minutes",
      step.offsetValue,
    ),
  };
};

const normalizeAppointmentPlanOccupancy = (
  occupancyKind: AppointmentPlanOccupancyKind,
): Result<AppointmentPlanStep["occupancy"], string> => {
  if (occupancyKind === "resource-ekg") {
    return ok({ calendarResourceColumn: "ekg", kind: "resourceColumn" });
  }
  if (occupancyKind === "resource-labor") {
    return ok({ calendarResourceColumn: "labor", kind: "resourceColumn" });
  }
  return ok({ kind: "inheritRootPractitioner" });
};

const normalizeDefaultOccupancyForSubmit = (
  occupancyKind: AppointmentTypeDefaultOccupancyKind,
): Result<NonNullable<AppointmentType["defaultOccupancy"]>, string> => {
  if (occupancyKind === "resource-ekg") {
    return ok({ calendarResourceColumn: "ekg", kind: "resourceColumn" });
  }
  if (occupancyKind === "resource-labor") {
    return ok({ calendarResourceColumn: "labor", kind: "resourceColumn" });
  }
  return ok({ kind: "selectedPractitioner" });
};

const defaultOccupancyKindForForm = (
  defaultOccupancy: AppointmentType["defaultOccupancy"],
): AppointmentTypeDefaultOccupancyKind => {
  if (!defaultOccupancy || defaultOccupancy.kind === "selectedPractitioner") {
    return "selectedPractitioner";
  }
  return `resource-${defaultOccupancy.calendarResourceColumn}`;
};

const parseAppointmentPlanOffsetUnit = (
  value: string,
): AppointmentPlanOffsetUnit | undefined => {
  switch (value) {
    case "days":
    case "minutes":
    case "months":
    case "weeks": {
      return value;
    }
    default: {
      return undefined;
    }
  }
};

const parseAppointmentPlanTimingKind = (
  value: string,
): AppointmentPlanTimingKind | undefined => {
  switch (value) {
    case "afterPreviousEnd":
    case "beforeRootStart":
    case "firstAvailableOnOrAfter":
    case "sameStartAs": {
      return value;
    }
    default: {
      return undefined;
    }
  }
};

const normalizeAppointmentPlanForForm = (
  appointmentPlan: AppointmentType["appointmentPlan"] | undefined,
): AppointmentPlanFormStep[] =>
  (appointmentPlan?.steps ?? []).map((step) => ({
    anchorStepId:
      "anchorStepId" in step.timing ? step.timing.anchorStepId : "root",
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      step.appointmentTypeLineageKey,
    ),
    occupancyKind: appointmentPlanOccupancyKindForForm(step.occupancy),
    offsetUnit:
      step.timing.kind === "firstAvailableOnOrAfter"
        ? step.timing.offsetUnit
        : "minutes",
    offsetValue: normalizeAppointmentPlanOffsetValue(
      step.timing.kind === "firstAvailableOnOrAfter"
        ? step.timing.offsetUnit
        : "minutes",
      "offsetValue" in step.timing
        ? step.timing.offsetValue
        : "offsetMinutes" in step.timing
          ? step.timing.offsetMinutes
          : 0,
    ),
    timingKind: step.timing.kind,
  }));

const appointmentPlanOccupancyKindForForm = (
  occupancy: AppointmentPlanStep["occupancy"],
): AppointmentPlanOccupancyKind => {
  if (occupancy.kind === "resourceColumn") {
    return `resource-${occupancy.calendarResourceColumn}`;
  }
  return "inheritRootPractitioner";
};

const serializeAppointmentPlan = (steps: AppointmentPlanStep[] | undefined) =>
  JSON.stringify(
    (steps ?? []).map((step) => ({
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      note: step.note ?? null,
      occupancy: step.occupancy,
      required: step.required,
      stepId: step.stepId,
      timing: step.timing,
    })),
  );

interface PractitionerHistorySnapshot {
  lineageId: PractitionerLineageKey;
  name: string;
}

function createAppointmentPlanStepSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z
    .object({
      anchorStepId: z.string().min(1),
      appointmentTypeLineageKey: createAppointmentTypeLineageSelectionSchema(
        availableLineageKeys,
      ).refine((value) => value !== "", "Bitte wählen Sie eine Terminart"),
      occupancyKind: z
        .string()
        .transform((value) =>
          normalizeAppointmentPlanOccupancyKindSelection(value),
        ),
      offsetUnit: z.enum(["minutes", "days", "weeks", "months"]),
      offsetValue: z.number().int("Der Versatz muss eine ganze Zahl sein"),
      timingKind: z.enum([
        "afterPreviousEnd",
        "beforeRootStart",
        "sameStartAs",
        "firstAvailableOnOrAfter",
      ]),
    })
    .superRefine((step, ctx) => {
      if (step.timingKind === "sameStartAs") {
        return;
      }

      if (
        step.offsetUnit === "minutes" ||
        step.timingKind === "afterPreviousEnd" ||
        step.timingKind === "beforeRootStart"
      ) {
        if (step.offsetValue < 0) {
          ctx.addIssue({
            code: "custom",
            message: "Minuten dürfen nicht negativ sein",
            path: ["offsetValue"],
          });
        }

        if (step.offsetValue % 5 !== 0) {
          ctx.addIssue({
            code: "custom",
            message: "Minuten müssen in 5er-Schritten angegeben werden",
            path: ["offsetValue"],
          });
        }

        if (step.timingKind !== "firstAvailableOnOrAfter") {
          return;
        }
      }

      if (step.offsetValue < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Tage, Wochen und Monate müssen mindestens 1 sein",
          path: ["offsetValue"],
        });
      }
    });
}

function createAppointmentTypeFormSchema(params: {
  appointmentTypeLineageKeys: readonly AppointmentTypeLineageKey[];
  practitionerIds: readonly Id<"practitioners">[];
}) {
  return z.object({
    appointmentPlan: z.array(
      createAppointmentPlanStepSchema(params.appointmentTypeLineageKeys),
    ),
    defaultOccupancyKind: z
      .string()
      .transform((value) => normalizeDefaultOccupancyKindSelection(value)),
    duration: z
      .number()
      .min(5, "Dauer muss mindestens 5 Minuten betragen")
      .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
      .refine((val) => val % 5 === 0, {
        message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
      }),
    name: z
      .string()
      .trim()
      .min(2, "Name muss mindestens 2 Zeichen lang sein")
      .max(50, "Name darf maximal 50 Zeichen lang sein"),
    practitionerIds: z.array(
      createPractitionerIdSchema(params.practitionerIds),
    ),
  }) satisfies z.ZodType<AppointmentTypeFormValues>;
}

function createAppointmentTypeLineageSelectionSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z
    .string()
    .transform(
      (value, ctx): AppointmentPlanTargetSelection | typeof z.NEVER => {
        if (value === "") {
          return "";
        }

        const matchingLineageKey = availableLineageKeys.find(
          (lineageKey) => lineageKey === value,
        );
        if (!matchingLineageKey) {
          ctx.addIssue({
            code: "custom",
            message: "Bitte wählen Sie eine gültige Terminart",
          });
          return z.NEVER;
        }

        return matchingLineageKey;
      },
    );
}

function createPractitionerIdSchema(
  availablePractitionerIds: readonly Id<"practitioners">[],
) {
  return z
    .string()
    .transform((value, ctx): Id<"practitioners"> | typeof z.NEVER => {
      const practitionerId = findIdInList(availablePractitionerIds, value);
      if (!practitionerId) {
        ctx.addIssue({
          code: "custom",
          message: "Ungültiger Behandler",
        });
        return z.NEVER;
      }

      return practitionerId;
    });
}

function normalizeAppointmentPlanOccupancyKindSelection(
  value: string,
): AppointmentPlanOccupancyKind {
  switch (value) {
    case "inheritRootPractitioner":
    case "resource-ekg":
    case "resource-labor": {
      return value;
    }
  }

  return "inheritRootPractitioner";
}

function normalizeDefaultOccupancyKindSelection(
  value: string,
): AppointmentTypeDefaultOccupancyKind {
  switch (value) {
    case "resource-ekg":
    case "resource-labor":
    case "selectedPractitioner": {
      return value;
    }
  }

  return "selectedPractitioner";
}

const toSnapshotLineageIds = (snapshots: PractitionerHistorySnapshot[]) =>
  snapshots.map((snapshot) => snapshot.lineageId).toSorted();

const practitionerIdsFromSnapshots = (
  practitioners: readonly Practitioner[],
  snapshots: PractitionerHistorySnapshot[],
): { ids: Id<"practitioners">[] } | { message: string; status: "conflict" } => {
  const practitionerIdByLineageKey = new Map(
    practitioners.map((practitioner) => [
      practitioner.lineageKey,
      practitioner._id,
    ]),
  );
  const seen = new Set<Id<"practitioners">>();
  const ids: Id<"practitioners">[] = [];

  for (const snapshot of snapshots) {
    const practitionerId = practitionerIdByLineageKey.get(snapshot.lineageId);
    if (!practitionerId) {
      return {
        message: `[HISTORY:APPOINTMENT_TYPE_PRACTITIONER_LINEAGE_MISSING] Behandler "${snapshot.name}" mit lineageKey ${snapshot.lineageId} konnte nicht geladen werden.`,
        status: "conflict",
      };
    }
    if (seen.has(practitionerId)) {
      continue;
    }
    seen.add(practitionerId);
    ids.push(practitionerId);
  }

  return { ids };
};

const samePractitionerLineageIds = (
  left: PractitionerLineageKey[],
  right: PractitionerLineageKey[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
};

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, APPOINTMENT_TYPE_MISSING_ENTITY_REGEX);

const resolveSelectedAppointmentTypeLineageKey = (
  step: AppointmentPlanFormStep,
): Result<AppointmentTypeLineageKey, string> => {
  if (step.appointmentTypeLineageKey === "") {
    return err("Bitte wählen Sie eine Terminart.");
  }

  return ok(step.appointmentTypeLineageKey);
};

const sanitizeTreeSegment = (value: string) =>
  value.replaceAll("/", "／").trim() || "Unbenannt";

const createTreeSegment = (name: string) => sanitizeTreeSegment(name);

const normalizeTreeLookupPath = (path: null | string | undefined) => {
  if (path === null || path === undefined) {
    return;
  }

  return path.endsWith("/") ? path.slice(0, -1) : path;
};

const createTreeFolderArg = (
  folderId: Id<"appointmentTypeFolders"> | undefined,
) => (folderId === undefined ? {} : { treeFolderId: folderId });

const createParentFolderArg = (
  folderId: Id<"appointmentTypeFolders"> | undefined,
) => (folderId === undefined ? {} : { parentFolderId: folderId });

const createTreeFolderMoveArg = (
  folderId: Id<"appointmentTypeFolders"> | undefined,
) => ({ treeFolderId: folderId ?? null });

const createParentFolderMoveArg = (
  folderId: Id<"appointmentTypeFolders"> | undefined,
) => ({ parentFolderId: folderId ?? null });

const normalizeEntityName = (name: string) => name.trim();

const hasAppointmentTypeNameConflict = (params: {
  appointmentTypes: readonly AppointmentType[];
  excludeAppointmentTypeId?: Id<"appointmentTypes">;
  name: string;
}) =>
  params.appointmentTypes.some(
    (appointmentType) =>
      appointmentType._id !== params.excludeAppointmentTypeId &&
      appointmentType.name === params.name,
  );

const hasTreeChildNameConflict = (params: {
  appointmentTypes: readonly AppointmentType[];
  excludeAppointmentTypeId?: Id<"appointmentTypes">;
  excludeFolderId?: Id<"appointmentTypeFolders">;
  folders: readonly AppointmentTypeFolder[];
  name: string;
  parentFolderId: Id<"appointmentTypeFolders"> | undefined;
}) =>
  params.folders.some(
    (folder) =>
      folder._id !== params.excludeFolderId &&
      folder.parentFolderId === params.parentFolderId &&
      createTreeSegment(folder.name) === createTreeSegment(params.name),
  ) ||
  params.appointmentTypes.some(
    (appointmentType) =>
      appointmentType._id !== params.excludeAppointmentTypeId &&
      appointmentType.treeFolderId === params.parentFolderId &&
      createTreeSegment(appointmentType.name) ===
        createTreeSegment(params.name),
  );

const getAppointmentTypeFolderLineageKey = (
  folder: AppointmentTypeFolder,
): AppointmentTypeFolderLineageKey => folder.lineageKey ?? folder._id;

const createAppointmentTypeFolderHistoryTarget = (
  folder: AppointmentTypeFolder | undefined,
): AppointmentTypeFolderHistoryTarget =>
  folder === undefined
    ? { kind: "root" }
    : {
        kind: "folder",
        lineageKey: getAppointmentTypeFolderLineageKey(folder),
      };

const appointmentTreeStyle: AppointmentTreeStyle = {
  "--trees-accent-override": "var(--primary)",
  "--trees-bg-muted-override": "var(--accent)",
  "--trees-bg-override": "var(--card)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "6px",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--card-foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "14px",
  "--trees-input-bg-override": "var(--background)",
  "--trees-item-margin-x-override": "4px",
  "--trees-item-padding-x-override": "8px",
  "--trees-padding-inline-override": "4px",
  "--trees-search-bg-override": "var(--background)",
  "--trees-search-fg-override": "var(--foreground)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
};

export function AppointmentTypesManagement({
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: AppointmentTypesManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAppointmentType, setEditingAppointmentType] =
    useState<AppointmentType | null>(null);
  const [editingAppointmentTypeFolder, setEditingAppointmentTypeFolder] =
    useState<AppointmentTypeFolder | null>(null);
  const [createFolderParentId, setCreateFolderParentId] = useState<
    Id<"appointmentTypeFolders"> | undefined
  >();
  const [createFolderName, setCreateFolderName] = useState("");
  const [newAppointmentTypeFolderId, setNewAppointmentTypeFolderId] = useState<
    Id<"appointmentTypeFolders"> | undefined
  >();
  const [selectedTreeFolderId, setSelectedTreeFolderId] = useState<
    Id<"appointmentTypeFolders"> | undefined
  >();
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [optimisticTreeRestore, setOptimisticTreeRestore] =
    useState<null | OptimisticAppointmentTypeTreeRestore>(null);

  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const appointmentTypeFoldersQuery = useQuery(
    api.entities.getAppointmentTypeFolders,
    {
      ruleSetId,
    },
  );
  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const createAppointmentTypeMutation = useMutation(
    api.entities.createAppointmentType,
  );
  const updateAppointmentTypeMutation = useMutation(
    api.entities.updateAppointmentType,
  );
  const deleteAppointmentTypeMutation = useMutation(
    api.entities.deleteAppointmentType,
  );
  const createAppointmentTypeFolderMutation = useMutation(
    api.entities.createAppointmentTypeFolder,
  );
  const updateAppointmentTypeFolderMutation = useMutation(
    api.entities.updateAppointmentTypeFolder,
  );
  const deleteAppointmentTypeFolderMutation = useMutation(
    api.entities.deleteAppointmentTypeFolder,
  );
  const moveAppointmentTypeToFolderMutation = useMutation(
    api.entities.moveAppointmentTypeToFolder,
  );

  const baseAppointmentTypes: AppointmentType[] = useMemo(() => {
    if (!appointmentTypesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "appointmentTypes",
      AppointmentTypeQueryResult[number]
    >({
      entities: appointmentTypesQuery,
      entityType: "appointment type",
      source: "AppointmentTypesManagement",
    });
  }, [appointmentTypesQuery]);
  const practitioners: Practitioner[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionerQueryResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "AppointmentTypesManagement",
    });
  }, [practitionersQuery]);
  const baseAppointmentTypeFolders = useMemo(
    () => appointmentTypeFoldersQuery ?? [],
    [appointmentTypeFoldersQuery],
  );
  const activeOptimisticTreeRestore = useMemo(
    () =>
      getActiveAppointmentTypeTreeOverlay({
        baseAppointmentTypes,
        baseFolders: baseAppointmentTypeFolders,
        getFolderLineageKey: getAppointmentTypeFolderLineageKey,
        overlay: optimisticTreeRestore,
      }),
    [baseAppointmentTypeFolders, baseAppointmentTypes, optimisticTreeRestore],
  );
  const appointmentTypes = useMemo(
    () =>
      activeOptimisticTreeRestore === null
        ? baseAppointmentTypes
        : mergeAppointmentTypesByLineage(
            baseAppointmentTypes,
            activeOptimisticTreeRestore.appointmentTypes,
            activeOptimisticTreeRestore.deletedAppointmentTypeLineageKeys,
          ),
    [activeOptimisticTreeRestore, baseAppointmentTypes],
  );
  const appointmentTypeFolders = useMemo(
    () =>
      activeOptimisticTreeRestore === null
        ? baseAppointmentTypeFolders
        : mergeAppointmentTypeFoldersByLineage(
            baseAppointmentTypeFolders,
            activeOptimisticTreeRestore.folders,
            activeOptimisticTreeRestore.deletedFolderLineageKeys,
            getAppointmentTypeFolderLineageKey,
          ),
    [activeOptimisticTreeRestore, baseAppointmentTypeFolders],
  );
  const treeModel = useMemo(
    () => buildAppointmentTreeModel(appointmentTypes, appointmentTypeFolders),
    [appointmentTypeFolders, appointmentTypes],
  );
  const treeModelRef = useRef(treeModel);
  useEffect(() => {
    treeModelRef.current = treeModel;
  }, [treeModel]);
  const fileTree = useFileTree({
    dragAndDrop: {
      canDrop: ({ draggedPaths, target }) => {
        if (draggedPaths.length !== 1) {
          return false;
        }
        if (target.kind === "root") {
          return true;
        }

        const targetPath = normalizeTreeLookupPath(
          target.directoryPath ?? target.hoveredPath,
        );
        return (
          targetPath === treeModelRef.current.rootPath ||
          treeModelRef.current.itemByPath.get(targetPath ?? "")?.kind ===
            "folder"
        );
      },
      onDropComplete: (event) => {
        void handleTreeDrop(event);
      },
      onDropError: (error) => {
        toast.error("Verschieben fehlgeschlagen", { description: error });
      },
    },
    flattenEmptyDirectories: false,
    initialExpansion: "open",
    onSelectionChange: (selectedPaths) => {
      handleTreeSelectionChange(selectedPaths);
    },
    paths: treeModel.paths,
    search: true,
  });
  useEffect(() => {
    fileTree.model.resetPaths(treeModel.paths, {
      initialExpandedPaths: treeModel.expandedPaths,
    });
  }, [fileTree.model, treeModel.expandedPaths, treeModel.paths]);
  const formSchema = useMemo(
    () =>
      createAppointmentTypeFormSchema({
        appointmentTypeLineageKeys: appointmentTypes.map(
          (appointmentType) => appointmentType.lineageKey,
        ),
        practitionerIds: practitioners.map((practitioner) => practitioner._id),
      }),
    [appointmentTypes, practitioners],
  );
  const appointmentTypesRef = useRef(appointmentTypes);
  useEffect(() => {
    appointmentTypesRef.current = appointmentTypes;
  }, [appointmentTypes]);
  const appointmentTypeFoldersRef = useRef(appointmentTypeFolders);
  useEffect(() => {
    appointmentTypeFoldersRef.current = appointmentTypeFolders;
  }, [appointmentTypeFolders]);
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const treePointerDownRef = useRef<null | {
    canOpenItem: boolean;
    path: string;
    x: number;
    y: number;
  }>(null);

  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });
  const upsertAppointmentTypeRef = useCallback(
    (
      appointmentType: AppointmentType,
      options?: {
        previousLineageKey?: AppointmentTypeLineageKey | undefined;
      },
    ) => {
      const next = [...appointmentTypesRef.current];
      const matchIndex = next.findIndex(
        (existing) =>
          existing._id === appointmentType._id ||
          existing.lineageKey === appointmentType.lineageKey ||
          (options?.previousLineageKey !== undefined &&
            existing.lineageKey === options.previousLineageKey),
      );

      if (matchIndex === -1) {
        next.push(appointmentType);
      } else {
        next[matchIndex] = appointmentType;
      }

      appointmentTypesRef.current = next;
    },
    [],
  );
  const removeAppointmentTypeFromRef = useCallback(
    (params: {
      id: Id<"appointmentTypes">;
      lineageKey?: AppointmentTypeLineageKey | undefined;
    }) => {
      appointmentTypesRef.current = appointmentTypesRef.current.filter(
        (existing) =>
          existing._id !== params.id &&
          (params.lineageKey === undefined ||
            existing.lineageKey !== params.lineageKey),
      );
    },
    [],
  );
  const upsertAppointmentTypeFolderRef = useCallback(
    (
      folder: AppointmentTypeFolder,
      options?: {
        previousLineageKey?: AppointmentTypeFolderLineageKey | undefined;
      },
    ) => {
      const next = [...appointmentTypeFoldersRef.current];
      const folderLineageKey = getAppointmentTypeFolderLineageKey(folder);
      const matchIndex = next.findIndex(
        (existing) =>
          existing._id === folder._id ||
          existing.lineageKey === folderLineageKey ||
          (options?.previousLineageKey !== undefined &&
            existing.lineageKey === options.previousLineageKey),
      );

      if (matchIndex === -1) {
        next.push(folder);
      } else {
        next[matchIndex] = folder;
      }

      appointmentTypeFoldersRef.current = next;
    },
    [],
  );
  const removeAppointmentTypeFolderFromRef = useCallback(
    (params: {
      id: Id<"appointmentTypeFolders">;
      lineageKey?: AppointmentTypeFolderLineageKey | undefined;
    }) => {
      appointmentTypeFoldersRef.current =
        appointmentTypeFoldersRef.current.filter(
          (existing) =>
            existing._id !== params.id &&
            (params.lineageKey === undefined ||
              existing.lineageKey !== params.lineageKey),
        );
    },
    [],
  );
  const createAppointmentTypeFolderRefSnapshot = useCallback(
    (params: {
      id: Id<"appointmentTypeFolders">;
      lineageKey: AppointmentTypeFolderLineageKey;
      name: string;
      parentFolderId?: Id<"appointmentTypeFolders"> | undefined;
      ruleSetId: Id<"ruleSets">;
    }): AppointmentTypeFolder => ({
      _creationTime: 0,
      _id: params.id,
      createdAt: 0n,
      lastModified: 0n,
      lineageKey: params.lineageKey,
      name: params.name,
      practiceId,
      ruleSetId: params.ruleSetId,
      ...(params.parentFolderId && {
        parentFolderId: params.parentFolderId,
      }),
    }),
    [practiceId],
  );
  const createAppointmentTypeRefSnapshot = useCallback(
    (params: {
      allowedPractitionerLineageKeys: AppointmentType["allowedPractitionerLineageKeys"];
      appointmentPlan: NonNullable<AppointmentType["appointmentPlan"]>;
      defaultOccupancy: NonNullable<AppointmentType["defaultOccupancy"]>;
      duration: number;
      id: AppointmentTypeId;
      lineageKey: AppointmentTypeLineageKey;
      name: string;
      ruleSetId: Id<"ruleSets">;
      treeFolderId?: Id<"appointmentTypeFolders"> | undefined;
    }): AppointmentType => ({
      _creationTime: 0,
      _id: params.id,
      allowedPractitionerLineageKeys: params.allowedPractitionerLineageKeys,
      appointmentPlan: params.appointmentPlan,
      createdAt: 0n,
      defaultOccupancy: params.defaultOccupancy,
      duration: params.duration,
      lastModified: 0n,
      lineageKey: params.lineageKey,
      name: params.name,
      practiceId,
      ruleSetId: params.ruleSetId,
      ...(params.treeFolderId && { treeFolderId: params.treeFolderId }),
    }),
    [practiceId],
  );
  const hideAppointmentTypeTreeSubtreeOptimistically = useCallback(
    (params: {
      appointmentTypeLineageKeys: AppointmentTypeLineageKey[];
      folderLineageKeys: AppointmentTypeFolderLineageKey[];
    }) => {
      setOptimisticTreeRestore(createAppointmentTypeTreeDeleteOverlay(params));
    },
    [],
  );
  const restoreAppointmentTypeTreeSubtreeOptimistically = useCallback(
    (params: {
      appointmentTypes: AppointmentType[];
      folders: AppointmentTypeFolder[];
    }) => {
      setOptimisticTreeRestore(
        createAppointmentTypeTreeRestoreOverlay(
          params,
          getAppointmentTypeFolderLineageKey,
        ),
      );
    },
    [],
  );
  const clearAppointmentTypeTreeOptimisticRestore = useCallback(() => {
    setOptimisticTreeRestore(null);
  }, []);
  const createMovedAppointmentTypeRefSnapshot = useCallback(
    (params: {
      appointmentType: AppointmentType;
      id: Id<"appointmentTypes">;
      ruleSetId: Id<"ruleSets">;
      treeFolderId: Id<"appointmentTypeFolders"> | undefined;
    }): AppointmentType => {
      const appointmentTypeWithoutFolder = { ...params.appointmentType };
      delete appointmentTypeWithoutFolder.treeFolderId;
      return {
        ...appointmentTypeWithoutFolder,
        _id: asAppointmentTypeId(params.id),
        ruleSetId: params.ruleSetId,
        ...(params.treeFolderId && { treeFolderId: params.treeFolderId }),
      };
    },
    [],
  );
  const isActiveAppointmentTypeFolder = useCallback(
    (folderId: Id<"appointmentTypeFolders"> | undefined) =>
      folderId === undefined ||
      appointmentTypeFoldersRef.current.some(
        (folder) => folder._id === folderId,
      ),
    [],
  );
  const validateTreeChildNameForHistory = useCallback(
    (params: {
      excludeAppointmentTypeId?: Id<"appointmentTypes">;
      excludeFolderId?: Id<"appointmentTypeFolders">;
      name: string;
      parentFolderId: Id<"appointmentTypeFolders"> | undefined;
    }) => {
      if (!isActiveAppointmentTypeFolder(params.parentFolderId)) {
        return "Der Zielordner existiert nicht mehr.";
      }
      if (
        hasTreeChildNameConflict({
          appointmentTypes: appointmentTypesRef.current,
          ...(params.excludeAppointmentTypeId && {
            excludeAppointmentTypeId: params.excludeAppointmentTypeId,
          }),
          ...(params.excludeFolderId && {
            excludeFolderId: params.excludeFolderId,
          }),
          folders: appointmentTypeFoldersRef.current,
          name: params.name,
          parentFolderId: params.parentFolderId,
        })
      ) {
        return `In diesem Ordner existiert bereits ein Eintrag mit dem Namen "${params.name}".`;
      }
      return null;
    },
    [isActiveAppointmentTypeFolder],
  );
  const resolveFolderHistoryTarget = useCallback(
    (
      target: AppointmentTypeFolderHistoryTarget,
    ):
      | { folderId: Id<"appointmentTypeFolders"> | undefined; status: "ok" }
      | { message: string; status: "conflict" } => {
      if (target.kind === "root") {
        return { folderId: undefined, status: "ok" };
      }

      const folder = appointmentTypeFoldersRef.current.find(
        (candidate) =>
          getAppointmentTypeFolderLineageKey(candidate) === target.lineageKey,
      );
      if (folder === undefined) {
        return {
          message: "Der Zielordner existiert nicht mehr.",
          status: "conflict",
        };
      }

      return { folderId: folder._id, status: "ok" };
    },
    [],
  );
  const validateTreeChildNameForHistoryTarget = useCallback(
    (params: {
      excludeAppointmentTypeId?: Id<"appointmentTypes">;
      excludeFolderId?: Id<"appointmentTypeFolders">;
      name: string;
      target: AppointmentTypeFolderHistoryTarget;
    }) => {
      const resolvedTarget = resolveFolderHistoryTarget(params.target);
      if (resolvedTarget.status === "conflict") {
        return resolvedTarget;
      }

      const validationMessage = validateTreeChildNameForHistory({
        ...(params.excludeAppointmentTypeId && {
          excludeAppointmentTypeId: params.excludeAppointmentTypeId,
        }),
        ...(params.excludeFolderId && {
          excludeFolderId: params.excludeFolderId,
        }),
        name: params.name,
        parentFolderId: resolvedTarget.folderId,
      });
      if (validationMessage) {
        return { message: validationMessage, status: "conflict" as const };
      }

      return resolvedTarget;
    },
    [resolveFolderHistoryTarget, validateTreeChildNameForHistory],
  );

  const resolvePractitionerLineageKey = (
    practitionerId: Id<"practitioners">,
  ): PractitionerLineageKey =>
    findFrontendEntityByEntityId(
      practitionersRef.current,
      asPractitionerId(practitionerId),
    )?.lineageKey ?? asPractitionerLineageKey(practitionerId);

  const resolvePractitionerIdForLineage = (
    practitionerLineageKey: PractitionerLineageKey,
  ): Id<"practitioners"> | undefined =>
    practitionersRef.current.find(
      (practitioner) => practitioner.lineageKey === practitionerLineageKey,
    )?._id;

  const createPractitionerSnapshots = (
    practitionerIds: Id<"practitioners">[],
  ): PractitionerHistorySnapshot[] => {
    const nameById = new Map(
      practitionersRef.current.map((practitioner) => [
        practitioner._id,
        practitioner.name,
      ]),
    );

    return practitionerIds.map((id) => ({
      lineageId: resolvePractitionerLineageKey(id),
      name: nameById.get(asPractitionerId(id)) ?? id,
    }));
  };

  const form = useForm({
    defaultValues: defaultAppointmentTypeFormValues,
    onSubmit: async ({ value }) => {
      try {
        const parseResult = formSchema.safeParse(value);
        if (!parseResult.success) {
          toast.error("Fehler beim Speichern", {
            description: "Bitte prüfen Sie die markierten Felder.",
          });
          return;
        }

        const parsedValue = parseResult.data;
        const normalizedName = normalizeEntityName(parsedValue.name);
        const existingAppointmentTypeId = editingAppointmentType?._id;
        if (
          hasAppointmentTypeNameConflict({
            appointmentTypes: appointmentTypesRef.current,
            ...(existingAppointmentTypeId && {
              excludeAppointmentTypeId: existingAppointmentTypeId,
            }),
            name: normalizedName,
          })
        ) {
          toast.error("Name bereits vergeben", {
            description: `Die Terminart "${normalizedName}" existiert bereits in dieser Praxis.`,
          });
          return;
        }

        const treeFolderId =
          editingAppointmentType?.treeFolderId ?? newAppointmentTypeFolderId;
        if (
          hasTreeChildNameConflict({
            appointmentTypes: appointmentTypesRef.current,
            ...(existingAppointmentTypeId && {
              excludeAppointmentTypeId: existingAppointmentTypeId,
            }),
            folders: appointmentTypeFoldersRef.current,
            name: normalizedName,
            parentFolderId: treeFolderId,
          })
        ) {
          toast.error("Name bereits vergeben", {
            description: `In diesem Ordner existiert bereits ein Eintrag mit dem Namen "${normalizedName}".`,
          });
          return;
        }

        const normalizedAppointmentPlan = normalizeAppointmentPlanForSubmit(
          parsedValue.appointmentPlan,
        ).match(
          (normalizedPlan) =>
            normalizedPlan.length === 0 ? undefined : normalizedPlan,
          (message) => {
            toast.error("Fehler beim Speichern", {
              description: message,
            });
            return null;
          },
        );
        if (normalizedAppointmentPlan === null) {
          return;
        }
        const normalizedDefaultOccupancy = normalizeDefaultOccupancyForSubmit(
          parsedValue.defaultOccupancyKind,
        ).match(
          (defaultOccupancy) => defaultOccupancy,
          (message) => {
            toast.error("Fehler beim Speichern", {
              description: message,
            });
            return null;
          },
        );
        if (normalizedDefaultOccupancy === null) {
          return;
        }
        const formPractitionerSnapshots = createPractitionerSnapshots(
          parsedValue.practitionerIds,
        );
        const resolvedFormPractitionerIds = practitionerIdsFromSnapshots(
          practitionersRef.current,
          formPractitionerSnapshots,
        );

        if ("status" in resolvedFormPractitionerIds) {
          toast.error("Fehler beim Speichern", {
            description: resolvedFormPractitionerIds.message,
          });
          return;
        }

        if (editingAppointmentType) {
          const appointmentTypeLineageKey = editingAppointmentType.lineageKey;
          const beforeState = {
            appointmentPlan: editingAppointmentType.appointmentPlan,
            defaultOccupancy: editingAppointmentType.defaultOccupancy,
            duration: editingAppointmentType.duration,
            name: editingAppointmentType.name,
            practitionerLineageKeys:
              editingAppointmentType.allowedPractitionerLineageKeys.map(
                (lineageKey) => asPractitionerLineageKey(lineageKey),
              ),
          };
          const afterState = {
            appointmentPlan:
              normalizedAppointmentPlan === undefined
                ? undefined
                : { steps: normalizedAppointmentPlan },
            defaultOccupancy: normalizedDefaultOccupancy,
            duration: parsedValue.duration,
            name: normalizedName,
            practitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
          };
          const beforePractitionerSnapshots = createPractitionerSnapshots(
            beforeState.practitionerLineageKeys
              .map((lineageKey) => resolvePractitionerIdForLineage(lineageKey))
              .flatMap((practitionerId) =>
                practitionerId === undefined ? [] : [practitionerId],
              ),
          );
          const afterPractitionerSnapshots = createPractitionerSnapshots(
            resolvedFormPractitionerIds.ids,
          );
          const beforeSnapshot = encodeRuleSetSnapshot(beforeState);
          const afterSnapshot = encodeRuleSetSnapshot(afterState);

          // Update existing appointment type
          const updateResult = await updateAppointmentTypeMutation({
            appointmentTypeId: editingAppointmentType._id,
            defaultOccupancy: afterState.defaultOccupancy,
            duration: parsedValue.duration,
            name: normalizedName,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...getCowMutationArgs(),
            ...createAppointmentPlanUpdateArgs(normalizedAppointmentPlan),
          });
          handleDraftMutationResult(updateResult);
          upsertAppointmentTypeRef(
            {
              ...editingAppointmentType,
              _id: asAppointmentTypeId(updateResult.entityId),
              allowedPractitionerLineageKeys:
                afterState.practitionerLineageKeys,
              appointmentPlan: afterState.appointmentPlan ?? { steps: [] },
              defaultOccupancy: afterState.defaultOccupancy,
              duration: afterState.duration,
              name: afterState.name,
              ruleSetId: updateResult.ruleSetId,
            },
            { previousLineageKey: appointmentTypeLineageKey },
          );
          recordLineageUpdateRuleSetCommand({
            entitiesRef: appointmentTypesRef,
            initialEntityId: updateResult.entityId,
            kind: "appointmentType.update",
            label: "Terminart aktualisiert",
            lineageKey: appointmentTypeLineageKey,
            onRecordCommand,
            redoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht erneut angewendet werden.",
            runRedo: async (currentAppointmentTypeId) => {
              const resolvedRedoPractitionerIds = practitionerIdsFromSnapshots(
                practitionersRef.current,
                afterPractitionerSnapshots,
              );
              if ("status" in resolvedRedoPractitionerIds) {
                return resolvedRedoPractitionerIds;
              }

              const redoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                defaultOccupancy: afterState.defaultOccupancy,
                duration: afterState.duration,
                name: afterState.name,
                practiceId,
                practitionerIds: resolvedRedoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createAppointmentPlanUpdateArgs(
                  afterState.appointmentPlan?.steps,
                ),
              });
              handleDraftMutationResult(redoResult);
              return { entityId: redoResult.entityId };
            },
            runUndo: async (currentAppointmentTypeId) => {
              const resolvedUndoPractitionerIds = practitionerIdsFromSnapshots(
                practitionersRef.current,
                beforePractitionerSnapshots,
              );
              if ("status" in resolvedUndoPractitionerIds) {
                return resolvedUndoPractitionerIds;
              }

              const undoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                defaultOccupancy: beforeState.defaultOccupancy ?? {
                  kind: "selectedPractitioner",
                },
                duration: beforeState.duration,
                name: beforeState.name,
                practiceId,
                practitionerIds: resolvedUndoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createAppointmentPlanUpdateArgs(
                  beforeState.appointmentPlan?.steps,
                ),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: undoResult.entityId };
            },
            snapshots: {
              after: afterSnapshot,
              before: beforeSnapshot,
            },
            undoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
            validateRedo: (current) => {
              if (
                current.name !== beforeState.name ||
                current.duration !== beforeState.duration ||
                serializeAppointmentPlan(current.appointmentPlan?.steps) !==
                  serializeAppointmentPlan(
                    beforeState.appointmentPlan?.steps,
                  ) ||
                !samePractitionerLineageIds(
                  current.allowedPractitionerLineageKeys
                    .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                    .toSorted(),
                  toSnapshotLineageIds(beforePractitionerSnapshots),
                )
              ) {
                return "Die Terminart wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.";
              }
              return null;
            },
            validateUndo: (current) => {
              if (
                current.name !== afterState.name ||
                current.duration !== afterState.duration ||
                serializeAppointmentPlan(current.appointmentPlan?.steps) !==
                  serializeAppointmentPlan(afterState.appointmentPlan?.steps) ||
                !samePractitionerLineageIds(
                  current.allowedPractitionerLineageKeys
                    .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                    .toSorted(),
                  toSnapshotLineageIds(afterPractitionerSnapshots),
                )
              ) {
                return "Die Terminart wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";
              }
              return null;
            },
          });

          toast.success("Terminart aktualisiert", {
            description: `Terminart "${normalizedName}" wurde erfolgreich aktualisiert.`,
          });

          setIsDialogOpen(false);
          setEditingAppointmentType(null);
          form.reset();
        } else {
          // Create new appointment type
          const createResult = await createAppointmentTypeMutation({
            defaultOccupancy: normalizedDefaultOccupancy,
            duration: parsedValue.duration,
            name: normalizedName,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...createTreeFolderArg(newAppointmentTypeFolderId),
            ...getCowMutationArgs(),
            ...createAppointmentPlanCreateArgs(normalizedAppointmentPlan),
          });
          handleDraftMutationResult(createResult);
          const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
            createResult.entityId,
          );
          const createdAppointmentType = createAppointmentTypeRefSnapshot({
            allowedPractitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
            appointmentPlan:
              normalizedAppointmentPlan === undefined
                ? { steps: [] }
                : { steps: normalizedAppointmentPlan },
            defaultOccupancy: normalizedDefaultOccupancy,
            duration: parsedValue.duration,
            id: asAppointmentTypeId(createResult.entityId),
            lineageKey: appointmentTypeLineageKey,
            name: normalizedName,
            ruleSetId: createResult.ruleSetId,
            treeFolderId: newAppointmentTypeFolderId,
          });
          upsertAppointmentTypeRef(createdAppointmentType);
          const { entityId } = createResult;
          const createdSnapshot = encodeRuleSetSnapshot({
            appointmentPlan:
              normalizedAppointmentPlan === undefined
                ? undefined
                : { steps: normalizedAppointmentPlan },
            duration: parsedValue.duration,
            name: normalizedName,
            practitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
            treeFolderId: newAppointmentTypeFolderId,
          });
          const createdFolderTarget = createAppointmentTypeFolderHistoryTarget(
            newAppointmentTypeFolderId === undefined
              ? undefined
              : appointmentTypeFoldersRef.current.find(
                  (folder) => folder._id === newAppointmentTypeFolderId,
                ),
          );

          recordLineageCreateRuleSetCommand({
            entitiesRef: appointmentTypesRef,
            initialEntityId: entityId,
            isMissingEntityError,
            kind: "appointmentType.create",
            label: "Terminart erstellt",
            lineageKey: appointmentTypeLineageKey,
            onRecordCommand,
            runCreate: async () => {
              const resolvedCreatePractitionerIds =
                practitionerIdsFromSnapshots(
                  practitionersRef.current,
                  formPractitionerSnapshots,
                );
              if ("status" in resolvedCreatePractitionerIds) {
                return resolvedCreatePractitionerIds;
              }
              const resolvedFolder =
                resolveFolderHistoryTarget(createdFolderTarget);
              if (resolvedFolder.status === "conflict") {
                return resolvedFolder;
              }
              const createConflict = validateTreeChildNameForHistory({
                name: normalizedName,
                parentFolderId: resolvedFolder.folderId,
              });
              if (createConflict) {
                return { message: createConflict, status: "conflict" };
              }
              const recreateResult = await createAppointmentTypeMutation({
                defaultOccupancy: normalizedDefaultOccupancy,
                duration: parsedValue.duration,
                lineageKey: appointmentTypeLineageKey,
                name: normalizedName,
                practiceId,
                practitionerIds: resolvedCreatePractitionerIds.ids,
                ...createTreeFolderArg(resolvedFolder.folderId),
                ...getCowMutationArgs(),
                ...createAppointmentPlanCreateArgs(normalizedAppointmentPlan),
              });
              handleDraftMutationResult(recreateResult);
              const restoredAppointmentType = createAppointmentTypeRefSnapshot({
                allowedPractitionerLineageKeys: toSnapshotLineageIds(
                  formPractitionerSnapshots,
                ),
                appointmentPlan:
                  normalizedAppointmentPlan === undefined
                    ? { steps: [] }
                    : { steps: normalizedAppointmentPlan },
                defaultOccupancy: normalizedDefaultOccupancy,
                duration: parsedValue.duration,
                id: asAppointmentTypeId(recreateResult.entityId),
                lineageKey: appointmentTypeLineageKey,
                name: normalizedName,
                ruleSetId: recreateResult.ruleSetId,
                treeFolderId: resolvedFolder.folderId,
              });
              upsertAppointmentTypeRef(restoredAppointmentType, {
                previousLineageKey: appointmentTypeLineageKey,
              });
              restoreAppointmentTypeTreeSubtreeOptimistically({
                appointmentTypes: [restoredAppointmentType],
                folders: [],
              });
              return { entityId: recreateResult.entityId };
            },
            runDelete: async (currentAppointmentTypeId) => {
              const undoResult = await deleteAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                appointmentTypeLineageKey,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              hideAppointmentTypeTreeSubtreeOptimistically({
                appointmentTypeLineageKeys: [appointmentTypeLineageKey],
                folderLineageKeys: [],
              });
              removeAppointmentTypeFromRef({
                id: currentAppointmentTypeId,
                lineageKey: appointmentTypeLineageKey,
              });
              return { entityId: undoResult.entityId };
            },
            snapshots: {
              after: createdSnapshot,
            },
            validateBeforeCreate: () => {
              const existingByName = appointmentTypesRef.current.some(
                (type) => type.name === normalizedName,
              );
              if (existingByName) {
                return `[HISTORY:APPOINTMENT_TYPE_NAME_CONFLICT] Die Terminart kann nicht wiederhergestellt werden, weil bereits eine andere Terminart mit dem Namen "${normalizedName}" existiert.`;
              }
              return null;
            },
            validateExistingForCreate: (existing) => {
              const resolvedFolder =
                resolveFolderHistoryTarget(createdFolderTarget);
              if (resolvedFolder.status === "conflict") {
                return resolvedFolder.message;
              }
              const existingPractitionerLineageIds =
                existing.allowedPractitionerLineageKeys
                  .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                  .toSorted();
              const expectedPractitionerLineageIds = toSnapshotLineageIds(
                formPractitionerSnapshots,
              );
              if (
                existing.name !== normalizedName ||
                existing.duration !== parsedValue.duration ||
                serializeAppointmentPlan(existing.appointmentPlan?.steps) !==
                  serializeAppointmentPlan(normalizedAppointmentPlan) ||
                existing.treeFolderId !== resolvedFolder.folderId ||
                !samePractitionerLineageIds(
                  existingPractitionerLineageIds,
                  expectedPractitionerLineageIds,
                )
              ) {
                return `[HISTORY:APPOINTMENT_TYPE_LINEAGE_CONFLICT] Die Terminart mit lineageKey ${appointmentTypeLineageKey} existiert bereits, hat aber abweichende Einstellungen.`;
              }
              return null;
            },
          });

          toast.success("Terminart erstellt", {
            description: `Terminart "${normalizedName}" wurde erfolgreich erstellt.`,
          });

          setIsDialogOpen(false);
          form.reset();
        }
      } catch (error: unknown) {
        toast.error(
          editingAppointmentType
            ? "Fehler beim Aktualisieren"
            : "Fehler beim Erstellen",
          {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          },
        );
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = formSchema.safeParse(value);
        return result.success ? undefined : result.error;
      },
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAppointmentType(null);
    setNewAppointmentTypeFolderId(undefined);
    form.reset();
  };

  const openCreateDialog = (treeFolderId?: Id<"appointmentTypeFolders">) => {
    setEditingAppointmentType(null);
    setNewAppointmentTypeFolderId(treeFolderId);
    form.reset();
    setIsDialogOpen(true);
  };

  const openEditDialog = useCallback(
    (appointmentType: AppointmentType) => {
      const validPractitionerIds =
        appointmentType.allowedPractitionerLineageKeys.flatMap((lineageKey) => {
          const practitionerLineageKey = asPractitionerLineageKey(lineageKey);
          const practitionerId = practitionersRef.current.find(
            (practitioner) =>
              practitioner.lineageKey === practitionerLineageKey,
          )?._id;
          return practitionerId === undefined ? [] : [practitionerId];
        });

      setEditingAppointmentType(appointmentType);
      setNewAppointmentTypeFolderId(undefined);
      form.setFieldValue(
        "defaultOccupancyKind",
        defaultOccupancyKindForForm(appointmentType.defaultOccupancy),
      );
      form.setFieldValue("name", appointmentType.name);
      form.setFieldValue("duration", appointmentType.duration);
      form.setFieldValue(
        "appointmentPlan",
        normalizeAppointmentPlanForForm(appointmentType.appointmentPlan),
      );
      form.setFieldValue("practitionerIds", validPractitionerIds);

      if (
        validPractitionerIds.length !==
        appointmentType.allowedPractitionerLineageKeys.length
      ) {
        toast.info(
          "Mindestens ein zuvor zugeordneter Behandler existiert nicht mehr und wurde entfernt.",
        );
      }

      setIsDialogOpen(true);
    },
    [form],
  );

  function handleTreeSelectionChange(selectedPaths: readonly string[]) {
    const [selectedPath] = selectedPaths;
    if (!selectedPath) {
      setSelectedTreeFolderId(undefined);
      return;
    }

    const selectedItem = treeModelRef.current.itemByPath.get(
      normalizeTreeLookupPath(selectedPath) ?? "",
    );
    if (selectedItem?.kind === "folder") {
      setSelectedTreeFolderId(selectedItem.id);
      return;
    }
    if (selectedItem?.kind === "appointmentType") {
      setSelectedTreeFolderId(selectedItem.appointmentType.treeFolderId);
      return;
    }
    setSelectedTreeFolderId(undefined);
  }

  const openEditFolderDialog = useCallback((folder: AppointmentTypeFolder) => {
    setEditingAppointmentTypeFolder(folder);
    setCreateFolderParentId(folder.parentFolderId);
    setCreateFolderName(folder.name);
    setIsFolderDialogOpen(true);
  }, []);

  const openAppointmentTypeFromTreePath = useCallback(
    (selectedPath: string | undefined) => {
      if (!selectedPath) {
        return;
      }

      const selectedItem = treeModelRef.current.itemByPath.get(
        normalizeTreeLookupPath(selectedPath) ?? "",
      );
      if (selectedItem?.kind === "appointmentType") {
        openEditDialog(selectedItem.appointmentType);
        return;
      }
      if (selectedItem?.kind === "folder") {
        openEditFolderDialog(selectedItem.folder);
      }
    },
    [openEditDialog, openEditFolderDialog],
  );

  useEffect(() => {
    const getTreeItemClickTarget = (event: PointerEvent) => {
      const treeHost = document.querySelector("file-tree-container");
      if (!treeHost) {
        return;
      }

      const composedPath = event.composedPath();
      if (!composedPath.includes(treeHost)) {
        return;
      }

      const treeItem = composedPath.find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.dataset["itemPath"] !== undefined,
      );
      const itemPath = treeItem?.dataset["itemPath"];
      if (!itemPath) {
        return;
      }

      const itemSection = composedPath.find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          node.dataset["itemSection"] !== undefined,
      )?.dataset["itemSection"];
      const item = treeModelRef.current.itemByPath.get(
        normalizeTreeLookupPath(itemPath) ?? "",
      );
      const isFolderChevronClick =
        item?.kind === "folder" && itemSection === "icon";

      return {
        canOpenItem: !isFolderChevronClick,
        path: itemPath,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        treePointerDownRef.current = null;
        return;
      }
      const target = getTreeItemClickTarget(event);
      treePointerDownRef.current =
        target === undefined
          ? null
          : {
              canOpenItem: target.canOpenItem,
              path: target.path,
              x: event.clientX,
              y: event.clientY,
            };
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
        treePointerDownRef.current = null;
        return;
      }
      const pointerDown = treePointerDownRef.current;
      treePointerDownRef.current = null;
      if (!pointerDown) {
        return;
      }

      const target = getTreeItemClickTarget(event);
      const path = target?.path;
      if (path !== pointerDown.path) {
        return;
      }
      if (!pointerDown.canOpenItem || target?.canOpenItem === false) {
        return;
      }

      const deltaX = event.clientX - pointerDown.x;
      const deltaY = event.clientY - pointerDown.y;
      if (Math.hypot(deltaX, deltaY) > 8) {
        return;
      }

      openAppointmentTypeFromTreePath(path);
    };
    const handleDragStart = () => {
      treePointerDownRef.current = null;
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("dragstart", handleDragStart, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("dragstart", handleDragStart, true);
    };
  }, [openAppointmentTypeFromTreePath]);

  function openCreateFolderDialog(
    parentFolderId?: Id<"appointmentTypeFolders">,
  ) {
    setEditingAppointmentTypeFolder(null);
    setCreateFolderParentId(parentFolderId);
    setCreateFolderName("");
    setIsFolderDialogOpen(true);
  }

  async function handleSubmitFolder() {
    const name = normalizeEntityName(createFolderName);
    if (name.length < 2) {
      toast.error("Ordnername muss mindestens 2 Zeichen lang sein.");
      return;
    }
    if (
      hasTreeChildNameConflict({
        appointmentTypes: appointmentTypesRef.current,
        folders: appointmentTypeFoldersRef.current,
        name,
        parentFolderId:
          editingAppointmentTypeFolder?.parentFolderId ?? createFolderParentId,
        ...(editingAppointmentTypeFolder && {
          excludeFolderId: editingAppointmentTypeFolder._id,
        }),
      })
    ) {
      toast.error("Name bereits vergeben", {
        description: `In diesem Ordner existiert bereits ein Eintrag mit dem Namen "${name}".`,
      });
      return;
    }

    try {
      if (editingAppointmentTypeFolder) {
        const folderBefore = editingAppointmentTypeFolder;
        const folderLineageKey =
          getAppointmentTypeFolderLineageKey(folderBefore);
        const previousName = folderBefore.name;
        const parentFolderId = folderBefore.parentFolderId;
        const result = await updateAppointmentTypeFolderMutation({
          folderId: folderBefore._id,
          name,
          practiceId,
          ...getCowMutationArgs(),
        });
        handleDraftMutationResult(result);
        upsertAppointmentTypeFolderRef(
          createAppointmentTypeFolderRefSnapshot({
            id: result.entityId,
            lineageKey: folderLineageKey,
            name,
            parentFolderId,
            ruleSetId: result.ruleSetId,
          }),
          { previousLineageKey: folderLineageKey },
        );
        const previousFolderSnapshot = encodeRuleSetSnapshot({
          lineageKey: folderLineageKey,
          name: previousName,
          parent: createAppointmentTypeFolderHistoryTarget(
            parentFolderId
              ? appointmentTypeFoldersRef.current.find(
                  (folder) => folder._id === parentFolderId,
                )
              : undefined,
          ),
        });
        const renamedFolderSnapshot = encodeRuleSetSnapshot({
          lineageKey: folderLineageKey,
          name,
          parent: createAppointmentTypeFolderHistoryTarget(
            parentFolderId
              ? appointmentTypeFoldersRef.current.find(
                  (folder) => folder._id === parentFolderId,
                )
              : undefined,
          ),
        });
        recordLineageUpdateRuleSetCommand({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          kind: "appointmentType.update",
          label: "Ordner umbenannt",
          lineageKey: folderLineageKey,
          onRecordCommand,
          redoMissingMessage:
            "Der Ordner wurde bereits gelöscht und kann nicht erneut umbenannt werden.",
          runRedo: async (currentFolderId) => {
            const redoResult = await updateAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              name,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
            upsertAppointmentTypeFolderRef(
              createAppointmentTypeFolderRefSnapshot({
                id: redoResult.entityId,
                lineageKey: folderLineageKey,
                name,
                parentFolderId,
                ruleSetId: redoResult.ruleSetId,
              }),
              { previousLineageKey: folderLineageKey },
            );
            return { entityId: redoResult.entityId };
          },
          runUndo: async (currentFolderId) => {
            const undoResult = await updateAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              name: previousName,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            upsertAppointmentTypeFolderRef(
              createAppointmentTypeFolderRefSnapshot({
                id: undoResult.entityId,
                lineageKey: folderLineageKey,
                name: previousName,
                parentFolderId,
                ruleSetId: undoResult.ruleSetId,
              }),
              { previousLineageKey: folderLineageKey },
            );
            return { entityId: undoResult.entityId };
          },
          snapshots: {
            after: renamedFolderSnapshot,
            before: previousFolderSnapshot,
          },
          undoMissingMessage:
            "Der Ordner wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
          validateRedo: (current) => {
            if (current.name !== previousName) {
              return "Der Ordner wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.";
            }
            return validateTreeChildNameForHistory({
              excludeFolderId: current._id,
              name,
              parentFolderId: current.parentFolderId,
            });
          },
          validateUndo: (current) => {
            if (current.name !== name) {
              return "Der Ordner wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";
            }
            return validateTreeChildNameForHistory({
              excludeFolderId: current._id,
              name: previousName,
              parentFolderId: current.parentFolderId,
            });
          },
        });
      } else {
        const parentFolderId = createFolderParentId;
        const parentFolderTarget = createAppointmentTypeFolderHistoryTarget(
          parentFolderId
            ? appointmentTypeFoldersRef.current.find(
                (folder) => folder._id === parentFolderId,
              )
            : undefined,
        );
        const result = await createAppointmentTypeFolderMutation({
          name,
          practiceId,
          ...createParentFolderArg(parentFolderId),
          ...getCowMutationArgs(),
        });
        handleDraftMutationResult(result);
        const folderLineageKey = result.entityId;
        upsertAppointmentTypeFolderRef(
          createAppointmentTypeFolderRefSnapshot({
            id: result.entityId,
            lineageKey: folderLineageKey,
            name,
            parentFolderId,
            ruleSetId: result.ruleSetId,
          }),
        );
        const createdFolderSnapshot = encodeRuleSetSnapshot({
          lineageKey: folderLineageKey,
          name,
          parent: parentFolderTarget,
        });
        recordLineageCreateRuleSetCommand({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          isMissingEntityError,
          kind: "appointmentType.create",
          label: "Ordner erstellt",
          lineageKey: folderLineageKey,
          onRecordCommand,
          runCreate: async () => {
            const resolvedParent =
              resolveFolderHistoryTarget(parentFolderTarget);
            if (resolvedParent.status === "conflict") {
              return resolvedParent;
            }
            const createConflict = validateTreeChildNameForHistory({
              name,
              parentFolderId: resolvedParent.folderId,
            });
            if (createConflict) {
              return { message: createConflict, status: "conflict" as const };
            }
            const recreateResult = await createAppointmentTypeFolderMutation({
              lineageKey: folderLineageKey,
              name,
              practiceId,
              ...createParentFolderArg(resolvedParent.folderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(recreateResult);
            const restoredFolder = createAppointmentTypeFolderRefSnapshot({
              id: recreateResult.entityId,
              lineageKey: folderLineageKey,
              name,
              parentFolderId: resolvedParent.folderId,
              ruleSetId: recreateResult.ruleSetId,
            });
            upsertAppointmentTypeFolderRef(restoredFolder, {
              previousLineageKey: folderLineageKey,
            });
            restoreAppointmentTypeTreeSubtreeOptimistically({
              appointmentTypes: [],
              folders: [restoredFolder],
            });
            return { entityId: recreateResult.entityId };
          },
          runDelete: async (currentFolderId) => {
            const undoResult = await deleteAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            hideAppointmentTypeTreeSubtreeOptimistically({
              appointmentTypeLineageKeys: [],
              folderLineageKeys: [folderLineageKey],
            });
            removeAppointmentTypeFolderFromRef({
              id: currentFolderId,
              lineageKey: folderLineageKey,
            });
            return { entityId: undoResult.entityId };
          },
          snapshots: {
            after: createdFolderSnapshot,
          },
          validateBeforeCreate: () => {
            const validation = validateTreeChildNameForHistoryTarget({
              name,
              target: parentFolderTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
          },
          validateExistingForCreate: (existing) => {
            const resolvedParent =
              resolveFolderHistoryTarget(parentFolderTarget);
            if (resolvedParent.status === "conflict") {
              return resolvedParent.message;
            }
            if (
              existing.name !== name ||
              existing.parentFolderId !== resolvedParent.folderId
            ) {
              return `[HISTORY:APPOINTMENT_TYPE_FOLDER_LINEAGE_CONFLICT] Der Ordner mit lineageKey ${folderLineageKey} existiert bereits, hat aber abweichende Einstellungen.`;
            }
            return null;
          },
        });
      }
      setIsFolderDialogOpen(false);
      setCreateFolderName("");
      setCreateFolderParentId(undefined);
      setEditingAppointmentTypeFolder(null);
      toast.success(
        editingAppointmentTypeFolder ? "Ordner umbenannt" : "Ordner erstellt",
        {
          description: `Ordner "${name}" wurde ${
            editingAppointmentTypeFolder ? "umbenannt" : "erstellt"
          }.`,
        },
      );
    } catch (error: unknown) {
      toast.error(
        editingAppointmentTypeFolder
          ? "Fehler beim Umbenennen"
          : "Fehler beim Erstellen",
        {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        },
      );
    }
  }

  async function handleDeleteFolder(folder: AppointmentTypeFolder) {
    try {
      const folderIdsToDelete = new Set<Id<"appointmentTypeFolders">>();
      const pendingFolderIds = [folder._id];
      const folderById = new Map(
        appointmentTypeFoldersRef.current.map((candidate) => [
          candidate._id,
          candidate,
        ]),
      );
      while (pendingFolderIds.length > 0) {
        const nextFolderId = pendingFolderIds.pop();
        if (nextFolderId === undefined || folderIdsToDelete.has(nextFolderId)) {
          continue;
        }
        folderIdsToDelete.add(nextFolderId);
        for (const childFolder of appointmentTypeFoldersRef.current) {
          if (childFolder.parentFolderId === nextFolderId) {
            pendingFolderIds.push(childFolder._id);
          }
        }
      }
      const depthOfDeletedFolder = (
        lineageKey: AppointmentTypeFolderLineageKey,
      ): number => {
        const folderAtLineage = appointmentTypeFoldersRef.current.find(
          (candidate) =>
            getAppointmentTypeFolderLineageKey(candidate) === lineageKey,
        );
        let depth = 0;
        let cursor = folderAtLineage?.parentFolderId;
        while (cursor !== undefined && folderIdsToDelete.has(cursor)) {
          depth += 1;
          cursor = folderById.get(cursor)?.parentFolderId;
        }
        return depth;
      };
      const folderSnapshots: DeletedAppointmentTypeFolderSnapshot[] =
        appointmentTypeFoldersRef.current
          .filter((candidate) => folderIdsToDelete.has(candidate._id))
          .map((candidate) => {
            const parentFolder = candidate.parentFolderId
              ? appointmentTypeFoldersRef.current.find(
                  (parent) => parent._id === candidate.parentFolderId,
                )
              : undefined;
            return {
              lineageKey: getAppointmentTypeFolderLineageKey(candidate),
              name: candidate.name,
              parentLineageKey: parentFolder
                ? getAppointmentTypeFolderLineageKey(parentFolder)
                : undefined,
            };
          })
          .toSorted((left, right) => {
            return (
              depthOfDeletedFolder(left.lineageKey) -
              depthOfDeletedFolder(right.lineageKey)
            );
          });
      const appointmentTypeSnapshots: DeletedAppointmentTypeSnapshot[] =
        appointmentTypesRef.current
          .filter(
            (appointmentType) =>
              appointmentType.treeFolderId !== undefined &&
              folderIdsToDelete.has(appointmentType.treeFolderId),
          )
          .map((appointmentType) => {
            const treeFolder = appointmentTypeFoldersRef.current.find(
              (candidate) => candidate._id === appointmentType.treeFolderId,
            );
            if (treeFolder === undefined) {
              return;
            }
            return {
              appointmentPlan: appointmentType.appointmentPlan,
              defaultOccupancy: appointmentType.defaultOccupancy ?? {
                kind: "selectedPractitioner",
              },
              duration: appointmentType.duration,
              lineageKey: appointmentType.lineageKey,
              name: appointmentType.name,
              practitionerSnapshots: createPractitionerSnapshots(
                appointmentType.allowedPractitionerLineageKeys
                  .map((lineageKey) =>
                    resolvePractitionerIdForLineage(
                      asPractitionerLineageKey(lineageKey),
                    ),
                  )
                  .flatMap((practitionerId) =>
                    practitionerId === undefined ? [] : [practitionerId],
                  ),
              ),
              treeFolderLineageKey:
                getAppointmentTypeFolderLineageKey(treeFolder),
            };
          })
          .flatMap((snapshot) => (snapshot === undefined ? [] : [snapshot]));
      const rootFolderLineageKey = getAppointmentTypeFolderLineageKey(folder);
      const deletedAppointmentTypeLineageKeys = appointmentTypeSnapshots.map(
        (snapshot) => snapshot.lineageKey,
      );
      const deletedFolderLineageKeys = folderSnapshots.map(
        (snapshot) => snapshot.lineageKey,
      );
      hideAppointmentTypeTreeSubtreeOptimistically({
        appointmentTypeLineageKeys: deletedAppointmentTypeLineageKeys,
        folderLineageKeys: deletedFolderLineageKeys,
      });
      const result = await deleteAppointmentTypeFolderMutation({
        folderId: folder._id,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
      const removeDeletedSubtreeRefs = () => {
        for (const snapshot of appointmentTypeSnapshots) {
          const currentAppointmentType = appointmentTypesRef.current.find(
            (appointmentType) =>
              appointmentType.lineageKey === snapshot.lineageKey,
          );
          if (currentAppointmentType) {
            removeAppointmentTypeFromRef({
              id: currentAppointmentType._id,
              lineageKey: snapshot.lineageKey,
            });
          }
        }
        for (const snapshot of folderSnapshots) {
          const currentFolder = appointmentTypeFoldersRef.current.find(
            (candidate) => candidate.lineageKey === snapshot.lineageKey,
          );
          if (currentFolder) {
            removeAppointmentTypeFolderFromRef({
              id: currentFolder._id,
              lineageKey: snapshot.lineageKey,
            });
          }
        }
      };
      removeDeletedSubtreeRefs();
      const deletedSubtreeSnapshot = encodeRuleSetSnapshot({
        appointmentTypes: appointmentTypeSnapshots,
        folders: folderSnapshots,
        rootFolderLineageKey,
      });
      const command = createRuleSetSnapshotCommand({
        kind: "appointmentType.delete",
        label: "Ordner gelöscht",
        snapshots: {
          before: deletedSubtreeSnapshot,
        },
        target: {
          entityId: result.entityId,
          lineageKey: rootFolderLineageKey,
        },
      });
      recordAppointmentTypeFolderSubtreeReplayCommand(
        onRecordCommand,
        command,
        {
          clearOptimisticRestore: clearAppointmentTypeTreeOptimisticRestore,
          deleteFolder: async (folderId) => {
            const deleteResult = await deleteAppointmentTypeFolderMutation({
              folderId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(deleteResult);
            return { entityId: deleteResult.entityId };
          },
          hideSubtreeOptimistically:
            hideAppointmentTypeTreeSubtreeOptimistically,
          initialFolderId: result.entityId,
          isMissingEntityError,
          removeSubtreeRefs: removeDeletedSubtreeRefs,
          restoreSubtree: async () => {
            const resolvedPractitionerIdsByAppointmentTypeLineage = new Map<
              AppointmentTypeLineageKey,
              Id<"practitioners">[]
            >();
            for (const snapshot of appointmentTypeSnapshots) {
              if (
                appointmentTypesRef.current.some(
                  (appointmentType) =>
                    appointmentType.lineageKey !== snapshot.lineageKey &&
                    appointmentType.name === snapshot.name,
                )
              ) {
                return {
                  message: `[HISTORY:APPOINTMENT_TYPE_NAME_CONFLICT] Die Terminart kann nicht wiederhergestellt werden, weil bereits eine andere Terminart mit dem Namen "${snapshot.name}" existiert.`,
                  status: "conflict" as const,
                };
              }
              const existingByLineage = appointmentTypesRef.current.find(
                (appointmentType) =>
                  appointmentType.lineageKey === snapshot.lineageKey,
              );
              if (
                existingByLineage &&
                (existingByLineage.name !== snapshot.name ||
                  existingByLineage.duration !== snapshot.duration ||
                  serializeAppointmentPlan(
                    existingByLineage.appointmentPlan?.steps,
                  ) !==
                    serializeAppointmentPlan(snapshot.appointmentPlan?.steps))
              ) {
                return {
                  message: `[HISTORY:APPOINTMENT_TYPE_LINEAGE_CONFLICT] Die Terminart mit lineageKey ${snapshot.lineageKey} existiert bereits, hat aber abweichende Einstellungen.`,
                  status: "conflict" as const,
                };
              }
              const resolvedPractitionerIds = practitionerIdsFromSnapshots(
                practitionersRef.current,
                snapshot.practitionerSnapshots,
              );
              if ("status" in resolvedPractitionerIds) {
                return resolvedPractitionerIds;
              }
              resolvedPractitionerIdsByAppointmentTypeLineage.set(
                snapshot.lineageKey,
                resolvedPractitionerIds.ids,
              );
            }

            const restoredFolderIds = new Map<
              AppointmentTypeFolderLineageKey,
              Id<"appointmentTypeFolders">
            >();
            const plannedFolderIds = new Map<
              AppointmentTypeFolderLineageKey,
              Id<"appointmentTypeFolders">
            >();
            const plannedFolders: AppointmentTypeFolder[] = [];
            const optimisticFolderIds = new Map<
              AppointmentTypeFolderLineageKey,
              Id<"appointmentTypeFolders">
            >();
            for (const snapshot of folderSnapshots) {
              optimisticFolderIds.set(snapshot.lineageKey, snapshot.lineageKey);
            }
            for (const snapshot of folderSnapshots) {
              const existingFolderByLineage =
                appointmentTypeFoldersRef.current.find(
                  (candidate) =>
                    getAppointmentTypeFolderLineageKey(candidate) ===
                    snapshot.lineageKey,
                );
              const parentFolderId =
                snapshot.parentLineageKey === undefined
                  ? undefined
                  : (plannedFolderIds.get(snapshot.parentLineageKey) ??
                    appointmentTypeFoldersRef.current.find(
                      (candidate) =>
                        getAppointmentTypeFolderLineageKey(candidate) ===
                        snapshot.parentLineageKey,
                    )?._id);
              if (
                snapshot.parentLineageKey !== undefined &&
                parentFolderId === undefined
              ) {
                return {
                  message: "Der Zielordner existiert nicht mehr.",
                  status: "conflict" as const,
                };
              }
              if (
                existingFolderByLineage !== undefined &&
                (existingFolderByLineage.name !== snapshot.name ||
                  existingFolderByLineage.parentFolderId !== parentFolderId)
              ) {
                return {
                  message: `[HISTORY:APPOINTMENT_TYPE_FOLDER_LINEAGE_CONFLICT] Der Ordner mit lineageKey ${snapshot.lineageKey} existiert bereits, hat aber abweichende Einstellungen.`,
                  status: "conflict" as const,
                };
              }
              if (
                hasTreeChildNameConflict({
                  appointmentTypes: appointmentTypesRef.current,
                  ...(existingFolderByLineage && {
                    excludeFolderId: existingFolderByLineage._id,
                  }),
                  folders: [
                    ...appointmentTypeFoldersRef.current,
                    ...plannedFolders,
                  ],
                  name: snapshot.name,
                  parentFolderId,
                })
              ) {
                return {
                  message: `In diesem Ordner existiert bereits ein Eintrag mit dem Namen "${snapshot.name}".`,
                  status: "conflict" as const,
                };
              }
              if (existingFolderByLineage === undefined) {
                plannedFolderIds.set(snapshot.lineageKey, snapshot.lineageKey);
                plannedFolders.push(
                  createAppointmentTypeFolderRefSnapshot({
                    id: snapshot.lineageKey,
                    lineageKey: snapshot.lineageKey,
                    name: snapshot.name,
                    parentFolderId,
                    ruleSetId,
                  }),
                );
              } else {
                plannedFolderIds.set(
                  snapshot.lineageKey,
                  existingFolderByLineage._id,
                );
              }
            }
            const optimisticFolders = folderSnapshots.map((snapshot) => {
              const parentFolderId =
                snapshot.parentLineageKey === undefined
                  ? undefined
                  : optimisticFolderIds.get(snapshot.parentLineageKey);
              return createAppointmentTypeFolderRefSnapshot({
                id: snapshot.lineageKey,
                lineageKey: snapshot.lineageKey,
                name: snapshot.name,
                parentFolderId,
                ruleSetId,
              });
            });
            const optimisticAppointmentTypes = appointmentTypeSnapshots.flatMap(
              (snapshot): AppointmentType[] => {
                const treeFolderId = optimisticFolderIds.get(
                  snapshot.treeFolderLineageKey,
                );
                const practitionerIds =
                  resolvedPractitionerIdsByAppointmentTypeLineage.get(
                    snapshot.lineageKey,
                  );
                if (
                  treeFolderId === undefined ||
                  practitionerIds === undefined
                ) {
                  return [];
                }
                return [
                  {
                    _creationTime: 0,
                    _id: asAppointmentTypeId(snapshot.lineageKey),
                    allowedPractitionerLineageKeys: toSnapshotLineageIds(
                      snapshot.practitionerSnapshots,
                    ),
                    appointmentPlan: snapshot.appointmentPlan ?? { steps: [] },
                    createdAt: 0n,
                    defaultOccupancy: snapshot.defaultOccupancy,
                    duration: snapshot.duration,
                    lastModified: 0n,
                    lineageKey: snapshot.lineageKey,
                    name: snapshot.name,
                    practiceId,
                    ruleSetId,
                    treeFolderId,
                  },
                ];
              },
            );
            restoreAppointmentTypeTreeSubtreeOptimistically({
              appointmentTypes: optimisticAppointmentTypes,
              folders: optimisticFolders,
            });
            try {
              let restoredRootFolderId = result.entityId;
              for (const snapshot of folderSnapshots) {
                const parentFolderId =
                  snapshot.parentLineageKey === undefined
                    ? undefined
                    : (restoredFolderIds.get(snapshot.parentLineageKey) ??
                      appointmentTypeFoldersRef.current.find(
                        (candidate) =>
                          getAppointmentTypeFolderLineageKey(candidate) ===
                          snapshot.parentLineageKey,
                      )?._id);
                const existingFolderByLineage =
                  appointmentTypeFoldersRef.current.find(
                    (candidate) =>
                      getAppointmentTypeFolderLineageKey(candidate) ===
                      snapshot.lineageKey,
                  );
                if (existingFolderByLineage !== undefined) {
                  restoredFolderIds.set(
                    snapshot.lineageKey,
                    existingFolderByLineage._id,
                  );
                  if (snapshot.lineageKey === rootFolderLineageKey) {
                    restoredRootFolderId = existingFolderByLineage._id;
                  }
                  continue;
                }
                const recreateResult =
                  await createAppointmentTypeFolderMutation({
                    lineageKey: snapshot.lineageKey,
                    name: snapshot.name,
                    practiceId,
                    ...createParentFolderArg(parentFolderId),
                    ...getCowMutationArgs(),
                  });
                handleDraftMutationResult(recreateResult);
                restoredFolderIds.set(
                  snapshot.lineageKey,
                  recreateResult.entityId,
                );
                upsertAppointmentTypeFolderRef(
                  createAppointmentTypeFolderRefSnapshot({
                    id: recreateResult.entityId,
                    lineageKey: snapshot.lineageKey,
                    name: snapshot.name,
                    parentFolderId,
                    ruleSetId: recreateResult.ruleSetId,
                  }),
                  { previousLineageKey: snapshot.lineageKey },
                );
                if (snapshot.lineageKey === rootFolderLineageKey) {
                  restoredRootFolderId = recreateResult.entityId;
                }
              }
              for (const snapshot of appointmentTypeSnapshots) {
                const treeFolderId = restoredFolderIds.get(
                  snapshot.treeFolderLineageKey,
                );
                if (treeFolderId === undefined) {
                  return {
                    message: "Der Zielordner existiert nicht mehr.",
                    status: "conflict" as const,
                  };
                }
                const practitionerIds =
                  resolvedPractitionerIdsByAppointmentTypeLineage.get(
                    snapshot.lineageKey,
                  );
                if (practitionerIds === undefined) {
                  return {
                    message:
                      "Die Terminart konnte nicht wiederhergestellt werden, weil ihre Behandler nicht aufgeloest werden konnten.",
                    status: "conflict" as const,
                  };
                }
                const recreateResult = await createAppointmentTypeMutation({
                  defaultOccupancy: snapshot.defaultOccupancy,
                  duration: snapshot.duration,
                  lineageKey: snapshot.lineageKey,
                  name: snapshot.name,
                  practiceId,
                  practitionerIds,
                  treeFolderId,
                  ...getCowMutationArgs(),
                  ...createAppointmentPlanCreateArgs(
                    snapshot.appointmentPlan?.steps,
                  ),
                });
                handleDraftMutationResult(recreateResult);
                upsertAppointmentTypeRef({
                  _creationTime: 0,
                  _id: asAppointmentTypeId(recreateResult.entityId),
                  allowedPractitionerLineageKeys: toSnapshotLineageIds(
                    snapshot.practitionerSnapshots,
                  ),
                  appointmentPlan: snapshot.appointmentPlan ?? { steps: [] },
                  createdAt: 0n,
                  defaultOccupancy: snapshot.defaultOccupancy,
                  duration: snapshot.duration,
                  lastModified: 0n,
                  lineageKey: snapshot.lineageKey,
                  name: snapshot.name,
                  practiceId,
                  ruleSetId: recreateResult.ruleSetId,
                  treeFolderId,
                });
              }
              return {
                restoredRootFolderId,
                status: "applied" as const,
              };
            } catch (error: unknown) {
              clearAppointmentTypeTreeOptimisticRestore();
              return {
                message:
                  error instanceof Error
                    ? error.message
                    : "Der Ordner konnte nicht wiederhergestellt werden.",
                status: "conflict" as const,
              };
            }
          },
          subtree: {
            appointmentTypeLineageKeys: deletedAppointmentTypeLineageKeys,
            folderLineageKeys: deletedFolderLineageKeys,
          },
        },
      );
      toast.success("Ordner gelöscht", {
        description: `Ordner "${folder.name}" wurde gelöscht.`,
      });
    } catch (error: unknown) {
      clearAppointmentTypeTreeOptimisticRestore();
      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  }

  async function handleTreeDrop(event: FileTreeDropResult) {
    const [draggedPath] = event.draggedPaths;
    if (!draggedPath) {
      return;
    }

    const currentTreeModel = treeModelRef.current;
    const draggedItem = currentTreeModel.itemByPath.get(
      normalizeTreeLookupPath(draggedPath) ?? "",
    );
    const targetPath = normalizeTreeLookupPath(
      event.target.directoryPath ?? event.target.hoveredPath,
    );
    const targetItem =
      targetPath === undefined || targetPath === currentTreeModel.rootPath
        ? undefined
        : currentTreeModel.itemByPath.get(targetPath);
    const parentFolderId =
      targetItem?.kind === "folder" ? targetItem.id : undefined;

    try {
      if (draggedItem?.kind === "appointmentType") {
        const appointmentType = draggedItem.appointmentType;
        const appointmentTypeLineageKey = appointmentType.lineageKey;
        const previousFolder = appointmentType.treeFolderId
          ? appointmentTypeFoldersRef.current.find(
              (folder) => folder._id === appointmentType.treeFolderId,
            )
          : undefined;
        const previousFolderTarget =
          createAppointmentTypeFolderHistoryTarget(previousFolder);
        const targetFolderTarget = createAppointmentTypeFolderHistoryTarget(
          targetItem?.kind === "folder" ? targetItem.folder : undefined,
        );
        const result = await moveAppointmentTypeToFolderMutation({
          appointmentTypeId: appointmentType._id,
          practiceId,
          ...createTreeFolderMoveArg(parentFolderId),
          ...getCowMutationArgs(),
        });
        handleDraftMutationResult(result);
        upsertAppointmentTypeRef(
          createMovedAppointmentTypeRefSnapshot({
            appointmentType,
            id: result.entityId,
            ruleSetId: result.ruleSetId,
            treeFolderId: parentFolderId,
          }),
          { previousLineageKey: appointmentTypeLineageKey },
        );
        const previousMoveSnapshot = encodeRuleSetSnapshot({
          lineageKey: appointmentTypeLineageKey,
          parent: previousFolderTarget,
        });
        const targetMoveSnapshot = encodeRuleSetSnapshot({
          lineageKey: appointmentTypeLineageKey,
          parent: targetFolderTarget,
        });
        recordLineageUpdateRuleSetCommand({
          entitiesRef: appointmentTypesRef,
          initialEntityId: result.entityId,
          kind: "appointmentType.move",
          label: "Terminart verschoben",
          lineageKey: appointmentTypeLineageKey,
          onRecordCommand,
          redoMissingMessage:
            "Die Terminart wurde bereits gelöscht und kann nicht erneut verschoben werden.",
          runRedo: async (currentAppointmentTypeId) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(targetFolderTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget;
            }
            const redoResult = await moveAppointmentTypeToFolderMutation({
              appointmentTypeId: currentAppointmentTypeId,
              practiceId,
              ...createTreeFolderMoveArg(resolvedTarget.folderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
            upsertAppointmentTypeRef(
              createMovedAppointmentTypeRefSnapshot({
                appointmentType,
                id: redoResult.entityId,
                ruleSetId: redoResult.ruleSetId,
                treeFolderId: resolvedTarget.folderId,
              }),
              { previousLineageKey: appointmentTypeLineageKey },
            );
            return { entityId: redoResult.entityId };
          },
          runUndo: async (currentAppointmentTypeId) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(previousFolderTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget;
            }
            const undoResult = await moveAppointmentTypeToFolderMutation({
              appointmentTypeId: currentAppointmentTypeId,
              practiceId,
              ...createTreeFolderMoveArg(resolvedTarget.folderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            upsertAppointmentTypeRef(
              createMovedAppointmentTypeRefSnapshot({
                appointmentType,
                id: undoResult.entityId,
                ruleSetId: undoResult.ruleSetId,
                treeFolderId: resolvedTarget.folderId,
              }),
              { previousLineageKey: appointmentTypeLineageKey },
            );
            return { entityId: undoResult.entityId };
          },
          snapshots: {
            after: targetMoveSnapshot,
            before: previousMoveSnapshot,
          },
          undoMissingMessage:
            "Die Terminart wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
          validateRedo: (current) => {
            const resolvedPreviousTarget =
              resolveFolderHistoryTarget(previousFolderTarget);
            if (resolvedPreviousTarget.status === "conflict") {
              return resolvedPreviousTarget.message;
            }
            if (current.treeFolderId !== resolvedPreviousTarget.folderId) {
              return "Die Terminart wurde zwischenzeitlich verschoben und kann nicht erneut angewendet werden.";
            }
            const validation = validateTreeChildNameForHistoryTarget({
              excludeAppointmentTypeId: current._id,
              name: current.name,
              target: targetFolderTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
          },
          validateUndo: (current) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(targetFolderTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget.message;
            }
            if (current.treeFolderId !== resolvedTarget.folderId) {
              return "Die Terminart wurde zwischenzeitlich verschoben und kann nicht zurückgesetzt werden.";
            }
            const validation = validateTreeChildNameForHistoryTarget({
              excludeAppointmentTypeId: current._id,
              name: current.name,
              target: previousFolderTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
          },
        });
        return;
      }

      if (draggedItem?.kind === "folder") {
        const folder = draggedItem.folder;
        const folderLineageKey = getAppointmentTypeFolderLineageKey(folder);
        const previousParentFolder = folder.parentFolderId
          ? appointmentTypeFoldersRef.current.find(
              (candidate) => candidate._id === folder.parentFolderId,
            )
          : undefined;
        const previousParentTarget =
          createAppointmentTypeFolderHistoryTarget(previousParentFolder);
        const targetParentTarget = createAppointmentTypeFolderHistoryTarget(
          targetItem?.kind === "folder" ? targetItem.folder : undefined,
        );
        const result = await updateAppointmentTypeFolderMutation({
          folderId: folder._id,
          practiceId,
          ...createParentFolderMoveArg(parentFolderId),
          ...getCowMutationArgs(),
        });
        handleDraftMutationResult(result);
        upsertAppointmentTypeFolderRef(
          createAppointmentTypeFolderRefSnapshot({
            id: result.entityId,
            lineageKey: folderLineageKey,
            name: folder.name,
            parentFolderId,
            ruleSetId: result.ruleSetId,
          }),
          { previousLineageKey: folderLineageKey },
        );
        const previousFolderMoveSnapshot = encodeRuleSetSnapshot({
          lineageKey: folderLineageKey,
          parent: previousParentTarget,
        });
        const targetFolderMoveSnapshot = encodeRuleSetSnapshot({
          lineageKey: folderLineageKey,
          parent: targetParentTarget,
        });
        recordLineageUpdateRuleSetCommand({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          kind: "appointmentType.move",
          label: "Ordner verschoben",
          lineageKey: folderLineageKey,
          onRecordCommand,
          redoMissingMessage:
            "Der Ordner wurde bereits gelöscht und kann nicht erneut verschoben werden.",
          runRedo: async (currentFolderId) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(targetParentTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget;
            }
            const redoResult = await updateAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              practiceId,
              ...createParentFolderMoveArg(resolvedTarget.folderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
            upsertAppointmentTypeFolderRef(
              createAppointmentTypeFolderRefSnapshot({
                id: redoResult.entityId,
                lineageKey: folderLineageKey,
                name: folder.name,
                parentFolderId: resolvedTarget.folderId,
                ruleSetId: redoResult.ruleSetId,
              }),
              { previousLineageKey: folderLineageKey },
            );
            return { entityId: redoResult.entityId };
          },
          runUndo: async (currentFolderId) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(previousParentTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget;
            }
            const undoResult = await updateAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              practiceId,
              ...createParentFolderMoveArg(resolvedTarget.folderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            upsertAppointmentTypeFolderRef(
              createAppointmentTypeFolderRefSnapshot({
                id: undoResult.entityId,
                lineageKey: folderLineageKey,
                name: folder.name,
                parentFolderId: resolvedTarget.folderId,
                ruleSetId: undoResult.ruleSetId,
              }),
              { previousLineageKey: folderLineageKey },
            );
            return { entityId: undoResult.entityId };
          },
          snapshots: {
            after: targetFolderMoveSnapshot,
            before: previousFolderMoveSnapshot,
          },
          undoMissingMessage:
            "Der Ordner wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
          validateRedo: (current) => {
            const resolvedPreviousTarget =
              resolveFolderHistoryTarget(previousParentTarget);
            if (resolvedPreviousTarget.status === "conflict") {
              return resolvedPreviousTarget.message;
            }
            if (current.parentFolderId !== resolvedPreviousTarget.folderId) {
              return "Der Ordner wurde zwischenzeitlich verschoben und kann nicht erneut angewendet werden.";
            }
            const validation = validateTreeChildNameForHistoryTarget({
              excludeFolderId: current._id,
              name: current.name,
              target: targetParentTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
          },
          validateUndo: (current) => {
            const resolvedTarget =
              resolveFolderHistoryTarget(targetParentTarget);
            if (resolvedTarget.status === "conflict") {
              return resolvedTarget.message;
            }
            if (current.parentFolderId !== resolvedTarget.folderId) {
              return "Der Ordner wurde zwischenzeitlich verschoben und kann nicht zurückgesetzt werden.";
            }
            const validation = validateTreeChildNameForHistoryTarget({
              excludeFolderId: current._id,
              name: current.name,
              target: previousParentTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
          },
        });
      }
    } catch (error: unknown) {
      toast.error("Verschieben fehlgeschlagen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  }

  const handleDelete = async (appointmentType: AppointmentType) => {
    try {
      const deletedSnapshot = {
        appointmentPlan: appointmentType.appointmentPlan,
        defaultOccupancy: appointmentType.defaultOccupancy ?? {
          kind: "selectedPractitioner",
        },
        duration: appointmentType.duration,
        lineageKey: appointmentType.lineageKey,
        name: appointmentType.name,
        practitionerLineageKeys:
          appointmentType.allowedPractitionerLineageKeys.map((lineageKey) =>
            asPractitionerLineageKey(lineageKey),
          ),
        treeFolderId: appointmentType.treeFolderId,
      };
      const deletedPractitionerSnapshots = createPractitionerSnapshots(
        deletedSnapshot.practitionerLineageKeys
          .map((lineageKey) => resolvePractitionerIdForLineage(lineageKey))
          .flatMap((practitionerId) =>
            practitionerId === undefined ? [] : [practitionerId],
          ),
      );
      const deletedFolderTarget = createAppointmentTypeFolderHistoryTarget(
        appointmentType.treeFolderId === undefined
          ? undefined
          : appointmentTypeFoldersRef.current.find(
              (folder) => folder._id === appointmentType.treeFolderId,
            ),
      );

      const deleteResult = await deleteAppointmentTypeMutation({
        appointmentTypeId: appointmentType._id,
        appointmentTypeLineageKey: deletedSnapshot.lineageKey,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(deleteResult);
      removeAppointmentTypeFromRef({
        id: appointmentType._id,
        lineageKey: deletedSnapshot.lineageKey,
      });

      const deletedAppointmentTypeSnapshot = encodeRuleSetSnapshot({
        ...deletedSnapshot,
        practitionerSnapshots: deletedPractitionerSnapshots,
      });

      const command = createRuleSetSnapshotCommand({
        kind: "appointmentType.delete",
        label: "Terminart gelöscht",
        snapshots: {
          before: deletedAppointmentTypeSnapshot,
        },
        target: {
          entityId: appointmentType._id,
          lineageKey: deletedSnapshot.lineageKey,
        },
      });
      recordAppointmentTypeDeleteReplayCommand(onRecordCommand, command, {
        createAppointmentType: async (
          snapshot,
          practitionerIds,
          treeFolderId: Id<"appointmentTypeFolders"> | null,
        ) => {
          const recreateResult = await createAppointmentTypeMutation({
            defaultOccupancy: snapshot.defaultOccupancy,
            duration: snapshot.duration,
            lineageKey: snapshot.lineageKey,
            name: snapshot.name,
            practiceId,
            practitionerIds,
            treeFolderId,
            ...getCowMutationArgs(),
            ...createAppointmentPlanCreateArgs(snapshot.appointmentPlan?.steps),
          });
          handleDraftMutationResult(recreateResult);
          return {
            entityId: asAppointmentTypeId(recreateResult.entityId),
            ruleSetId: recreateResult.ruleSetId,
          };
        },
        deleteAppointmentType: async (args) => {
          const redoResult = await deleteAppointmentTypeMutation({
            appointmentTypeId: args.appointmentTypeId,
            appointmentTypeLineageKey: args.appointmentTypeLineageKey,
            practiceId,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(redoResult);
        },
        findExistingByLineage: (lineageKey, selectedRuleSetId) =>
          appointmentTypesRef.current.find(
            (type) =>
              type.lineageKey === lineageKey &&
              type.ruleSetId === selectedRuleSetId,
          ),
        initialEntityId: appointmentType._id,
        isMissingEntityError,
        isSameDefinition: (existingByLineage, snapshot) => {
          const resolvedFolder =
            resolveFolderHistoryTarget(deletedFolderTarget);
          if (resolvedFolder.status === "conflict") {
            return false;
          }
          const existingPractitionerLineageIds =
            existingByLineage.allowedPractitionerLineageKeys
              .map((lineageKey) => asPractitionerLineageKey(lineageKey))
              .toSorted();
          const deletedPractitionerLineageIds = toSnapshotLineageIds(
            deletedPractitionerSnapshots,
          );
          return (
            existingByLineage.name === snapshot.name &&
            existingByLineage.treeFolderId === resolvedFolder.folderId &&
            existingByLineage.duration === snapshot.duration &&
            serializeAppointmentPlan(
              existingByLineage.appointmentPlan?.steps,
            ) === serializeAppointmentPlan(snapshot.appointmentPlan?.steps) &&
            samePractitionerLineageIds(
              existingPractitionerLineageIds,
              deletedPractitionerLineageIds,
            )
          );
        },
        lineageKey: deletedSnapshot.lineageKey,
        removeRestoredRef: (args) => {
          removeAppointmentTypeFromRef({
            id: args.appointmentTypeId,
            lineageKey: args.appointmentTypeLineageKey,
          });
        },
        resolvePractitionerIds: () => {
          const resolvedUndoPractitionerIds = practitionerIdsFromSnapshots(
            practitionersRef.current,
            deletedPractitionerSnapshots,
          );
          if ("status" in resolvedUndoPractitionerIds) {
            return resolvedUndoPractitionerIds;
          }
          return {
            ids: resolvedUndoPractitionerIds.ids,
            status: "ok",
          };
        },
        resolveTreeFolderId: () => {
          const resolvedFolder =
            resolveFolderHistoryTarget(deletedFolderTarget);
          if (resolvedFolder.status === "conflict") {
            return resolvedFolder;
          }
          return { folderId: resolvedFolder.folderId ?? null, status: "ok" };
        },
        selectedRuleSetId: () => getCowMutationArgs().selectedRuleSetId,
        snapshot: deletedSnapshot,
        toRestoredRef: (
          snapshot,
          recreateResult,
          treeFolderId: Id<"appointmentTypeFolders"> | null,
        ) => ({
          _creationTime: 0,
          _id: recreateResult.entityId,
          allowedPractitionerLineageKeys: toSnapshotLineageIds(
            deletedPractitionerSnapshots,
          ),
          appointmentPlan: snapshot.appointmentPlan ?? { steps: [] },
          createdAt: 0n,
          defaultOccupancy: snapshot.defaultOccupancy,
          duration: snapshot.duration,
          lastModified: 0n,
          lineageKey: snapshot.lineageKey,
          name: snapshot.name,
          practiceId,
          ruleSetId: recreateResult.ruleSetId,
          ...(treeFolderId ? { treeFolderId } : {}),
        }),
        upsertRestoredRef: upsertAppointmentTypeRef,
      });

      toast.success("Terminart gelöscht", {
        description: `Terminart "${appointmentType.name}" wurde erfolgreich gelöscht.`,
      });
    } catch (error: unknown) {
      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package2 className="h-5 w-5" />
            <div>
              <CardTitle>Terminarten</CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Ordner hinzufügen"
                  onClick={() => {
                    openCreateFolderDialog(selectedTreeFolderId);
                  }}
                  size="icon"
                  variant="outline"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ordner hinzufügen</TooltipContent>
            </Tooltip>
            <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  aria-label="Terminart hinzufügen"
                  onClick={() => {
                    openCreateDialog(selectedTreeFolderId);
                  }}
                  size="icon"
                  variant="outline"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden">
                <DialogHeader>
                  <DialogTitle>
                    {editingAppointmentType
                      ? "Terminart bearbeiten"
                      : "Neue Terminart hinzufügen"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingAppointmentType
                      ? "Bearbeiten Sie die Terminart."
                      : "Erstellen Sie eine neue Terminart mit Namen und Dauer."}
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="flex max-h-full flex-col overflow-hidden"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit();
                  }}
                >
                  <div className="flex-1 overflow-y-auto pr-2">
                    <FieldGroup>
                      <form.Field name="name">
                        {(field) => {
                          const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;

                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor="appointment-type-name">
                                Name der Terminart
                              </FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                autoFocus
                                id="appointment-type-name"
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                  field.handleChange(e.target.value);
                                }}
                                placeholder="z.B. Erstgespräch, Kontrolltermin"
                                value={field.state.value}
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </Field>
                          );
                        }}
                      </form.Field>

                      <form.Field name="duration">
                        {(field) => {
                          const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;

                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor="appointment-type-duration">
                                Dauer (in Minuten)
                              </FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                id="appointment-type-duration"
                                max={480}
                                min={5}
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                  field.handleChange(
                                    parseNumberInput(
                                      e.target.valueAsNumber,
                                      field.state.value,
                                    ),
                                  );
                                }}
                                placeholder="30"
                                step={5}
                                type="number"
                                value={field.state.value}
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </Field>
                          );
                        }}
                      </form.Field>

                      <form.Field name="defaultOccupancyKind">
                        {(field) => (
                          <Field>
                            <FieldLabel>Standard-Belegung</FieldLabel>
                            <Select
                              onValueChange={(value) => {
                                field.handleChange(
                                  normalizeDefaultOccupancyKindSelection(value),
                                );
                              }}
                              value={field.state.value}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="selectedPractitioner">
                                  Gewählter Behandler
                                </SelectItem>
                                <SelectItem value="resource-ekg">
                                  EKG
                                </SelectItem>
                                <SelectItem value="resource-labor">
                                  Labor
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                        )}
                      </form.Field>

                      <form.Field mode="array" name="appointmentPlan">
                        {(field) => {
                          const availableTargets = appointmentTypes.filter(
                            (appointmentType) =>
                              appointmentType.lineageKey !==
                              editingAppointmentType?.lineageKey,
                          );

                          return (
                            <FieldSet>
                              <FieldLegend variant="label">
                                Kettentermine
                              </FieldLegend>
                              <div className="space-y-3">
                                {field.state.value.length === 0 ? (
                                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                    Keine Kettentermine konfiguriert.
                                  </div>
                                ) : (
                                  field.state.value.map((step, index) => {
                                    const selectedTargetExists =
                                      availableTargets.some(
                                        (appointmentType) =>
                                          appointmentType.lineageKey ===
                                          step.appointmentTypeLineageKey,
                                      );

                                    return (
                                      <form.Field
                                        key={`${index}-${step.appointmentTypeLineageKey}`}
                                        name={
                                          `appointmentPlan[${index}]` as const
                                        }
                                      >
                                        {(itemField) => (
                                          <div className="rounded-lg border p-4 space-y-4">
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="text-sm font-medium">
                                                Schritt {index + 1}
                                              </div>
                                              <div className="flex gap-1">
                                                <Button
                                                  disabled={index === 0}
                                                  onClick={() => {
                                                    if (index === 0) {
                                                      return;
                                                    }
                                                    const current =
                                                      itemField.state.value;
                                                    const previous =
                                                      field.state.value[
                                                        index - 1
                                                      ];
                                                    if (!previous) {
                                                      return;
                                                    }
                                                    itemField.handleChange(
                                                      previous,
                                                    );
                                                    field.replaceValue(
                                                      index - 1,
                                                      current,
                                                    );
                                                  }}
                                                  size="icon"
                                                  type="button"
                                                  variant="ghost"
                                                >
                                                  <ArrowUp className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                  disabled={
                                                    index ===
                                                    field.state.value.length - 1
                                                  }
                                                  onClick={() => {
                                                    const current =
                                                      itemField.state.value;
                                                    const next =
                                                      field.state.value[
                                                        index + 1
                                                      ];
                                                    if (!next) {
                                                      return;
                                                    }
                                                    itemField.handleChange(
                                                      next,
                                                    );
                                                    field.replaceValue(
                                                      index + 1,
                                                      current,
                                                    );
                                                  }}
                                                  size="icon"
                                                  type="button"
                                                  variant="ghost"
                                                >
                                                  <ArrowDown className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                  onClick={() => {
                                                    field.removeValue(index);
                                                  }}
                                                  size="icon"
                                                  type="button"
                                                  variant="ghost"
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </div>
                                            </div>

                                            <div className="grid gap-4 md:grid-cols-5">
                                              <Field>
                                                <FieldLabel>
                                                  Terminart
                                                </FieldLabel>
                                                <Select
                                                  onValueChange={(value) => {
                                                    const selectedAppointmentType =
                                                      availableTargets.find(
                                                        (appointmentType) =>
                                                          appointmentType.lineageKey ===
                                                          value,
                                                      );
                                                    itemField.handleChange({
                                                      ...itemField.state.value,
                                                      appointmentTypeLineageKey:
                                                        selectedAppointmentType?.lineageKey ??
                                                        "",
                                                    });
                                                  }}
                                                  {...(selectedTargetExists
                                                    ? {
                                                        value:
                                                          itemField.state.value
                                                            .appointmentTypeLineageKey,
                                                      }
                                                    : {})}
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue placeholder="Terminart wählen" />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {availableTargets.map(
                                                      (appointmentType) => (
                                                        <SelectItem
                                                          key={
                                                            appointmentType.lineageKey
                                                          }
                                                          value={
                                                            appointmentType.lineageKey
                                                          }
                                                        >
                                                          {appointmentType.name}
                                                        </SelectItem>
                                                      ),
                                                    )}
                                                  </SelectContent>
                                                </Select>
                                              </Field>

                                              <Field>
                                                <FieldLabel>Timing</FieldLabel>
                                                <Select
                                                  onValueChange={(value) => {
                                                    const timingKind =
                                                      parseAppointmentPlanTimingKind(
                                                        value,
                                                      );
                                                    if (!timingKind) {
                                                      return;
                                                    }
                                                    itemField.handleChange({
                                                      ...itemField.state.value,
                                                      offsetUnit:
                                                        timingKind ===
                                                          "firstAvailableOnOrAfter" &&
                                                        itemField.state.value
                                                          .offsetUnit ===
                                                          "minutes"
                                                          ? "days"
                                                          : itemField.state
                                                              .value.offsetUnit,
                                                      timingKind,
                                                    });
                                                  }}
                                                  value={
                                                    itemField.state.value
                                                      .timingKind
                                                  }
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="afterPreviousEnd">
                                                      Danach
                                                    </SelectItem>
                                                    <SelectItem value="beforeRootStart">
                                                      Vorher
                                                    </SelectItem>
                                                    <SelectItem value="sameStartAs">
                                                      Gleichzeitig
                                                    </SelectItem>
                                                    <SelectItem value="firstAvailableOnOrAfter">
                                                      Später
                                                    </SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </Field>

                                              {(itemField.state.value
                                                .timingKind === "sameStartAs" ||
                                                itemField.state.value
                                                  .timingKind ===
                                                  "firstAvailableOnOrAfter") && (
                                                <Field>
                                                  <FieldLabel>Anker</FieldLabel>
                                                  <Select
                                                    onValueChange={(value) => {
                                                      itemField.handleChange({
                                                        ...itemField.state
                                                          .value,
                                                        anchorStepId: value,
                                                      });
                                                    }}
                                                    value={
                                                      itemField.state.value
                                                        .anchorStepId
                                                    }
                                                  >
                                                    <SelectTrigger>
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      <SelectItem value="root">
                                                        Starttermin
                                                      </SelectItem>
                                                      {field.state.value
                                                        .slice(0, index)
                                                        .map(
                                                          (_, anchorIndex) => (
                                                            <SelectItem
                                                              key={anchorIndex}
                                                              value={`step-${
                                                                anchorIndex + 1
                                                              }`}
                                                            >
                                                              Schritt{" "}
                                                              {anchorIndex + 1}
                                                            </SelectItem>
                                                          ),
                                                        )}
                                                    </SelectContent>
                                                  </Select>
                                                </Field>
                                              )}

                                              <Field>
                                                <FieldLabel>Versatz</FieldLabel>
                                                <Input
                                                  disabled={
                                                    itemField.state.value
                                                      .timingKind ===
                                                    "sameStartAs"
                                                  }
                                                  min={
                                                    itemField.state.value
                                                      .offsetUnit === "minutes"
                                                      ? 0
                                                      : 1
                                                  }
                                                  onBlur={(e) => {
                                                    const normalizedOffsetValue =
                                                      normalizeAppointmentPlanOffsetValue(
                                                        itemField.state.value
                                                          .offsetUnit,
                                                        parseNumberInput(
                                                          e.target
                                                            .valueAsNumber,
                                                          itemField.state.value
                                                            .offsetValue,
                                                        ),
                                                      );

                                                    if (
                                                      normalizedOffsetValue !==
                                                      itemField.state.value
                                                        .offsetValue
                                                    ) {
                                                      itemField.handleChange({
                                                        ...itemField.state
                                                          .value,
                                                        offsetValue:
                                                          normalizedOffsetValue,
                                                      });
                                                    }
                                                  }}
                                                  onChange={(e) => {
                                                    const rawValue =
                                                      parseNumberInput(
                                                        e.target.valueAsNumber,
                                                        itemField.state.value
                                                          .offsetValue,
                                                      );
                                                    itemField.handleChange({
                                                      ...itemField.state.value,
                                                      offsetValue: rawValue,
                                                    });
                                                  }}
                                                  step={
                                                    itemField.state.value
                                                      .offsetUnit === "minutes"
                                                      ? 5
                                                      : 1
                                                  }
                                                  type="number"
                                                  value={
                                                    itemField.state.value
                                                      .offsetValue
                                                  }
                                                />
                                              </Field>

                                              <Field>
                                                <FieldLabel>Einheit</FieldLabel>
                                                <Select
                                                  disabled={
                                                    itemField.state.value
                                                      .timingKind ===
                                                    "sameStartAs"
                                                  }
                                                  onValueChange={(value) => {
                                                    const nextOffsetUnit =
                                                      parseAppointmentPlanOffsetUnit(
                                                        value,
                                                      );
                                                    if (!nextOffsetUnit) {
                                                      return;
                                                    }
                                                    itemField.handleChange({
                                                      ...itemField.state.value,
                                                      offsetUnit:
                                                        nextOffsetUnit,
                                                      offsetValue:
                                                        normalizeAppointmentPlanOffsetValue(
                                                          nextOffsetUnit,
                                                          itemField.state.value
                                                            .offsetValue,
                                                        ),
                                                    });
                                                  }}
                                                  value={
                                                    itemField.state.value
                                                      .offsetUnit
                                                  }
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {itemField.state.value
                                                      .timingKind !==
                                                      "firstAvailableOnOrAfter" && (
                                                      <SelectItem value="minutes">
                                                        Minuten
                                                      </SelectItem>
                                                    )}
                                                    <SelectItem value="days">
                                                      Tage
                                                    </SelectItem>
                                                    <SelectItem value="weeks">
                                                      Wochen
                                                    </SelectItem>
                                                    <SelectItem value="months">
                                                      Monate
                                                    </SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </Field>

                                              <Field>
                                                <FieldLabel>
                                                  Belegung
                                                </FieldLabel>
                                                <Select
                                                  onValueChange={(value) => {
                                                    itemField.handleChange({
                                                      ...itemField.state.value,
                                                      occupancyKind:
                                                        normalizeAppointmentPlanOccupancyKindSelection(
                                                          value,
                                                        ),
                                                    });
                                                  }}
                                                  value={
                                                    itemField.state.value
                                                      .occupancyKind
                                                  }
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="inheritRootPractitioner">
                                                      Start-Behandler
                                                    </SelectItem>
                                                    <SelectItem value="resource-ekg">
                                                      EKG
                                                    </SelectItem>
                                                    <SelectItem value="resource-labor">
                                                      Labor
                                                    </SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </Field>
                                            </div>
                                          </div>
                                        )}
                                      </form.Field>
                                    );
                                  })
                                )}

                                <Button
                                  onClick={() => {
                                    field.pushValue(
                                      createEmptyAppointmentPlanStep(),
                                    );
                                  }}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <Plus className="h-4 w-4 mr-2" />
                                  Kettentermin hinzufügen
                                </Button>
                              </div>
                              <FieldError errors={field.state.meta.errors} />
                            </FieldSet>
                          );
                        }}
                      </form.Field>

                      <form.Field mode="array" name="practitionerIds">
                        {(field) => {
                          const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;

                          return (
                            <FieldSet>
                              <FieldLegend variant="label">
                                Behandler auswählen
                              </FieldLegend>
                              <FieldDescription>
                                Wählen Sie die Behandler aus, die diese
                                Terminart anbieten.
                              </FieldDescription>
                              <FieldGroup
                                className="gap-3"
                                data-invalid={isInvalid}
                              >
                                {practitionersQuery === undefined ? (
                                  <div className="text-sm text-muted-foreground">
                                    Lade Behandler...
                                  </div>
                                ) : practitioners.length === 0 ? (
                                  <div className="text-sm text-muted-foreground">
                                    Keine Behandler verfügbar. Bitte erstellen
                                    Sie zuerst Behandler.
                                  </div>
                                ) : (
                                  practitioners.map((practitioner) => (
                                    <Field
                                      key={practitioner._id}
                                      orientation="horizontal"
                                    >
                                      <Checkbox
                                        aria-invalid={isInvalid}
                                        checked={field.state.value.includes(
                                          practitioner._id,
                                        )}
                                        id={`practitioner-${practitioner._id}`}
                                        onBlur={field.handleBlur}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            field.pushValue(practitioner._id);
                                          } else {
                                            const index =
                                              field.state.value.indexOf(
                                                practitioner._id,
                                              );
                                            if (index !== -1) {
                                              field.removeValue(index);
                                            }
                                          }
                                        }}
                                      />
                                      <FieldLabel
                                        className="font-normal"
                                        htmlFor={`practitioner-${practitioner._id}`}
                                      >
                                        {practitioner.name}
                                      </FieldLabel>
                                    </Field>
                                  ))
                                )}
                              </FieldGroup>
                              <FieldError errors={field.state.meta.errors} />
                            </FieldSet>
                          );
                        }}
                      </form.Field>
                    </FieldGroup>
                  </div>

                  <DialogFooter className="mt-6">
                    <Button
                      onClick={closeDialog}
                      type="button"
                      variant="outline"
                    >
                      Abbrechen
                    </Button>
                    <form.Subscribe
                      selector={(state) => [
                        state.canSubmit,
                        state.isSubmitting,
                      ]}
                    >
                      {([canSubmit, isSubmitting]) => (
                        <Button
                          disabled={!canSubmit || isSubmitting}
                          type="submit"
                        >
                          {isSubmitting
                            ? editingAppointmentType
                              ? "Aktualisiere..."
                              : "Erstelle..."
                            : editingAppointmentType
                              ? "Aktualisieren"
                              : "Erstellen"}
                        </Button>
                      )}
                    </form.Subscribe>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Dialog
            onOpenChange={(open) => {
              setIsFolderDialogOpen(open);
              if (!open) {
                setEditingAppointmentTypeFolder(null);
                setCreateFolderParentId(undefined);
                setCreateFolderName("");
              }
            }}
            open={isFolderDialogOpen}
          >
            <DialogContent className="sm:max-w-md">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmitFolder();
                }}
              >
                <DialogHeader>
                  <DialogTitle>
                    {editingAppointmentTypeFolder
                      ? "Ordner umbenennen"
                      : "Neuer Ordner"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingAppointmentTypeFolder
                      ? "Benennen Sie den Terminart-Ordner um."
                      : "Erstellen Sie einen Ordner für Terminarten."}
                  </DialogDescription>
                </DialogHeader>
                <Field className="mt-4">
                  <FieldLabel htmlFor="appointment-type-folder-name">
                    Ordnername
                  </FieldLabel>
                  <Input
                    autoFocus
                    id="appointment-type-folder-name"
                    onChange={(event) => {
                      setCreateFolderName(event.target.value);
                    }}
                    value={createFolderName}
                  />
                </Field>
                <DialogFooter className="mt-6">
                  <Button
                    onClick={() => {
                      setIsFolderDialogOpen(false);
                      setEditingAppointmentTypeFolder(null);
                      setCreateFolderParentId(undefined);
                      setCreateFolderName("");
                    }}
                    type="button"
                    variant="outline"
                  >
                    Abbrechen
                  </Button>
                  <Button type="submit">
                    {editingAppointmentTypeFolder ? "Umbenennen" : "Erstellen"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {appointmentTypesQuery === undefined ||
        appointmentTypeFoldersQuery === undefined ? (
          <div className="text-center py-4 text-muted-foreground">
            Lade Terminarten...
          </div>
        ) : appointmentTypes.length === 0 &&
          appointmentTypeFolders.length === 0 ? (
          <div className="text-center py-8">
            <Package2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <div className="text-muted-foreground">
              Noch keine Terminarten vorhanden
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {appointmentTypes.length} Terminarten in{" "}
              {appointmentTypeFolders.length} Ordnern
            </div>

            <div className="rounded-md border">
              <FileTree
                className="h-[420px] bg-card text-card-foreground"
                model={fileTree.model}
                renderContextMenu={(item: ContextMenuItem) => {
                  const itemPath = normalizeTreeLookupPath(item.path);
                  const treeItem = treeModel.itemByPath.get(itemPath ?? "");

                  return (
                    <div className="min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                      {treeItem?.kind === "folder" && (
                        <>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              openCreateDialog(treeItem.id);
                            }}
                            type="button"
                          >
                            <Plus className="h-4 w-4" />
                            Neue Terminart
                          </button>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              openCreateFolderDialog(treeItem.id);
                            }}
                            type="button"
                          >
                            <FolderPlus className="h-4 w-4" />
                            Neuer Ordner
                          </button>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              void handleDeleteFolder(treeItem.folder);
                            }}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                            Ordner löschen
                          </button>
                        </>
                      )}
                      {treeItem?.kind === "appointmentType" && (
                        <>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              openEditDialog(treeItem.appointmentType);
                            }}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                            Bearbeiten
                          </button>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              void handleDelete(treeItem.appointmentType);
                            }}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                            Löschen
                          </button>
                        </>
                      )}
                      {itemPath === treeModel.rootPath && (
                        <>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              openCreateDialog();
                            }}
                            type="button"
                          >
                            <Plus className="h-4 w-4" />
                            Neue Terminart
                          </button>
                          <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              openCreateFolderDialog();
                            }}
                            type="button"
                          >
                            <FolderPlus className="h-4 w-4" />
                            Neuer Ordner
                          </button>
                        </>
                      )}
                    </div>
                  );
                }}
                style={appointmentTreeStyle}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildAppointmentTreeModel(
  appointmentTypes: readonly AppointmentType[],
  folders: readonly AppointmentTypeFolder[],
): AppointmentTreeModel {
  const rootPath = "Terminarten";
  const itemByPath = new Map<string, AppointmentTreeItem>();
  const folderById = new Map(folders.map((folder) => [folder._id, folder]));
  const folderPathById = new Map<Id<"appointmentTypeFolders">, string>();

  const resolveFolderPath = (
    folder: AppointmentTypeFolder,
    activeIds: ReadonlySet<Id<"appointmentTypeFolders">> = new Set(),
  ): string => {
    const cached = folderPathById.get(folder._id);
    if (cached) {
      return cached;
    }

    if (activeIds.has(folder._id)) {
      const fallback = `${rootPath}/${createTreeSegment(folder.name)}`;
      folderPathById.set(folder._id, fallback);
      return fallback;
    }

    const parentFolder =
      folder.parentFolderId === undefined
        ? undefined
        : folderById.get(folder.parentFolderId);
    const parentPath = parentFolder
      ? resolveFolderPath(parentFolder, new Set([...activeIds, folder._id]))
      : rootPath;
    const path = `${parentPath}/${createTreeSegment(folder.name)}`;
    folderPathById.set(folder._id, path);
    return path;
  };

  const expandedPaths = [rootPath];
  const paths = [`${rootPath}/`];

  for (const folder of folders) {
    const path = resolveFolderPath(folder);
    expandedPaths.push(path);
    paths.push(`${path}/`);
    itemByPath.set(path, {
      folder,
      id: folder._id,
      kind: "folder",
    });
  }

  for (const appointmentType of appointmentTypes) {
    const parentPath =
      appointmentType.treeFolderId === undefined
        ? rootPath
        : (folderPathById.get(appointmentType.treeFolderId) ?? rootPath);
    const path = `${parentPath}/${createTreeSegment(appointmentType.name)}`;
    paths.push(path);
    itemByPath.set(path, {
      appointmentType,
      id: appointmentType._id,
      kind: "appointmentType",
    });
  }

  return {
    expandedPaths,
    itemByPath,
    paths: paths.toSorted(),
    rootPath,
  };
}
