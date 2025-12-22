import { useNavigate, useSearch } from "@tanstack/react-router";

import type { Id } from "@/convex/_generated/dataModel";

import { formatJSDateDE, isTodayJS, parseJSDateDE } from "./date-utils";

export const NEW_PATIENT_SEGMENT = "neu";
export const EXISTING_PATIENT_SEGMENT = "bestand";

export interface RegelnSearchParams {
  datum?: string;
  patientType?: typeof EXISTING_PATIENT_SEGMENT | typeof NEW_PATIENT_SEGMENT;
  regelwerk?: string;
  standort?: string;
  tab?: RegelnTabParam;
}

export type RegelnTab = "rule-management" | "staff-view";

export type RegelnTabParam = "debug" | "mitarbeiter" | undefined;

interface LocationSummary {
  _id: Id<"locations">;
  name: string;
}

interface RegelnNavigationState {
  dateDE?: string | undefined;
  locationName?: string | undefined;
  patientTypeSegment?:
    | typeof EXISTING_PATIENT_SEGMENT
    | typeof NEW_PATIENT_SEGMENT
    | undefined;
  ruleSetId?: string | undefined;
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
  if (state.locationName) {
    search.standort = state.locationName;
  }
  if (state.dateDE) {
    search.datum = state.dateDE;
  }
  if (state.patientTypeSegment) {
    search.patientType = state.patientTypeSegment;
  }
  if (state.ruleSetId) {
    search.regelwerk = state.ruleSetId;
  }
  return search;
}

export function internalTabToParam(tab: RegelnTab): RegelnTabParam {
  if (tab === "staff-view") {
    return "mitarbeiter";
  }
  return undefined;
}

export function tabParamToInternal(tabParam?: string): RegelnTab {
  if (tabParam === "mitarbeiter") {
    return "staff-view";
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
  const parsedDate = currentRouteState.dateDE
    ? parseJSDateDE(currentRouteState.dateDE)
    : null;
  const selectedDate = parsedDate?.ok ? parsedDate.value : new Date();
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

  // Map ruleSet ID from URL
  const ruleSetIdFromUrl: Id<"ruleSets"> | undefined = (() => {
    if (!currentRouteState.ruleSetId) {
      return;
    }
    if (currentRouteState.ruleSetId === "ungespeichert") {
      return options.unsavedRuleSet?._id;
    }
    // Use ID directly - IDs are unique and prevent collisions
    const found = options.ruleSetsQuery?.find(
      (rs) => rs._id === currentRouteState.ruleSetId,
    );
    return found?._id;
  })();

  // Map location name from URL -> id
  const locationIdFromUrl: Id<"locations"> | undefined = (() => {
    if (!currentRouteState.locationName) {
      return;
    }
    const foundLoc = options.locationsListQuery?.find(
      (l) => l.name === currentRouteState.locationName,
    );
    return foundLoc?._id;
  })();

  function toUrlRuleSetId(id: Id<"ruleSets"> | undefined): string | undefined {
    if (!id) {
      return undefined;
    }
    if (options.unsavedRuleSet?._id === id) {
      return "ungespeichert";
    }
    // Return the ID directly - IDs are unique and prevent collisions
    const found = options.ruleSetsQuery?.find((rs) => rs._id === id);
    return found ? found._id : undefined;
  }

  function toUrlLocationName(
    id: Id<"locations"> | undefined,
  ): string | undefined {
    if (!id) {
      return undefined;
    }
    const loc = options.locationsListQuery?.find((l) => l._id === id);
    return loc?.name;
  }

  function pushUrl(overrides: {
    date?: Date;
    isNewPatient?: boolean;
    locationId?: Id<"locations"> | undefined;
    ruleSetId?: Id<"ruleSets"> | undefined;
    tab?: RegelnTab;
  }) {
    const nextTabParam = internalTabToParam(overrides.tab ?? activeTab);

    // Only convert to ID if we have an explicit override
    // Otherwise preserve the current value directly to avoid query dependency issues
    const targetRuleSetId =
      overrides.ruleSetId === undefined
        ? currentRouteState.ruleSetId
        : toUrlRuleSetId(overrides.ruleSetId);

    const targetIsNew = overrides.isNewPatient ?? isNewPatient;
    const patientTypeSegment = targetIsNew
      ? undefined
      : EXISTING_PATIENT_SEGMENT;

    // Only convert to name if we have an explicit override
    // Otherwise preserve the current value directly to avoid query dependency issues
    const targetLocationName =
      overrides.locationId === undefined
        ? currentRouteState.locationName
        : toUrlLocationName(overrides.locationId);

    const dateToUse = overrides.date ?? selectedDate;
    let dateDE = isTodayJS(dateToUse) ? undefined : formatJSDateDE(dateToUse);
    if (
      !dateDE &&
      (nextTabParam !== undefined ||
        targetRuleSetId !== undefined ||
        patientTypeSegment !== undefined ||
        targetLocationName !== undefined)
    ) {
      dateDE = formatJSDateDE(dateToUse);
    }

    navigateWithOptionalParams({
      dateDE,
      locationName: targetLocationName,
      patientTypeSegment,
      ruleSetId: targetRuleSetId,
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
      datum: currentRouteState.dateDE,
      patientType: currentRouteState.patientTypeSegment,
      ruleSet: currentRouteState.ruleSetId,
      standort: currentRouteState.locationName,
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
    dateDE: params.datum,
    locationName: params.standort,
    patientTypeSegment,
    ruleSetId: params.regelwerk,
    tabParam: params.tab,
  };
}
