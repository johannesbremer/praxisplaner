import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";

import { mapFrontendLineageEntities } from "../utils/frontend-lineage";

describe("frontend lineage mapping", () => {
  type MutableGlobals = typeof globalThis & {
    posthog?: { captureException: ReturnType<typeof vi.fn> };
  };

  const mutableGlobalThis = globalThis as MutableGlobals;
  const originalPosthog = mutableGlobalThis.posthog;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_ENABLE_POSTHOG_IN_DEV", "true");
    mutableGlobalThis.posthog = {
      captureException: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    if (originalPosthog) {
      mutableGlobalThis.posthog = originalPosthog;
    } else {
      Reflect.deleteProperty(globalThis as Record<string, unknown>, "posthog");
    }
  });

  test("returns an Err instead of silently dropping invalid lineage entities", () => {
    const result = mapFrontendLineageEntities({
      entities: [{ _id: "mfa_1" as Id<"mfas">, name: "Alice" }],
      entityType: "mfa",
      source: "frontend-lineage.test",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "invalid_state",
      message: expect.stringContaining("hat keinen lineageKey"),
      source: "frontend-lineage.test",
    });

    expect(
      mutableGlobalThis.posthog?.captureException,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining("hat keinen lineageKey"),
        name: "FrontendError:invalid_state",
      }),
      expect.objectContaining({
        context: "map_frontend_lineage_entities",
        entityId: "mfa_1",
        entityType: "mfa",
        source: "frontend-lineage.test",
      }),
    );
  });

  test("requires callers to pick an explicit fallback when invalid lineage data is encountered", () => {
    const result = mapFrontendLineageEntities({
      entities: [{ _id: "mfa_2" as Id<"mfas">, name: "Bob" }],
      entityType: "mfa",
      source: "frontend-lineage.test",
    });

    const handled = result.match(
      (value) => value,
      () => [],
    );

    expect(handled).toEqual([]);
  });
});
