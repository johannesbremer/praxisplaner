import { useForm } from "@tanstack/react-form";
import React from "react";

import type {
  ConditionOperator,
  ConditionTreeNode,
  ConditionType,
  Scope,
} from "@/convex/ruleEngine";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateRuleSetDescriptionSync } from "@/convex/ruleSetValidation";

import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../../lib/rule-name-generator";

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
  ruleSetDiff?: null | RuleSetDiff | undefined;
  setActivationName: (name: string) => void;
}

interface StructuredDiffRow {
  after: string;
  before: string;
  id: string;
  kind: "added" | "modified" | "removed";
  path: string;
}

const UNSAVED_RULE_SET_DESCRIPTION = "Ungespeicherte Änderungen";

function buildRuleNameContextFromTree(
  tree: ConditionTreeNode,
): RuleNameContext {
  const appointmentTypes = new Set<string>();
  const locations = new Set<string>();
  const practitioners = new Set<string>();
  const conditions = conditionTreeToConditions(tree);

  for (const condition of conditions) {
    switch (condition.type) {
      case "APPOINTMENT_TYPE": {
        for (const valueId of condition.valueIds ?? []) {
          appointmentTypes.add(valueId);
        }
        break;
      }
      case "CONCURRENT_COUNT":
      case "DAILY_CAPACITY": {
        for (const appointmentType of condition.appointmentTypes ?? []) {
          appointmentTypes.add(appointmentType);
        }
        break;
      }
      case "LOCATION": {
        for (const valueId of condition.valueIds ?? []) {
          locations.add(valueId);
        }
        break;
      }
      case "PRACTITIONER": {
        for (const valueId of condition.valueIds ?? []) {
          practitioners.add(valueId);
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  return {
    appointmentTypes: [...appointmentTypes].map((name) => ({
      _id: name,
      name,
    })),
    locations: [...locations].map((name) => ({ _id: name, name })),
    practitioners: [...practitioners].map((name) => ({ _id: name, name })),
  };
}

function buildStructuredDiffRows(
  section: RuleSetDiffSection,
  entityRenames: EntityRenameMaps,
) {
  const removedCandidates = section.removed.map((value, index) => ({
    index,
    key: getDiffItemMatchKey(section, value),
    path: getDiffItemPath(section, value, entityRenames),
    value,
  }));
  const addedCandidates = section.added.map((value, index) => ({
    index,
    key: getDiffItemMatchKey(section, value),
    path: getDiffItemPath(section, value, entityRenames),
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
      if (beforeEntry) {
        usedRemoved.add(beforeEntry.index);
      }
      if (afterEntry) {
        usedAdded.add(afterEntry.index);
      }
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
          ? formatChangedStructuredDiffValues(section, before, after)
          : null;

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
  section: RuleSetDiffSection,
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

  if (section.key === "rules") {
    return {
      after: getRuleSummary(after),
      before: getRuleSummary(before),
    };
  }

  if (section.key === "appointmentCoverage") {
    return {
      after: stringValue(after["practitionerName"]),
      before: stringValue(before["practitionerName"]),
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
      full: "Ganztägig",
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

function formatRuleDiffSummary(value: Record<string, unknown>) {
  const tree = parseRuleDiffTree(value);
  if (!tree) {
    return null;
  }

  const snapshotRuleNameContext = buildRuleNameContextFromTree(tree);

  try {
    return generateRuleName(
      conditionTreeToConditions(tree),
      snapshotRuleNameContext.appointmentTypes,
      snapshotRuleNameContext.practitioners,
      snapshotRuleNameContext.locations,
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
    patientLastName: "Patient",
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
      formatPrimitiveValue(parsed["date"]),
      formatEnumValue("portion", parsed["portion"]),
    ]
      .filter(Boolean)
      .join(" > ");
  }

  if (section.key === "appointmentCoverage") {
    return stringValue(parsed["patientLastName"]);
  }

  if (section.key === "rules") {
    return getRuleSummary(parsed);
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

function getProjectedRuleSetDiffSections(diff: RuleSetDiff) {
  const changedSections = diff.sections.filter(
    (section) => section.added.length > 0 || section.removed.length > 0,
  );
  const entityRenames = getEntityRenames(diff);
  return changedSections
    .map(
      (section): ProjectedRuleSetDiffSection => ({
        rows: buildStructuredDiffRows(section, entityRenames),
        section,
      }),
    )
    .filter((projectedSection) => projectedSection.rows.length > 0);
}

function getRuleSummary(value: Record<string, unknown>) {
  const naturalLanguageRule = formatRuleDiffSummary(value);
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
}: {
  diff?: null | RuleSetDiff | undefined;
}) {
  if (!diff) {
    return null;
  }

  const projectedSections = getProjectedRuleSetDiffSections(diff);
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
  const isAppointmentCoverageSection = section.key === "appointmentCoverage";
  const isRuleSection = section.key === "rules";
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
                    <td className="border-l px-3 py-2">
                      <Badge variant="secondary">Geändert</Badge>
                    </td>
                    {isRuleSection ? (
                      <td className="px-0 py-0">
                        <div className="flex">
                          <div className="bg-red-50/60 px-3 py-2 text-red-950">
                            <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                              {row.before}
                            </pre>
                          </div>
                          <div className="border-l bg-emerald-50/60 px-3 py-2 text-emerald-950">
                            <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                              {row.after}
                            </pre>
                          </div>
                        </div>
                      </td>
                    ) : isAppointmentCoverageSection ? (
                      <>
                        <td className="bg-muted/10 px-3 py-2 font-medium text-foreground">
                          {row.path}
                        </td>
                        <td className="border-l px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-red-950">{row.before}</span>
                            <span className="text-muted-foreground">-&gt;</span>
                            <span className="text-emerald-950">
                              {row.after}
                            </span>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="bg-muted/10 px-3 py-2 font-medium text-foreground">
                          {row.path}
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
                      </>
                    )}
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

function RuleSetDiffView({ diff }: { diff?: null | RuleSetDiff | undefined }) {
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

  const projectedSections = getProjectedRuleSetDiffSections(diff);

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
        <RuleSetDiffView diff={ruleSetDiff} />
      </div>
      <RuleSetDiffChangeCount diff={ruleSetDiff} />
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

export type { RuleSetDiff };
export {
  RuleSetDiffChangeCount,
  RuleSetDiffView,
  SaveDialogForm,
  UNSAVED_RULE_SET_DESCRIPTION,
};
