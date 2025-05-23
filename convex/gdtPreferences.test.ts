import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

describe("gdtPreferences functions", () => {
  test("should save, get, update, and remove directory preferences", async () => {
    const t = convexTest(schema);
    const initialDirectory = "gdt/praxis/data";
    const updatedDirectory = "gdt/praxis/updated_data";

    // 1. Get initial state (should be null)
    let preference = await t.query(api.gdtPreferences.get);
    expect(preference).toBeNull();

    // 2. Save initial preference
    await t.mutation(api.gdtPreferences.save, {
      directoryName: initialDirectory,
    });
    preference = await t.query(api.gdtPreferences.get);
    expect(preference).not.toBeNull();
    expect(preference?.directoryName).toBe(initialDirectory);

    // 3. Update preference
    await t.mutation(api.gdtPreferences.save, {
      directoryName: updatedDirectory,
    });
    preference = await t.query(api.gdtPreferences.get);
    expect(preference).not.toBeNull();
    expect(preference?.directoryName).toBe(updatedDirectory);

    // 4. Remove preference
    await t.mutation(api.gdtPreferences.remove, {});
    preference = await t.query(api.gdtPreferences.get);
    expect(preference).toBeNull();
  });

  test("remove preference when none exists should not error", async () => {
    const t = convexTest(schema);

    // Ensure no preference exists
    let preference = await t.query(api.gdtPreferences.get);
    expect(preference).toBeNull();

    // Attempt to remove
    await t.mutation(api.gdtPreferences.remove, {});

    // Check again, should still be null and no error thrown
    preference = await t.query(api.gdtPreferences.get);
    expect(preference).toBeNull();
  });

  test("save multiple times should correctly update", async () => {
    const t = convexTest(schema);
    const dir1 = "dir1";
    const dir2 = "dir2";
    const dir3 = "dir3";

    await t.mutation(api.gdtPreferences.save, { directoryName: dir1 });
    let pref = await t.query(api.gdtPreferences.get);
    expect(pref?.directoryName).toBe(dir1);

    await t.mutation(api.gdtPreferences.save, { directoryName: dir2 });
    pref = await t.query(api.gdtPreferences.get);
    expect(pref?.directoryName).toBe(dir2);

    await t.mutation(api.gdtPreferences.save, { directoryName: dir3 });
    pref = await t.query(api.gdtPreferences.get);
    expect(pref?.directoryName).toBe(dir3);
  });
});
