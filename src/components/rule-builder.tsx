import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Combobox, type ComboboxOption } from "@/src/components/combobox";

// UI segment types
type ConjunctionType = "concurrent" | "dann" | "und";

type FilterType =
  | "APPOINTMENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "LOCATION"
  | "PRACTITIONER";
type OperatorType = "ist" | "nicht";

interface RuleBuilderProps {
  onRuleCreated?: () => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

type Segment =
  | {
      count: null | number;
      crossTypeAppointmentTypes: null | string[];
      crossTypeComparison: "EQUALS" | "GREATER_THAN_OR_EQUAL" | null;
      crossTypeCount: null | number;
      scope: "location" | "practice" | "practitioner" | null;
      type: "concurrent-params";
    }
  | {
      count: null | number;
      per: "location" | "practice" | "practitioner" | null;
      type: "daily-capacity-params";
    }
  | { days: null | number; type: "days-ahead" }
  | {
      filterType: FilterType;
      isExclude: boolean;
      selected: string[];
      type: "filter-value";
    }
  | { selected: ConjunctionType | null; type: "conjunction" }
  | { selected: FilterType | null; type: "filter-type" }
  | { selected: null | OperatorType; type: "operator" };

interface SegmentRendererProps {
  appointmentTypes: Doc<"appointmentTypes">[];
  hasAnyFilter: boolean;
  index: number;
  locations: Doc<"locations">[];
  onConcurrentParamsUpdate: (
    index: number,
    field: string,
    value: null | number | string | string[],
  ) => void;
  onConjunctionSelect: (index: number, conjunction: ConjunctionType) => void;
  onDailyCapacityParamsUpdate: (
    index: number,
    field: "count" | "per",
    value: null | number | string,
  ) => void;
  onDaysAheadUpdate: (index: number, days: number) => void;
  onFilterTypeSelect: (index: number, filterType: FilterType) => void;
  onFilterValueSelect: (index: number, values: string | string[]) => void;
  onOperatorSelect: (
    index: number,
    operator: OperatorType,
    filterType: FilterType,
  ) => void;
  practitioners: Doc<"practitioners">[];
  segment: Segment;
  segments: Segment[];
}

export function RuleBuilder({
  onRuleCreated,
  practiceId,
  ruleSetId,
}: RuleBuilderProps) {
  const createRuleMutation = useMutation(api.entities.createRule);
  const deleteRuleMutation = useMutation(api.entities.deleteRule);

  // Query data from Convex
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const locations = useQuery(api.entities.getLocations, { ruleSetId });
  const existingRules = useQuery(api.entities.getRules, { ruleSetId });

  // Check if all data is loaded
  const dataReady = Boolean(appointmentTypes && practitioners && locations);

  // Map of rule ID to segments (for existing AND new rules)
  // Only initialize when data is ready
  const [ruleSegments, setRuleSegments] = useState(
    () => new Map<"new" | Id<"ruleConditions">, Segment[]>(),
  );

  // Initialize segments from existing rules - memoized to only compute when needed
  const initializedSegments = useMemo(() => {
    if (!dataReady || !existingRules) {
      return new Map<"new" | Id<"ruleConditions">, Segment[]>();
    }
    const map = new Map<"new" | Id<"ruleConditions">, Segment[]>();
    for (const rule of existingRules) {
      map.set(rule._id, conditionTreeToSegments(rule.conditionTree));
    }
    return map;
  }, [dataReady, existingRules]);

  // Sync state with initialized segments
  if (initializedSegments.size > 0 && ruleSegments.size === 0) {
    setRuleSegments(initializedSegments);
  }

  const startBuilding = () => {
    setRuleSegments((prev) => {
      const newMap = new Map(prev);
      newMap.set("new", [{ selected: null, type: "filter-type" }]);
      return newMap;
    });
  };

  const removeNewRule = () => {
    setRuleSegments((prev) => {
      const newMap = new Map(prev);
      newMap.delete("new");
      return newMap;
    });
  };

  const updateSegment = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    updates: Partial<Segment>,
  ) => {
    setRuleSegments((prev) => {
      const newMap = new Map(prev);
      const segments = newMap.get(ruleId) ?? [];
      const newSegments = [...segments];
      newSegments[index] = { ...newSegments[index], ...updates } as Segment;
      newMap.set(ruleId, newSegments.slice(0, index + 1));
      return newMap;
    });
  };

  const addSegment = (
    ruleId: "new" | Id<"ruleConditions">,
    segment: Segment,
  ) => {
    setRuleSegments((prev) => {
      const newMap = new Map(prev);
      const segments = newMap.get(ruleId) ?? [];
      newMap.set(ruleId, [...segments, segment]);
      return newMap;
    });
  };

  const handleFilterTypeSelect = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    filterType: FilterType,
  ) => {
    updateSegment(ruleId, index, { selected: filterType });

    if (filterType === "DAYS_AHEAD") {
      addSegment(ruleId, {
        days: null,
        type: "days-ahead",
      });
    } else if (filterType === "DAILY_CAPACITY") {
      addSegment(ruleId, {
        count: null,
        per: null,
        type: "daily-capacity-params",
      });
    } else {
      addSegment(ruleId, {
        selected: null,
        type: "operator",
      });
    }
  };

  const handleOperatorSelect = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    operator: OperatorType,
    filterType: FilterType,
  ) => {
    updateSegment(ruleId, index, { selected: operator });

    addSegment(ruleId, {
      filterType,
      isExclude: operator === "nicht",
      selected: [],
      type: "filter-value",
    });
  };

  const handleFilterValueSelect = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    values: string | string[],
  ) => {
    const valueArray = Array.isArray(values) ? values : [values];
    updateSegment(ruleId, index, { selected: valueArray });

    addSegment(ruleId, {
      selected: null,
      type: "conjunction",
    });
  };

  const handleDaysAheadUpdate = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    days: number,
  ) => {
    updateSegment(ruleId, index, { days });

    if (days > 0) {
      addSegment(ruleId, {
        selected: null,
        type: "conjunction",
      });
    }
  };

  const handleConjunctionSelect = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    conjunction: ConjunctionType,
  ) => {
    updateSegment(ruleId, index, { selected: conjunction });

    if (conjunction === "dann") {
      // Rule is complete, auto-save
      void handleSave(ruleId);
      return;
    } else if (conjunction === "concurrent") {
      addSegment(ruleId, {
        count: null,
        crossTypeAppointmentTypes: null,
        crossTypeComparison: null,
        crossTypeCount: null,
        scope: null,
        type: "concurrent-params",
      });
    } else {
      addSegment(ruleId, {
        selected: null,
        type: "filter-type",
      });
    }
  };

  const handleDailyCapacityParamsUpdate = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    field: "count" | "per",
    value: null | number | string,
  ) => {
    updateSegment(ruleId, index, { [field]: value });

    const segments = ruleSegments.get(ruleId) ?? [];
    const seg = segments[index];
    if (
      seg?.type === "daily-capacity-params" &&
      seg.count !== null &&
      seg.count > 0 &&
      seg.per !== null
    ) {
      const nextIndex = index + 1;
      if (
        nextIndex >= segments.length ||
        segments[nextIndex]?.type !== "conjunction"
      ) {
        addSegment(ruleId, {
          selected: null,
          type: "conjunction",
        });
      }
    }
  };

  const handleConcurrentParamsUpdate = (
    ruleId: "new" | Id<"ruleConditions">,
    index: number,
    field: string,
    value: null | number | string | string[],
  ) => {
    updateSegment(ruleId, index, { [field]: value });
  };

  const hasIncludeOrExcludeFilter = (ruleId: "new" | Id<"ruleConditions">) => {
    const segments = ruleSegments.get(ruleId) ?? [];
    return segments.some(
      (seg) =>
        seg.type === "filter-value" ||
        seg.type === "days-ahead" ||
        seg.type === "daily-capacity-params",
    );
  };

  const handleSave = async (ruleId: "new" | Id<"ruleConditions">) => {
    const segments = ruleSegments.get(ruleId) ?? [];
    // Build condition tree from segments
    const conditionTree = buildConditionTree(segments);

    // Generate rule name from segments
    const ruleName = generateRuleName(segments);

    try {
      if (ruleId !== "new") {
        // Update existing rule (delete and recreate)
        await deleteRuleMutation({
          practiceId,
          ruleId,
          sourceRuleSetId: ruleSetId,
        });
      }

      await createRuleMutation({
        conditionTree: conditionTree as Parameters<
          typeof createRuleMutation
        >[0]["conditionTree"],
        enabled: true,
        name: ruleName,
        practiceId,
        sourceRuleSetId: ruleSetId,
      });

      // Don't delete from local state - let Convex reactively update existingRules
      // When existingRules updates, useMemo will create a new initializedSegments map
      // We need to force a re-sync by clearing the map, which will trigger the sync logic
      setRuleSegments(new Map());

      onRuleCreated?.();
    } catch (error) {
      console.error("Failed to save rule:", error);
    }
  };

  const handleDeleteRule = async (ruleId: Id<"ruleConditions">) => {
    try {
      await deleteRuleMutation({
        practiceId,
        ruleId,
        sourceRuleSetId: ruleSetId,
      });
      // Remove from map
      setRuleSegments((prev) => {
        const newMap = new Map(prev);
        newMap.delete(ruleId);
        return newMap;
      });
      onRuleCreated?.();
    } catch (error) {
      console.error("Failed to delete rule:", error);
    }
  };

  // Helper to create segment renderers for a specific rule
  const renderRuleSegments = (ruleId: "new" | Id<"ruleConditions">) => {
    const segments = ruleSegments.get(ruleId) ?? [];

    // Early return if data not ready (should never happen due to guards below, but satisfies linter)
    if (!appointmentTypes || !locations || !practitioners) {
      return null;
    }

    return segments.map((segment, index) => (
      <SegmentRenderer
        appointmentTypes={appointmentTypes}
        hasAnyFilter={hasIncludeOrExcludeFilter(ruleId)}
        index={index}
        key={index}
        locations={locations}
        onConcurrentParamsUpdate={(idx, field, value) => {
          handleConcurrentParamsUpdate(ruleId, idx, field, value);
        }}
        onConjunctionSelect={(idx, conjunction) => {
          handleConjunctionSelect(ruleId, idx, conjunction);
        }}
        onDailyCapacityParamsUpdate={(idx, field, value) => {
          handleDailyCapacityParamsUpdate(ruleId, idx, field, value);
        }}
        onDaysAheadUpdate={(idx, days) => {
          handleDaysAheadUpdate(ruleId, idx, days);
        }}
        onFilterTypeSelect={(idx, filterType) => {
          handleFilterTypeSelect(ruleId, idx, filterType);
        }}
        onFilterValueSelect={(idx, values) => {
          handleFilterValueSelect(ruleId, idx, values);
        }}
        onOperatorSelect={(idx, operator, filterType) => {
          handleOperatorSelect(ruleId, idx, operator, filterType);
        }}
        practitioners={practitioners}
        segment={segment}
        segments={segments}
      />
    ));
  };

  return (
    <div className="space-y-4">
      {/* Show loading state if data is still loading */}
      {(!appointmentTypes || !practitioners || !locations) && (
        <div className="text-sm text-muted-foreground">Lade Daten...</div>
      )}

      {/* Render all existing rules as editable segments */}
      {appointmentTypes &&
        practitioners &&
        locations &&
        existingRules?.map((rule) => {
          const segments = ruleSegments.get(rule._id);
          if (!segments) {
            return null;
          }

          return (
            <Card className="p-6" key={rule._id}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="font-medium text-sm text-muted-foreground">
                  {generateRuleName(segments)}
                </div>
                <Button
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    void handleDeleteRule(rule._id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ButtonGroup className="flex-wrap gap-y-2">
                {renderRuleSegments(rule._id)}
              </ButtonGroup>
            </Card>
          );
        })}

      {/* Render new rule being created */}
      {appointmentTypes &&
        practitioners &&
        locations &&
        ruleSegments.has("new") && (
          <Card className="p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="font-medium text-sm text-muted-foreground">
                Neue Regel
              </div>
              <Button
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={removeNewRule}
                size="icon"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <ButtonGroup className="flex-wrap gap-y-2">
              {renderRuleSegments("new")}
            </ButtonGroup>
          </Card>
        )}

      {/* Add new rule button */}
      {appointmentTypes &&
        practitioners &&
        locations &&
        !ruleSegments.has("new") && (
          <Button className="gap-2" onClick={startBuilding}>
            <Plus className="h-4 w-4" />
            Neue Regel
          </Button>
        )}
    </div>
  );
}

function ConcurrentParamsRenderer({
  appointmentTypes,
  comparisonOperatorOptions,
  concurrentScopeOptions,
  index,
  onUpdate,
  segment,
}: {
  appointmentTypes: Doc<"appointmentTypes">[];
  comparisonOperatorOptions: ComboboxOption[];
  concurrentScopeOptions: ComboboxOption[];
  index: number;
  onUpdate: (
    index: number,
    field: string,
    value: null | number | string | string[],
  ) => void;
  segment: Extract<Segment, { type: "concurrent-params" }>;
}) {
  const hasCrossType =
    (segment.crossTypeAppointmentTypes &&
      segment.crossTypeAppointmentTypes.length > 0) ||
    segment.crossTypeCount !== null;
  const appointmentLabel =
    segment.crossTypeCount === 1 ? "gebucht ist," : "gebucht sind,";

  const appointmentTypeOptions: ComboboxOption[] = appointmentTypes.map(
    (at) => ({
      label: at.name,
      value: at._id,
    }),
  );

  return (
    <>
      <Input
        className="w-20"
        min="0"
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value);
          onUpdate(index, "count", Number.isNaN(parsed) ? null : parsed);
        }}
        placeholder="Anzahl"
        type="number"
        value={segment.count ?? ""}
      />
      <Combobox
        onValueChange={(value: string | string[]) => {
          onUpdate(index, "scope", value);
        }}
        options={concurrentScopeOptions}
        placeholder="Bereich..."
        value={segment.scope || ""}
      />
      <Combobox
        onValueChange={(value: string | string[]) => {
          if (value === "none") {
            onUpdate(index, "crossTypeAppointmentTypes", null);
            onUpdate(index, "crossTypeCount", null);
            onUpdate(index, "crossTypeComparison", null);
          }
        }}
        options={[
          { label: "und", value: "none" },
          { label: "nur wenn bereits", value: "cross-type" },
        ]}
        placeholder="Optional..."
        value={hasCrossType ? "cross-type" : "none"}
      />
      {hasCrossType && (
        <>
          <Combobox
            onValueChange={(value: string | string[]) => {
              onUpdate(index, "crossTypeComparison", value);
            }}
            options={comparisonOperatorOptions}
            placeholder="Vergleich..."
            value={segment.crossTypeComparison || ""}
          />
          <Input
            className="w-20"
            min="1"
            onChange={(e) => {
              onUpdate(
                index,
                "crossTypeCount",
                Number.parseInt(e.target.value) || null,
              );
            }}
            placeholder="Anzahl"
            type="number"
            value={segment.crossTypeCount ?? ""}
          />
          <Combobox
            multiple
            onValueChange={(value: string | string[]) => {
              onUpdate(index, "crossTypeAppointmentTypes", value);
            }}
            options={appointmentTypeOptions}
            placeholder="Termintypen..."
            value={segment.crossTypeAppointmentTypes ?? []}
          />
          <ButtonGroupText>{appointmentLabel}</ButtonGroupText>
        </>
      )}
    </>
  );
}

function DailyCapacityParamsRenderer({
  dailyCapacityPerOptions,
  index,
  onUpdate,
  segment,
}: {
  dailyCapacityPerOptions: ComboboxOption[];
  index: number;
  onUpdate: (
    index: number,
    field: "count" | "per",
    value: null | number | string,
  ) => void;
  segment: Extract<Segment, { type: "daily-capacity-params" }>;
}) {
  const appointmentLabel = segment.count === 1 ? "Termin" : "Termine";

  return (
    <>
      <Input
        className="w-20"
        min="1"
        onChange={(e) => {
          onUpdate(index, "count", Number.parseInt(e.target.value) || null);
        }}
        placeholder="Anzahl"
        type="number"
        value={segment.count || ""}
      />
      <ButtonGroupText>oder mehr {appointmentLabel}</ButtonGroupText>
      <Combobox
        onValueChange={(value: string | string[]) => {
          onUpdate(index, "per", value as string);
        }}
        options={dailyCapacityPerOptions}
        placeholder="pro..."
        value={segment.per || ""}
      />
      <ButtonGroupText>gebucht wurden,</ButtonGroupText>
    </>
  );
}

function DaysAheadRenderer({
  index,
  onUpdate,
  segment,
}: {
  index: number;
  onUpdate: (index: number, days: number) => void;
  segment: Extract<Segment, { type: "days-ahead" }>;
}) {
  const dayLabel =
    segment.days === 1 ? "Tag entfernt ist," : "Tage entfernt ist,";

  return (
    <>
      <Input
        className="w-20"
        min="1"
        onChange={(e) => {
          onUpdate(index, Number.parseInt(e.target.value) || 0);
        }}
        placeholder="Anzahl"
        type="number"
        value={segment.days || ""}
      />
      <ButtonGroupText>{dayLabel}</ButtonGroupText>
    </>
  );
}

function SegmentRenderer({
  appointmentTypes,
  hasAnyFilter,
  index,
  locations,
  onConcurrentParamsUpdate,
  onConjunctionSelect,
  onDailyCapacityParamsUpdate,
  onDaysAheadUpdate,
  onFilterTypeSelect,
  onFilterValueSelect,
  onOperatorSelect,
  practitioners,
  segment,
  segments,
}: SegmentRendererProps) {
  const showSeparatorAfter =
    segment.type === "daily-capacity-params" ||
    segment.type === "concurrent-params";

  const filterTypeOptions: ComboboxOption[] = [
    { label: "Termintyp", value: "APPOINTMENT_TYPE" },
    { label: "Behandler", value: "PRACTITIONER" },
    { label: "Standort", value: "LOCATION" },
    { label: "Wochentag", value: "DAY_OF_WEEK" },
    { label: "Der Termin", value: "DAYS_AHEAD" },
    { label: "Tageskapazität", value: "DAILY_CAPACITY" },
  ];

  const getFilterValueOptions = (filterType: FilterType): ComboboxOption[] => {
    switch (filterType) {
      case "APPOINTMENT_TYPE": {
        return appointmentTypes.map((at) => ({
          label: at.name,
          value: at._id,
        }));
      }
      case "DAY_OF_WEEK": {
        return [
          { label: "Montag", value: "MONDAY" },
          { label: "Dienstag", value: "TUESDAY" },
          { label: "Mittwoch", value: "WEDNESDAY" },
          { label: "Donnerstag", value: "THURSDAY" },
          { label: "Freitag", value: "FRIDAY" },
          { label: "Samstag", value: "SATURDAY" },
          { label: "Sonntag", value: "SUNDAY" },
        ];
      }
      case "LOCATION": {
        return locations.map((l) => ({
          label: l.name,
          value: l._id,
        }));
      }
      case "PRACTITIONER": {
        return practitioners.map((p) => ({
          label: p.name,
          value: p._id,
        }));
      }
      default: {
        return [];
      }
    }
  };

  const getConjunctionOptions = (): ComboboxOption[] => {
    const hasCondition = segments.some(
      (seg) => seg.type === "concurrent-params",
    );

    const baseOptions: ComboboxOption[] = [{ label: "und", value: "und" }];

    if (!hasCondition) {
      baseOptions.push({
        label: "gleichzeitig max.",
        value: "concurrent",
      });
    }

    if (hasAnyFilter) {
      baseOptions.push({
        label: "dann blockiere diesen Termin.",
        value: "dann",
      });
    }

    return baseOptions;
  };

  const getFilterTypeForOperator = (): FilterType | null => {
    const filterTypeSegment = segments
      .slice(0, index)
      .toReversed()
      .find((s) => s.type === "filter-type");
    return filterTypeSegment?.type === "filter-type"
      ? filterTypeSegment.selected
      : null;
  };

  const dailyCapacityPerOptions: ComboboxOption[] = [
    { label: "pro Behandler", value: "practitioner" },
    { label: "pro Standort", value: "location" },
    { label: "pro Praxis", value: "practice" },
  ];

  const concurrentScopeOptions: ComboboxOption[] = [
    { label: "beim gleichen Behandler", value: "practitioner" },
    { label: "am gleichen Standort", value: "location" },
    { label: "in der gesamten Praxis", value: "practice" },
  ];

  const comparisonOperatorOptions: ComboboxOption[] = [
    { label: "mindestens", value: "GREATER_THAN_OR_EQUAL" },
    { label: "genau", value: "EQUALS" },
  ];

  return (
    <>
      {segment.type === "filter-type" && (
        <Combobox
          onValueChange={(value: string | string[]) => {
            onFilterTypeSelect(index, value as FilterType);
          }}
          options={filterTypeOptions}
          placeholder="Filter wählen..."
          value={segment.selected || ""}
        />
      )}

      {segment.type === "operator" && (
        <Combobox
          onValueChange={(value: string | string[]) => {
            const filterType = getFilterTypeForOperator();
            if (filterType) {
              onOperatorSelect(index, value as OperatorType, filterType);
            }
          }}
          options={[
            { label: "ist", value: "ist" },
            { label: "nicht", value: "nicht" },
          ]}
          placeholder="Operator..."
          value={segment.selected || ""}
        />
      )}

      {segment.type === "filter-value" && (
        <Combobox
          className={cn(
            segment.isExclude &&
              "bg-[var(--exclude-tint)] border-[var(--exclude-border)]",
          )}
          inverted={segment.isExclude}
          multiple
          onValueChange={(value: string | string[]) => {
            onFilterValueSelect(index, value);
          }}
          options={getFilterValueOptions(segment.filterType)}
          placeholder="Wert wählen..."
          value={segment.selected}
        />
      )}

      {segment.type === "days-ahead" && (
        <DaysAheadRenderer
          index={index}
          onUpdate={onDaysAheadUpdate}
          segment={segment}
        />
      )}

      {segment.type === "conjunction" && (
        <Combobox
          onValueChange={(value: string | string[]) => {
            onConjunctionSelect(index, value as ConjunctionType);
          }}
          options={getConjunctionOptions()}
          placeholder="Verbindung..."
          value={segment.selected || ""}
        />
      )}

      {segment.type === "daily-capacity-params" && (
        <DailyCapacityParamsRenderer
          dailyCapacityPerOptions={dailyCapacityPerOptions}
          index={index}
          onUpdate={onDailyCapacityParamsUpdate}
          segment={segment}
        />
      )}

      {segment.type === "concurrent-params" && (
        <ConcurrentParamsRenderer
          appointmentTypes={appointmentTypes}
          comparisonOperatorOptions={comparisonOperatorOptions}
          concurrentScopeOptions={concurrentScopeOptions}
          index={index}
          onUpdate={onConcurrentParamsUpdate}
          segment={segment}
        />
      )}

      {showSeparatorAfter && <ButtonGroupSeparator />}
    </>
  );
}

// Helper function to convert a condition tree back to segments for editing
function conditionTreeToSegments(tree: unknown): Segment[] {
  // Basic validation - if tree is invalid, start fresh
  if (!tree || typeof tree !== "object") {
    return [{ selected: null, type: "filter-type" }];
  }

  const segments: Segment[] = [];
  const node = tree as Record<string, unknown>;

  // Handle AND node with multiple conditions
  if (node["nodeType"] === "AND" && Array.isArray(node["children"])) {
    const children = node["children"] as Record<string, unknown>[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) {
        continue;
      }
      const childSegments = parseConditionNode(child);
      segments.push(...childSegments);

      // Add conjunction between conditions (except after the last one)
      if (i < children.length - 1) {
        segments.push({ selected: "und", type: "conjunction" });
      }
    }
  } else if (node["nodeType"] === "CONDITION") {
    // Single condition without AND wrapper
    const childSegments = parseConditionNode(node);
    segments.push(...childSegments);
  }

  // Always end with the "dann" conjunction and action
  segments.push({ selected: "dann", type: "conjunction" });

  return segments;
}

// Helper to parse a single condition node into segments
function parseConditionNode(node: Record<string, unknown>): Segment[] {
  const segments: Segment[] = [];
  const conditionType = node["conditionType"] as string;

  // Add filter type segment
  segments.push({
    selected: conditionType as FilterType,
    type: "filter-type",
  });

  // Handle different condition types
  switch (conditionType) {
    case "CONCURRENT_COUNT": {
      const valueIds = node["valueIds"] as string[];
      segments.push({
        count: (node["valueNumber"] as null | number) ?? null,
        crossTypeAppointmentTypes: null,
        crossTypeComparison: null,
        crossTypeCount: null,
        scope: (valueIds[0] ?? null) as
          | "location"
          | "practice"
          | "practitioner"
          | null,
        type: "concurrent-params",
      });

      break;
    }
    case "DAILY_CAPACITY": {
      const valueIds = node["valueIds"] as string[];
      segments.push({
        count: (node["valueNumber"] as null | number) ?? null,
        per: (valueIds[0] ?? null) as
          | "location"
          | "practice"
          | "practitioner"
          | null,
        type: "daily-capacity-params",
      });

      break;
    }
    case "DAYS_AHEAD": {
      segments.push({
        days: (node["valueNumber"] as null | number) ?? null,
        type: "days-ahead",
      });

      break;
    }
    default: {
      // Handle filter types with operator and values (APPOINTMENT_TYPE, PRACTITIONER, LOCATION, DAY_OF_WEEK)
      const operator = node["operator"] as string;
      const isExclude = operator === "IS_NOT";

      segments.push({
        selected: isExclude ? "nicht" : "ist",
        type: "operator",
      });

      // Special handling for DAY_OF_WEEK: convert valueNumber to day name
      if (conditionType === "DAY_OF_WEEK") {
        const dayNumber = (node["valueNumber"] as null | number) ?? 0;
        const dayName = dayNumberToName(dayNumber);

        segments.push({
          filterType: conditionType as FilterType,
          isExclude,
          selected: [dayName],
          type: "filter-value",
        });
      } else {
        const valueIds = node["valueIds"] as string[] | undefined;
        segments.push({
          filterType: conditionType as FilterType,
          isExclude,
          selected: valueIds ?? [],
          type: "filter-value",
        });
      }
    }
  }

  return segments;
}

// Helper function to convert day name to numeric day of week
// JavaScript Date.getDay() returns 0=Sunday, 1=Monday, ..., 6=Saturday
function dayNameToNumber(dayName: string): number {
  const dayMap: Record<string, number> = {
    FRIDAY: 5,
    MONDAY: 1,
    SATURDAY: 6,
    SUNDAY: 0,
    THURSDAY: 4,
    TUESDAY: 2,
    WEDNESDAY: 3,
  };
  return dayMap[dayName] ?? 0;
}

// Helper function to convert numeric day of week to day name
function dayNumberToName(dayNumber: number): string {
  const dayNames = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return dayNames[dayNumber] ?? "SUNDAY";
}

// Helper function to build the Convex condition tree from segments
function buildConditionTree(segments: Segment[]): unknown {
  const conditions: unknown[] = [];
  let concurrentCondition: unknown = null;

  for (const seg of segments) {
    if (seg.type === "filter-value" && seg.selected.length > 0) {
      const conditionType = seg.filterType;
      const operator = seg.isExclude ? "IS_NOT" : "IS";

      // Special handling for DAY_OF_WEEK: convert day names to numbers
      if (conditionType === "DAY_OF_WEEK" && seg.selected.length > 0) {
        // For DAY_OF_WEEK, we convert the first selected day name to a number
        // Note: Current UI only allows single day selection, but we handle array
        const dayName = seg.selected[0];
        const dayNumber = dayName ? dayNameToNumber(dayName) : 0;

        // DAY_OF_WEEK uses numeric comparison, so use EQUALS operator
        conditions.push({
          conditionType,
          nodeType: "CONDITION",
          operator: "EQUALS",
          valueNumber: dayNumber,
        });
      } else {
        conditions.push({
          conditionType,
          nodeType: "CONDITION",
          operator,
          valueIds: seg.selected,
        });
      }
    } else if (seg.type === "days-ahead" && seg.days !== null) {
      conditions.push({
        conditionType: "DAYS_AHEAD",
        nodeType: "CONDITION",
        operator: "GREATER_THAN_OR_EQUAL",
        valueNumber: seg.days,
      });
    } else if (
      seg.type === "daily-capacity-params" &&
      seg.count !== null &&
      seg.per !== null
    ) {
      conditions.push({
        conditionType: "DAILY_CAPACITY",
        nodeType: "CONDITION",
        operator: "GREATER_THAN_OR_EQUAL",
        valueIds: [seg.per],
        valueNumber: seg.count,
      });
    } else if (
      seg.type === "concurrent-params" &&
      seg.count !== null &&
      seg.scope !== null
    ) {
      const concurrentNode: Record<string, unknown> = {
        conditionType: "CONCURRENT_COUNT",
        nodeType: "CONDITION",
        operator: "GREATER_THAN_OR_EQUAL",
        valueIds: [seg.scope],
        valueNumber: seg.count,
      };

      // TODO: Handle cross-type conditions when specified
      // This would require wrapping in AND node with additional conditions

      concurrentCondition = concurrentNode;
    }
  }

  // Build the final tree
  const allConditions = [...conditions];
  if (concurrentCondition) {
    allConditions.push(concurrentCondition);
  }

  if (allConditions.length === 1) {
    return allConditions[0];
  }

  return {
    children: allConditions,
    nodeType: "AND",
  };
}

// Helper function to generate a human-readable rule name from segments
function generateRuleName(segments: Segment[]): string {
  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.type === "filter-type" && seg.selected) {
      const filterTypeLabels: Record<FilterType, string> = {
        APPOINTMENT_TYPE: "Termintyp",
        CONCURRENT_COUNT: "Gleichzeitig",
        DAILY_CAPACITY: "Tageskapazität",
        DAY_OF_WEEK: "Wochentag",
        DAYS_AHEAD: "Termin",
        LOCATION: "Standort",
        PRACTITIONER: "Behandler",
      };
      parts.push(filterTypeLabels[seg.selected] || seg.selected);
    } else if (seg.type === "operator" && seg.selected) {
      parts.push(seg.selected);
    } else if (seg.type === "conjunction" && seg.selected === "und") {
      parts.push("und");
    }
  }

  return parts.join(" ") || "Neue Regel";
}
