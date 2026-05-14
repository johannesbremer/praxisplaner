import { describe, expect, test } from "vitest";

import { resolveCallRouting } from "./call-routing";

describe("resolveCallRouting", () => {
  test("reads caller and dialed practice number from SIP participant attributes", () => {
    const resolved = resolveCallRouting({
      attributes: {
        "sip.phoneNumber": "+491701234567",
        "sip.trunkPhoneNumber": "+495421000000",
      },
      metadata: undefined,
    });

    expect(resolved.callerPhoneNumber).toBe("+491701234567");
    expect(resolved.dialedPracticePhoneNumber).toBe("+495421000000");
  });

  test("falls back to participant and job metadata for caller number only", () => {
    const resolved = resolveCallRouting(
      {
        attributes: {},
        metadata: JSON.stringify({
          sip: {
            caller_number: "+491701234567",
          },
        }),
      },
      JSON.stringify({
        caller_number: "+491709999999",
      }),
    );

    expect(resolved.callerPhoneNumber).toBe("+491701234567");
    expect(resolved.dialedPracticePhoneNumber).toBeUndefined();
  });

  test("keeps dialed practice number missing when LiveKit did not provide it", () => {
    const resolved = resolveCallRouting({
      attributes: {
        "sip.phoneNumber": "+491701234567",
      },
      metadata: undefined,
    });

    expect(resolved.callerPhoneNumber).toBe("+491701234567");
    expect(resolved.dialedPracticePhoneNumber).toBeUndefined();
  });
});
