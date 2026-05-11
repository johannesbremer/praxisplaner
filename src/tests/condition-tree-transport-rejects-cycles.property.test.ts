import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertProperty } from "./property-test-utils";

export function runProperty() {
  assertProperty(
    fc.property(fc.string({ maxLength: 12, minLength: 1 }), (id) => {
      expect(() =>
        parseConditionTreeTransport({
          nodes: [
            {
              childNodeIds: [id],
              nodeId: id,
              nodeType: "AND",
            },
          ],
          rootNodeId: id,
        }),
      ).toThrow(TypeError);
    }),
    "condition tree rejects cycles",
  );
}

if (process.env["VITEST"]) {
  describe("condition tree transport cycle rejection property", () => {
    test("parseConditionTreeTransport rejects cycles", () => {
      expect.hasAssertions();
      runProperty();
    });
  });
}
