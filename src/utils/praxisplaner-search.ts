import type { DeDateString } from "@/lib/typed-regex";

import { isValidDateDE } from "./date-utils";

export const NERDS_TAB_SEARCH_VALUE = "nerds" as const;
export const VACATION_TAB_SEARCH_VALUE = "urlaub" as const;

export interface PraxisplanerSearchParams {
  datum?: DeDateString;
  spalten?: string;
  standort?: string;
  tab?: PraxisplanerTabParam;
}

export type PraxisplanerTabParam =
  | typeof NERDS_TAB_SEARCH_VALUE
  | typeof VACATION_TAB_SEARCH_VALUE;

const COLUMN_NAME_SEPARATOR = "*";

export const normalizeColumnNames = (
  columnNames: readonly string[],
): string[] =>
  [...new Set(columnNames)]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .toSorted();

export const parseVisibleColumnNamesFromSearch = (value: string): string[] =>
  normalizeColumnNames(value.split(COLUMN_NAME_SEPARATOR));

export const serializeVisibleColumnNamesForSearch = (
  visibleColumnNames?: readonly string[],
): string | undefined => {
  if (visibleColumnNames === undefined) {
    return undefined;
  }

  const normalizedNames = normalizeColumnNames(visibleColumnNames);

  if (normalizedNames.length === 0) {
    return undefined;
  }

  return normalizedNames.join(COLUMN_NAME_SEPARATOR);
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

  const rawSpalten = search["spalten"];
  if (typeof rawSpalten === "string") {
    const spalten = serializeVisibleColumnNamesForSearch(
      parseVisibleColumnNamesFromSearch(rawSpalten),
    );
    if (spalten) {
      params.spalten = spalten;
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
