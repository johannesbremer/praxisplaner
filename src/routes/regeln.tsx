// src/routes/regeln.tsx
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";
import type {
  ConditionOperator,
  ConditionTreeNode,
  ConditionType,
  Scope,
} from "@/convex/ruleEngine";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { validateRuleSetDescriptionSync } from "@/convex/ruleSetValidation";

import type { VersionNode } from "../components/version-graph/types";
import type { LocalHistoryAction } from "../hooks/use-local-history";
import type { PatientInfo } from "../types";
import type { SchedulingSimulatedContext } from "../types";
import type { RuleSetReplayTarget } from "../utils/cow-history";

import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../lib/rule-name-generator";
import { createSimulatedContext } from "../../lib/utils";
import { AppointmentTypeSelector } from "../components/appointment-type-selector";
import { AppointmentTypesManagement } from "../components/appointment-types-management";
import BaseScheduleManagement from "../components/base-schedule-management";
import { LocationSelector } from "../components/location-selector";
import { LocationsManagement } from "../components/locations-management";
import { MedicalStaffDisplay } from "../components/medical-staff-display";
import { PatientBookingFlow } from "../components/patient-booking-flow";
import PractitionerManagement from "../components/practitioner-management";
import { RuleBuilder } from "../components/rule-builder";
import { VacationScheduler } from "../components/vacation-scheduler";
import { VersionGraph } from "../components/version-graph/index";
import { useRegisterGlobalUndoRedoControls } from "../hooks/use-global-undo-redo-controls";
import { useLocalHistory } from "../hooks/use-local-history";
import { isValidDateDE } from "../utils/date-utils";
import { useErrorTracking } from "../utils/error-tracking";
import {
  frontendErrorFromUnknown,
  wrapAsyncResult,
} from "../utils/frontend-errors";
import {
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
  type RegelnSearchParams,
  type RegelnTabParam,
  useRegelnUrl,
} from "../utils/regeln-url";

export const Route = createFileRoute("/regeln")({
  component: LogicView,
  validateSearch: (search): RegelnSearchParams => {
    const params = search;

    const result: RegelnSearchParams = {};

    if (
      params["tab"] === "mitarbeiter" ||
      params["tab"] === "debug" ||
      params["tab"] === "urlaub"
    ) {
      result.tab = params["tab"] as RegelnTabParam;
    }

    if (
      typeof params["standort"] === "string" &&
      params["standort"].length > 0
    ) {
      result.standort = params["standort"];
    }

    if (isValidDateDE(params["datum"])) {
      result.datum = params["datum"];
    }

    if (params["patientType"] === EXISTING_PATIENT_SEGMENT) {
      result.patientType = EXISTING_PATIENT_SEGMENT;
    } else if (params["patientType"] === NEW_PATIENT_SEGMENT) {
      result.patientType = NEW_PATIENT_SEGMENT;
    }

    if (
      typeof params["regelwerk"] === "string" &&
      params["regelwerk"].length > 0
    ) {
      result.regelwerk = params["regelwerk"];
    }

    return result;
  },
});

interface EntityRenameMaps {
  appointmentTypes: Map<string, string>;
  locations: Map<string, string>;
  mfas: Map<string, string>;
  practitioners: Map<string, string>;
}

interface ProjectedRuleSetDiffSection {
  rows: StructuredDiffRow[];
  section: RuleSetDiffSection;
}

interface RuleNameContext {
  appointmentTypes: RuleNameEntity[];
  locations: RuleNameEntity[];
  practitioners: RuleNameEntity[];
}

interface RuleNameEntity {
  _id: string;
  name: string;
}

interface RuleSetDiff {
  draftRuleSet: {
    _id: string;
    description: string;
    version: number;
  };
  parentRuleSet: {
    _id: string;
    description: string;
    version: number;
  };
  sections: RuleSetDiffSection[];
  totals: {
    added: number;
    changed: number;
    removed: number;
  };
}

interface RuleSetDiffSection {
  added: string[];
  key: string;
  removed: string[];
  title: string;
}

interface SaveDialogFormProps {
  activationName: string;
  existingSavedDescriptions: string[];
  onDiscard?: (() => void) | null;
  onSaveAndActivate: (name: string) => void;
  onSaveOnly: (name: string) => void;
  ruleNameContext: RuleNameContext | undefined;
  ruleSetDiff?: null | RuleSetDiff | undefined;
  setActivationName: (name: string) => void;
}

type SimulatedContext = SchedulingSimulatedContext;

interface StructuredDiffRow {
  after: string;
  before: string;
  id: string;
  kind: "added" | "modified" | "removed";
  path: string;
}

const UNSAVED_RULE_SET_DESCRIPTION = "Ungespeicherte Änderungen";

function buildStructuredDiffRows(
  section: RuleSetDiffSection,
  entityRenames: EntityRenameMaps,
  ruleNameContext?: RuleNameContext,
) {
  const removedCandidates = section.removed.map((value, index) => ({
    index,
    key: getDiffItemMatchKey(section, value),
    path: getDiffItemPath(section, value, entityRenames, ruleNameContext),
    value,
  }));
  const addedCandidates = section.added.map((value, index) => ({
    index,
    key: getDiffItemMatchKey(section, value),
    path: getDiffItemPath(section, value, entityRenames, ruleNameContext),
    value,
  }));
  const removedByKey = new Map<
    string,
    {
      index: number;
      key: string;
      path: string;
      value: string;
    }[]
  >();
  const addedByKey = new Map<
    string,
    {
      index: number;
      key: string;
      path: string;
      value: string;
    }[]
  >();
  const usedRemoved = new Set<number>();
  const usedAdded = new Set<number>();
  const rows: StructuredDiffRow[] = [];

  for (const candidate of removedCandidates) {
    const { key } = candidate;
    const bucket = removedByKey.get(key) ?? [];
    bucket.push(candidate);
    removedByKey.set(key, bucket);
  }
  for (const candidate of addedCandidates) {
    const { key } = candidate;
    const bucket = addedByKey.get(key) ?? [];
    bucket.push(candidate);
    addedByKey.set(key, bucket);
  }

  const keys = [...new Set([...removedByKey.keys(), ...addedByKey.keys()])];

  for (const key of keys.toSorted()) {
    const beforeEntries = removedByKey.get(key) ?? [];
    const afterEntries = addedByKey.get(key) ?? [];
    const pairCount = Math.max(beforeEntries.length, afterEntries.length);

    const nextRows = Array.from({ length: pairCount }, (_, pairIndex) => {
      const beforeEntry = beforeEntries[pairIndex];
      const afterEntry = afterEntries[pairIndex];
      const before = beforeEntry?.value;
      const after = afterEntry?.value;
      if (
        section.key === "baseSchedules" &&
        before &&
        after &&
        isOnlyReferenceRename(section, before, after, entityRenames)
      ) {
        return null;
      }
      if (
        section.key === "vacations" &&
        before &&
        after &&
        isOnlyReferenceRename(section, before, after, entityRenames)
      ) {
        return null;
      }

      const changedValues =
        before && after
          ? formatChangedStructuredDiffValues(before, after)
          : null;

      if (beforeEntry) {
        usedRemoved.add(beforeEntry.index);
      }
      if (afterEntry) {
        usedAdded.add(afterEntry.index);
      }

      return {
        after: changedValues
          ? changedValues.after
          : after
            ? formatStructuredDiffValue(after)
            : "",
        before: changedValues
          ? changedValues.before
          : before
            ? formatStructuredDiffValue(before)
            : "",
        id: `${section.key}:${key}:${pairIndex}`,
        kind: before && after ? "modified" : after ? "added" : "removed",
        path: afterEntry?.path ?? beforeEntry?.path ?? key,
      };
    }).filter((row): row is StructuredDiffRow => row !== null);

    rows.push(...nextRows);
  }

  const remainingRows = [
    ...removedCandidates
      .filter((candidate) => !usedRemoved.has(candidate.index))
      .map(
        (candidate): StructuredDiffRow => ({
          after: "",
          before: formatStructuredDiffValue(candidate.value),
          id: `${section.key}:removed:${candidate.index}`,
          kind: "removed",
          path: candidate.path,
        }),
      ),
    ...addedCandidates
      .filter((candidate) => !usedAdded.has(candidate.index))
      .map(
        (candidate): StructuredDiffRow => ({
          after: formatStructuredDiffValue(candidate.value),
          before: "",
          id: `${section.key}:added:${candidate.index}`,
          kind: "added",
          path: candidate.path,
        }),
      ),
  ];

  return [...rows, ...remainingRows].toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );
}

function dayOfWeekLabel(value: unknown) {
  const labels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return typeof value === "number" ? (labels[value] ?? String(value)) : "";
}

function formatChangedStructuredDiffValues(
  beforeValue: string,
  afterValue: string,
) {
  const before = parseDiffValue(beforeValue);
  const after = parseDiffValue(afterValue);
  if (!before || !after) {
    return {
      after: formatStructuredDiffValue(afterValue),
      before: formatStructuredDiffValue(beforeValue),
    };
  }

  const changedKeys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter(
    (key) =>
      !isDiffMetadataKey(key) && !isEqualDiffValue(before[key], after[key]),
  );

  if (changedKeys.length === 0) {
    return {
      after: formatStructuredDiffValue(afterValue),
      before: formatStructuredDiffValue(beforeValue),
    };
  }

  return {
    after: formatStructuredDiffEntries(after, changedKeys),
    before: formatStructuredDiffEntries(before, changedKeys),
  };
}

function formatEnumValue(key: string, value: unknown) {
  const stringifiedValue = stringValue(value);

  const enumLabels: Record<string, Record<string, string>> = {
    conditionType: {
      APPOINTMENT_TYPE: "Terminart",
      CLIENT_TYPE: "Patiententyp",
      CONCURRENT_COUNT: "Parallele Termine",
      DAILY_CAPACITY: "Tageskapazitaet",
      DATE_RANGE: "Datumsbereich",
      DAY_OF_WEEK: "Wochentag",
      DAYS_AHEAD: "Tage im Voraus",
      HOURS_AHEAD: "Stunden im Voraus",
      LOCATION: "Standort",
      PATIENT_AGE: "Patientenalter",
      PRACTITIONER: "Behandler",
      PRACTITIONER_TAG: "Behandler-Tag",
    },
    locationMode: {
      any: "Beliebiger Standort",
      inherit: "Standort uebernehmen",
      selected: "Ausgewaehlter Standort",
    },
    offsetUnit: {
      days: "Tage",
      minutes: "Minuten",
      months: "Monate",
      weeks: "Wochen",
    },
    operator: {
      EQUALS: "Ist gleich",
      GREATER_THAN: "Groesser als",
      GREATER_THAN_OR_EQUAL: "Groesser oder gleich",
      IS: "Ist",
      IS_NOT: "Ist nicht",
      LESS_THAN: "Kleiner als",
      LESS_THAN_OR_EQUAL: "Kleiner oder gleich",
    },
    portion: {
      afternoon: "Nachmittag",
      full: "Ganztags",
      morning: "Vormittag",
    },
    practitionerMode: {
      any: "Beliebiger Behandler",
      inherit: "Behandler uebernehmen",
      selected: "Ausgewaehlter Behandler",
    },
    scope: {
      location: "Standort",
      practice: "Praxis",
      practitioner: "Behandler",
      real: "Echt",
      simulation: "Simulation",
    },
    searchMode: {
      exact_after_previous: "Direkt nach dem vorherigen Termin",
      first_available_on_or_after: "Erster verfuegbarer Termin ab dann",
      same_day: "Am selben Tag",
    },
    staffType: {
      mfa: "MFA",
      practitioner: "Behandler",
    },
  };

  return enumLabels[key]?.[stringifiedValue] ?? stringifiedValue;
}

function formatFieldValue(key: string, value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return value
        .map((entry) =>
          typeof entry === "string"
            ? formatEnumValue(key, entry)
            : formatPrimitiveValue(entry),
        )
        .join(", ");
    }
    return `${value.length} Eintrag${value.length === 1 ? "" : "e"}`;
  }

  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }

  if (value && typeof value === "object") {
    return formatValue(value);
  }

  return formatEnumValue(key, value);
}

function formatPrimitiveValue(value: unknown) {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-");
      return `${day}.${month}.${year}`;
    }
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value);
}

function formatRuleDiffSummary(
  value: Record<string, unknown>,
  ruleNameContext: RuleNameContext,
) {
  const tree = parseRuleDiffTree(value);
  if (!tree) {
    return null;
  }

  try {
    return generateRuleName(
      conditionTreeToConditions(tree),
      ruleNameContext.appointmentTypes,
      ruleNameContext.practitioners,
      ruleNameContext.locations,
    );
  } catch {
    return null;
  }
}

function formatStructuredDiffEntries(
  value: Record<string, unknown>,
  keys: string[],
) {
  return keys
    .filter(
      (key) =>
        !isDiffMetadataKey(key) &&
        value[key] !== null &&
        value[key] !== undefined,
    )
    .map(
      (key) =>
        `${formatStructuredKey(key)}: ${formatFieldValue(key, value[key])}`,
    )
    .join("\n");
}

function formatStructuredDiffValue(value: string) {
  const parsed = parseDiffValue(value);
  if (!parsed || typeof parsed !== "object") {
    return value;
  }

  return Object.entries(parsed)
    .filter(
      ([key, entryValue]) =>
        !isDiffMetadataKey(key) &&
        entryValue !== null &&
        entryValue !== undefined,
    )
    .map(
      ([key, entryValue]) =>
        `${formatStructuredKey(key)}: ${formatFieldValue(key, entryValue)}`,
    )
    .join("\n");
}

function formatStructuredKey(key: string) {
  const labels: Record<string, string> = {
    allowedPractitioners: "Behandler",
    appointmentTypeName: "Terminart",
    breakTimes: "Pausen",
    children: "Bedingungen",
    conditionType: "Bedingung",
    date: "Datum",
    dayOfWeek: "Tag",
    duration: "Dauer",
    enabled: "Aktiv",
    endTime: "Ende",
    followUpPlan: "Folgetermine",
    locationName: "Standort",
    name: "Name",
    nodeType: "Logik",
    operator: "Operator",
    portion: "Teil",
    practitionerName: "Behandler",
    scope: "Geltungsbereich",
    staffName: "Mitarbeiter",
    staffType: "Typ",
    startTime: "Start",
    tags: "Tags",
    valueIds: "Werte",
    valueNumber: "Wert",
  };

  return labels[key] ?? key;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return value.map((entry) => formatPrimitiveValue(entry)).join(", ");
    }
    return `${value.length} Eintrag${value.length === 1 ? "" : "e"}`;
  }
  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(
        ([key, entryValue]) =>
          `${formatStructuredKey(key)}=${formatFieldValue(key, entryValue)}`,
      )
      .join(", ");
  }
  return formatPrimitiveValue(value);
}

function getDiffItemMatchKey(section: RuleSetDiffSection, value: string) {
  const parsed = parseDiffValue(value);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `[INVARIANT:DIFF_VALUE_INVALID] Abschnitt ${section.key} enthaelt keinen gueltigen Diff-Wert.`,
    );
  }

  if (typeof parsed["__diffKey"] === "string") {
    return parsed["__diffKey"];
  }

  throw new Error(
    `[INVARIANT:DIFF_KEY_MISSING] Abschnitt ${section.key} hat keinen stabilen Diff-Schluessel.`,
  );
}

function getDiffItemPath(
  section: RuleSetDiffSection,
  value: string,
  entityRenames: EntityRenameMaps,
  ruleNameContext?: RuleNameContext,
) {
  const parsed = parseDiffValue(value);
  if (!parsed || typeof parsed !== "object") {
    return value;
  }

  if ("name" in parsed && typeof parsed["name"] === "string") {
    const name = parsed["name"];
    return normalizeEntityName(section.key, name, entityRenames);
  }

  if (section.key === "baseSchedules") {
    const locationName = stringValue(parsed["locationName"]);
    const practitionerName = stringValue(parsed["practitionerName"]);

    return [
      normalizeRenamedValue(practitionerName, entityRenames.practitioners),
      dayOfWeekLabel(parsed["dayOfWeek"]),
      normalizeRenamedValue(locationName, entityRenames.locations),
      `${stringValue(parsed["startTime"])}-${stringValue(parsed["endTime"])}`,
    ]
      .filter(Boolean)
      .join(" > ");
  }

  if (section.key === "vacations") {
    const staffName = stringValue(parsed["staffName"]);
    return [
      normalizeRenamedValue(
        normalizeRenamedValue(staffName, entityRenames.practitioners),
        entityRenames.mfas,
      ),
      stringValue(parsed["date"]),
      stringValue(parsed["portion"]),
    ]
      .filter(Boolean)
      .join(" > ");
  }

  if (section.key === "rules") {
    return getRuleSummary(parsed, ruleNameContext);
  }

  return formatStructuredDiffValue(value).split("\n")[0] ?? section.title;
}

function getEntityRenames(diff: RuleSetDiff) {
  const baseRenames: EntityRenameMaps = {
    appointmentTypes: new Map(),
    locations: new Map(),
    mfas: new Map(),
    practitioners: new Map(),
  };

  for (const section of diff.sections) {
    switch (section.key) {
      case "locations": {
        baseRenames.locations = getSectionNameRenames(section, baseRenames);
        break;
      }
      case "mfas": {
        baseRenames.mfas = getSectionNameRenames(section, baseRenames);
        break;
      }
      case "practitioners": {
        baseRenames.practitioners = getSectionNameRenames(section, baseRenames);
        break;
      }
    }
  }

  for (const section of diff.sections) {
    if (section.key === "appointmentTypes") {
      baseRenames.appointmentTypes = getSectionNameRenames(
        section,
        baseRenames,
      );
    }
  }

  return baseRenames;
}

function getProjectedRuleSetDiffSections(
  diff: RuleSetDiff,
  ruleNameContext?: RuleNameContext,
) {
  const changedSections = diff.sections.filter(
    (section) => section.added.length > 0 || section.removed.length > 0,
  );
  const entityRenames = getEntityRenames(diff);
  return changedSections
    .map(
      (section): ProjectedRuleSetDiffSection => ({
        rows: buildStructuredDiffRows(section, entityRenames, ruleNameContext),
        section,
      }),
    )
    .filter((projectedSection) => projectedSection.rows.length > 0);
}

function getRuleSummary(
  value: Record<string, unknown>,
  ruleNameContext?: RuleNameContext,
) {
  const naturalLanguageRule = ruleNameContext
    ? formatRuleDiffSummary(value, ruleNameContext)
    : null;
  if (naturalLanguageRule) {
    return naturalLanguageRule;
  }

  const children: unknown[] = Array.isArray(value["children"])
    ? value["children"]
    : [];
  const firstChild: unknown = children[0];
  if (firstChild && typeof firstChild === "object") {
    const child = firstChild as Record<string, unknown>;
    return [
      "Regel",
      stringValue(child["nodeType"]),
      stringValue(child["conditionType"]),
      formatValue(child["valueIds"]),
      formatValue(child["valueNumber"]),
    ]
      .filter((part) => part && part !== "undefined")
      .join(" > ");
  }

  return [
    "Regel",
    stringValue(value["nodeType"]),
    stringValue(value["conditionType"]),
  ]
    .filter(Boolean)
    .join(" > ");
}

function getSectionNameRenames(
  section: RuleSetDiffSection,
  entityRenames: EntityRenameMaps,
) {
  const renames = new Map<string, string>();
  const unmatchedAdded = [...section.added];

  for (const removed of section.removed) {
    const before = parseDiffValue(removed);
    const beforeName = before ? stringValue(before["name"]) : "";
    if (!before || !beforeName) {
      continue;
    }

    const addedIndex = unmatchedAdded.findIndex((added) => {
      const after = parseDiffValue(added);
      const afterName = after ? stringValue(after["name"]) : "";
      if (!after || !afterName || afterName === beforeName) {
        return false;
      }

      return isSameAfterNormalizingReferences(
        section.key,
        omitKey(before, "name"),
        omitKey(after, "name"),
        entityRenames,
      );
    });

    if (addedIndex === -1) {
      continue;
    }

    const added = unmatchedAdded[addedIndex];
    if (!added) {
      continue;
    }
    const after = parseDiffValue(added);
    const afterName = after ? stringValue(after["name"]) : "";
    if (afterName) {
      renames.set(beforeName, afterName);
    }
    unmatchedAdded.splice(addedIndex, 1);
  }

  return renames;
}

function isDiffMetadataKey(key: string) {
  return key.startsWith("__");
}

function isEqualDiffValue(before: unknown, after: unknown) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function isOnlyReferenceRename(
  section: RuleSetDiffSection,
  beforeValue: string,
  afterValue: string,
  entityRenames: EntityRenameMaps,
) {
  const before = parseDiffValue(beforeValue);
  const after = parseDiffValue(afterValue);
  if (!before || !after) {
    return false;
  }

  return isSameAfterNormalizingReferences(
    section.key,
    before,
    after,
    entityRenames,
  );
}

function isSameAfterNormalizingReferences(
  sectionKey: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  entityRenames: EntityRenameMaps,
) {
  return (
    JSON.stringify(normalizeReferences(sectionKey, before, entityRenames)) ===
    JSON.stringify(normalizeReferences(sectionKey, after, entityRenames))
  );
}

function LogicView() {
  // URL helpers: central source of truth for parsing and navigation
  // URL is the source of truth. No local tab/date/patientType/ruleSet state.

  // Practices and initialization
  const practicesQuery = useQuery(api.practices.getAllPractices, {});
  const initializePracticeMutation = useMutation(
    api.practices.initializeDefaultPractice,
  );

  // pushParams will be defined after data queries and derived state
  const { captureError } = useErrorTracking();

  // No explicit selected saved rule set state; selection is driven by URL
  const [unsavedRuleSetId, setUnsavedRuleSetId] =
    useState<Id<"ruleSets"> | null>(null); // New: tracks unsaved rule set
  const [draftRevisionOverride, setDraftRevisionOverride] = useState<
    null | number
  >(null);
  const [draftParentRuleSetIdOverride, setDraftParentRuleSetIdOverride] =
    useState<Id<"ruleSets"> | null>(null);
  const [isDraftEquivalentToParent, setIsDraftEquivalentToParent] =
    useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const [isInitializingPractice, setIsInitializingPractice] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [discardTargetRuleSetId, setDiscardTargetRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();
  const [pendingRuleSetId, setPendingRuleSetId] = useState<
    Id<"ruleSets"> | undefined
  >();
  const [activationName, setActivationName] = useState("");
  const [isClearingSimulatedAppointments, setIsClearingSimulatedAppointments] =
    useState(false);
  const [isResettingSimulation, setIsResettingSimulation] = useState(false);
  const discardingUnsavedRuleSetIdRef = useRef<Id<"ruleSets"> | null>(null);
  const pendingDraftRuleSetNavigationIdRef = useRef<Id<"ruleSets"> | null>(
    null,
  );
  const {
    canRedo: canRedoRegelnHistoryAction,
    canUndo: canUndoRegelnHistoryAction,
    clear: clearRegelnHistoryAction,
    pushAction: pushRegelnHistoryAction,
    redo: redoRegelnHistoryAction,
    redoDepth: redoRegelnHistoryDepth,
    undo: undoRegelnHistoryAction,
    undoDepth: undoRegelnHistoryDepth,
  } = useLocalHistory();

  const registerRegelnHistoryAction = useCallback(
    (action: LocalHistoryAction) => {
      pushRegelnHistoryAction(action);
    },
    [pushRegelnHistoryAction],
  );

  const deleteAllSimulatedDataMutation = useMutation(
    api.appointments.deleteAllSimulatedData,
  );

  // Local appointments for simulation
  const [simulatedContext, setSimulatedContext] = useState<SimulatedContext>({
    patient: { isNew: true },
  });
  // URL will be parsed after queries and unsaved draft are known

  // Use the first available practice or initialize one
  const currentPractice = practicesQuery?.[0];

  // Initialize practice if none exists
  const handleInitializePractice = useCallback(async () => {
    try {
      setIsInitializingPractice(true);
      await initializePracticeMutation();
    } catch (error: unknown) {
      captureError(error, {
        context: "practice_initialization",
      });

      toast.error("Fehler beim Initialisieren der Praxis", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    } finally {
      setIsInitializingPractice(false);
    }
  }, [initializePracticeMutation, captureError]);

  // If no practice exists and we haven't tried to initialize, do it automatically
  const shouldInitialize = practicesQuery?.length === 0;

  React.useEffect(() => {
    if (shouldInitialize && !isInitializingPractice) {
      void handleInitializePractice();
    }
  }, [shouldInitialize, isInitializingPractice, handleInitializePractice]);

  const performClearSimulatedAppointments = useCallback(
    (options: { silent?: boolean }) =>
      wrapAsyncResult(
        async () => {
          const { silent = false } = options;
          if (!currentPractice) {
            return 0;
          }

          const result = await deleteAllSimulatedDataMutation({
            practiceId: currentPractice._id,
          });
          const totalDeleted = result.total;

          if (!silent) {
            if (totalDeleted > 0) {
              const parts = [];
              if (result.appointmentsDeleted > 0) {
                parts.push(
                  `${result.appointmentsDeleted} Termin${result.appointmentsDeleted === 1 ? "" : "e"}`,
                );
              }
              if (result.blockedSlotsDeleted > 0) {
                parts.push(
                  `${result.blockedSlotsDeleted} Sperrung${result.blockedSlotsDeleted === 1 ? "" : "en"}`,
                );
              }
              toast.success(`${parts.join(" und ")} gelöscht`);
            } else {
              toast.info("Keine Simulationsdaten vorhanden");
            }
          }

          return totalDeleted;
        },
        (error) => {
          captureError(error, {
            context: "simulation_clear",
          });

          const frontendError = frontendErrorFromUnknown(error, {
            kind: "invalid_state",
            message:
              error instanceof Error ? error.message : "Unbekannter Fehler",
            source: "performClearSimulatedAppointments",
          });

          toast.error("Simulationsdaten konnten nicht gelöscht werden", {
            description: frontendError.message,
          });

          return frontendError;
        },
      ),
    [captureError, currentPractice, deleteAllSimulatedDataMutation],
  );

  const handleClearSimulatedAppointments = useCallback(async () => {
    try {
      setIsClearingSimulatedAppointments(true);
      await performClearSimulatedAppointments({}).match(
        () => 0,
        () => 0,
      );
    } finally {
      setIsClearingSimulatedAppointments(false);
    }
  }, [performClearSimulatedAppointments]);

  // Fetch rule sets for this practice
  const ruleSetsQuery = useQuery(
    api.ruleSets.getAllRuleSets, // Include unsaved for navigation
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Fetch version history for visualization
  const versionsQuery = useQuery(
    api.ruleSets.getVersionHistory,
    currentPractice ? { practiceId: currentPractice._id } : "skip",
  );

  // Get the first rule set to fetch appointment types
  const firstRuleSetId = ruleSetsQuery?.[0]?._id;

  // Query appointment types to get a valid default
  const appointmentTypesQuery = useQuery(
    api.entities.getAppointmentTypes,
    firstRuleSetId ? { ruleSetId: firstRuleSetId } : "skip",
  );

  // Get the first appointment type ID for default
  const defaultAppointmentTypeId = appointmentTypesQuery?.[0]?._id;
  const hasAutoInitializedDefaultAppointmentTypeRef = useRef(false);

  React.useEffect(() => {
    hasAutoInitializedDefaultAppointmentTypeRef.current = false;
  }, [firstRuleSetId]);

  // Initialize appointmentTypeId once appointment types are loaded
  React.useEffect(() => {
    if (
      defaultAppointmentTypeId &&
      !simulatedContext.appointmentTypeId &&
      !hasAutoInitializedDefaultAppointmentTypeRef.current
    ) {
      hasAutoInitializedDefaultAppointmentTypeRef.current = true;
      setSimulatedContext((prev) => ({
        ...prev,
        appointmentTypeId: defaultAppointmentTypeId,
      }));
    }
  }, [defaultAppointmentTypeId, simulatedContext.appointmentTypeId]);

  // Transform rule sets to include isActive computed field
  // RuleSetSummary interface expects: { _id, description, isActive, version }
  const ruleSetsWithActive = useMemo(() => {
    if (!ruleSetsQuery || !currentPractice) {
      return;
    }
    const ruleSets = ruleSetsQuery.map((rs) => ({
      _id: rs._id,
      description: rs.description,
      isActive: currentPractice.currentActiveRuleSetId === rs._id,
      version: rs.version,
    }));

    if (
      unsavedRuleSetId &&
      discardingUnsavedRuleSetIdRef.current !== unsavedRuleSetId &&
      !ruleSets.some((rs) => rs._id === unsavedRuleSetId)
    ) {
      const parentRuleSet = draftParentRuleSetIdOverride
        ? ruleSetsQuery.find((rs) => rs._id === draftParentRuleSetIdOverride)
        : undefined;

      ruleSets.push({
        _id: unsavedRuleSetId,
        description: UNSAVED_RULE_SET_DESCRIPTION,
        isActive: currentPractice.currentActiveRuleSetId === unsavedRuleSetId,
        version: (parentRuleSet?.version ?? 0) + 1,
      });
    }

    return ruleSets;
  }, [
    currentPractice,
    draftParentRuleSetIdOverride,
    ruleSetsQuery,
    unsavedRuleSetId,
  ]);

  // Mutations
  const activateRuleSetMutation = useMutation(api.ruleSets.setActiveRuleSet);
  const saveUnsavedRuleSetMutation = useMutation(
    api.ruleSets.saveUnsavedRuleSet,
  );
  const deleteUnsavedRuleSetMutation = useMutation(
    api.ruleSets.deleteUnsavedRuleSet,
  ).withOptimisticUpdate((localStore, args) => {
    const queryArgs = { practiceId: args.practiceId };

    const allRuleSets = localStore.getQuery(
      api.ruleSets.getAllRuleSets,
      queryArgs,
    );
    if (allRuleSets !== undefined) {
      localStore.setQuery(
        api.ruleSets.getAllRuleSets,
        queryArgs,
        allRuleSets.filter((ruleSet) => ruleSet._id !== args.ruleSetId),
      );
    }

    const unsavedRuleSet = localStore.getQuery(
      api.ruleSets.getUnsavedRuleSet,
      queryArgs,
    );
    if (unsavedRuleSet?._id === args.ruleSetId) {
      localStore.setQuery(api.ruleSets.getUnsavedRuleSet, queryArgs, null);
    }

    const versionHistory = localStore.getQuery(
      api.ruleSets.getVersionHistory,
      queryArgs,
    );
    if (versionHistory !== undefined) {
      localStore.setQuery(
        api.ruleSets.getVersionHistory,
        queryArgs,
        versionHistory.filter((version) => version.id !== args.ruleSetId),
      );
    }
  });
  const discardEquivalentUnsavedRuleSetMutation = useMutation(
    api.ruleSets.discardUnsavedRuleSetIfEquivalentToParent,
  ).withOptimisticUpdate((localStore, args) => {
    const queryArgs = { practiceId: args.practiceId };

    const allRuleSets = localStore.getQuery(
      api.ruleSets.getAllRuleSets,
      queryArgs,
    );
    if (allRuleSets !== undefined) {
      localStore.setQuery(
        api.ruleSets.getAllRuleSets,
        queryArgs,
        allRuleSets.filter((ruleSet) => ruleSet._id !== args.ruleSetId),
      );
    }

    const unsavedRuleSet = localStore.getQuery(
      api.ruleSets.getUnsavedRuleSet,
      queryArgs,
    );
    if (unsavedRuleSet?._id === args.ruleSetId) {
      localStore.setQuery(api.ruleSets.getUnsavedRuleSet, queryArgs, null);
    }

    const versionHistory = localStore.getQuery(
      api.ruleSets.getVersionHistory,
      queryArgs,
    );
    if (versionHistory !== undefined) {
      localStore.setQuery(
        api.ruleSets.getVersionHistory,
        queryArgs,
        versionHistory.filter((version) => version.id !== args.ruleSetId),
      );
    }
  });

  const activeRuleSet = ruleSetsWithActive?.find((rs) => rs.isActive);
  // selectedRuleSet will be computed after unsavedRuleSet and ruleSetIdFromUrl are available

  // Find any existing unsaved rule set (not active and no explicit selection)
  const existingUnsavedRuleSet = ruleSetsWithActive?.find(
    (rs) => !rs.isActive && rs.description === UNSAVED_RULE_SET_DESCRIPTION,
  );

  // Transform unsavedRuleSet from raw query to include isActive
  const unsavedRuleSet = useMemo(() => {
    if (
      unsavedRuleSetId &&
      discardingUnsavedRuleSetIdRef.current === unsavedRuleSetId
    ) {
      return;
    }

    const rawUnsaved = unsavedRuleSetId
      ? ruleSetsQuery?.find((rs) => rs._id === unsavedRuleSetId)
      : undefined;
    if (!currentPractice) {
      return;
    }
    if (!rawUnsaved) {
      return;
    }

    if (rawUnsaved.saved) {
      return;
    }

    return {
      _id: rawUnsaved._id,
      description: rawUnsaved.description,
      draftRevision: rawUnsaved.draftRevision,
      isActive: currentPractice.currentActiveRuleSetId === rawUnsaved._id,
      parentVersion: rawUnsaved.parentVersion,
      version: rawUnsaved.version,
    };
  }, [currentPractice, ruleSetsQuery, unsavedRuleSetId]);

  // Get the search params directly to determine which rule set to use
  const routeSearch: RegelnSearchParams = Route.useSearch();

  // Determine current working rule set based on URL
  // We'll do a preliminary calculation to fetch locations
  const preliminarySelectedRuleSet = useMemo(() => {
    // We need to extract ruleSetIdFromUrl logic inline here to avoid circular dependency
    const ruleSetId = routeSearch.regelwerk;
    if (!ruleSetId) {
      return;
    }
    if (ruleSetId === "ungespeichert") {
      return ruleSetsWithActive?.find((rs) => rs._id === unsavedRuleSet?._id);
    }
    // Match by ID directly - IDs are unique and prevent collisions
    return ruleSetsWithActive?.find((rs) => rs._id === ruleSetId);
  }, [ruleSetsWithActive, unsavedRuleSet, routeSearch.regelwerk]);

  const preliminaryWorkingRuleSet = useMemo(
    () => preliminarySelectedRuleSet ?? unsavedRuleSet ?? activeRuleSet,
    [preliminarySelectedRuleSet, unsavedRuleSet, activeRuleSet],
  );
  const resolvedPreliminaryWorkingRuleSet = useMemo(
    () =>
      preliminaryWorkingRuleSet &&
      ruleSetsWithActive?.some(
        (ruleSet) => ruleSet._id === preliminaryWorkingRuleSet._id,
      )
        ? preliminaryWorkingRuleSet
        : undefined,
    [preliminaryWorkingRuleSet, ruleSetsWithActive],
  );

  // Fetch locations for the working rule set
  const locationsListQuery = useQuery(
    api.entities.getLocations,
    resolvedPreliminaryWorkingRuleSet
      ? { ruleSetId: resolvedPreliminaryWorkingRuleSet._id }
      : "skip",
  );

  // Now call the hook ONCE with all the data we have
  const {
    activeTab,
    isNewPatient,
    locationIdFromUrl,
    navigateTab,
    pushUrl,
    raw,
    ruleSetIdFromUrl,
    selectedDate,
  } = useRegelnUrl({
    locationsListQuery: locationsListQuery ?? undefined,
    ruleSetsQuery: ruleSetsWithActive,
    unsavedRuleSet: unsavedRuleSet ?? null,
  });

  // Determine current working rule set based on the properly computed ruleSetIdFromUrl
  const selectedRuleSet = useMemo(
    () => ruleSetsWithActive?.find((rs) => rs._id === ruleSetIdFromUrl),
    [ruleSetsWithActive, ruleSetIdFromUrl],
  );

  // Use unsaved rule set if available, otherwise selected rule set, otherwise active rule set
  const currentWorkingRuleSet = useMemo(
    () => selectedRuleSet ?? unsavedRuleSet ?? activeRuleSet,
    [selectedRuleSet, unsavedRuleSet, activeRuleSet],
  );
  const resolvedCurrentWorkingRuleSet = useMemo(
    () =>
      currentWorkingRuleSet &&
      ruleSetsWithActive?.some(
        (ruleSet) => ruleSet._id === currentWorkingRuleSet._id,
      )
        ? currentWorkingRuleSet
        : undefined,
    [currentWorkingRuleSet, ruleSetsWithActive],
  );
  const isShowingUnsavedRuleSet =
    Boolean(unsavedRuleSet) &&
    currentWorkingRuleSet?._id === unsavedRuleSet?._id;
  const hasBlockingUnsavedChanges = Boolean(
    unsavedRuleSet && !isDraftEquivalentToParent,
  );
  const ruleSetDiff = useQuery(
    api.ruleSets.getUnsavedRuleSetDiff,
    currentPractice &&
      unsavedRuleSet?.parentVersion &&
      !isDraftEquivalentToParent
      ? {
          practiceId: currentPractice._id,
          ruleSetId: unsavedRuleSet._id,
        }
      : "skip",
  ) as RuleSetDiff | undefined;
  const diffAppointmentTypesQuery = useQuery(
    api.entities.getAppointmentTypes,
    resolvedCurrentWorkingRuleSet
      ? { ruleSetId: resolvedCurrentWorkingRuleSet._id }
      : "skip",
  );
  const diffPractitionersQuery = useQuery(
    api.entities.getPractitioners,
    resolvedCurrentWorkingRuleSet
      ? { ruleSetId: resolvedCurrentWorkingRuleSet._id }
      : "skip",
  );
  const ruleNameContext = useMemo<RuleNameContext | undefined>(() => {
    if (
      !diffAppointmentTypesQuery ||
      !diffPractitionersQuery ||
      !locationsListQuery
    ) {
      return;
    }

    return {
      appointmentTypes: diffAppointmentTypesQuery.map((item) => ({
        _id: item.name,
        name: item.name,
      })),
      locations: locationsListQuery.map((item) => ({
        _id: item.name,
        name: item.name,
      })),
      practitioners: diffPractitionersQuery.map((item) => ({
        _id: item.name,
        name: item.name,
      })),
    };
  }, [diffAppointmentTypesQuery, diffPractitionersQuery, locationsListQuery]);
  const ruleSetReplayTarget = useMemo((): null | RuleSetReplayTarget => {
    if (!resolvedCurrentWorkingRuleSet) {
      return null;
    }
    if (unsavedRuleSet?.parentVersion) {
      return {
        draftRevision: draftRevisionOverride ?? unsavedRuleSet.draftRevision,
        draftRuleSetId: unsavedRuleSet._id,
        kind: "draft",
        parentRuleSetId: unsavedRuleSet.parentVersion,
      };
    }
    return {
      kind: "saved-parent",
      parentRuleSetId: resolvedCurrentWorkingRuleSet._id,
    };
  }, [draftRevisionOverride, resolvedCurrentWorkingRuleSet, unsavedRuleSet]);

  React.useEffect(() => {
    if (!ruleSetsQuery || !unsavedRuleSetId) {
      return;
    }

    const draftStillExists = ruleSetsQuery.some(
      (ruleSet) => ruleSet._id === unsavedRuleSetId && !ruleSet.saved,
    );
    if (draftStillExists) {
      return;
    }

    setUnsavedRuleSetId(null);
    setDraftRevisionOverride(null);
    setDraftParentRuleSetIdOverride(null);
    setIsDraftEquivalentToParent(false);
  }, [ruleSetsQuery, unsavedRuleSetId]);

  React.useEffect(() => {
    if (!unsavedRuleSet) {
      setDraftRevisionOverride(null);
      setDraftParentRuleSetIdOverride(null);
      setIsDraftEquivalentToParent(false);
      return;
    }
    setDraftRevisionOverride(unsavedRuleSet.draftRevision);
    if (unsavedRuleSet.parentVersion) {
      setDraftParentRuleSetIdOverride(unsavedRuleSet.parentVersion);
    }
  }, [
    unsavedRuleSet,
    unsavedRuleSet?._id,
    unsavedRuleSet?.draftRevision,
    unsavedRuleSet?.parentVersion,
  ]);

  const historyScopeKey = useMemo(() => {
    const isWorkingOnUnsavedRuleSet =
      unsavedRuleSet && currentWorkingRuleSet?._id === unsavedRuleSet._id;
    if (isWorkingOnUnsavedRuleSet && unsavedRuleSet.parentVersion) {
      return unsavedRuleSet.parentVersion;
    }
    if (ruleSetIdFromUrl) {
      return ruleSetIdFromUrl;
    }
    return null;
  }, [currentWorkingRuleSet?._id, ruleSetIdFromUrl, unsavedRuleSet]);
  const lastHistoryScopeRef = useRef<null | string>(historyScopeKey);

  React.useEffect(() => {
    if (!historyScopeKey) {
      return;
    }
    if (!lastHistoryScopeRef.current) {
      lastHistoryScopeRef.current = historyScopeKey;
      return;
    }
    if (lastHistoryScopeRef.current === historyScopeKey) {
      return;
    }

    clearRegelnHistoryAction();
    lastHistoryScopeRef.current = historyScopeKey;
  }, [clearRegelnHistoryAction, historyScopeKey]);

  const isRegelnHistoryTab =
    activeTab === "rule-management" || activeTab === "vacation-scheduler";

  const runRegelnUndo = useCallback(async () => {
    if (!currentPractice) {
      toast.info("Keine rückgängig machbare Änderung vorhanden.");
      return;
    }

    const optimisticallySelectedParentRuleSetId =
      isRegelnHistoryTab &&
      undoRegelnHistoryDepth === 1 &&
      ruleSetIdFromUrl === unsavedRuleSet?._id
        ? unsavedRuleSet?.parentVersion
        : undefined;

    if (optimisticallySelectedParentRuleSetId) {
      setIsDraftEquivalentToParent(true);
      pushUrl({ ruleSetId: optimisticallySelectedParentRuleSetId });
    }

    const result = await undoRegelnHistoryAction();

    if (result.status === "conflict") {
      if (optimisticallySelectedParentRuleSetId && unsavedRuleSet) {
        setIsDraftEquivalentToParent(false);
        pushUrl({ ruleSetId: unsavedRuleSet._id });
      }
      toast.error("Änderung konnte nicht rückgängig gemacht werden", {
        description: result.message,
      });
      return;
    }
    if (result.status === "applied") {
      toast.success("Änderung rückgängig gemacht");
      if (
        !result.canUndoAfter &&
        isRegelnHistoryTab &&
        unsavedRuleSet?.parentVersion
      ) {
        const draftToDiscard = unsavedRuleSet;
        const parentRuleSetId = unsavedRuleSet.parentVersion;
        discardingUnsavedRuleSetIdRef.current = draftToDiscard._id;
        setUnsavedRuleSetId(null);
        setIsDraftEquivalentToParent(false);
        setDraftRevisionOverride(null);
        setDraftParentRuleSetIdOverride(null);
        pushUrl({ ruleSetId: parentRuleSetId });

        try {
          const discardResult = await discardEquivalentUnsavedRuleSetMutation({
            practiceId: currentPractice._id,
            ruleSetId: draftToDiscard._id,
          });

          if (!discardResult.deleted) {
            discardingUnsavedRuleSetIdRef.current = null;
            setUnsavedRuleSetId(draftToDiscard._id);
            setDraftRevisionOverride(draftToDiscard.draftRevision);
            setDraftParentRuleSetIdOverride(parentRuleSetId);
            setIsDraftEquivalentToParent(false);
            pushUrl({ ruleSetId: draftToDiscard._id });
          }
        } catch (error: unknown) {
          discardingUnsavedRuleSetIdRef.current = null;
          setUnsavedRuleSetId(draftToDiscard._id);
          setDraftRevisionOverride(draftToDiscard.draftRevision);
          setDraftParentRuleSetIdOverride(parentRuleSetId);
          setIsDraftEquivalentToParent(false);
          pushUrl({ ruleSetId: draftToDiscard._id });
          captureError(error, {
            context: "discard_equivalent_draft_after_final_undo",
            practiceId: currentPractice._id,
            ruleSetId: draftToDiscard._id,
          });
        } finally {
          if (discardingUnsavedRuleSetIdRef.current === draftToDiscard._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
        }
      }
      return;
    }
    toast.info("Keine rückgängig machbare Änderung vorhanden.");
  }, [
    isRegelnHistoryTab,
    pushUrl,
    ruleSetIdFromUrl,
    captureError,
    currentPractice,
    discardEquivalentUnsavedRuleSetMutation,
    undoRegelnHistoryAction,
    undoRegelnHistoryDepth,
    unsavedRuleSet,
  ]);

  const runRegelnRedo = useCallback(async () => {
    const previousRuleSetId = ruleSetIdFromUrl;
    setIsDraftEquivalentToParent(false);
    const shouldRestorePreviousRuleSet =
      previousRuleSetId !== undefined &&
      unsavedRuleSet !== undefined &&
      previousRuleSetId !== unsavedRuleSet._id;
    if (
      isRegelnHistoryTab &&
      redoRegelnHistoryDepth > 0 &&
      unsavedRuleSet &&
      ruleSetIdFromUrl !== unsavedRuleSet._id
    ) {
      pushUrl({ ruleSetId: unsavedRuleSet._id });
    }

    const result = await redoRegelnHistoryAction();

    if (result.status === "conflict") {
      if (shouldRestorePreviousRuleSet) {
        setIsDraftEquivalentToParent(true);
        pushUrl({ ruleSetId: previousRuleSetId });
      }
      toast.error("Änderung konnte nicht wiederhergestellt werden", {
        description: result.message,
      });
      return;
    }
    if (result.status === "applied") {
      toast.success("Änderung wiederhergestellt");
      return;
    }
    if (shouldRestorePreviousRuleSet) {
      setIsDraftEquivalentToParent(true);
      pushUrl({ ruleSetId: previousRuleSetId });
    }
    toast.info("Keine wiederherstellbare Änderung vorhanden.");
  }, [
    isRegelnHistoryTab,
    pushUrl,
    redoRegelnHistoryAction,
    redoRegelnHistoryDepth,
    ruleSetIdFromUrl,
    unsavedRuleSet,
  ]);

  const regelnUndoRedoControls = useMemo(
    () =>
      isRegelnHistoryTab &&
      (canUndoRegelnHistoryAction || canRedoRegelnHistoryAction)
        ? {
            canRedo: canRedoRegelnHistoryAction,
            canUndo: canUndoRegelnHistoryAction,
            onRedo: runRegelnRedo,
            onUndo: runRegelnUndo,
          }
        : null,
    [
      canRedoRegelnHistoryAction,
      canUndoRegelnHistoryAction,
      isRegelnHistoryTab,
      runRegelnRedo,
      runRegelnUndo,
    ],
  );

  useRegisterGlobalUndoRedoControls(regelnUndoRedoControls);

  // Function to get or wait for the unsaved rule set
  // With CoW, the unsaved rule set is created automatically by mutations when needed
  const createInitialUnsaved = React.useCallback(() => {
    if (!currentPractice) {
      return;
    }

    // Simply return the existing unsaved rule set if it exists
    if (existingUnsavedRuleSet) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
      return existingUnsavedRuleSet._id;
    }

    // If no unsaved rule set exists yet, it will be created automatically
    // by the first mutation that tries to modify data (via CoW)
    // For now, we return null and let the mutations handle it
    return null;
  }, [currentPractice, existingUnsavedRuleSet]);

  const handleDraftMutation = useCallback(
    (result: { draftRevision: number; ruleSetId: Id<"ruleSets"> }) => {
      setUnsavedRuleSetId(result.ruleSetId);
      setIsDraftEquivalentToParent(false);
      setIsSaveDialogOpen(false);
      setPendingRuleSetId(undefined);
      setDraftRevisionOverride(result.draftRevision);
      if (ruleSetReplayTarget?.parentRuleSetId) {
        setDraftParentRuleSetIdOverride(ruleSetReplayTarget.parentRuleSetId);
      }
      pendingDraftRuleSetNavigationIdRef.current = result.ruleSetId;
    },
    [ruleSetReplayTarget?.parentRuleSetId],
  );

  // Helper to push the canonical URL reflecting current UI intent
  // pushUrl and navigateTab come from useRegelnUrl

  // Ensure the URL reflects an existing unsaved draft selection
  // If an unsaved rule set exists but the URL doesn't say 'ungespeichert',
  // navigate to include it so the URL remains the single source of truth.
  React.useEffect(() => {
    // Only enforce when the ruleSet segment is missing entirely.
    // Do NOT override a user-chosen named rule set in the URL.
    if (
      unsavedRuleSet &&
      !raw.ruleSet &&
      ruleSetIdFromUrl !== unsavedRuleSet._id &&
      // Avoid navigating before we know the date from URL/state
      selectedDate instanceof Date
    ) {
      pushUrl({ ruleSetId: unsavedRuleSet._id as Id<"ruleSets"> });
    }
  }, [unsavedRuleSet, raw.ruleSet, ruleSetIdFromUrl, selectedDate, pushUrl]);

  React.useEffect(() => {
    const pendingDraftRuleSetId = pendingDraftRuleSetNavigationIdRef.current;
    if (
      !pendingDraftRuleSetId ||
      unsavedRuleSet?._id !== pendingDraftRuleSetId
    ) {
      return;
    }

    pendingDraftRuleSetNavigationIdRef.current = null;
    if (ruleSetIdFromUrl !== pendingDraftRuleSetId) {
      pushUrl({ ruleSetId: pendingDraftRuleSetId });
    }
  }, [pushUrl, ruleSetIdFromUrl, unsavedRuleSet?._id]);

  // Reset simulation helper (after pushParams is defined)
  const resetSimulation = useCallback(async () => {
    setIsResettingSimulation(true);
    try {
      const resetContext = createSimulatedContext({
        ...(defaultAppointmentTypeId && {
          appointmentTypeId: defaultAppointmentTypeId,
        }),
        isNewPatient: true,
      });
      setSimulatedContext(resetContext);
      pushUrl({
        date: new Date(),
        isNewPatient: true,
        ruleSetId: undefined,
      });

      await performClearSimulatedAppointments({ silent: true }).match(
        () => 0,
        () => 0,
      );
    } finally {
      setIsResettingSimulation(false);
    }
  }, [defaultAppointmentTypeId, performClearSimulatedAppointments, pushUrl]);

  // Auto-detect existing unsaved rule set on load
  React.useEffect(() => {
    if (!existingUnsavedRuleSet) {
      return;
    }

    // Respect explicit URL selection of a saved rule set.
    if (raw.ruleSet && raw.ruleSet !== "ungespeichert") {
      return;
    }

    if (!unsavedRuleSetId || unsavedRuleSetId !== existingUnsavedRuleSet._id) {
      setUnsavedRuleSetId(existingUnsavedRuleSet._id);
    }
  }, [existingUnsavedRuleSet, raw.ruleSet, unsavedRuleSetId]);

  // Auto-create an initial unsaved rule set when no rule sets exist
  React.useEffect(() => {
    if (currentPractice && ruleSetsQuery?.length === 0 && !unsavedRuleSetId) {
      void createInitialUnsaved();
    }
  }, [currentPractice, ruleSetsQuery, unsavedRuleSetId, createInitialUnsaved]);

  // Keep patient.isNew in local simulatedContext in sync with URL
  React.useEffect(() => {
    if (simulatedContext.patient.isNew !== isNewPatient) {
      setSimulatedContext((prev) => ({
        ...prev,
        patient: { isNew: isNewPatient },
      }));
    }
  }, [isNewPatient, simulatedContext.patient.isNew]);

  // Sync URL location to Context on initial load or URL change (e.g., from shared link)
  // This is ONE-WAY: URL → Context only. User changes go through onLocationChange → pushUrl → URL
  React.useEffect(() => {
    if (locationIdFromUrl) {
      setSimulatedContext((prev) => {
        if (prev.locationId === locationIdFromUrl) {
          return prev;
        }
        return {
          ...prev,
          locationId: locationIdFromUrl,
        };
      });
    }
  }, [locationIdFromUrl]);

  // TODO: Fetch rules for the current working rule set (re-enable once new rule system is implemented)
  // const rulesQuery = useQuery(
  //   api.entities.getRules,
  //   currentWorkingRuleSet ? { ruleSetId: currentWorkingRuleSet._id } : "skip",
  // );

  // Convert selectedDate (JS Date) to Temporal.PlainDate for the calendar components
  const simulationDate = useMemo(
    () =>
      Temporal.PlainDate.from({
        day: selectedDate.getDate(),
        month: selectedDate.getMonth() + 1, // JS months are 0-indexed
        year: selectedDate.getFullYear(),
      }),
    [selectedDate],
  );

  // Create date range representing a full calendar day without timezone issues (after selectedDate is known)
  // This is still used by PatientBookingFlow which hasn't been converted to Temporal yet
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  const dateRange = {
    end: endOfDay.toISOString(),
    start: startOfDay.toISOString(),
  };

  // Create patient info for the right sidebar in staff view
  // This extracts patient information from the simulated context
  const patientInfo: PatientInfo = useMemo(
    () => ({
      isNewPatient,
    }),
    [isNewPatient],
  );

  // With CoW, we don't need to explicitly create copies
  // The backend will handle draft creation automatically when mutations are made
  const handleVersionClick = React.useCallback(
    (version: VersionNode) => {
      if (!currentPractice) {
        toast.error("Keine Praxis gefunden");
        return;
      }

      const versionId = version.hash as Id<"ruleSets">;

      // If we have unsaved changes and the target is not the unsaved draft, show save dialog
      if (hasBlockingUnsavedChanges && versionId !== unsavedRuleSet?._id) {
        setPendingRuleSetId(versionId);
        setActivationName("");
        setIsSaveDialogOpen(true);
        return;
      }

      // Navigate to the chosen version
      setUnsavedRuleSetId(null);
      setDraftParentRuleSetIdOverride(null);
      pushUrl({ ruleSetId: versionId });
    },
    [currentPractice, hasBlockingUnsavedChanges, pushUrl, unsavedRuleSet],
  );

  // Show loading state if practice is being initialized
  if (practicesQuery === undefined || isInitializingPractice) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-8">
          <div className="text-lg text-muted-foreground">
            {isInitializingPractice
              ? "Initialisiere Praxis..."
              : "Lade Daten..."}
          </div>
        </div>
      </div>
    );
  }

  // Show error state if no practice could be loaded
  if (!currentPractice) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-8">
          <div className="text-lg text-destructive">
            Fehler beim Laden der Praxis
          </div>
          <Button
            className="mt-4"
            onClick={() => void handleInitializePractice()}
          >
            Praxis initialisieren
          </Button>
        </div>
      </div>
    );
  }

  const handleActivateRuleSet = async (ruleSetId: Id<"ruleSets">) => {
    try {
      // Check if this is the unsaved rule set
      const isUnsavedRuleSet = ruleSetId === unsavedRuleSetId;

      if (isUnsavedRuleSet) {
        // Save and activate the unsaved rule set
        await saveUnsavedRuleSetMutation({
          description: activationName || "Ungespeicherte Änderungen",
          practiceId: currentPractice._id,
          setAsActive: true,
        });
      } else {
        // Just activate an already-saved rule set
        await activateRuleSetMutation({
          practiceId: currentPractice._id,
          ruleSetId,
        });
      }

      toast.success("Regelset aktiviert", {
        description:
          "Das Regelset wurde erfolgreich gespeichert und aktiviert.",
      });

      setIsSaveDialogOpen(false);
      setActivationName("");
      setUnsavedRuleSetId(null); // Clear unsaved state
      setIsDraftEquivalentToParent(false);
      setDraftRevisionOverride(null);
      setDraftParentRuleSetIdOverride(null);

      // If we came from the save dialog, switch to the pending rule set (or active when undefined)
      if (pendingRuleSetId === undefined) {
        // Keep URL in sync with the activated rule set
        pushUrl({ ruleSetId });
      } else {
        pushUrl({ ruleSetId: pendingRuleSetId });
        setPendingRuleSetId(undefined);
      }
    } catch (error: unknown) {
      captureError(error, {
        context: "ruleset_activation",
        practiceId: currentPractice._id,
        ruleSetId,
      });

      toast.error("Fehler beim Aktivieren", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleOpenSaveDialog = () => {
    if (currentWorkingRuleSet) {
      setActivationName(""); // Always start with empty name
      setIsSaveDialogOpen(true);
    }
  };

  // Save dialog handlers
  // Note: name parameter is required by the interface but not used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSaveOnly = (_name: string) => {
    if (!currentWorkingRuleSet) {
      return;
    }

    void (async () => {
      try {
        const isUnsavedRuleSet = currentWorkingRuleSet._id === unsavedRuleSetId;

        if (isUnsavedRuleSet) {
          // Save the unsaved rule set WITHOUT activating
          await saveUnsavedRuleSetMutation({
            description: activationName || "Ungespeicherte Änderungen",
            practiceId: currentPractice._id,
            setAsActive: false, // Key difference: don't activate
          });
        }
        // If it's already saved, there's nothing to do

        setUnsavedRuleSetId(null);
        setIsDraftEquivalentToParent(false);
        setDraftRevisionOverride(null);
        setDraftParentRuleSetIdOverride(null);
        setPendingRuleSetId(undefined);
        setIsSaveDialogOpen(false);
        setActivationName("");
        toast.success("Änderungen gespeichert");

        // Navigate to pending rule set if there was one, otherwise stay on current
        if (pendingRuleSetId === undefined) {
          // Stay on the saved rule set (don't navigate away)
          pushUrl({ ruleSetId: currentWorkingRuleSet._id });
        } else {
          pushUrl({ ruleSetId: pendingRuleSetId });
        }
      } catch (error: unknown) {
        captureError(error, {
          context: "save_only",
          practiceId: currentPractice._id,
          ruleSetId: currentWorkingRuleSet._id,
        });
        toast.error("Fehler beim Speichern", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    })();
  };

  // Note: name parameter is required by the interface but not used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSaveAndActivate = (_name: string) => {
    if (currentWorkingRuleSet) {
      void handleActivateRuleSet(currentWorkingRuleSet._id);
    }
  };

  const handleOpenDiscardDialog = () => {
    setDiscardTargetRuleSetId(pendingRuleSetId ?? activeRuleSet?._id);
    setIsSaveDialogOpen(false);
    setIsDiscardDialogOpen(true);
  };

  const handleDiscardChanges = () => {
    if (unsavedRuleSet) {
      const draftToDelete = unsavedRuleSet;
      const targetRuleSetId =
        discardTargetRuleSetId ?? pendingRuleSetId ?? activeRuleSet?._id;

      void (async () => {
        try {
          discardingUnsavedRuleSetIdRef.current = draftToDelete._id;
          setUnsavedRuleSetId(null);
          setIsDraftEquivalentToParent(false);
          setDraftRevisionOverride(null);
          setDraftParentRuleSetIdOverride(null);
          pushUrl({ ruleSetId: targetRuleSetId });

          await deleteUnsavedRuleSetMutation({
            practiceId: currentPractice._id,
            ruleSetId: draftToDelete._id,
          });

          setPendingRuleSetId(undefined);
          setDiscardTargetRuleSetId(undefined);
          setIsDiscardDialogOpen(false);
          setIsSaveDialogOpen(false);
          setActivationName("");
          toast.success("Änderungen verworfen");
        } catch (error: unknown) {
          if (discardingUnsavedRuleSetIdRef.current === draftToDelete._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
          setUnsavedRuleSetId(draftToDelete._id);
          setDraftRevisionOverride(draftToDelete.draftRevision);
          if (draftToDelete.parentVersion) {
            setDraftParentRuleSetIdOverride(draftToDelete.parentVersion);
          } else {
            setDraftParentRuleSetIdOverride(null);
          }
          pushUrl({ ruleSetId: draftToDelete._id });

          captureError(error, {
            context: "discard_changes",
            practiceId: currentPractice._id,
            ruleSetId: draftToDelete._id,
          });

          toast.error("Fehler beim Verwerfen der Änderungen", {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          });
        } finally {
          if (discardingUnsavedRuleSetIdRef.current === draftToDelete._id) {
            discardingUnsavedRuleSetIdRef.current = null;
          }
        }
      })();
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Regelverwaltung & Simulation
        </h1>
      </div>

      {currentWorkingRuleSet && isShowingUnsavedRuleSet && (
        <div className="sticky top-3 z-40 mb-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 rounded-2xl border border-red-300 bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  Ungespeicherte Änderungen
                </div>
                <div className="text-sm text-muted-foreground">
                  Dieses Regelset enthält Änderungen gegenüber dem
                  übergeordneten Regelset, die noch nicht gespeichert wurden.
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  onClick={handleOpenDiscardDialog}
                  size="sm"
                  variant="outline"
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Änderungen verwerfen
                </Button>
                <Button onClick={handleOpenSaveDialog} size="sm">
                  Speichern
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page-level Tabs */}
      <ClientOnly fallback={<div />}>
        <Tabs
          className="space-y-6"
          onValueChange={(val) => {
            navigateTab(val as typeof activeTab);
          }}
          value={activeTab}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rule-management">
              Regelverwaltung + Patientensicht
            </TabsTrigger>
            <TabsTrigger value="staff-view">Praxismitarbeiter</TabsTrigger>
            <TabsTrigger value="vacation-scheduler">Urlaub</TabsTrigger>
          </TabsList>

          {/* Tab 1: Rule Management + Patient View */}
          <TabsContent value="rule-management">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left Panel - Regelverwaltung */}
              <div className="space-y-6">
                <div className="space-y-6">
                  {/* Rule Set Selection */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Regelset Auswahl</CardTitle>
                      {ruleSetsQuery?.length === 0 && (
                        <CardDescription>
                          Erstellen Sie Ihr erstes Regelset durch das Hinzufügen
                          von Regeln, Ärzten oder Arbeitszeiten.
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Show version graph when there are saved rule sets */}
                      {versionsQuery && versionsQuery.length > 0 && (
                        <div className="space-y-2">
                          <Label>Regelset-Versionshistorie</Label>
                          <div className="border rounded-lg p-4">
                            <VersionGraph
                              onVersionClick={handleVersionClick}
                              {...((ruleSetIdFromUrl || unsavedRuleSetId) && {
                                selectedVersionId: (ruleSetIdFromUrl ||
                                  unsavedRuleSetId) as string,
                              })}
                              versions={versionsQuery}
                            />
                          </div>
                          {/* Show current state indicator */}
                          {isShowingUnsavedRuleSet && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Badge className="text-xs" variant="secondary">
                                Ungespeicherte Änderungen
                              </Badge>
                              <span>Arbeiten Sie gerade an Änderungen</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        {/* Show save button when we have an unsaved rule set or when creating the first one */}
                        {(isShowingUnsavedRuleSet ||
                          (ruleSetsQuery?.length === 0 &&
                            currentWorkingRuleSet)) && (
                          <Button
                            onClick={handleOpenSaveDialog}
                            variant="default"
                          >
                            <Save className="h-4 w-4 mr-2" />
                            Speichern
                          </Button>
                        )}

                        {/* Show activate button when a different rule set is selected and there are no unsaved changes */}
                        {selectedRuleSet &&
                          !hasBlockingUnsavedChanges &&
                          !selectedRuleSet.isActive && (
                            <Button
                              onClick={() =>
                                void handleActivateRuleSet(selectedRuleSet._id)
                              }
                              variant="outline"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Aktivieren
                            </Button>
                          )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Appointment Types Management */}
                  {ruleSetReplayTarget && (
                    <AppointmentTypesManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Practitioner Management */}
                  {ruleSetReplayTarget && (
                    <PractitionerManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Base Schedule Management */}
                  {ruleSetReplayTarget && (
                    <BaseScheduleManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}

                  {/* Locations Management */}
                  {ruleSetReplayTarget && (
                    <LocationsManagement
                      onDraftMutation={handleDraftMutation}
                      onRegisterHistoryAction={registerRegelnHistoryAction}
                      practiceId={currentPractice._id}
                      ruleSetReplayTarget={ruleSetReplayTarget}
                    />
                  )}
                </div>
              </div>

              {/* Right Panel - Patient View + Simulation Controls */}
              <div className="space-y-6">
                {ruleSetIdFromUrl ? (
                  <div className="flex justify-center">
                    <PatientBookingFlow
                      dateRange={dateRange}
                      onLocationChange={(locationId) => {
                        pushUrl({ locationId });
                      }}
                      onUpdateSimulatedContext={(ctx) => {
                        setSimulatedContext(ctx);
                        pushUrl({
                          isNewPatient: ctx.patient.isNew,
                          locationId: ctx.locationId,
                        });
                      }}
                      practiceId={currentPractice._id}
                      ruleSetId={ruleSetIdFromUrl}
                      simulatedContext={simulatedContext}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    Bitte wählen Sie einen Regelsatz aus, um die Patientensicht
                    anzuzeigen.
                  </div>
                )}

                <SimulationControls
                  isClearingSimulatedAppointments={
                    isClearingSimulatedAppointments
                  }
                  isResettingSimulation={isResettingSimulation}
                  locationsListQuery={locationsListQuery}
                  onClearSimulatedAppointments={
                    handleClearSimulatedAppointments
                  }
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onLocationChange={(locationId) => {
                    pushUrl({ locationId });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({
                      isNewPatient: ctx.patient.isNew,
                      locationId: ctx.locationId,
                    });
                  }}
                  onSimulationRuleSetChange={(id) => {
                    // If unsaved exists and target is not the unsaved id, show save dialog
                    if (
                      hasBlockingUnsavedChanges &&
                      id !== unsavedRuleSet?._id
                    ) {
                      setPendingRuleSetId(id);
                      setActivationName("");
                      setIsSaveDialogOpen(true);
                      return;
                    }
                    pushUrl({ ruleSetId: id });
                  }}
                  ruleSetsQuery={ruleSetsWithActive}
                  selectedDate={selectedDate}
                  selectedLocationId={locationIdFromUrl}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
                />
              </div>
            </div>

            {/* Full width Rules List */}
            {(currentWorkingRuleSet ?? ruleSetsQuery?.length === 0) && (
              <div className="mt-6">
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>
                          {currentWorkingRuleSet ? (
                            <>
                              {isShowingUnsavedRuleSet ? (
                                <>
                                  Regeln in{" "}
                                  <Badge className="ml-2" variant="secondary">
                                    Ungespeicherte Änderungen
                                  </Badge>
                                </>
                              ) : (
                                <>
                                  Regeln in {currentWorkingRuleSet.description}
                                  {currentWorkingRuleSet.isActive && (
                                    <Badge className="ml-2" variant="default">
                                      AKTIV
                                    </Badge>
                                  )}
                                </>
                              )}
                            </>
                          ) : (
                            "Regeln"
                          )}
                        </CardTitle>
                        <CardDescription>
                          {currentWorkingRuleSet
                            ? currentWorkingRuleSet.description
                            : "Fügen Sie Ihre erste Regel hinzu"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ruleSetReplayTarget && (
                      <RuleBuilder
                        onDraftMutation={handleDraftMutation}
                        onRegisterHistoryAction={registerRegelnHistoryAction}
                        practiceId={currentPractice._id}
                        ruleSetReplayTarget={ruleSetReplayTarget}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Staff View Only */}
          <TabsContent value="staff-view">
            <div className="space-y-6">
              <div className="space-y-6">
                {ruleSetIdFromUrl ? (
                  <MedicalStaffDisplay
                    onUpdateSimulatedContext={(ctx) => {
                      setSimulatedContext(ctx);
                      pushUrl({
                        isNewPatient: ctx.patient.isNew,
                        locationId: ctx.locationId,
                      });
                    }}
                    patient={patientInfo}
                    practiceId={currentPractice._id}
                    ruleSetId={ruleSetIdFromUrl}
                    simulatedContext={simulatedContext}
                    simulationDate={simulationDate}
                  />
                ) : (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    Bitte wählen Sie ein Regelwerk aus, um die
                    Mitarbeiteransicht anzuzeigen.
                  </div>
                )}

                <SimulationControls
                  isClearingSimulatedAppointments={
                    isClearingSimulatedAppointments
                  }
                  isResettingSimulation={isResettingSimulation}
                  locationsListQuery={locationsListQuery}
                  onClearSimulatedAppointments={
                    handleClearSimulatedAppointments
                  }
                  onDateChange={(d) => {
                    pushUrl({ date: d });
                  }}
                  onLocationChange={(locationId) => {
                    pushUrl({ locationId });
                  }}
                  onResetSimulation={resetSimulation}
                  onSimulatedContextChange={(ctx) => {
                    setSimulatedContext(ctx);
                    pushUrl({
                      isNewPatient: ctx.patient.isNew,
                      locationId: ctx.locationId,
                    });
                  }}
                  onSimulationRuleSetChange={(id) => {
                    if (
                      hasBlockingUnsavedChanges &&
                      id !== unsavedRuleSet?._id
                    ) {
                      setPendingRuleSetId(id);
                      setActivationName("");
                      setIsSaveDialogOpen(true);
                      return;
                    }
                    pushUrl({ ruleSetId: id });
                  }}
                  ruleSetsQuery={ruleSetsWithActive}
                  selectedDate={selectedDate}
                  selectedLocationId={locationIdFromUrl}
                  simulatedContext={simulatedContext}
                  simulationRuleSetId={ruleSetIdFromUrl}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="vacation-scheduler">
            {ruleSetReplayTarget && (
              <VacationScheduler
                editable
                onDateChange={(date) => {
                  pushUrl({
                    date: new Date(date.year, date.month - 1, date.day),
                  });
                }}
                onDraftMutation={handleDraftMutation}
                onRegisterHistoryAction={registerRegelnHistoryAction}
                practiceId={currentPractice._id}
                ruleSetReplayTarget={ruleSetReplayTarget}
                selectedDate={Temporal.PlainDate.from({
                  day: selectedDate.getDate(),
                  month: selectedDate.getMonth() + 1,
                  year: selectedDate.getFullYear(),
                })}
              />
            )}
          </TabsContent>
        </Tabs>
      </ClientOnly>

      {/* Save Dialog */}
      <Dialog
        onOpenChange={(open) => {
          setIsSaveDialogOpen(open);
          if (!open) {
            setPendingRuleSetId(undefined);
            setActivationName("");
          }
        }}
        open={isSaveDialogOpen}
      >
        <DialogContent className="flex max-h-[calc(100vh-2rem)] !w-auto min-w-[min(32rem,calc(100vw-2rem))] !max-w-[calc(100vw-2rem)] flex-col overflow-auto">
          <DialogHeader>
            <DialogTitle>Regelset speichern</DialogTitle>
            <DialogDescription>
              {pendingRuleSetId
                ? "Sie haben ungespeicherte Änderungen. Möchten Sie diese speichern, bevor Sie zu einem anderen Regelset wechseln?"
                : "Geben Sie einen eindeutigen Namen für dieses Regelset ein."}
            </DialogDescription>
          </DialogHeader>
          <SaveDialogForm
            activationName={activationName}
            existingSavedDescriptions={
              ruleSetsQuery
                ?.filter((rs) => rs.saved)
                .map((rs) => rs.description) ?? []
            }
            onDiscard={pendingRuleSetId ? handleOpenDiscardDialog : null}
            onSaveAndActivate={handleSaveAndActivate}
            onSaveOnly={handleSaveOnly}
            ruleNameContext={ruleNameContext}
            ruleSetDiff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
            setActivationName={setActivationName}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setIsDiscardDialogOpen(open);
          if (!open) {
            setDiscardTargetRuleSetId(undefined);
          }
        }}
        open={isDiscardDialogOpen}
      >
        <DialogContent className="flex max-h-[calc(100vh-2rem)] !w-auto min-w-[min(32rem,calc(100vw-2rem))] !max-w-[calc(100vw-2rem)] flex-col overflow-auto">
          <DialogHeader>
            <DialogTitle>Änderungen verwerfen?</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>
                Diese ungespeicherten Änderungen werden gelöscht. Das kann nicht
                rückgängig gemacht werden.
              </DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <RuleSetDiffView
            diff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
            ruleNameContext={ruleNameContext}
          />
          <RuleSetDiffChangeCount
            diff={unsavedRuleSet?.parentVersion ? ruleSetDiff : null}
            ruleNameContext={ruleNameContext}
          />
          <DialogFooter className="mt-2 flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              onClick={() => {
                setIsDiscardDialogOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDiscardChanges}
              type="button"
              variant="destructive"
            >
              Änderungen verwerfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function normalizeEntityName(
  sectionKey: string,
  name: string,
  entityRenames: EntityRenameMaps,
) {
  if (sectionKey === "appointmentTypes") {
    return normalizeRenamedValue(name, entityRenames.appointmentTypes);
  }
  if (sectionKey === "locations") {
    return normalizeRenamedValue(name, entityRenames.locations);
  }
  if (sectionKey === "mfas") {
    return normalizeRenamedValue(name, entityRenames.mfas);
  }
  if (sectionKey === "practitioners") {
    return normalizeRenamedValue(name, entityRenames.practitioners);
  }

  return name;
}

function normalizeFollowUpPlanReferences(
  value: unknown,
  renames: Map<string, string>,
) {
  if (!Array.isArray(value)) {
    return value;
  }

  const steps: unknown[] = value;
  return steps.map((step) => {
    if (!step || typeof step !== "object") {
      return step;
    }

    const parsedStep = step as Record<string, unknown>;
    return {
      ...parsedStep,
      appointmentTypeName: normalizeRenamedValue(
        stringValue(parsedStep["appointmentTypeName"]),
        renames,
      ),
    };
  });
}

function normalizeReferences(
  sectionKey: string,
  value: Record<string, unknown>,
  entityRenames: EntityRenameMaps,
) {
  if (sectionKey === "appointmentTypes") {
    return {
      ...value,
      allowedPractitioners: normalizeRenamedArray(
        value["allowedPractitioners"],
        entityRenames.practitioners,
      ),
      followUpPlan: normalizeFollowUpPlanReferences(
        value["followUpPlan"],
        entityRenames.appointmentTypes,
      ),
    };
  }

  if (sectionKey === "baseSchedules") {
    return {
      ...value,
      locationName: normalizeRenamedValue(
        stringValue(value["locationName"]),
        entityRenames.locations,
      ),
      practitionerName: normalizeRenamedValue(
        stringValue(value["practitionerName"]),
        entityRenames.practitioners,
      ),
    };
  }

  if (sectionKey === "rules") {
    return normalizeRuleReferences(value, entityRenames);
  }

  if (sectionKey === "vacations") {
    const staffName = stringValue(value["staffName"]);
    return {
      ...value,
      staffName: normalizeRenamedValue(
        normalizeRenamedValue(staffName, entityRenames.practitioners),
        entityRenames.mfas,
      ),
    };
  }

  return value;
}

function normalizeRenamedArray(value: unknown, renames: Map<string, string>) {
  if (!Array.isArray(value)) {
    return value;
  }

  const entries: unknown[] = value;
  return entries.map((entry) =>
    typeof entry === "string" ? normalizeRenamedValue(entry, renames) : entry,
  );
}

function normalizeRenamedValue(value: string, renames: Map<string, string>) {
  return (
    [...renames.entries()].find(([, after]) => after === value)?.[0] ?? value
  );
}

function normalizeRuleReferences(
  value: Record<string, unknown>,
  entityRenames: EntityRenameMaps,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...value };
  const conditionType = stringValue(normalized["conditionType"]);
  const valueIds = normalized["valueIds"];

  switch (conditionType) {
    case "APPOINTMENT_TYPE":
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY": {
      normalized["valueIds"] = normalizeRenamedArray(
        valueIds,
        entityRenames.appointmentTypes,
      );
      break;
    }
    case "LOCATION": {
      normalized["valueIds"] = normalizeRenamedArray(
        valueIds,
        entityRenames.locations,
      );
      break;
    }
    case "PRACTITIONER": {
      normalized["valueIds"] = normalizeRenamedArray(
        valueIds,
        entityRenames.practitioners,
      );
      break;
    }
  }

  if (Array.isArray(normalized["children"])) {
    const children: unknown[] = normalized["children"];
    normalized["children"] = children.map((child) =>
      child && typeof child === "object"
        ? normalizeRuleReferences(
            child as Record<string, unknown>,
            entityRenames,
          )
        : child,
    );
  }

  return normalized;
}

function omitKey(value: Record<string, unknown>, keyToOmit: string) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== keyToOmit),
  );
}

function parseConditionTreeNode(value: unknown): ConditionTreeNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const nodeType = stringValue(parsed["nodeType"]);

  if (nodeType === "CONDITION") {
    const conditionType = stringValue(parsed["conditionType"]);
    const operator = stringValue(parsed["operator"]);
    if (!conditionType || !operator) {
      return null;
    }

    const conditionNode: ConditionTreeNode = {
      conditionType: conditionType as ConditionType,
      nodeType: "CONDITION",
      operator: operator as ConditionOperator,
    };

    const scope = stringValue(parsed["scope"]);
    if (scope) {
      conditionNode.scope = scope as Scope;
    }

    if (Array.isArray(parsed["valueIds"])) {
      conditionNode.valueIds = parsed["valueIds"].filter(
        (entry): entry is string => typeof entry === "string",
      );
    }

    if (typeof parsed["valueNumber"] === "number") {
      conditionNode.valueNumber = parsed["valueNumber"];
    }

    return conditionNode;
  }

  if (nodeType === "AND" || nodeType === "NOT") {
    const childValues = Array.isArray(parsed["children"])
      ? parsed["children"]
      : [];
    const parsedChildren = childValues
      .map((child) => parseConditionTreeNode(child))
      .filter((child): child is ConditionTreeNode => child !== null);

    return {
      children: parsedChildren,
      nodeType,
    };
  }

  return null;
}

function parseDiffValue(value: string): null | Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseRuleDiffTree(
  value: Record<string, unknown>,
): ConditionTreeNode | null {
  const childValues = Array.isArray(value["children"]) ? value["children"] : [];
  const firstChild: unknown = childValues[0];
  const treeRoot =
    value["nodeType"] === null || value["nodeType"] === undefined
      ? firstChild
      : value;

  return parseConditionTreeNode(treeRoot);
}

function RuleSetDiffChangeCount({
  diff,
  ruleNameContext,
}: {
  diff?: null | RuleSetDiff | undefined;
  ruleNameContext: RuleNameContext | undefined;
}) {
  if (!diff) {
    return null;
  }

  const projectedSections = getProjectedRuleSetDiffSections(
    diff,
    ruleNameContext,
  );
  const changeCount = projectedSections.flatMap(
    (projectedSection) => projectedSection.rows,
  ).length;

  return (
    <div className="mt-2 flex shrink-0 justify-end">
      <Badge variant="secondary">{changeCount} Änderungen</Badge>
    </div>
  );
}

function RuleSetDiffSectionView({
  projectedSection,
}: {
  projectedSection: ProjectedRuleSetDiffSection;
}) {
  const { rows, section } = projectedSection;
  const modifiedRows = rows.filter((row) => row.kind === "modified");
  const singleValueRows = rows.filter((row) => row.kind !== "modified");
  return (
    <div className="w-max overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="text-sm font-medium">{section.title}</div>
      </div>
      <div className="overflow-x-auto">
        <div className="w-max">
          {modifiedRows.length > 0 && (
            <table className="w-auto table-auto border-collapse text-left text-xs">
              <tbody>
                {modifiedRows.map((row) => (
                  <tr className="border-b" key={row.id}>
                    <td className="bg-muted/10 px-3 py-2 font-medium text-foreground">
                      {row.path}
                    </td>
                    <td className="border-l px-3 py-2">
                      <Badge variant="secondary">Geändert</Badge>
                    </td>
                    <td className="border-l bg-red-50/60 px-3 py-2 text-red-950">
                      <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                        {row.before}
                      </pre>
                    </td>
                    <td className="border-l bg-emerald-50/60 px-3 py-2 text-emerald-950">
                      <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                        {row.after}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {singleValueRows.length > 0 && (
            <table className="w-auto table-auto border-collapse text-left text-xs">
              <tbody>
                {singleValueRows.map((row) => (
                  <tr className="border-b last:border-b-0" key={row.id}>
                    <td
                      className={
                        row.kind === "added"
                          ? "bg-emerald-50/60 px-3 py-2 font-medium text-emerald-950"
                          : "bg-red-50/60 px-3 py-2 font-medium text-red-950"
                      }
                    >
                      {row.path}
                    </td>
                    <td className="border-l px-3 py-2">
                      <Badge
                        className={
                          row.kind === "added"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-red-100 text-red-900"
                        }
                        variant="outline"
                      >
                        {row.kind === "added" ? "Hinzugefügt" : "Entfernt"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleSetDiffView({
  diff,
  ruleNameContext,
}: {
  diff?: null | RuleSetDiff | undefined;
  ruleNameContext: RuleNameContext | undefined;
}) {
  if (diff === null) {
    return null;
  }

  if (!diff) {
    return (
      <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Änderungen werden geladen...
      </div>
    );
  }

  const projectedSections = getProjectedRuleSetDiffSections(
    diff,
    ruleNameContext,
  );

  return (
    <div className="w-max">
      {projectedSections.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Keine sichtbaren Änderungen zum übergeordneten Regelset.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {projectedSections.map((projectedSection) => (
            <RuleSetDiffSectionView
              key={projectedSection.section.key}
              projectedSection={projectedSection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SaveDialogForm({
  activationName,
  existingSavedDescriptions,
  onDiscard,
  onSaveAndActivate,
  onSaveOnly,
  ruleNameContext,
  ruleSetDiff,
  setActivationName,
}: SaveDialogFormProps) {
  const form = useForm({
    defaultValues: {
      name: activationName,
    },
    onSubmit: async () => {
      // This will be handled by individual button clicks
    },
  });

  React.useEffect(() => {
    form.setFieldValue("name", activationName);
  }, [activationName, form]);

  // Use activationName directly since it's kept in sync via setActivationName
  const trimmedName = activationName.trim();

  // Local validation using shared validation logic (instant, no network latency)
  const { isValidName, validationError } = React.useMemo(() => {
    const result = validateRuleSetDescriptionSync(
      trimmedName,
      existingSavedDescriptions,
    );
    return {
      isValidName: result.isValid,
      validationError: result.error,
    };
  }, [trimmedName, existingSavedDescriptions]);

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="flex min-h-0 flex-col gap-4">
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }: { value: string }) =>
              value.trim() ? undefined : "Name ist erforderlich",
          }}
        >
          {(field: {
            handleChange: (value: string) => void;
            name: string;
            state: { value: string };
          }) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Name für das Regelset</Label>
              <Input
                id={field.name}
                onChange={(e) => {
                  field.handleChange(e.target.value);
                  setActivationName(e.target.value);
                }}
                placeholder="z.B. Wintersprechzeiten 2024"
                required
                value={field.state.value}
              />
              {validationError && (
                <div className="text-sm text-destructive">
                  {validationError}
                </div>
              )}
            </div>
          )}
        </form.Field>
        <RuleSetDiffView diff={ruleSetDiff} ruleNameContext={ruleNameContext} />
      </div>
      <RuleSetDiffChangeCount
        diff={ruleSetDiff}
        ruleNameContext={ruleNameContext}
      />
      <DialogFooter className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2">
        {onDiscard && (
          <Button onClick={onDiscard} type="button" variant="outline">
            Änderungen verwerfen
          </Button>
        )}
        <Button
          disabled={!isValidName}
          onClick={() => {
            if (isValidName && trimmedName) {
              onSaveOnly(trimmedName);
            }
          }}
          type="button"
          variant="secondary"
        >
          Speichern
        </Button>
        <Button
          disabled={!isValidName}
          onClick={() => {
            if (isValidName && trimmedName) {
              onSaveAndActivate(trimmedName);
            }
          }}
          type="button"
          variant="default"
        >
          Speichern & Aktivieren
        </Button>
      </DialogFooter>
    </form>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

// Simulation Controls Component - Extracted from SimulationPanel
function SimulationControls({
  isClearingSimulatedAppointments,
  isResettingSimulation,
  locationsListQuery,
  onClearSimulatedAppointments,
  onDateChange,
  onLocationChange,
  onResetSimulation,
  onSimulatedContextChange,
  onSimulationRuleSetChange,
  ruleSetsQuery,
  selectedDate,
  selectedLocationId,
  simulatedContext,
  simulationRuleSetId,
}: {
  isClearingSimulatedAppointments: boolean;
  isResettingSimulation: boolean;
  locationsListQuery:
    | undefined
    | {
        _id: Id<"locations">;
        name: string;
      }[];
  onClearSimulatedAppointments: () => Promise<void>;
  onDateChange: (date: Date) => void;
  onLocationChange: (locationId: Id<"locations"> | undefined) => void;
  onResetSimulation: () => Promise<void>;
  onSimulatedContextChange: (context: SimulatedContext) => void;
  onSimulationRuleSetChange: (ruleSetId: Id<"ruleSets"> | undefined) => void;
  ruleSetsQuery:
    | undefined
    | {
        _id: Id<"ruleSets">;
        description: string;
        isActive: boolean;
        version: number;
      }[];
  selectedDate: Date;
  selectedLocationId: Id<"locations"> | undefined;
  simulatedContext: SimulatedContext;
  simulationRuleSetId: Id<"ruleSets"> | undefined;
}) {
  // Compute once to avoid duplicate finds
  const unsavedRuleSet = ruleSetsQuery?.find(
    (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulation Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rule-set">Regelset</Label>
          <Select
            onValueChange={(value) => {
              onSimulationRuleSetChange(
                value === "active" ? undefined : (value as Id<"ruleSets">),
              );
            }}
            value={simulationRuleSetId || "active"}
          >
            <SelectTrigger id="rule-set">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktives Regelset</SelectItem>
              {/* Show unsaved rule set if it exists */}
              {unsavedRuleSet && (
                <SelectItem value={unsavedRuleSet._id}>
                  Ungespeicherte Änderungen
                </SelectItem>
              )}
              {ruleSetsQuery
                ?.filter((rs) => rs.description !== "Ungespeicherte Änderungen")
                .map((ruleSet) => (
                  <SelectItem key={ruleSet._id} value={ruleSet._id}>
                    v{ruleSet.version} - {ruleSet.description}
                    {ruleSet.isActive && " (aktiv)"}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {simulationRuleSetId && (
          <AppointmentTypeSelector
            onTypeDeselect={() => {
              const updated = { ...simulatedContext };
              delete updated.appointmentTypeId;
              onSimulatedContextChange(updated);
            }}
            onTypeSelect={(type) => {
              onSimulatedContextChange({
                ...simulatedContext,
                appointmentTypeId: type,
              });
            }}
            ruleSetId={simulationRuleSetId}
            selectedType={simulatedContext.appointmentTypeId}
          />
        )}

        <div className="space-y-2">
          <Label>Standort auswählen</Label>
          {locationsListQuery && locationsListQuery.length > 0 ? (
            <LocationSelector
              locations={locationsListQuery}
              onLocationSelect={(locationId) => {
                onLocationChange(locationId);
              }}
              selectedLocationId={selectedLocationId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine Standorte verfügbar
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="patient-type">Patiententyp</Label>
          <Select
            onValueChange={(value) => {
              onSimulatedContextChange({
                ...simulatedContext,
                patient: { isNew: value === "new" },
              });
            }}
            value={simulatedContext.patient.isNew ? "new" : "existing"}
          >
            <SelectTrigger id="patient-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Neuer Patient</SelectItem>
              <SelectItem value="existing">Bestandspatient</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Datum auswählen</Label>
          <Calendar
            className="rounded-md border"
            mode="single"
            onSelect={(date) => {
              if (date) {
                onDateChange(date);
              }
            }}
            selected={selectedDate}
          />
        </div>

        <Button
          className="w-full"
          disabled={isResettingSimulation}
          onClick={() => {
            void onResetSimulation();
          }}
          variant="outline"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isResettingSimulation ? "animate-spin" : ""}`}
          />
          Zurücksetzen
        </Button>

        <Button
          className="w-full"
          disabled={isClearingSimulatedAppointments}
          onClick={() => {
            void onClearSimulatedAppointments();
          }}
          variant="destructive"
        >
          <Trash2
            className={`h-4 w-4 mr-2 ${
              isClearingSimulatedAppointments ? "animate-spin" : ""
            }`}
          />
          Alle Simulationstermine löschen
        </Button>
      </CardContent>
    </Card>
  );
}
