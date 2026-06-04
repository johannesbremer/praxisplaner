import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "practices@example.com",
    subject: "workos_practices",
  });
}

describe("Practices", () => {
  test("initializeDefaultPractice is not available to normal authenticated users", async () => {
    const t = createAuthedTestContext();

    await expect(
      t.mutation(api.practices.initializeDefaultPractice, {}),
    ).rejects.toThrow("only available in bypass mode");
  });
});
