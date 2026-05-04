import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertAsyncProperty } from "./property-test-utils";

describe("condition tree transport cycle rejection property", () => {
  test("parseConditionTreeTransport rejects cycles", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.string({ maxLength: 12, minLength: 1 }),
        async (id) => {
          await Promise.resolve();

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
        },
      ),
      "condition tree rejects cycles",
    );
  });
});
