import { describe, expect, test } from "vitest";

import {
  consumeAuthReturnToPath,
  consumeAuthReturnToState,
  setAuthReturnToPath,
  setAuthReturnToState,
} from "../auth/auth-return-to";

describe("auth return target", () => {
  test("consumes a route restored from the current WorkOS callback state", () => {
    const saved = setAuthReturnToPath(
      "/demo/praxisplaner/kalender?tag=heute#slot",
    );
    expect(saved.isOk()).toBe(true);

    const consumed = consumeAuthReturnToPath();
    expect(consumed.isOk()).toBe(true);
    const consumedValue = consumed.isOk() ? consumed.value : null;
    expect(consumedValue).toBe("/demo/praxisplaner/kalender?tag=heute#slot");

    const consumedAgain = consumeAuthReturnToPath();
    expect(consumedAgain.isErr()).toBe(true);
    const consumedAgainMessage = consumedAgain.isErr()
      ? consumedAgain.error.message
      : null;
    expect(consumedAgainMessage).toBe("Missing WorkOS auth return target.");
  });

  test("rejects missing, callback, and cross-origin-shaped paths", () => {
    const missing = consumeAuthReturnToPath();
    expect(missing.isErr()).toBe(true);
    const missingMessage = missing.isErr() ? missing.error.message : null;
    expect(missingMessage).toBe("Missing WorkOS auth return target.");

    const callback = setAuthReturnToPath("/callback");
    expect(callback.isErr()).toBe(true);
    const callbackMessage = callback.isErr() ? callback.error.message : null;
    expect(callbackMessage).toBe(
      "Invalid WorkOS auth return target: /callback",
    );

    const crossOrigin = setAuthReturnToPath("//attacker.example/path");
    expect(crossOrigin.isErr()).toBe(true);
    const crossOriginMessage = crossOrigin.isErr()
      ? crossOrigin.error.message
      : null;
    expect(crossOriginMessage).toBe(
      "Invalid WorkOS auth return target: //attacker.example/path",
    );
  });

  test("consumes practice slug from booking return state", () => {
    const saved = setAuthReturnToState({
      practiceSlug: "demo-praxis",
      returnTo: "/demo-praxis",
    });
    expect(saved.isOk()).toBe(true);

    const consumed = consumeAuthReturnToState();
    expect(consumed.isOk()).toBe(true);
    const consumedValue = consumed.isOk() ? consumed.value : null;
    expect(consumedValue).toEqual({
      practiceSlug: "demo-praxis",
      returnTo: "/demo-praxis",
    });
  });
});
