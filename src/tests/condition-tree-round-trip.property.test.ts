import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  parseConditionTreeTransport,
  serializeConditionTreeTransport,
} from "../../lib/condition-tree";
import { conditionTreeArbitrary } from "./condition-tree-property-utils";
import { assertProperty } from "./property-test-utils";

export function runProperty() {
  assertProperty(
    fc.property(conditionTreeArbitrary(4), (tree) => {
      const transport = serializeConditionTreeTransport(tree);
      expect(parseConditionTreeTransport(transport)).toEqual(tree);
    }),
    "condition tree round-trip",
  );
}

if (process.env["VITEST"]) {
  describe("condition tree round-trip property", () => {
    test("valid condition trees round-trip through flat transport", () => {
      expect.hasAssertions();
      runProperty();
    });
  });
}
