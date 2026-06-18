import { describe, expect, it } from "vitest";

import {
  normalizePraxisplanerSearch,
  serializeVisibleColumnNamesForSearch,
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

  it("normalizes visible column names for URL state", () => {
    const result = normalizePraxisplanerSearch({
      spalten: "Labor*KB*Labor** EKG ",
    });

    expect(result).toEqual({
      spalten: "EKG*KB*Labor",
    });
  });

  it("keeps a single visible column name as a plain search value", () => {
    const result = normalizePraxisplanerSearch({
      spalten: "EKG",
    });

    expect(result).toEqual({
      spalten: "EKG",
    });
  });

  it("omits empty visible column URL state", () => {
    const result = normalizePraxisplanerSearch({
      spalten: " ",
    });

    expect(result).toEqual({});
  });

  it("serializes visible column names deterministically", () => {
    expect(
      serializeVisibleColumnNamesForSearch(["Labor", "EKG", "Labor"]),
    ).toBe("EKG*Labor");
  });

  it("omits visible column URL state when all columns should be shown", () => {
    expect(serializeVisibleColumnNamesForSearch()).toBeUndefined();
  });
});
