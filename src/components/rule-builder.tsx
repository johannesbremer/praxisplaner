import { useMutation, useQuery } from "convex/react";
import { Check, Plus } from "lucide-react";
import { useState } from "react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
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
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const createRuleMutation = useMutation(api.entities.createRule);

  // Query data from Convex
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
  const locations = useQuery(api.entities.getLocations, { ruleSetId });

  const startBuilding = () => {
    setSegments([{ selected: null, type: "filter-type" }]);
    setIsBuilding(true);
  };

  const updateSegment = (index: number, updates: Partial<Segment>) => {
    setSegments((prev) => {
      const newSegments = [...prev];
      newSegments[index] = { ...newSegments[index], ...updates } as Segment;
      return newSegments.slice(0, index + 1);
    });
  };

  const addSegment = (segment: Segment) => {
    setSegments((prev) => [...prev, segment]);
  };

  const handleFilterTypeSelect = (index: number, filterType: FilterType) => {
    updateSegment(index, { selected: filterType });

    if (filterType === "DAYS_AHEAD") {
      addSegment({
        days: null,
        type: "days-ahead",
      });
    } else if (filterType === "DAILY_CAPACITY") {
      addSegment({
        count: null,
        per: null,
        type: "daily-capacity-params",
      });
    } else {
      addSegment({
        selected: null,
        type: "operator",
      });
    }
  };

  const handleOperatorSelect = (
    index: number,
    operator: OperatorType,
    filterType: FilterType,
  ) => {
    updateSegment(index, { selected: operator });

    addSegment({
      filterType,
      isExclude: operator === "nicht",
      selected: [],
      type: "filter-value",
    });
  };

  const handleFilterValueSelect = (
    index: number,
    values: string | string[],
  ) => {
    const valueArray = Array.isArray(values) ? values : [values];
    updateSegment(index, { selected: valueArray });

    addSegment({
      selected: null,
      type: "conjunction",
    });
  };

  const handleDaysAheadUpdate = (index: number, days: number) => {
    updateSegment(index, { days });

    if (days > 0) {
      addSegment({
        selected: null,
        type: "conjunction",
      });
    }
  };

  const handleConjunctionSelect = (
    index: number,
    conjunction: ConjunctionType,
  ) => {
    updateSegment(index, { selected: conjunction });

    if (conjunction === "dann") {
      return;
    } else if (conjunction === "concurrent") {
      addSegment({
        count: null,
        crossTypeAppointmentTypes: null,
        crossTypeComparison: null,
        crossTypeCount: null,
        scope: null,
        type: "concurrent-params",
      });
    } else {
      addSegment({
        selected: null,
        type: "filter-type",
      });
    }
  };

  const handleDailyCapacityParamsUpdate = (
    index: number,
    field: "count" | "per",
    value: null | number | string,
  ) => {
    updateSegment(index, { [field]: value });

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
        addSegment({
          selected: null,
          type: "conjunction",
        });
      }
    }
  };

  const handleConcurrentParamsUpdate = (
    index: number,
    field: string,
    value: null | number | string | string[],
  ) => {
    updateSegment(index, { [field]: value });
  };

  const isComplete = () => {
    const lastSeg = segments[segments.length - 1];
    if (!lastSeg) {
      return false;
    }

    if (lastSeg.type === "conjunction") {
      return lastSeg.selected === "dann";
    }

    return false;
  };

  const hasIncludeOrExcludeFilter = () => {
    return segments.some(
      (seg) =>
        seg.type === "filter-value" ||
        seg.type === "days-ahead" ||
        seg.type === "daily-capacity-params",
    );
  };

  const handleSave = async () => {
    // Build condition tree from segments
    const conditionTree = buildConditionTree(segments);

    // Generate rule name from segments
    const ruleName = generateRuleName(segments);

    try {
      await createRuleMutation({
        conditionTree: conditionTree as Parameters<
          typeof createRuleMutation
        >[0]["conditionTree"],
        enabled: true,
        name: ruleName,
        practiceId,
        sourceRuleSetId: ruleSetId,
      });

      setSegments([]);
      setIsBuilding(false);
      onRuleCreated?.();
    } catch (error) {
      console.error("Failed to create rule:", error);
    }
  };

  const reset = () => {
    setSegments([]);
    setIsBuilding(false);
  };

  return (
    <div className="space-y-4">
      {isBuilding ? (
        <Card className="p-6">
          <div className="space-y-6">
            <ButtonGroup className="flex-wrap gap-y-2">
              {segments.map((segment, index) => (
                <SegmentRenderer
                  appointmentTypes={appointmentTypes ?? []}
                  hasAnyFilter={hasIncludeOrExcludeFilter()}
                  index={index}
                  key={index}
                  locations={locations ?? []}
                  onConcurrentParamsUpdate={handleConcurrentParamsUpdate}
                  onConjunctionSelect={handleConjunctionSelect}
                  onDailyCapacityParamsUpdate={handleDailyCapacityParamsUpdate}
                  onDaysAheadUpdate={handleDaysAheadUpdate}
                  onFilterTypeSelect={handleFilterTypeSelect}
                  onFilterValueSelect={handleFilterValueSelect}
                  onOperatorSelect={handleOperatorSelect}
                  practitioners={practitioners ?? []}
                  segment={segment}
                  segments={segments}
                />
              ))}
            </ButtonGroup>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                className="gap-2"
                disabled={!isComplete()}
                onClick={() => {
                  void handleSave();
                }}
              >
                <Check className="h-4 w-4" />
                Regel speichern
              </Button>
              <Button onClick={reset} variant="outline">
                Abbrechen
              </Button>
            </div>
          </div>
        </Card>
      ) : (
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
          <span className="inline-flex items-center px-3 py-2 text-sm font-medium text-muted-foreground bg-muted/50 border border-border rounded-md pointer-events-none">
            {appointmentLabel}
          </span>
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
      <span className="inline-flex items-center px-3 py-2 text-sm font-medium text-muted-foreground bg-muted/50 border border-border rounded-md pointer-events-none">
        oder mehr {appointmentLabel}
      </span>
      <Combobox
        onValueChange={(value: string | string[]) => {
          onUpdate(index, "per", value as string);
        }}
        options={dailyCapacityPerOptions}
        placeholder="pro..."
        value={segment.per || ""}
      />
      <span className="inline-flex items-center px-3 py-2 text-sm font-medium text-muted-foreground bg-muted/50 border border-border rounded-md pointer-events-none">
        gebucht wurden,
      </span>
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
      <span className="inline-flex items-center px-3 py-2 text-sm font-medium text-muted-foreground bg-muted/50 border border-border rounded-md pointer-events-none">
        {dayLabel}
      </span>
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

// Helper function to build the Convex condition tree from segments
function buildConditionTree(segments: Segment[]): unknown {
  const conditions: unknown[] = [];
  let concurrentCondition: unknown = null;

  for (const seg of segments) {
    if (seg.type === "filter-value" && seg.selected.length > 0) {
      const conditionType = seg.filterType;
      const operator = seg.isExclude ? "IS_NOT" : "IS";

      conditions.push({
        conditionType,
        nodeType: "CONDITION",
        operator,
        valueIds: seg.selected,
      });
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
