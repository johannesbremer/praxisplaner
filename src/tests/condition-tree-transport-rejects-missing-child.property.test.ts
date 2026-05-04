import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertAsyncProperty } from "./property-test-utils";

describe("condition tree transport missing child rejection property", () => {
  test("parseConditionTreeTransport rejects missing child IDs", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.string({ maxLength: 12, minLength: 1 }),
        fc.string({ maxLength: 12, minLength: 1 }),
        async (rootId, missingChildId) => {
          fc.pre(rootId !== missingChildId);
          await Promise.resolve();

          expect(() =>
            parseConditionTreeTransport({
              nodes: [
                {
                  childNodeIds: [missingChildId],
                  nodeId: rootId,
                  nodeType: "AND",
                },
              ],
              rootNodeId: rootId,
            }),
          ).toThrow(TypeError);
        },
      ),
      "condition tree rejects missing child ids",
    );
  });
});
