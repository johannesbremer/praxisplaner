import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { resolveReplayEntity } from "../utils/cow-history";
import { assertAsyncProperty } from "./property-test-utils";

describe("copy-on-write replay entity resolution property", () => {
  test("resolveReplayEntity falls back from copied row id to stable lineage key", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ maxLength: 12, minLength: 1 }), {
          maxLength: 8,
          minLength: 1,
        }),
        fc.integer({ max: 7, min: 0 }),
        async (lineageSuffixes, rawIndex) => {
          await Promise.resolve();
          const targetIndex = rawIndex % lineageSuffixes.length;
          const targetLineageKey = `lineage-${lineageSuffixes[targetIndex]}`;
          const copiedEntityId = `copy-${targetIndex}`;
          const staleSourceRowId = "stale-source-row";
          const entities = lineageSuffixes.map((suffix, index) => ({
            _id: `copy-${index}`,
            lineageKey: `lineage-${suffix}`,
          }));

          expect(
            resolveReplayEntity<
              string,
              string,
              { _id: string; lineageKey: string }
            >({
              currentEntityId: staleSourceRowId,
              entities,
              lineageKey: targetLineageKey,
              missingMessage: "missing",
            }),
          ).toEqual({
            currentEntityId: copiedEntityId,
            entity: {
              _id: copiedEntityId,
              lineageKey: targetLineageKey,
            },
            status: "ok",
          });
        },
      ),
      "cow history resolves replay entity by lineage",
    );
  });
});
