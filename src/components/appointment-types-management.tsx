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

import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";

import { findIdInList } from "../utils/convex-ids";
import {
  ruleSetIdFromReplayTarget,
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import {
  registerLineageCreateHistoryAction,
  registerLineageUpdateHistoryAction,
} from "../utils/cow-history-actions";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import {
  findFrontendEntityByEntityId,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
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
type AppointmentTypeFolder = AppointmentTypeFolderQueryResult[number];
type AppointmentTypeFolderHistoryTarget =
  | { kind: "folder"; lineageKey: AppointmentTypeFolderLineageKey }
  | { kind: "root" };
type AppointmentTypeFolderLineageKey = Id<"appointmentTypeFolders">;
type AppointmentTypeFolderQueryResult =
  (typeof api.entities.getAppointmentTypeFolders)["_returnType"];
interface AppointmentTypeFormValues {
  duration: number;
  followUpPlan: FollowUpPlanFormStep[];
  name: string;
  practitionerIds: Id<"practitioners">[];
}
type AppointmentTypeQueryResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];
interface AppointmentTypesManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
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
  duration: number;
  followUpPlan: AppointmentType["followUpPlan"];
  lineageKey: AppointmentTypeLineageKey;
  name: string;
  practitionerSnapshots: PractitionerHistorySnapshot[];
  treeFolderLineageKey: AppointmentTypeFolderLineageKey;
}

interface FollowUpPlanFormStep {
  appointmentTypeLineageKey: FollowUpPlanTargetSelection;
  offsetUnit: FollowUpPlanOffsetUnit;
  offsetValue: number;
}
type FollowUpPlanOffsetUnit = FollowUpPlanStep["offsetUnit"];
type FollowUpPlanStep = NonNullable<AppointmentType["followUpPlan"]>[number];
type FollowUpPlanTargetSelection = "" | AppointmentTypeLineageKey;

type Practitioner = FrontendLineageEntity<
  "practitioners",
  PractitionerQueryResult[number]
>;

type PractitionerQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];

const defaultAppointmentTypeFormValues: AppointmentTypeFormValues = {
  duration: 30,
  followUpPlan: [],
  name: "",
  practitionerIds: [],
};

const createEmptyFollowUpStep = (): FollowUpPlanFormStep => ({
  appointmentTypeLineageKey: "",
  offsetUnit: "days",
  offsetValue: 1,
});

const getFollowUpSearchMode = (
  step: FollowUpPlanFormStep,
): FollowUpPlanStep["searchMode"] => {
  if (step.offsetUnit !== "minutes") {
    return "first_available_on_or_after";
  }

  return step.offsetValue === 0 ? "exact_after_previous" : "same_day";
};

const normalizeFollowUpPlanForSubmit = (
  steps: FollowUpPlanFormStep[],
): Result<FollowUpPlanStep[], string> => {
  if (steps.length === 0) {
    return ok([]);
  }

  return Result.combine(
    steps.map((step, index) =>
      resolveSelectedAppointmentTypeLineageKey(step).map(
        (appointmentTypeLineageKey) => ({
          appointmentTypeLineageKey,
          locationMode: "inherit" as const,
          offsetUnit: step.offsetUnit,
          offsetValue: normalizeFollowUpOffsetValue(
            step.offsetUnit,
            step.offsetValue,
          ),
          practitionerMode: "inherit" as const,
          required: true,
          searchMode: getFollowUpSearchMode(step),
          stepId: `step-${index + 1}`,
        }),
      ),
    ),
  );
};

const createFollowUpPlanCreateArgs = (
  followUpPlan: FollowUpPlanStep[] | undefined,
) => (followUpPlan === undefined ? {} : { followUpPlan });

const createFollowUpPlanUpdateArgs = (
  followUpPlan: FollowUpPlanStep[] | undefined,
) => ({ followUpPlan: followUpPlan ?? [] });

const parseNumberInput = (valueAsNumber: number, fallback = 0) =>
  Number.isNaN(valueAsNumber) ? fallback : valueAsNumber;

const normalizeFollowUpOffsetValue = (
  offsetUnit: FollowUpPlanFormStep["offsetUnit"],
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

const parseFollowUpOffsetUnit = (
  value: string,
): FollowUpPlanOffsetUnit | undefined => {
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

const normalizeFollowUpPlanForForm = (
  followUpPlan: FollowUpPlanStep[] | undefined,
): FollowUpPlanFormStep[] =>
  (followUpPlan ?? []).map((step) => ({
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      step.appointmentTypeLineageKey,
    ),
    offsetUnit: step.offsetUnit,
    offsetValue: normalizeFollowUpOffsetValue(
      step.offsetUnit,
      step.offsetValue,
    ),
  }));

const serializeFollowUpPlan = (steps: FollowUpPlanStep[] | undefined) =>
  JSON.stringify(
    (steps ?? []).map((step) => ({
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      locationMode: step.locationMode,
      note: step.note ?? null,
      offsetUnit: step.offsetUnit,
      offsetValue: step.offsetValue,
      practitionerMode: step.practitionerMode,
      required: step.required,
      searchMode: step.searchMode,
      stepId: step.stepId,
    })),
  );

interface PractitionerHistorySnapshot {
  lineageId: PractitionerLineageKey;
  name: string;
}

function createAppointmentTypeFormSchema(params: {
  appointmentTypeLineageKeys: readonly AppointmentTypeLineageKey[];
  practitionerIds: readonly Id<"practitioners">[];
}) {
  return z.object({
    duration: z
      .number()
      .min(5, "Dauer muss mindestens 5 Minuten betragen")
      .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
      .refine((val) => val % 5 === 0, {
        message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
      }),
    followUpPlan: z.array(
      createFollowUpStepSchema(params.appointmentTypeLineageKeys),
    ),
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
    .transform((value, ctx): FollowUpPlanTargetSelection | typeof z.NEVER => {
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
    });
}

function createFollowUpStepSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z
    .object({
      appointmentTypeLineageKey: createAppointmentTypeLineageSelectionSchema(
        availableLineageKeys,
      ).refine((value) => value !== "", "Bitte wählen Sie eine Terminart"),
      offsetUnit: z.enum(["minutes", "days", "weeks", "months"]),
      offsetValue: z.number().int("Der Versatz muss eine ganze Zahl sein"),
    })
    .superRefine((step, ctx) => {
      if (step.offsetUnit === "minutes") {
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

        return;
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
    if (!practitionerId || seen.has(practitionerId)) {
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
  step: FollowUpPlanFormStep,
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
  onRegisterHistoryAction,
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

  const appointmentTypes: AppointmentType[] = useMemo(() => {
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
  const appointmentTypeFolders = useMemo(
    () => appointmentTypeFoldersQuery ?? [],
    [appointmentTypeFoldersQuery],
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
  const ruleSetReplayTargetRef = useRef(ruleSetReplayTarget);
  useEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const treePointerDownRef = useRef<null | {
    canOpenItem: boolean;
    path: string;
    x: number;
    y: number;
  }>(null);

  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };
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

        const normalizedFollowUpPlan = normalizeFollowUpPlanForSubmit(
          parsedValue.followUpPlan,
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
        if (normalizedFollowUpPlan === null) {
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
            duration: editingAppointmentType.duration,
            followUpPlan: editingAppointmentType.followUpPlan,
            name: editingAppointmentType.name,
            practitionerLineageKeys:
              editingAppointmentType.allowedPractitionerLineageKeys.map(
                (lineageKey) => asPractitionerLineageKey(lineageKey),
              ),
          };
          const afterState = {
            duration: parsedValue.duration,
            followUpPlan: normalizedFollowUpPlan,
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

          // Update existing appointment type
          const updateResult = await updateAppointmentTypeMutation({
            appointmentTypeId: editingAppointmentType._id,
            duration: parsedValue.duration,
            name: normalizedName,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...getCowMutationArgs(),
            ...createFollowUpPlanUpdateArgs(normalizedFollowUpPlan),
          });
          handleDraftMutationResult(updateResult);
          upsertAppointmentTypeRef(
            {
              ...editingAppointmentType,
              _id: asAppointmentTypeId(updateResult.entityId),
              allowedPractitionerLineageKeys:
                afterState.practitionerLineageKeys,
              duration: afterState.duration,
              followUpPlan: afterState.followUpPlan ?? [],
              name: afterState.name,
              ruleSetId: updateResult.ruleSetId,
            },
            { previousLineageKey: appointmentTypeLineageKey },
          );
          registerLineageUpdateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: updateResult.entityId,
            label: "Terminart aktualisiert",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
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
                duration: afterState.duration,
                name: afterState.name,
                practiceId,
                practitionerIds: resolvedRedoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createFollowUpPlanUpdateArgs(afterState.followUpPlan),
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
                duration: beforeState.duration,
                name: beforeState.name,
                practiceId,
                practitionerIds: resolvedUndoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createFollowUpPlanUpdateArgs(beforeState.followUpPlan),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: undoResult.entityId };
            },
            undoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
            validateRedo: (current) => {
              if (
                current.name !== beforeState.name ||
                current.duration !== beforeState.duration ||
                serializeFollowUpPlan(current.followUpPlan) !==
                  serializeFollowUpPlan(beforeState.followUpPlan) ||
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
                serializeFollowUpPlan(current.followUpPlan) !==
                  serializeFollowUpPlan(afterState.followUpPlan) ||
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
            duration: parsedValue.duration,
            name: normalizedName,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...createTreeFolderArg(newAppointmentTypeFolderId),
            ...getCowMutationArgs(),
            ...createFollowUpPlanCreateArgs(normalizedFollowUpPlan),
          });
          handleDraftMutationResult(createResult);
          const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
            createResult.entityId,
          );
          upsertAppointmentTypeRef({
            _creationTime: 0,
            _id: asAppointmentTypeId(createResult.entityId),
            allowedPractitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
            createdAt: 0n,
            duration: parsedValue.duration,
            followUpPlan: normalizedFollowUpPlan ?? [],
            lastModified: 0n,
            lineageKey: appointmentTypeLineageKey,
            name: normalizedName,
            practiceId,
            ruleSetId: createResult.ruleSetId,
            ...createTreeFolderArg(newAppointmentTypeFolderId),
          });
          const { entityId } = createResult;

          registerLineageCreateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: entityId,
            isMissingEntityError,
            label: "Terminart erstellt",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
            runCreate: async () => {
              const recreateResult = await createAppointmentTypeMutation({
                duration: parsedValue.duration,
                lineageKey: appointmentTypeLineageKey,
                name: normalizedName,
                practiceId,
                practitionerIds: resolvedFormPractitionerIds.ids,
                ...createTreeFolderArg(newAppointmentTypeFolderId),
                ...getCowMutationArgs(),
                ...createFollowUpPlanCreateArgs(normalizedFollowUpPlan),
              });
              handleDraftMutationResult(recreateResult);
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
              return { entityId: undoResult.entityId };
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
      form.setFieldValue("name", appointmentType.name);
      form.setFieldValue("duration", appointmentType.duration);
      form.setFieldValue(
        "followUpPlan",
        normalizeFollowUpPlanForForm(appointmentType.followUpPlan),
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
        registerLineageUpdateHistoryAction({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          label: "Ordner umbenannt",
          lineageKey: folderLineageKey,
          onRegisterHistoryAction,
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
        registerLineageCreateHistoryAction({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          isMissingEntityError,
          label: "Ordner erstellt",
          lineageKey: folderLineageKey,
          onRegisterHistoryAction,
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
            upsertAppointmentTypeFolderRef(
              createAppointmentTypeFolderRefSnapshot({
                id: recreateResult.entityId,
                lineageKey: folderLineageKey,
                name,
                parentFolderId: resolvedParent.folderId,
                ruleSetId: recreateResult.ruleSetId,
              }),
              { previousLineageKey: folderLineageKey },
            );
            return { entityId: recreateResult.entityId };
          },
          runDelete: async (currentFolderId) => {
            const undoResult = await deleteAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(undoResult);
            removeAppointmentTypeFolderFromRef({
              id: currentFolderId,
              lineageKey: folderLineageKey,
            });
            return { entityId: undoResult.entityId };
          },
          validateBeforeCreate: () => {
            const validation = validateTreeChildNameForHistoryTarget({
              name,
              target: parentFolderTarget,
            });
            return validation.status === "conflict" ? validation.message : null;
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
              duration: appointmentType.duration,
              followUpPlan: appointmentType.followUpPlan,
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
      const result = await deleteAppointmentTypeFolderMutation({
        folderId: folder._id,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(result);
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
      let currentFolderId = result.entityId;
      onRegisterHistoryAction?.({
        label: "Ordner gelöscht",
        redo: async () => {
          try {
            const redoResult = await deleteAppointmentTypeFolderMutation({
              folderId: currentFolderId,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
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
            currentFolderId = redoResult.entityId;
            return { status: "applied" as const };
          } catch (error: unknown) {
            if (isMissingEntityError(error)) {
              return { status: "applied" as const };
            }
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "Der Ordner konnte nicht gelöscht werden.",
              status: "conflict" as const,
            };
          }
        },
        undo: async () => {
          const restoredFolderIds = new Map<
            AppointmentTypeFolderLineageKey,
            Id<"appointmentTypeFolders">
          >();
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
            const createConflict = validateTreeChildNameForHistory({
              name: snapshot.name,
              parentFolderId,
            });
            if (createConflict) {
              return { message: createConflict, status: "conflict" as const };
            }
            const recreateResult = await createAppointmentTypeFolderMutation({
              lineageKey: snapshot.lineageKey,
              name: snapshot.name,
              practiceId,
              ...createParentFolderArg(parentFolderId),
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(recreateResult);
            restoredFolderIds.set(snapshot.lineageKey, recreateResult.entityId);
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
              currentFolderId = recreateResult.entityId;
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
            const resolvedPractitionerIds = practitionerIdsFromSnapshots(
              practitionersRef.current,
              snapshot.practitionerSnapshots,
            );
            if ("status" in resolvedPractitionerIds) {
              return resolvedPractitionerIds;
            }
            const recreateResult = await createAppointmentTypeMutation({
              duration: snapshot.duration,
              lineageKey: snapshot.lineageKey,
              name: snapshot.name,
              practiceId,
              practitionerIds: resolvedPractitionerIds.ids,
              treeFolderId,
              ...getCowMutationArgs(),
              ...createFollowUpPlanCreateArgs(snapshot.followUpPlan),
            });
            handleDraftMutationResult(recreateResult);
            upsertAppointmentTypeRef({
              _creationTime: 0,
              _id: asAppointmentTypeId(recreateResult.entityId),
              allowedPractitionerLineageKeys: toSnapshotLineageIds(
                snapshot.practitionerSnapshots,
              ),
              createdAt: 0n,
              duration: snapshot.duration,
              followUpPlan: snapshot.followUpPlan ?? [],
              lastModified: 0n,
              lineageKey: snapshot.lineageKey,
              name: snapshot.name,
              practiceId,
              ruleSetId: recreateResult.ruleSetId,
              treeFolderId,
            });
          }
          return { status: "applied" as const };
        },
      });
      toast.success("Ordner gelöscht", {
        description: `Ordner "${folder.name}" wurde gelöscht.`,
      });
    } catch (error: unknown) {
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
        registerLineageUpdateHistoryAction({
          entitiesRef: appointmentTypesRef,
          initialEntityId: result.entityId,
          label: "Terminart verschoben",
          lineageKey: appointmentTypeLineageKey,
          onRegisterHistoryAction,
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
        registerLineageUpdateHistoryAction({
          entitiesRef: appointmentTypeFoldersRef,
          initialEntityId: result.entityId,
          label: "Ordner verschoben",
          lineageKey: folderLineageKey,
          onRegisterHistoryAction,
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
        duration: appointmentType.duration,
        followUpPlan: appointmentType.followUpPlan,
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

      let currentAppointmentTypeId = appointmentType._id;

      onRegisterHistoryAction?.({
        label: "Terminart gelöscht",
        redo: async () => {
          try {
            const redoResult = await deleteAppointmentTypeMutation({
              appointmentTypeId: currentAppointmentTypeId,
              appointmentTypeLineageKey: deletedSnapshot.lineageKey,
              practiceId,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
            return { status: "applied" as const };
          } catch (error: unknown) {
            if (isMissingEntityError(error)) {
              return { status: "applied" as const };
            }
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "Die Terminart konnte nicht gelöscht werden.",
              status: "conflict" as const,
            };
          }
        },
        undo: async () => {
          const { selectedRuleSetId } = getCowMutationArgs();
          const existingByLineage = appointmentTypesRef.current.find(
            (type) =>
              type.lineageKey === deletedSnapshot.lineageKey &&
              type.ruleSetId === selectedRuleSetId,
          );
          if (existingByLineage) {
            const existingPractitionerLineageIds =
              existingByLineage.allowedPractitionerLineageKeys
                .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                .toSorted();
            const deletedPractitionerLineageIds = toSnapshotLineageIds(
              deletedPractitionerSnapshots,
            );
            const isSameDefinition =
              existingByLineage.duration === deletedSnapshot.duration &&
              serializeFollowUpPlan(existingByLineage.followUpPlan) ===
                serializeFollowUpPlan(deletedSnapshot.followUpPlan) &&
              samePractitionerLineageIds(
                existingPractitionerLineageIds,
                deletedPractitionerLineageIds,
              );

            if (isSameDefinition) {
              currentAppointmentTypeId = existingByLineage._id;
              return { status: "applied" as const };
            }

            return {
              message: `[HISTORY:APPOINTMENT_TYPE_LINEAGE_CONFLICT] Die Terminart mit lineageKey ${deletedSnapshot.lineageKey} existiert bereits, hat aber abweichende Einstellungen.`,
              status: "conflict" as const,
            };
          }

          const resolvedUndoPractitionerIds = practitionerIdsFromSnapshots(
            practitionersRef.current,
            deletedPractitionerSnapshots,
          );
          if ("status" in resolvedUndoPractitionerIds) {
            return resolvedUndoPractitionerIds;
          }

          const recreateResult = await createAppointmentTypeMutation({
            duration: deletedSnapshot.duration,
            lineageKey: deletedSnapshot.lineageKey,
            name: deletedSnapshot.name,
            practiceId,
            practitionerIds: resolvedUndoPractitionerIds.ids,
            treeFolderId:
              deletedSnapshot.treeFolderId &&
              appointmentTypeFoldersRef.current.some(
                (folder) => folder._id === deletedSnapshot.treeFolderId,
              )
                ? deletedSnapshot.treeFolderId
                : null,
            ...getCowMutationArgs(),
            ...createFollowUpPlanCreateArgs(deletedSnapshot.followUpPlan),
          });
          handleDraftMutationResult(recreateResult);
          upsertAppointmentTypeRef({
            _creationTime: 0,
            _id: asAppointmentTypeId(recreateResult.entityId),
            allowedPractitionerLineageKeys: toSnapshotLineageIds(
              deletedPractitionerSnapshots,
            ),
            createdAt: 0n,
            duration: deletedSnapshot.duration,
            followUpPlan: deletedSnapshot.followUpPlan ?? [],
            lastModified: 0n,
            lineageKey: deletedSnapshot.lineageKey,
            name: deletedSnapshot.name,
            practiceId,
            ruleSetId: recreateResult.ruleSetId,
            ...(deletedSnapshot.treeFolderId &&
            appointmentTypeFoldersRef.current.some(
              (folder) => folder._id === deletedSnapshot.treeFolderId,
            )
              ? { treeFolderId: deletedSnapshot.treeFolderId }
              : {}),
          });
          currentAppointmentTypeId = asAppointmentTypeId(
            recreateResult.entityId,
          );
          return { status: "applied" as const };
        },
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

                      <form.Field mode="array" name="followUpPlan">
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
                                        name={`followUpPlan[${index}]` as const}
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

                                            <div className="grid gap-4 md:grid-cols-3">
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
                                                <FieldLabel>Versatz</FieldLabel>
                                                <Input
                                                  min={
                                                    itemField.state.value
                                                      .offsetUnit === "minutes"
                                                      ? 0
                                                      : 1
                                                  }
                                                  onBlur={(e) => {
                                                    const normalizedOffsetValue =
                                                      normalizeFollowUpOffsetValue(
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
                                                  onValueChange={(value) => {
                                                    const nextOffsetUnit =
                                                      parseFollowUpOffsetUnit(
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
                                                        normalizeFollowUpOffsetValue(
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
                                                    <SelectItem value="minutes">
                                                      Minuten
                                                    </SelectItem>
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
                                            </div>
                                          </div>
                                        )}
                                      </form.Field>
                                    );
                                  })
                                )}

                                <Button
                                  onClick={() => {
                                    field.pushValue(createEmptyFollowUpStep());
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
