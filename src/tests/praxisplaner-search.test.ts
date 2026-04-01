import { describe, expect, it } from "vitest";

import {
  normalizePraxisplanerSearch,
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
});
