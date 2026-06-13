import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildRegelnSearchFromState,
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
  useRegelnUrl,
} from "../utils/regeln-url";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

describe("Regeln search helpers", () => {
  it("builds search params only for defined state", () => {
    const search = buildRegelnSearchFromState({
      dateDE: "30.01.2025",
      locationName: "Praxis am Markt",
      patientTypeSegment: EXISTING_PATIENT_SEGMENT,
      ruleSetDescription: "wintersprechzeiten-2025",
      tabParam: "debug",
    });

    expect(search).toEqual({
      datum: "30.01.2025",
      patientType: EXISTING_PATIENT_SEGMENT,
      regelwerk: "wintersprechzeiten-2025",
      standort: "Praxis am Markt",
      tab: "debug",
    });
  });

  it("omits undefined values", () => {
    const search = buildRegelnSearchFromState({
      dateDE: undefined,
      locationName: undefined,
      patientTypeSegment: NEW_PATIENT_SEGMENT,
      ruleSetDescription: undefined,
      tabParam: undefined,
    });

    expect(Object.hasOwn(search, "datum")).toBe(false);
    expect(Object.hasOwn(search, "standort")).toBe(false);
    expect(Object.hasOwn(search, "regelwerk")).toBe(false);
    expect(Object.hasOwn(search, "tab")).toBe(false);

    expect(search).toEqual({
      patientType: NEW_PATIENT_SEGMENT,
    });
  });

  it("includes the vacation tab param when present", () => {
    const search = buildRegelnSearchFromState({
      tabParam: "urlaub",
    });

    expect(search).toEqual({
      tab: "urlaub",
    });
  });

  it("can replace an unsaved rule set URL value with a saved description", () => {
    navigateMock.mockClear();

    const { result } = renderHook(() =>
      useRegelnUrl({
        locationsListQuery: [],
        organizationSlug: "standardpraxis",
        routeSearch: {
          datum: "13.06.2026",
          regelwerk: "ungespeichert",
        },
        ruleSetsQuery: [],
        unsavedRuleSet: null,
      }),
    );

    act(() => {
      result.current.pushUrl({
        ruleSetDescription: "Wintersprechzeiten 2026",
      });
    });

    expect(navigateMock).toHaveBeenCalledWith({
      params: { organizationSlug: "standardpraxis" },
      replace: false,
      resetScroll: false,
      search: {
        datum: "13.06.2026",
        regelwerk: "Wintersprechzeiten 2026",
      },
      to: "/$organizationSlug/regeln",
    });
  });
});
