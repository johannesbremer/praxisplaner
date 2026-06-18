import { describe, expect, it } from "vitest";

import {
  normalizePraxisplanerSearch,
  serializeHiddenColumnNamesForSearch,
  VACATION_TAB_SEARCH_VALUE,
} from "../utils/praxisplaner-search";

describe("Praxisplaner search", () => {
  it("accepts the vacation tab value", () => {
    const result = normalizePraxisplanerSearch({
      tab: VACATION_TAB_SEARCH_VALUE,
    });

    expect(result).toEqual({
      tab: VACATION_TAB_SEARCH_VALUE,
    });
  });

  it("normalizes hidden column names for URL state", () => {
    const result = normalizePraxisplanerSearch({
      ohne: "Labor*KB*Labor** EKG ",
    });

    expect(result).toEqual({
      ohne: "EKG*KB*Labor",
    });
  });

  it("keeps a single hidden column name as a plain search value", () => {
    const result = normalizePraxisplanerSearch({
      ohne: "EKG",
    });

    expect(result).toEqual({
      ohne: "EKG",
    });
  });

  it("omits empty hidden column URL state", () => {
    const result = normalizePraxisplanerSearch({
      ohne: " ",
    });

    expect(result).toEqual({});
  });

  it("serializes hidden column names deterministically", () => {
    expect(serializeHiddenColumnNamesForSearch(["Labor", "EKG", "Labor"])).toBe(
      "EKG*Labor",
    );
  });
});
