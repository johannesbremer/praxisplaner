import { describe, expect, test } from "vitest";

import {
  consumeAuthReturnToPath,
  setAuthReturnToPath,
} from "../auth/auth-return-to";

const STORAGE_KEY = "praxisplaner.auth.returnTo";

describe("auth return target", () => {
  test("consumes a route captured before sign-in", () => {
    setAuthReturnToPath("/demo/praxisplaner/kalender?tag=heute#slot");

    expect(consumeAuthReturnToPath()).toBe(
      "/demo/praxisplaner/kalender?tag=heute#slot",
    );
    expect(consumeAuthReturnToPath()).toBe("/");
  });

  test("consumes a route restored after the auth callback page load", () => {
    globalThis.localStorage.setItem(STORAGE_KEY, "/demo/regeln");

    expect(consumeAuthReturnToPath()).toBe("/demo/regeln");
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("falls back for callback and cross-origin-shaped paths", () => {
    setAuthReturnToPath("/callback");
    expect(consumeAuthReturnToPath()).toBe("/");

    globalThis.localStorage.setItem(STORAGE_KEY, "//attacker.example/path");
    expect(consumeAuthReturnToPath()).toBe("/");
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
