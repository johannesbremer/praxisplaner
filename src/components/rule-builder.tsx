import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ConditionTreeNode } from "@/convex/ruleEngine";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";

import type { Id } from "../../convex/_generated/dataModel";
import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { NamedEntity, RuleFromDB } from "./rule-builder-types";

import { api } from "../../convex/_generated/api";
import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../lib/rule-name-generator";
import {
  ruleSetIdFromReplayTarget,
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import { RuleEditDialog } from "./rule-builder-editor";

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
  conditionTree: unknown;
  status: "ok";
}

const isMissingEntityError = (error: unknown) =>
  error instanceof Error &&
  !/source rule set not found/i.test(error.message) &&
  /already deleted|bereits gelöscht|rule not found|regel.*nicht gefunden/i.test(
    error.message,
  );

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
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const locations = useQuery(api.entities.getLocations, { ruleSetId });
  const existingRules = useQuery(api.entities.getRules, { ruleSetId });
  const appointmentTypesRef = useRef(appointmentTypes ?? []);
  const practitionersRef = useRef(practitioners ?? []);
  const locationsRef = useRef(locations ?? []);
  const rulesRef = useRef(existingRules ?? []);
  useEffect(() => {
    appointmentTypesRef.current = appointmentTypes ?? [];
  }, [appointmentTypes]);
  useEffect(() => {
    practitionersRef.current = practitioners ?? [];
  }, [practitioners]);
  useEffect(() => {
    locationsRef.current = locations ?? [];
  }, [locations]);
  useEffect(() => {
    rulesRef.current = existingRules ?? [];
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

  // Check if all data is loaded
  const dataReady = Boolean(appointmentTypes && practitioners && locations);

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
            appointmentTypes ?? [],
            practitioners ?? [],
            locations ?? [],
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
            const recreateResult = await createRuleMutation({
              conditionTree: preparedRule.conditionTree as Parameters<
                typeof createRuleMutation
              >[0]["conditionTree"],
              ...getReplayCopySource(deletedRule),
              enabled: deletedRule.enabled,
              name: deletedRuleName,
              practiceId,
              ...getCowMutationArgs(),
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
  const editingRule = existingRules?.find((r) => r._id === editingRuleId);

  // Early return for loading state
  if (!dataReady || !appointmentTypes || !practitioners || !locations) {
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
      {existingRules?.map((rule) => {
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

            const conditions = conditionTreeToConditions(
              conditionTree as ConditionTreeNode,
            );
            const ruleName = generateRuleName(
              conditions,
              appointmentTypes,
              practitioners,
              locations,
            );

            const createResult = await createRuleMutation({
              conditionTree: conditionTree as Parameters<
                typeof createRuleMutation
              >[0]["conditionTree"],
              ...(previousRule ? getReplayCopySource(previousRule) : {}),
              enabled: true,
              name: ruleName,
              practiceId,
              ...getCowMutationArgs(),
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
                appointmentTypes,
                practitioners,
                locations,
              );
              const currentRuleState = serializeRuleStateForComparison({
                conditionTree: currentRuleLineageTree,
                enabled: true,
              });
              const previousRuleLineageTree = normalizeConditionTreeToLineage(
                previousRule.conditionTree,
                appointmentTypes,
                practitioners,
                locations,
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

                  const recreateResult = await createRuleMutation({
                    conditionTree: preparedRule.conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    ...getReplayCopySource(previousRule),
                    enabled: true,
                    name: ruleName,
                    practiceId,
                    ...getCowMutationArgs(),
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

                  const recreatePrevious = await createRuleMutation({
                    conditionTree: preparedRule.conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    ...getReplayCopySource(previousRule),
                    enabled: previousRule.enabled,
                    name: previousRuleName,
                    practiceId,
                    ...getCowMutationArgs(),
                  });
                  handleDraftMutationResult(recreatePrevious);
                  currentRuleId = recreatePrevious.entityId;
                  return { status: "applied" as const };
                },
              });
            } else {
              const createdRuleLineageTree = normalizeConditionTreeToLineage(
                conditionTree,
                appointmentTypes,
                practitioners,
                locations,
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
                  const recreateResult = await createRuleMutation({
                    conditionTree: preparedRule.conditionTree as Parameters<
                      typeof createRuleMutation
                    >[0]["conditionTree"],
                    enabled: true,
                    name: ruleName,
                    practiceId,
                    ...getCowMutationArgs(),
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
  entities: NamedEntity[],
  missingLabel: string,
  missingGroups: Set<string>,
): (lineageKey: string) => null | string {
  const entityIds = new Set(entities.map((entry) => entry._id));
  const entityIdByLineageKey = new Map(
    entities.map((entry) => [entry.lineageKey ?? entry._id, entry._id]),
  );

  return (lineageKey) => {
    if (entityIds.has(lineageKey)) {
      return lineageKey;
    }

    const entityId = entityIdByLineageKey.get(lineageKey);
    if (entityId) {
      return entityId;
    }

    missingGroups.add(missingLabel);
    return null;
  };
}

function createLineageKeyResolver(
  entities: NamedEntity[],
): (id: string) => string {
  const lineageKeyById = new Map(
    entities.map((entry) => [entry._id, entry.lineageKey ?? entry._id]),
  );

  return (id) => lineageKeyById.get(id) ?? id;
}

function normalizeConditionTreeForComparison(
  conditionTree: unknown,
  normalizeAppointmentTypeId: (id: string) => string,
  normalizePractitionerId: (id: string) => string,
  normalizeLocationId: (id: string) => string,
): unknown {
  if (!conditionTree || typeof conditionTree !== "object") {
    return conditionTree;
  }

  if (Array.isArray(conditionTree)) {
    return conditionTree.map((node) =>
      normalizeConditionTreeForComparison(
        node,
        normalizeAppointmentTypeId,
        normalizePractitionerId,
        normalizeLocationId,
      ),
    );
  }

  const node = conditionTree as Record<string, unknown>;
  const nodeType = node["nodeType"];
  const valueIds = node["valueIds"];
  const conditionType = node["conditionType"];
  const children = node["children"];

  if (
    nodeType === "CONDITION" &&
    Array.isArray(valueIds) &&
    typeof conditionType === "string"
  ) {
    const normalizeId =
      conditionType === "APPOINTMENT_TYPE" ||
      conditionType === "CONCURRENT_COUNT" ||
      conditionType === "DAILY_CAPACITY"
        ? normalizeAppointmentTypeId
        : conditionType === "PRACTITIONER"
          ? normalizePractitionerId
          : conditionType === "LOCATION"
            ? normalizeLocationId
            : null;

    if (!normalizeId) {
      return node;
    }

    return {
      ...node,
      valueIds: valueIds
        .filter((valueId): valueId is string => typeof valueId === "string")
        .map((valueId) => normalizeId(valueId)),
    };
  }

  if ((nodeType === "AND" || nodeType === "NOT") && Array.isArray(children)) {
    return {
      ...node,
      children: children.map((child) =>
        normalizeConditionTreeForComparison(
          child,
          normalizeAppointmentTypeId,
          normalizePractitionerId,
          normalizeLocationId,
        ),
      ),
    };
  }

  return node;
}

function normalizeConditionTreeToLineage(
  conditionTree: unknown,
  appointmentTypes: NamedEntity[],
  practitioners: NamedEntity[],
  locations: NamedEntity[],
) {
  return normalizeConditionTreeForComparison(
    conditionTree,
    createLineageKeyResolver(appointmentTypes),
    createLineageKeyResolver(practitioners),
    createLineageKeyResolver(locations),
  );
}

function prepareRuleConditionTreeForReplay(
  conditionTree: unknown,
  appointmentTypes: NamedEntity[],
  practitioners: NamedEntity[],
  locations: NamedEntity[],
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
  conditionTree: unknown,
  remapAppointmentTypeId: (id: string) => null | string,
  remapPractitionerId: (id: string) => null | string,
  remapLocationId: (id: string) => null | string,
): unknown {
  if (!conditionTree || typeof conditionTree !== "object") {
    return conditionTree;
  }

  if (Array.isArray(conditionTree)) {
    return conditionTree.map((node) =>
      remapConditionTreeReferences(
        node,
        remapAppointmentTypeId,
        remapPractitionerId,
        remapLocationId,
      ),
    );
  }

  const node = conditionTree as Record<string, unknown>;
  const nodeType = node["nodeType"];
  const valueIds = node["valueIds"];
  const conditionType = node["conditionType"];
  const children = node["children"];

  if (
    nodeType === "CONDITION" &&
    Array.isArray(valueIds) &&
    typeof conditionType === "string"
  ) {
    const remapId =
      conditionType === "APPOINTMENT_TYPE" ||
      conditionType === "CONCURRENT_COUNT" ||
      conditionType === "DAILY_CAPACITY"
        ? remapAppointmentTypeId
        : conditionType === "PRACTITIONER"
          ? remapPractitionerId
          : conditionType === "LOCATION"
            ? remapLocationId
            : null;

    if (!remapId) {
      return node;
    }

    const remappedValueIds: string[] = [];
    for (const valueId of valueIds) {
      if (typeof valueId !== "string") {
        continue;
      }
      const remappedId = remapId(valueId);
      if (remappedId) {
        remappedValueIds.push(remappedId);
      }
    }

    return {
      ...node,
      valueIds: remappedValueIds,
    };
  }

  if ((nodeType === "AND" || nodeType === "NOT") && Array.isArray(children)) {
    return {
      ...node,
      children: children.map((child) =>
        remapConditionTreeReferences(
          child,
          remapAppointmentTypeId,
          remapPractitionerId,
          remapLocationId,
        ),
      ),
    };
  }

  return node;
}

function serializeRuleState(conditionTree: unknown, enabled: boolean): string {
  return JSON.stringify(
    {
      conditionTree,
      enabled,
    },
    (_, value: unknown) => {
      if (!value || Array.isArray(value) || typeof value !== "object") {
        return value;
      }

      const objectValue = value as Record<string, unknown>;
      const sortedEntries = Object.entries(objectValue).toSorted(([a], [b]) =>
        a.localeCompare(b),
      );
      return Object.fromEntries(sortedEntries);
    },
  );
}

function serializeRuleStateForComparison(params: {
  conditionTree: unknown;
  enabled: boolean;
}): string {
  return serializeRuleState(params.conditionTree, params.enabled);
}
