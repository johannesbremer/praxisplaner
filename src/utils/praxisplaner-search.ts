import type { DeDateString } from "@/lib/typed-regex";

import { isValidDateDE } from "./date-utils";

export const NERDS_TAB_SEARCH_VALUE = "nerds" as const;
export const VACATION_TAB_SEARCH_VALUE = "urlaub" as const;

export interface PraxisplanerSearchParams {
  datum?: DeDateString;
  ohne?: string;
  standort?: string;
  tab?: PraxisplanerTabParam;
}

export type PraxisplanerTabParam =
  | typeof NERDS_TAB_SEARCH_VALUE
  | typeof VACATION_TAB_SEARCH_VALUE;

const HIDDEN_COLUMN_SEPARATOR = "*";

export const normalizeHiddenColumnNames = (
  hiddenColumnNames: readonly string[],
): string[] =>
  [...new Set(hiddenColumnNames)]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .toSorted();

export const parseHiddenColumnNamesFromSearch = (value: string): string[] =>
  normalizeHiddenColumnNames(value.split(HIDDEN_COLUMN_SEPARATOR));

export const serializeHiddenColumnNamesForSearch = (
  hiddenColumnNames: readonly string[],
): string | undefined => {
  const normalizedNames = normalizeHiddenColumnNames(hiddenColumnNames);

  if (normalizedNames.length === 0) {
    return;
  }

  return normalizedNames.join(HIDDEN_COLUMN_SEPARATOR);
};

export const normalizePraxisplanerSearch = (
  search: Record<string, unknown>,
): PraxisplanerSearchParams => {
  const params: PraxisplanerSearchParams = {};

  if (isValidDateDE(search["datum"])) {
    params.datum = search["datum"];
  }

  if (typeof search["standort"] === "string" && search["standort"].length > 0) {
    params.standort = search["standort"];
  }

  const rawOhne = search["ohne"];
  if (typeof rawOhne === "string") {
    const ohne = serializeHiddenColumnNamesForSearch(
      parseHiddenColumnNamesFromSearch(rawOhne),
    );
    if (ohne) {
      params.ohne = ohne;
    }
  }

  if (
    search["tab"] === NERDS_TAB_SEARCH_VALUE ||
    search["tab"] === VACATION_TAB_SEARCH_VALUE
  ) {
    params.tab = search["tab"];
  }

  return params;
};
