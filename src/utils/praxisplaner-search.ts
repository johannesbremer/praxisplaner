export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const NERDS_TAB_SEARCH_VALUE = "nerds" as const;

export interface PraxisplanerSearchParams {
  date?: string;
  tab?: typeof NERDS_TAB_SEARCH_VALUE;
}

const isValidDateString = (value: unknown): value is string =>
  typeof value === "string" && DATE_REGEX.test(value);

export const normalizePraxisplanerSearch = (
  search: Record<string, unknown>,
): PraxisplanerSearchParams => {
  const params: PraxisplanerSearchParams = {};

  if (isValidDateString(search["date"])) {
    params.date = search["date"];
  }

  if (search["tab"] === NERDS_TAB_SEARCH_VALUE) {
    params.tab = NERDS_TAB_SEARCH_VALUE;
  }

  return params;
};
