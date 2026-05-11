import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { toTableId } from "../../convex/identity";
import {
  buildFrontendLineageIndex,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
import { assertProperty } from "./property-test-utils";

describe("frontend lineage index property", () => {
  test("lineage entities resolve by copied entity id and stable lineage key", () => {
    assertProperty(
      fc.property(
        fc.uniqueArray(fc.string({ maxLength: 12, minLength: 1 }), {
          maxLength: 16,
          minLength: 1,
        }),
        (lineageSuffixes) => {
          const entities = requireFrontendLineageEntities({
            entities: lineageSuffixes.map((suffix, index) => ({
              _id: toTableId<"locations">(`location_copy_${index}`),
              lineageKey: toTableId<"locations">(`location_lineage_${suffix}`),
              name: `Location ${index}`,
            })),
            entityType: "location",
            source: "frontend-lineage-index.property.test",
          });
          const index = buildFrontendLineageIndex(entities);

          for (const entity of entities) {
            expect(index.byEntityId.get(entity._id)).toBe(entity);
            expect(index.byLineageKey.get(entity.lineageKey)).toBe(entity);
          }
        },
      ),
      "frontend lineage index resolves copies",
    );
  });
});
