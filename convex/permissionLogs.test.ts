import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

describe("permissionLogs functions", () => {
  test("should log permission events and retrieve them", async () => {
    const t = convexTest(schema);

    const event1Data = {
      accessMode: "read" as const,
      context: "Initial load",
      handleName: "file://documents/file1.txt",
      operationType: "query" as const,
      resultState: "granted" as const,
    };

    const event2Data = {
      accessMode: "readwrite" as const,
      context: "User action",
      errorMessage: "User did not grant permission",
      handleName: "file://documents/file2.txt",
      operationType: "request" as const,
      resultState: "denied" as const,
    };

    const event3Data = {
      accessMode: "read" as const,
      context: "Polling",
      errorMessage: "Handle no longer valid",
      handleName: "file://downloads/archive.zip",
      operationType: "query" as const,
      resultState: "error" as const,
    };

    // Log events
    await t.mutation(api.permissionLogs.logPermissionEvent, event1Data);
    await t.mutation(api.permissionLogs.logPermissionEvent, event2Data);
    await t.mutation(api.permissionLogs.logPermissionEvent, event3Data);

    // Retrieve events
    const recentEvents = await t.query(
      api.permissionLogs.getRecentPermissionEvents,
      { limit: 5 },
    );

    // Assertions
    expect(recentEvents.length).toBe(3);

    // Events are ordered by timestamp descending (most recent first)
    // So event3 should be first, then event2, then event1.
    const firstEvent = recentEvents[0];
    expect(firstEvent).toBeDefined();
    if (firstEvent) {
      expect(firstEvent).toMatchObject(event3Data);
      expect(firstEvent.errorMessage).toBe(event3Data.errorMessage);
    }

    const secondEvent = recentEvents[1];
    expect(secondEvent).toBeDefined();
    if (secondEvent) {
      expect(secondEvent).toMatchObject(event2Data);
      expect(secondEvent.errorMessage).toBe(event2Data.errorMessage);
    }

    const thirdEvent = recentEvents[2];
    expect(thirdEvent).toBeDefined();
    if (thirdEvent) {
      expect(thirdEvent).toMatchObject(event1Data);
      expect(thirdEvent.errorMessage).toBeUndefined();
    }

    // Check presence/absence of optional errorMessage
    // Already handled above

    // Test with no limit (should use default limit)
    const defaultLimitEvents = await t.query(
      api.permissionLogs.getRecentPermissionEvents,
      {},
    );
    // Default limit is 30, but we only added 3 events
    expect(defaultLimitEvents.length).toBe(3);
  });

  test("logPermissionEvent handles optional errorMessage correctly", async () => {
    const t = convexTest(schema);
    const eventError = {
      accessMode: "readwrite" as const,
      context: "Test Error",
      errorMessage: "A specific error occurred",
      handleName: "error.handle",
      operationType: "request" as const,
      resultState: "error" as const,
    };
    const eventGranted = {
      accessMode: "read" as const,
      context: "Test Granted",
      handleName: "granted.handle",
      operationType: "query" as const,
      resultState: "granted" as const,
      // No errorMessage
    };

    await t.mutation(api.permissionLogs.logPermissionEvent, eventError);
    await t.mutation(api.permissionLogs.logPermissionEvent, eventGranted);

    const events = await t.query(api.permissionLogs.getRecentPermissionEvents, {
      limit: 2,
    });

    // events[0] is eventGranted (most recent, assuming minimal time diff or same timestamp)
    // Actually, let's rely on the order of insertion if timestamps are too close.
    // The test logic assumes events are retrieved in order of recency.
    // eventGranted was logged after eventError, so it should be more recent.
    // However, to be safe, let's identify them by a unique property like handleName.

    const grantedEvent = events.find((e) => e.handleName === "granted.handle");
    const errorEvent = events.find((e) => e.handleName === "error.handle");

    expect(grantedEvent).toBeDefined();
    if (grantedEvent) {
      expect(grantedEvent.errorMessage).toBeUndefined();
      expect(grantedEvent.resultState).toBe("granted");
    }

    expect(errorEvent).toBeDefined();
    if (errorEvent) {
      expect(errorEvent.errorMessage).toBe("A specific error occurred");
      expect(errorEvent.resultState).toBe("error");
    }
  });
});
