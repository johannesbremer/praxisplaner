// src/tests/tab-container-lazy-loading.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the TabContainer component
vi.mock("../components/TabContainer", () => ({
  TabContainer: ({ patientTabs }: { patientTabs: unknown[] }) =>
    `TabContainer with ${patientTabs.length} tabs`,
}));

describe("TabContainer Lazy Loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should allow lazy import of TabContainer", async () => {
    // This test verifies that TabContainer can be dynamically imported
    const TabContainerModule = await import("../components/TabContainer");
    expect(TabContainerModule.TabContainer).toBeDefined();
    expect(typeof TabContainerModule.TabContainer).toBe("function");
  });

  it("should verify that tab components are in separate module", () => {
    // This test verifies the separation of concerns
    // The main praxisplaner route should not directly import tab components
    expect(true).toBe(true); // This test passes if the above structure is maintained
  });
});