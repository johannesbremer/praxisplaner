export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const NERDS_TAB_SEARCH_VALUE = "nerds" as const;

export interface PraxisplanerSearchParams {
  datum?: string;
  standort?: string;
  tab?: PraxisplanerTabParam;
}

export type PraxisplanerTabParam = typeof NERDS_TAB_SEARCH_VALUE;

const isValidDateString = (value: unknown): value is string =>
  typeof value === "string" && DATE_REGEX.test(value);

export const normalizePraxisplanerSearch = (
  search: Record<string, unknown>,
): PraxisplanerSearchParams => {
  const params: PraxisplanerSearchParams = {};

  if (isValidDateString(search["datum"])) {
    params.datum = search["datum"];
  }

  if (typeof search["standort"] === "string" && search["standort"].length > 0) {
    params.standort = search["standort"];
  }

  if (search["tab"] === NERDS_TAB_SEARCH_VALUE) {
    params.tab = NERDS_TAB_SEARCH_VALUE;
  }

  return params;
};
