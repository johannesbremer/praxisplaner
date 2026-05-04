import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { serializeConditionTreeTransport } from "../../lib/condition-tree";
import {
  collectReachableNodeIds,
  conditionTreeArbitrary,
} from "./condition-tree-property-utils";
import { assertAsyncProperty } from "./property-test-utils";

describe("condition tree reachable ids property", () => {
  test("serialized transports have unique reachable node ids", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(conditionTreeArbitrary(4), async (tree) => {
        await Promise.resolve();
        const transport = serializeConditionTreeTransport(tree);
        const nodeIds = transport.nodes.map((node) => node.nodeId);
        const uniqueNodeIds = new Set(nodeIds);
        const nodesById = new Map(
          transport.nodes.map((node) => [node.nodeId, node]),
        );

        expect(uniqueNodeIds.size).toBe(nodeIds.length);
        expect(
          collectReachableNodeIds(transport.rootNodeId, nodesById).size,
        ).toBe(transport.nodes.length);
      }),
      "condition tree reachable ids",
    );
  });
});
