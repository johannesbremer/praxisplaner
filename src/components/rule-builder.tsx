import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { RULE_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";
import type { RecordRuleSetCommand } from "../utils/rule-set-replay";
import type { RuleFromDB } from "./rule-builder-types";

import { api } from "../../convex/_generated/api";
import {
  type ConditionTreeNode,
  serializeConditionTreeTransport,
} from "../../lib/condition-tree";
import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../lib/rule-name-generator";
import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import { requireFrontendLineageEntities } from "../utils/frontend-lineage";
import { createRuleSetSchedulingRuleCommand } from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";
import {
  getSchedulingRuleCopySource,
  recordSchedulingRuleCreateReplayCommand,
  recordSchedulingRuleDeleteReplayCommand,
  recordSchedulingRuleUpdateReplayCommand,
} from "../utils/scheduling-rule-replay";
import { RuleEditDialog } from "./rule-builder-editor";

type AppointmentTypeQueryResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];

type LocationQueryResult = (typeof api.entities.getLocations)["_returnType"];

type PractitionerQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];

type RuleAppointmentType = FrontendLineageEntity<
  "appointmentTypes",
  AppointmentTypeQueryResult[number]
>;

interface RuleBuilderProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: RecordRuleSetCommand;
  onRuleCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}
type RuleConditionTreePreparation =
  | RuleConditionTreePreparationConflict
  | RuleConditionTreePreparationSuccess;
interface RuleConditionTreePreparationConflict {
  message: string;
  status: "conflict";
}
interface RuleConditionTreePreparationSuccess {
  conditionTree: ConditionTreeNode;
  status: "ok";
}
type RuleLocation = FrontendLineageEntity<
  "locations",
  LocationQueryResult[number]
>;
type RulePractitioner = FrontendLineageEntity<
  "practitioners",
  PractitionerQueryResult[number]
>;

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, RULE_MISSING_ENTITY_REGEX);

export function RuleBuilder({
  onDraftMutation,
  onRecordCommand,
  onRuleCreated,
  practiceId,
  ruleSetReplayTarget,
}: RuleBuilderProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const createRuleMutation = useMutation(api.entities.createRule);
  const deleteRuleMutation = useMutation(api.entities.deleteRule);

  // Query data from Convex
  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const locationsQuery = useQuery(api.entities.getLocations, { ruleSetId });
  const existingRulesQuery = useQuery(api.entities.getRules, { ruleSetId });
  const appointmentTypes = appointmentTypesQuery ?? [];
  const practitioners = practitionersQuery ?? [];
  const locations = locationsQuery ?? [];
  const existingRules: RuleFromDB[] = useMemo(
    () => existingRulesQuery ?? [],
    [existingRulesQuery],
  );
  const lineageAppointmentTypes: RuleAppointmentType[] = useMemo(() => {
    if (!appointmentTypesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "appointmentTypes",
      AppointmentTypeQueryResult[number]
    >({
      entities: appointmentTypesQuery,
      entityType: "appointment type",
      source: "RuleBuilder",
    });
  }, [appointmentTypesQuery]);
  const lineagePractitioners: RulePractitioner[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionerQueryResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "RuleBuilder",
    });
  }, [practitionersQuery]);
  const lineageLocations: RuleLocation[] = useMemo(() => {
    if (!locationsQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "locations",
      LocationQueryResult[number]
    >({
      entities: locationsQuery,
      entityType: "location",
      source: "RuleBuilder",
    });
  }, [locationsQuery]);
  const appointmentTypesRef = useRef(lineageAppointmentTypes);
  const practitionersRef = useRef(lineagePractitioners);
  const locationsRef = useRef(lineageLocations);
  const rulesRef = useRef(existingRules);
  useEffect(() => {
    appointmentTypesRef.current = lineageAppointmentTypes;
  }, [lineageAppointmentTypes]);
  useEffect(() => {
    practitionersRef.current = lineagePractitioners;
  }, [lineagePractitioners]);
  useEffect(() => {
    locationsRef.current = lineageLocations;
  }, [lineageLocations]);
  useEffect(() => {
    rulesRef.current = existingRules;
  }, [existingRules]);
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleCreated && { onRuleSetCreated: onRuleCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });
  const runCreateRule = async (params: {
    conditionTree: ConditionTreeNode;
    copyFromId?: Id<"ruleConditions">;
    name: string;
  }) =>
    await createRuleMutation({
      conditionTree: serializeConditionTreeTransport(params.conditionTree),
      name: params.name,
      ...(params.copyFromId === undefined
        ? {}
        : { copyFromId: params.copyFromId }),
      practiceId,
      ...getCowMutationArgs(),
    });
  const createRuleReplayContext = () => ({
    deleteRule: (ruleId: Id<"ruleConditions">) =>
      deleteRuleMutation({
        practiceId,
        ruleId,
        ...getCowMutationArgs(),
      }),
    getCopySource: (
      rule: Pick<RuleFromDB, "_id" | "copyFromId" | "ruleSetId">,
    ) => getSchedulingRuleCopySource(rule, ruleSetReplayTarget.parentRuleSetId),
    handleDraftMutationResult,
    isMissingEntityError,
    prepareRule: (conditionTree: ConditionTreeNode) =>
      prepareRuleConditionTreeForReplay(
        conditionTree,
        appointmentTypesRef.current,
        practitionersRef.current,
        locationsRef.current,
      ),
    rules: () => rulesRef.current,
    runCreateRule,
    serializeRule: (rule: RuleFromDB) =>
      serializeRuleStateForComparison({
        conditionTree: normalizeConditionTreeToLineage(
          rule.conditionTree,
          appointmentTypesRef.current,
          practitionersRef.current,
          locationsRef.current,
        ),
      }),
  });

  // Check if all data is loaded
  const dataReady =
    appointmentTypesQuery !== undefined &&
    practitionersQuery !== undefined &&
    locationsQuery !== undefined;

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<
    "new" | Id<"ruleConditions"> | null
  >(null);

  const openNewRuleDialog = () => {
    setEditingRuleId("new");
    setIsDialogOpen(true);
  };

  const openEditRuleDialog = (ruleId: Id<"ruleConditions">) => {
    const rule = rulesRef.current.find((candidate) => candidate._id === ruleId);
    if (!rule || !canFlattenRuleConditionTree(rule.conditionTree)) {
      return;
    }

    setEditingRuleId(ruleId);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRuleId(null);
  };

  const handleDeleteRule = async (ruleId: Id<"ruleConditions">) => {
    try {
      const deletedRule = rulesRef.current.find((rule) => rule._id === ruleId);
      const deletedRuleName = deletedRule
        ? getFlattenedRuleDisplayName(
            deletedRule.conditionTree,
            appointmentTypes,
            practitioners,
            locations,
          )
        : "Regel";

      const deleteResult = await deleteRuleMutation({
        practiceId,
        ruleId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(deleteResult);

      if (deletedRule) {
        const deletedRuleLineageTree = normalizeConditionTreeToLineage(
          deletedRule.conditionTree,
          appointmentTypesRef.current,
          practitionersRef.current,
          locationsRef.current,
        );
        const deletedRuleState = serializeRuleStateForComparison({
          conditionTree: deletedRuleLineageTree,
        });
        const deletedRuleSnapshot = encodeRuleSetSnapshot({
          conditionTree: deletedRuleLineageTree,
        });
        const command = createRuleSetSchedulingRuleCommand({
          kind: "schedulingRule.delete",
          label: "Regel gelöscht",
          payload: {
            hasAfterSnapshot: false,
            hasBeforeSnapshot: true,
            kind: "schedulingRule.delete",
            ruleName: deletedRuleName,
          },
          snapshots: {
            before: deletedRuleSnapshot,
          },
          target: {
            entityId: ruleId,
          },
        });
        recordSchedulingRuleDeleteReplayCommand(onRecordCommand, command, {
          context: createRuleReplayContext(),
          deletedRule,
          deletedRuleLineageTree,
          deletedRuleName,
          deletedRuleState,
          initialRuleId: ruleId,
        });
      }
    } catch (error) {
      console.error("Failed to delete rule:", error);
    }
  };

  // Get existing rule for editing
  const editingRule =
    editingRuleId === "new"
      ? undefined
      : existingRules.find((rule) => rule._id === editingRuleId);

  // Early return for loading state
  if (!dataReady) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">Lade Daten...</div>
      </div>
    );
  }

  // At this point, TypeScript knows all data is loaded
  return (
    <div className="space-y-4">
      {/* Render all existing rules as cards */}
      {existingRules.map((rule) => {
        const canEditRule = canFlattenRuleConditionTree(rule.conditionTree);
        const ruleName = getFlattenedRuleDisplayName(
          rule.conditionTree,
          appointmentTypes,
          practitioners,
          locations,
        );

        return (
          <Card key={rule._id}>
            <CardHeader>
              <CardTitle className="font-normal">{ruleName}</CardTitle>
              <CardAction className="flex gap-2">
                <Button
                  disabled={!canEditRule}
                  onClick={() => {
                    openEditRuleDialog(rule._id);
                  }}
                  size="sm"
                  title={
                    canEditRule
                      ? "Regel bearbeiten"
                      : "Regeln mit NOT-Knoten können nicht im vereinfachten Editor bearbeitet werden."
                  }
                  variant="ghost"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => {
                    void handleDeleteRule(rule._id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        );
      })}

      {/* Add new rule button */}
      <Button className="gap-2" onClick={openNewRuleDialog}>
        <Plus className="h-4 w-4" />
        Neue Regel
      </Button>

      {/* Edit/Create Rule Dialog */}
      {editingRuleId && (
        <RuleEditDialog
          appointmentTypes={appointmentTypes}
          existingRule={editingRule}
          isOpen={isDialogOpen}
          locations={locations}
          onClose={closeDialog}
          onCreate={async (conditionTree) => {
            const previousRule =
              editingRuleId === "new"
                ? undefined
                : rulesRef.current.find((rule) => rule._id === editingRuleId);

            if (editingRuleId !== "new") {
              // Delete old rule first
              const deleteResult = await deleteRuleMutation({
                practiceId,
                ruleId: editingRuleId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(deleteResult);
            }

            const conditions = conditionTreeToConditions(conditionTree);
            const ruleName = generateRuleName(
              conditions,
              appointmentTypes,
              practitioners,
              locations,
            );

            const createResult = await runCreateRule({
              conditionTree,
              ...(previousRule
                ? getSchedulingRuleCopySource(
                    previousRule,
                    ruleSetReplayTarget.parentRuleSetId,
                  )
                : {}),
              name: ruleName,
            });
            handleDraftMutationResult(createResult);

            const currentRuleId = createResult.entityId;

            if (previousRule) {
              const previousRuleName = getFlattenedRuleDisplayName(
                previousRule.conditionTree,
                appointmentTypes,
                practitioners,
                locations,
              );
              const currentRuleLineageTree = normalizeConditionTreeToLineage(
                conditionTree,
                lineageAppointmentTypes,
                lineagePractitioners,
                lineageLocations,
              );
              const currentRuleState = serializeRuleStateForComparison({
                conditionTree: currentRuleLineageTree,
              });
              const currentRuleSnapshot = encodeRuleSetSnapshot({
                conditionTree: currentRuleLineageTree,
              });
              const previousRuleLineageTree = normalizeConditionTreeToLineage(
                previousRule.conditionTree,
                lineageAppointmentTypes,
                lineagePractitioners,
                lineageLocations,
              );
              const previousRuleState = serializeRuleStateForComparison({
                conditionTree: previousRuleLineageTree,
              });
              const previousRuleSnapshot = encodeRuleSetSnapshot({
                conditionTree: previousRuleLineageTree,
              });
              const command = createRuleSetSchedulingRuleCommand({
                kind: "schedulingRule.update",
                label: "Regel aktualisiert",
                payload: {
                  hasAfterSnapshot: true,
                  hasBeforeSnapshot: true,
                  kind: "schedulingRule.update",
                  ruleName,
                },
                snapshots: {
                  after: currentRuleSnapshot,
                  before: previousRuleSnapshot,
                },
                target: {
                  entityId: currentRuleId,
                },
              });
              recordSchedulingRuleUpdateReplayCommand(
                onRecordCommand,
                command,
                {
                  context: createRuleReplayContext(),
                  currentRuleLineageTree,
                  currentRuleState,
                  initialRuleId: currentRuleId,
                  previousRule,
                  previousRuleLineageTree,
                  previousRuleName,
                  previousRuleState,
                  ruleName,
                },
              );
            } else {
              const createdRuleLineageTree = normalizeConditionTreeToLineage(
                conditionTree,
                lineageAppointmentTypes,
                lineagePractitioners,
                lineageLocations,
              );
              const createdRuleSnapshot = encodeRuleSetSnapshot({
                conditionTree: createdRuleLineageTree,
              });
              const command = createRuleSetSchedulingRuleCommand({
                kind: "schedulingRule.create",
                label: "Regel erstellt",
                payload: {
                  hasAfterSnapshot: true,
                  hasBeforeSnapshot: false,
                  kind: "schedulingRule.create",
                  ruleName,
                },
                snapshots: {
                  after: createdRuleSnapshot,
                },
                target: {
                  entityId: currentRuleId,
                },
              });
              recordSchedulingRuleCreateReplayCommand(
                onRecordCommand,
                command,
                {
                  context: createRuleReplayContext(),
                  createdRuleLineageTree,
                  initialRuleId: currentRuleId,
                  ruleName,
                },
              );
            }

            closeDialog();
          }}
          practitioners={practitioners}
        />
      )}
    </div>
  );
}

function canFlattenRuleConditionTree(
  conditionTree: ConditionTreeNode,
): boolean {
  try {
    conditionTreeToConditions(conditionTree);
    return true;
  } catch {
    return false;
  }
}

function createKnownLineageKeyResolver(
  entities: { _id: string; lineageKey: string }[],
  missingLabel: string,
  missingGroups: Set<string>,
): (reference: string) => null | string {
  const lineageKeyByReference = new Map<string, string>(
    entities.flatMap((entry) => [
      [entry._id, entry.lineageKey] as const,
      [entry.lineageKey, entry.lineageKey] as const,
    ]),
  );

  return (reference) => {
    const lineageKey = lineageKeyByReference.get(reference);
    if (lineageKey) {
      return lineageKey;
    }

    missingGroups.add(missingLabel);
    return null;
  };
}

function createLineageKeyResolver(
  entities: { _id: string; lineageKey: string }[],
): (id: string) => string {
  const lineageKeyById = new Map<string, string>(
    entities.map((entry) => [entry._id, entry.lineageKey] as const),
  );

  return (id) => lineageKeyById.get(id) ?? id;
}

function getFlattenedRuleDisplayName(
  conditionTree: ConditionTreeNode,
  appointmentTypes: Doc<"appointmentTypes">[],
  practitioners: Doc<"practitioners">[],
  locations: Doc<"locations">[],
): string {
  try {
    return generateRuleName(
      conditionTreeToConditions(conditionTree),
      appointmentTypes,
      practitioners,
      locations,
    );
  } catch {
    return "Regel mit nicht unterstützter Bedingungsstruktur";
  }
}

function isSerializableRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConditionTreeForComparison(
  conditionTree: ConditionTreeNode,
  normalizeAppointmentTypeId: (id: string) => string,
  normalizePractitionerId: (id: string) => string,
  normalizeLocationId: (id: string) => string,
): ConditionTreeNode {
  if (conditionTree.nodeType === "CONDITION") {
    const normalizeId = [
      "APPOINTMENT_TYPE",
      "CONCURRENT_COUNT",
      "DAILY_CAPACITY",
    ].includes(conditionTree.conditionType)
      ? normalizeAppointmentTypeId
      : conditionTree.conditionType === "PRACTITIONER"
        ? normalizePractitionerId
        : conditionTree.conditionType === "LOCATION"
          ? normalizeLocationId
          : null;

    if (!normalizeId || !conditionTree.valueIds) {
      return conditionTree;
    }

    return {
      ...conditionTree,
      valueIds: conditionTree.valueIds.map((valueId) => normalizeId(valueId)),
    };
  }

  return {
    ...conditionTree,
    children: conditionTree.children.map((child) =>
      normalizeConditionTreeForComparison(
        child,
        normalizeAppointmentTypeId,
        normalizePractitionerId,
        normalizeLocationId,
      ),
    ),
  };
}

function normalizeConditionTreeToLineage(
  conditionTree: ConditionTreeNode,
  appointmentTypes: RuleAppointmentType[],
  practitioners: RulePractitioner[],
  locations: RuleLocation[],
): ConditionTreeNode {
  return normalizeConditionTreeForComparison(
    conditionTree,
    createLineageKeyResolver(appointmentTypes),
    createLineageKeyResolver(practitioners),
    createLineageKeyResolver(locations),
  );
}

function prepareRuleConditionTreeForReplay(
  conditionTree: ConditionTreeNode,
  appointmentTypes: RuleAppointmentType[],
  practitioners: RulePractitioner[],
  locations: RuleLocation[],
): RuleConditionTreePreparation {
  const missingGroups = new Set<string>();
  const remapAppointmentTypeId = createKnownLineageKeyResolver(
    appointmentTypes,
    "Termintypen",
    missingGroups,
  );
  const remapPractitionerId = createKnownLineageKeyResolver(
    practitioners,
    "Behandler",
    missingGroups,
  );
  const remapLocationId = createKnownLineageKeyResolver(
    locations,
    "Standorte",
    missingGroups,
  );

  const remappedConditionTree = remapConditionTreeReferences(
    conditionTree,
    remapAppointmentTypeId,
    remapPractitionerId,
    remapLocationId,
  );

  if (missingGroups.size > 0) {
    return {
      message: `Die Regel kann nicht wiederhergestellt werden, weil referenzierte ${[...missingGroups].join(", ")} nicht mehr existieren.`,
      status: "conflict",
    };
  }

  return {
    conditionTree: remappedConditionTree,
    status: "ok",
  };
}

function remapConditionTreeReferences(
  conditionTree: ConditionTreeNode,
  remapAppointmentTypeId: (id: string) => null | string,
  remapPractitionerId: (id: string) => null | string,
  remapLocationId: (id: string) => null | string,
): ConditionTreeNode {
  if (conditionTree.nodeType === "CONDITION") {
    const remapId = [
      "APPOINTMENT_TYPE",
      "CONCURRENT_COUNT",
      "DAILY_CAPACITY",
    ].includes(conditionTree.conditionType)
      ? remapAppointmentTypeId
      : conditionTree.conditionType === "PRACTITIONER"
        ? remapPractitionerId
        : conditionTree.conditionType === "LOCATION"
          ? remapLocationId
          : null;

    if (!remapId || !conditionTree.valueIds) {
      return conditionTree;
    }

    const remappedValueIds: string[] = [];
    for (const valueId of conditionTree.valueIds) {
      const remappedId = remapId(valueId);
      if (remappedId) {
        remappedValueIds.push(remappedId);
      }
    }

    return {
      ...conditionTree,
      valueIds: remappedValueIds,
    };
  }

  return {
    ...conditionTree,
    children: conditionTree.children.map((child) =>
      remapConditionTreeReferences(
        child,
        remapAppointmentTypeId,
        remapPractitionerId,
        remapLocationId,
      ),
    ),
  };
}

function serializeRuleState(conditionTree: ConditionTreeNode): string {
  return JSON.stringify(
    {
      conditionTree,
    },
    (_, value: unknown) => {
      if (!isSerializableRecord(value)) {
        return value;
      }

      const sortedEntries = Object.entries(value).toSorted(([a], [b]) =>
        a.localeCompare(b),
      );
      return Object.fromEntries(sortedEntries);
    },
  );
}

function serializeRuleStateForComparison(params: {
  conditionTree: ConditionTreeNode;
}): string {
  return serializeRuleState(params.conditionTree);
}
