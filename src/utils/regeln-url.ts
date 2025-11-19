import { useNavigate, useSearch } from "@tanstack/react-router";

import type { Id } from "@/convex/_generated/dataModel";

import { slugify } from "./slug";

export const NEW_PATIENT_SEGMENT = "neu";
export const EXISTING_PATIENT_SEGMENT = "bestand";

export interface RegelnSearchParams {
  datum?: string;
  patientType?: typeof EXISTING_PATIENT_SEGMENT | typeof NEW_PATIENT_SEGMENT;
  regelwerk?: string;
  standort?: string;
  tab?: RegelnTabParam;
}

export type RegelnTab = "debug-views" | "rule-management" | "staff-view";

export type RegelnTabParam = "debug" | "mitarbeiter" | undefined;

interface LocationSummary {
  _id: Id<"locations">;
  name: string;
}

interface RegelnNavigationState {
  dateYmd?: string | undefined;
  locationSlug?: string | undefined;
  patientTypeSegment?:
    | typeof EXISTING_PATIENT_SEGMENT
    | typeof NEW_PATIENT_SEGMENT
    | undefined;
  ruleSetSlug?: string | undefined;
  tabParam?: RegelnTabParam | undefined;
}

interface RuleSetSummary {
  _id: Id<"ruleSets">;
  description: string;
  isActive: boolean;
  version?: number;
}

export function buildRegelnSearchFromState(
  state: RegelnNavigationState,
): RegelnSearchParams {
  const search: RegelnSearchParams = {};
  if (state.tabParam) {
    search.tab = state.tabParam;
  }
  if (state.locationSlug) {
    search.standort = state.locationSlug;
  }
  if (state.dateYmd) {
    search.datum = state.dateYmd;
  }
  if (state.patientTypeSegment) {
    search.patientType = state.patientTypeSegment;
  }
  if (state.ruleSetSlug) {
    search.regelwerk = state.ruleSetSlug;
  }
  return search;
}

export function formatYmd(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function internalTabToParam(tab: RegelnTab): RegelnTabParam {
  if (tab === "staff-view") {
    return "mitarbeiter";
  }
  if (tab === "debug-views") {
    return "debug";
  }
  return undefined;
}

export function isToday(dt?: Date): boolean {
  if (!dt) {
    return true;
  }
  const now = new Date();
  return (
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate()
  );
}

export function parseYmd(ymd?: string): Date | undefined {
  if (!ymd) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return undefined;
  }
  const [ys, ms, ds] = ymd.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

export function tabParamToInternal(tabParam?: string): RegelnTab {
  if (tabParam === "mitarbeiter") {
    return "staff-view";
  }
  if (tabParam === "debug") {
    return "debug-views";
  }
  return "rule-management";
}

export function useRegelnUrl(options: {
  locationsListQuery: LocationSummary[] | undefined;
  ruleSetsQuery: RuleSetSummary[] | undefined;
  unsavedRuleSet?: null | { _id: Id<"ruleSets"> };
}) {
  const navigate = useNavigate();
  const routeSearch: RegelnSearchParams = useSearch({
    from: "/regeln",
  });

  const currentRouteState = fromSearchParams(routeSearch);
  const activeTab = tabParamToInternal(currentRouteState.tabParam);
  const selectedDate = parseYmd(currentRouteState.dateYmd) ?? new Date();
  const isNewPatient =
    currentRouteState.patientTypeSegment !== EXISTING_PATIENT_SEGMENT;
  function navigateWithOptionalParams(
    nextState: Partial<RegelnNavigationState>,
  ) {
    const mergedState: RegelnNavigationState = {
      ...currentRouteState,
      ...nextState,
    };

    const nextSearch = buildRegelnSearchFromState(mergedState);
    void navigate({
      replace: false,
      search: nextSearch,
      to: "/regeln",
    });
  }

  // Map ruleSet slug -> id
  const ruleSetIdFromUrl: Id<"ruleSets"> | undefined = (() => {
    if (!currentRouteState.ruleSetSlug) {
      return;
    }
    if (currentRouteState.ruleSetSlug === "ungespeichert") {
      return options.unsavedRuleSet?._id;
    }
    const found = options.ruleSetsQuery?.find(
      (rs) => slugify(rs.description) === currentRouteState.ruleSetSlug,
    );
    return found?._id;
  })();

  // Map location slug -> id
  const locationIdFromUrl: Id<"locations"> | undefined = (() => {
    if (!currentRouteState.locationSlug) {
      return;
    }
    const foundLoc = options.locationsListQuery?.find(
      (l) => slugify(l.name) === currentRouteState.locationSlug,
    );
    return foundLoc?._id;
  })();

  function getRuleSetSlugFromId(
    id: Id<"ruleSets"> | undefined,
  ): string | undefined {
    if (!id) {
      return undefined;
    }
    if (options.unsavedRuleSet?._id === id) {
      return "ungespeichert";
    }
    const found = options.ruleSetsQuery?.find((rs) => rs._id === id);
    return found ? slugify(found.description) : undefined;
  }

  function getLocationSlugFromId(
    id: Id<"locations"> | undefined,
  ): string | undefined {
    if (!id) {
      return undefined;
    }
    const loc = options.locationsListQuery?.find((l) => l._id === id);
    return loc ? slugify(loc.name) : undefined;
  }

  function pushUrl(overrides: {
    date?: Date;
    isNewPatient?: boolean;
    locationId?: Id<"locations"> | undefined;
    ruleSetId?: Id<"ruleSets"> | undefined;
    tab?: RegelnTab;
  }) {
    const nextTabParam = internalTabToParam(overrides.tab ?? activeTab);

    // Only convert to slug if we have an explicit override
    // Otherwise preserve the current slug directly to avoid query dependency issues
    const targetRuleSetSlug =
      overrides.ruleSetId === undefined
        ? currentRouteState.ruleSetSlug
        : getRuleSetSlugFromId(overrides.ruleSetId); // Preserve current slug directly

    const targetIsNew = overrides.isNewPatient ?? isNewPatient;
    const patientTypeSegment = targetIsNew
      ? undefined
      : EXISTING_PATIENT_SEGMENT;

    // Only convert to slug if we have an explicit override
    // Otherwise preserve the current slug directly to avoid query dependency issues
    const targetLocationSlug =
      overrides.locationId === undefined
        ? currentRouteState.locationSlug
        : getLocationSlugFromId(overrides.locationId); // Preserve current slug directly

    const dateToUse = overrides.date ?? selectedDate;
    let dateYmd = isToday(dateToUse) ? undefined : formatYmd(dateToUse);
    if (
      !dateYmd &&
      (nextTabParam !== undefined ||
        targetRuleSetSlug !== undefined ||
        patientTypeSegment !== undefined ||
        targetLocationSlug !== undefined)
    ) {
      dateYmd = formatYmd(dateToUse);
    }

    navigateWithOptionalParams({
      dateYmd,
      locationSlug: targetLocationSlug,
      patientTypeSegment,
      ruleSetSlug: targetRuleSetSlug,
      tabParam: nextTabParam,
    });
  }

  function navigateTab(next: RegelnTab) {
    const nextTabParam = internalTabToParam(next);
    navigateWithOptionalParams({
      tabParam: nextTabParam,
    });
  }

  return {
    // raw params
    raw: {
      datum: currentRouteState.dateYmd,
      patientType: currentRouteState.patientTypeSegment,
      ruleSet: currentRouteState.ruleSetSlug,
      standort: currentRouteState.locationSlug,
      tab: currentRouteState.tabParam,
    },
    // derived state
    activeTab,
    isNewPatient,
    locationIdFromUrl,
    ruleSetIdFromUrl,
    selectedDate,
    // actions
    navigateTab,
    pushUrl,
  };
}

function fromSearchParams(params: RegelnSearchParams): RegelnNavigationState {
  let patientTypeSegment: RegelnNavigationState["patientTypeSegment"] =
    undefined;
  if (params.patientType === EXISTING_PATIENT_SEGMENT) {
    patientTypeSegment = EXISTING_PATIENT_SEGMENT;
  } else if (params.patientType === NEW_PATIENT_SEGMENT) {
    patientTypeSegment = NEW_PATIENT_SEGMENT;
  }

  return {
    dateYmd: params.datum,
    locationSlug: params.standort,
    patientTypeSegment,
    ruleSetSlug: params.regelwerk,
    tabParam: params.tab,
  };
}
