import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { RULE_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type { Id } from "../../convex/_generated/dataModel";
import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";
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
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import { requireFrontendLineageEntities } from "../utils/frontend-lineage";
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
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
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

function isSerializableRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const getReplayCopySource = (
  rule: Pick<RuleFromDB, "_id" | "copyFromId">,
): { copyFromId?: Id<"ruleConditions"> } =>
  rule.copyFromId ? { copyFromId: rule.copyFromId } : {};

export function RuleBuilder({
  onDraftMutation,
  onRegisterHistoryAction,
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
  const ruleSetReplayTargetRef = useRef(ruleSetReplayTarget);
  useEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleCreated && result.ruleSetId !== ruleSetId) {
      onRuleCreated(result.ruleSetId);
    }
  };
  const runCreateRule = async (params: {
    conditionTree: ConditionTreeNode;
    copyFromId?: Id<"ruleConditions">;
    enabled: boolean;
    name: string;
  }) =>
    await createRuleMutation({
      conditionTree: serializeConditionTreeTransport(params.conditionTree),
      enabled: params.enabled,
      name: params.name,
      ...(params.copyFromId === undefined
        ? {}
        : { copyFromId: params.copyFromId }),
      practiceId,
      ...getCowMutationArgs(),
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
        ? generateRuleName(
            conditionTreeToConditions(deletedRule.conditionTree),
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
        let currentRuleId = ruleId;
        const deletedRuleLineageTree = normalizeConditionTreeToLineage(
          deletedRule.conditionTree,
          appointmentTypesRef.current,
          practitionersRef.current,
          locationsRef.current,
        );
        const deletedRuleState = serializeRuleStateForComparison({
          conditionTree: deletedRuleLineageTree,
          enabled: deletedRule.enabled,
        });
        onRegisterHistoryAction?.({
          label: "Regel gelöscht",
          redo: async () => {
            const existing =
              rulesRef.current.find((rule) => rule._id === currentRuleId) ??
              rulesRef.current.find(
                (rule) =>
                  serializeRuleStateForComparison({
                    conditionTree: normalizeConditionTreeToLineage(
                      rule.conditionTree,
                      appointmentTypesRef.current,
                      practitionersRef.current,
                      locationsRef.current,
                    ),
                    enabled: rule.enabled,
                  }) === deletedRuleState,
              );
            if (
              existing &&
              serializeRuleStateForComparison({
                conditionTree: normalizeConditionTreeToLineage(
                  existing.conditionTree,
                  appointmentTypesRef.current,
                  practitionersRef.current,
                  locationsRef.current,
                ),
                enabled: existing.enabled,
              }) !== deletedRuleState
            ) {
              return {
                message:
                  "Die Regel wurde zwischenzeitlich geändert und kann nicht erneut gelöscht werden.",
                status: "conflict" as const,
              };
            }

            if (!existing) {
              return { status: "applied" as const };
            }

            currentRuleId = existing._id;

            try {
              const redoResult = await deleteRuleMutation({
                practiceId,
                ruleId: currentRuleId,
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
                    : "Die Regel konnte nicht gelöscht werden.",
                status: "conflict" as const,
              };
            }
          },
          undo: async () => {
            const preparedRule = prepareRuleConditionTreeForReplay(
              deletedRuleLineageTree,
              appointmentTypesRef.current,
              practitionersRef.current,
              locationsRef.current,
            );
            if (preparedRule.status === "conflict") {
              return {
                message: preparedRule.message,
                status: "conflict" as const,
              };
            }
            const recreateResult = await runCreateRule({
              conditionTree: preparedRule.conditionTree,
              ...getReplayCopySource(deletedRule),
              enabled: deletedRule.enabled,
              name: deletedRuleName,
            });
            handleDraftMutationResult(recreateResult);
            currentRuleId = recreateResult.entityId;
            return { status: "applied" as const };
          },
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
        const ruleName = generateRuleName(
          conditionTreeToConditions(rule.conditionTree),
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
                  onClick={() => {
                    openEditRuleDialog(rule._id);
                  }}
                  size="sm"
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
              ...(previousRule ? getReplayCopySource(previousRule) : {}),
              enabled: true,
              name: ruleName,
            });
            handleDraftMutationResult(createResult);

            let currentRuleId = createResult.entityId;

            if (previousRule) {
              const previousRuleName = generateRuleName(
                conditionTreeToConditions(previousRule.conditionTree),
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
                enabled: true,
              });
              const previousRuleLineageTree = normalizeConditionTreeToLineage(
                previousRule.conditionTree,
                lineageAppointmentTypes,
                lineagePractitioners,
                lineageLocations,
              );
              const previousRuleState = serializeRuleStateForComparison({
                conditionTree: previousRuleLineageTree,
                enabled: previousRule.enabled,
              });
              const findRuleIdsBySerializedState = (
                serializedState: string,
              ): Id<"ruleConditions">[] =>
                rulesRef.current
                  .filter(
                    (rule) =>
                      serializeRuleStateForComparison({
                        conditionTree: normalizeConditionTreeToLineage(
                          rule.conditionTree,
                          appointmentTypesRef.current,
                          practitionersRef.current,
                          locationsRef.current,
                        ),
                        enabled: rule.enabled,
                      }) === serializedState,
                  )
                  .map((rule) => rule._id);
              const resolveRuleIdForReplay = (params: {
                ambiguousMessage: string;
                missingMessage: string;
                requiredState: string;
                staleMessage: string;
              }):
                | { message: string; status: "conflict" }
                | { ruleId: Id<"ruleConditions">; status: "ok" } => {
                const byId = rulesRef.current.find(
                  (rule) => rule._id === currentRuleId,
                );
                if (byId) {
                  const byIdState = serializeRuleStateForComparison({
                    conditionTree: normalizeConditionTreeToLineage(
                      byId.conditionTree,
                      appointmentTypesRef.current,
                      practitionersRef.current,
                      locationsRef.current,
                    ),
                    enabled: byId.enabled,
                  });
                  if (byIdState === params.requiredState) {
                    return { ruleId: byId._id, status: "ok" };
                  }
                  return {
                    message: params.staleMessage,
                    status: "conflict",
                  };
                }

                const matches = findRuleIdsBySerializedState(
                  params.requiredState,
                );
                const [singleMatch] = matches;
                if (singleMatch) {
                  return { ruleId: singleMatch, status: "ok" };
                }
                if (matches.length > 1) {
                  return {
                    message: params.ambiguousMessage,
                    status: "conflict",
                  };
                }
                return {
                  message: params.missingMessage,
                  status: "conflict",
                };
              };
              const redoAmbiguousMessage =
                "Die Regel kann nicht wiederhergestellt werden, weil der vorherige Regelzustand mehrfach vorhanden ist.";
              const redoMissingMessage =
                "Die Regel kann nicht wiederhergestellt werden, weil der vorherige Regelzustand nicht mehr vorhanden ist.";
              const redoStaleMessage =
                "Die vorherige Regel wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.";
              const undoAmbiguousMessage =
                "Die aktualisierte Regel kann nicht zurückgesetzt werden, weil der aktuelle Regelzustand mehrfach vorhanden ist.";
              const undoMissingMessage =
                "Die aktualisierte Regel wurde bereits gelöscht und kann nicht zurückgesetzt werden.";
              const undoStaleMessage =
                "Die aktualisierte Regel wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";

              onRegisterHistoryAction?.({
                label: "Regel aktualisiert",
                redo: async () => {
                  const resolvedRule = resolveRuleIdForReplay({
                    ambiguousMessage: redoAmbiguousMessage,
                    missingMessage: redoMissingMessage,
                    requiredState: previousRuleState,
                    staleMessage: redoStaleMessage,
                  });
                  if (resolvedRule.status === "conflict") {
                    if (resolvedRule.message === redoMissingMessage) {
                      const currentMatches =
                        findRuleIdsBySerializedState(currentRuleState);
                      if (currentMatches.length === 1) {
                        const resolvedCurrentRuleId = currentMatches.at(0);
                        if (!resolvedCurrentRuleId) {
                          return {
                            message: resolvedRule.message,
                            status: "conflict" as const,
                          };
                        }
                        currentRuleId = resolvedCurrentRuleId;
                        return { status: "applied" as const };
                      }
                    }
                    return {
                      message: resolvedRule.message,
                      status: "conflict" as const,
                    };
                  }
                  currentRuleId = resolvedRule.ruleId;
                  const preparedRule = prepareRuleConditionTreeForReplay(
                    currentRuleLineageTree,
                    appointmentTypesRef.current,
                    practitionersRef.current,
                    locationsRef.current,
                  );
                  if (preparedRule.status === "conflict") {
                    return {
                      message: preparedRule.message,
                      status: "conflict" as const,
                    };
                  }

                  const redoDeleteResult = await deleteRuleMutation({
                    practiceId,
                    ruleId: currentRuleId,
                    ...getCowMutationArgs(),
                  });
                  handleDraftMutationResult(redoDeleteResult);

                  const recreateResult = await runCreateRule({
                    conditionTree: preparedRule.conditionTree,
                    ...getReplayCopySource(previousRule),
                    enabled: true,
                    name: ruleName,
                  });
                  handleDraftMutationResult(recreateResult);
                  currentRuleId = recreateResult.entityId;
                  return { status: "applied" as const };
                },
                undo: async () => {
                  const resolvedRule = resolveRuleIdForReplay({
                    ambiguousMessage: undoAmbiguousMessage,
                    missingMessage: undoMissingMessage,
                    requiredState: currentRuleState,
                    staleMessage: undoStaleMessage,
                  });
                  if (resolvedRule.status === "conflict") {
                    if (resolvedRule.message === undoMissingMessage) {
                      const previousMatches =
                        findRuleIdsBySerializedState(previousRuleState);
                      if (previousMatches.length === 1) {
                        const resolvedPreviousRuleId = previousMatches.at(0);
                        if (!resolvedPreviousRuleId) {
                          return {
                            message: resolvedRule.message,
                            status: "conflict" as const,
                          };
                        }
                        currentRuleId = resolvedPreviousRuleId;
                        return { status: "applied" as const };
                      }
                    }
                    return {
                      message: resolvedRule.message,
                      status: "conflict" as const,
                    };
                  }
                  currentRuleId = resolvedRule.ruleId;
                  const preparedRule = prepareRuleConditionTreeForReplay(
                    previousRuleLineageTree,
                    appointmentTypesRef.current,
                    practitionersRef.current,
                    locationsRef.current,
                  );
                  if (preparedRule.status === "conflict") {
                    return {
                      message: preparedRule.message,
                      status: "conflict" as const,
                    };
                  }

                  const undoDeleteResult = await deleteRuleMutation({
                    practiceId,
                    ruleId: currentRuleId,
                    ...getCowMutationArgs(),
                  });
                  handleDraftMutationResult(undoDeleteResult);

                  const recreatePrevious = await runCreateRule({
                    conditionTree: preparedRule.conditionTree,
                    ...getReplayCopySource(previousRule),
                    enabled: previousRule.enabled,
                    name: previousRuleName,
                  });
                  handleDraftMutationResult(recreatePrevious);
                  currentRuleId = recreatePrevious.entityId;
                  return { status: "applied" as const };
                },
              });
            } else {
              const createdRuleLineageTree = normalizeConditionTreeToLineage(
                conditionTree,
                lineageAppointmentTypes,
                lineagePractitioners,
                lineageLocations,
              );
              onRegisterHistoryAction?.({
                label: "Regel erstellt",
                redo: async () => {
                  const preparedRule = prepareRuleConditionTreeForReplay(
                    createdRuleLineageTree,
                    appointmentTypesRef.current,
                    practitionersRef.current,
                    locationsRef.current,
                  );
                  if (preparedRule.status === "conflict") {
                    return {
                      message: preparedRule.message,
                      status: "conflict" as const,
                    };
                  }
                  const recreateResult = await runCreateRule({
                    conditionTree: preparedRule.conditionTree,
                    enabled: true,
                    name: ruleName,
                  });
                  handleDraftMutationResult(recreateResult);
                  currentRuleId = recreateResult.entityId;
                  return { status: "applied" as const };
                },
                undo: async () => {
                  try {
                    const undoDeleteResult = await deleteRuleMutation({
                      practiceId,
                      ruleId: currentRuleId,
                      ...getCowMutationArgs(),
                    });
                    handleDraftMutationResult(undoDeleteResult);
                    return { status: "applied" as const };
                  } catch (error: unknown) {
                    if (isMissingEntityError(error)) {
                      return { status: "applied" as const };
                    }
                    return {
                      message:
                        error instanceof Error
                          ? error.message
                          : "Die Regel konnte nicht gelöscht werden.",
                      status: "conflict" as const,
                    };
                  }
                },
              });
            }

            closeDialog();
          }}
          practitioners={practitioners}
        />
      )}
    </div>
  );
}

function createEntityIdResolver(
  entities: { _id: string; lineageKey: string }[],
  missingLabel: string,
  missingGroups: Set<string>,
): (lineageKey: string) => null | string {
  const entityIdByLineageKey = new Map<string, string>(
    entities.map((entry) => [entry.lineageKey, entry._id] as const),
  );

  return (lineageKey) => {
    const entityId = entityIdByLineageKey.get(lineageKey);
    if (entityId) {
      return entityId;
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

function normalizeConditionTreeForComparison(
  conditionTree: ConditionTreeNode,
  normalizeAppointmentTypeId: (id: string) => string,
  normalizePractitionerId: (id: string) => string,
  normalizeLocationId: (id: string) => string,
): ConditionTreeNode {
  if (conditionTree.nodeType === "CONDITION") {
    const normalizeId =
      conditionTree.conditionType === "APPOINTMENT_TYPE" ||
      conditionTree.conditionType === "CONCURRENT_COUNT" ||
      conditionTree.conditionType === "DAILY_CAPACITY"
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
  const remapAppointmentTypeId = createEntityIdResolver(
    appointmentTypes,
    "Termintypen",
    missingGroups,
  );
  const remapPractitionerId = createEntityIdResolver(
    practitioners,
    "Behandler",
    missingGroups,
  );
  const remapLocationId = createEntityIdResolver(
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
    const remapId =
      conditionTree.conditionType === "APPOINTMENT_TYPE" ||
      conditionTree.conditionType === "CONCURRENT_COUNT" ||
      conditionTree.conditionType === "DAILY_CAPACITY"
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

function serializeRuleState(
  conditionTree: ConditionTreeNode,
  enabled: boolean,
): string {
  return JSON.stringify(
    {
      conditionTree,
      enabled,
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
  enabled: boolean;
}): string {
  return serializeRuleState(params.conditionTree, params.enabled);
}
