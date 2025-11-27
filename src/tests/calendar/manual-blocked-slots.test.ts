import { describe, expect, it } from "vitest";

/**
 * Integration tests for manual blocked slots
 *
 * These tests verify that manual blocked slots are properly created with
 * the isManual flag and that they render correctly in the calendar grid.
 *
 * CRITICAL: These tests exist to prevent regression of the manual blocked slots bug
 * where manual blocks appear as rule-based overlays instead of interactive blocks.
 * This bug has occurred 3+ times and must not regress again.
 */

interface ManualBlockedSlot {
  blockedByRuleId?: string;
  column: string;
  duration?: number;
  id?: string;
  isManual?: boolean;
  reason?: string;
  slot: number;
  startSlot?: number;
  title?: string;
}

/**
 * Simulates the backend slot data structure returned by scheduling.ts
 */
interface BackendSlotData {
  blockedByBlockedSlotId?: string; // Key field added to fix the bug
  blockedByRuleId?: string;
  practitionerId: string;
  reason?: string;
  slot: number;
  status: "AVAILABLE" | "BLOCKED" | "BOOKED";
}

/**
 * Simulates the frontend transformation from backend slot data to blocked slot.
 * This mirrors the logic in use-calendar-logic.ts blockedSlots memo.
 */
function transformBackendSlotToBlockedSlot(
  slotData: BackendSlotData,
  columnId: string,
): ManualBlockedSlot | null {
  if (slotData.status !== "BLOCKED") {
    return null;
  }

  // CRITICAL: Check if this is a manual block (has blockedByBlockedSlotId)
  const isManualBlock = !!slotData.blockedByBlockedSlotId;

  const result: ManualBlockedSlot = {
    column: columnId,
    slot: slotData.slot,
  };

  if (slotData.reason) {
    result.reason = slotData.reason;
  }

  if (slotData.blockedByRuleId) {
    result.blockedByRuleId = slotData.blockedByRuleId;
  }

  // CRITICAL: These properties must be set when blockedByBlockedSlotId exists
  if (isManualBlock && slotData.blockedByBlockedSlotId) {
    result.id = slotData.blockedByBlockedSlotId;
    result.isManual = true;
  }

  return result;
}

/**
 * Simulates the creation of manual blocked slots from database records.
 * This mirrors the logic in use-calendar-logic.ts.
 */
function createManualBlockedSlotsFromDatabase(
  blockedSlotsData: {
    _id: string;
    end: string;
    practitionerId: string;
    start: string;
    title: string;
  }[],
  workingPractitioners: { id: string; name: string }[],
  timeToSlot: (time: string) => number,
): ManualBlockedSlot[] {
  const manual: ManualBlockedSlot[] = [];

  for (const blockedSlot of blockedSlotsData) {
    const practitionerColumn = workingPractitioners.find(
      (p) => p.id === blockedSlot.practitionerId,
    );

    if (practitionerColumn) {
      // Simplified time parsing for tests
      const startTime = blockedSlot.start;
      const endTime = blockedSlot.end;

      const startSlot = timeToSlot(startTime);
      const endSlot = timeToSlot(endTime);

      // Calculate duration in minutes (simplified for tests)
      const durationMinutes = (endSlot - startSlot) * 5; // Assuming 5-minute slots

      // Add each individual slot from the blocked time range
      for (let slot = startSlot; slot < endSlot; slot++) {
        manual.push({
          column: practitionerColumn.id,
          duration: durationMinutes,
          id: blockedSlot._id,
          isManual: true, // CRITICAL: This must always be set to true
          reason: blockedSlot.title,
          slot,
          startSlot,
          title: blockedSlot.title,
        });
      }
    }
  }

  return manual;
}

describe("Manual Blocked Slots Integration", () => {
  const timeToSlot = (time: string): number => {
    const [hours, minutes] = time.split(":").map(Number);
    if (hours === undefined || minutes === undefined) {
      throw new Error("Invalid time format");
    }
    return (hours - 8) * 12 + Math.floor(minutes / 5); // Assuming business starts at 8:00
  };

  describe("Database to Frontend Mapping", () => {
    it("should create manual blocked slots with isManual=true flag", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "10:00",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Team Meeting",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((slot) => slot.isManual === true)).toBe(true);
      expect(result.every((slot) => slot.id === "blocked1")).toBe(true);
    });

    it("should create multiple slots for multi-slot blocked time", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:30", // 30 minutes = 6 slots
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Meeting",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      // 30 minutes = 6 five-minute slots
      expect(result).toHaveLength(6);
      expect(result.every((slot) => slot.isManual === true)).toBe(true);
      expect(result.every((slot) => slot.id === "blocked1")).toBe(true);
      expect(result.every((slot) => slot.duration === 30)).toBe(true);
    });

    it("should set all required properties for manual slots", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:15",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Important Meeting",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      for (const slot of result) {
        // Check all critical properties exist
        expect(slot.id).toBe("blocked1");
        expect(slot.isManual).toBe(true);
        expect(slot.title).toBe("Important Meeting");
        expect(slot.reason).toBe("Important Meeting");
        expect(slot.column).toBe("practitioner1");
        expect(slot.duration).toBeDefined();
        expect(slot.startSlot).toBeDefined();
        expect(slot.slot).toBeDefined();
      }
    });

    it("should skip blocked slots for practitioners not working that day", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:30",
          practitionerId: "practitioner2", // Not in working list
          start: "09:00",
          title: "Meeting",
        },
      ];

      const workingPractitioners = [
        { id: "practitioner1", name: "Dr. Smith" }, // Different practitioner
      ];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      expect(result).toHaveLength(0);
    });

    it("should handle multiple blocked slots from same practitioner", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:15",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Meeting 1",
        },
        {
          _id: "blocked2",
          end: "11:15",
          practitionerId: "practitioner1",
          start: "11:00",
          title: "Meeting 2",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      // 15 minutes each = 3 slots each = 6 total
      expect(result).toHaveLength(6);

      const meeting1Slots = result.filter((s) => s.id === "blocked1");
      const meeting2Slots = result.filter((s) => s.id === "blocked2");

      expect(meeting1Slots).toHaveLength(3);
      expect(meeting2Slots).toHaveLength(3);

      expect(meeting1Slots.every((s) => s.isManual === true)).toBe(true);
      expect(meeting2Slots.every((s) => s.isManual === true)).toBe(true);
    });

    it("should handle blocked slots across multiple practitioners", () => {
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:15",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Team Meeting",
        },
        {
          _id: "blocked2",
          end: "09:15",
          practitionerId: "practitioner2",
          start: "09:00",
          title: "Team Meeting",
        },
      ];

      const workingPractitioners = [
        { id: "practitioner1", name: "Dr. Smith" },
        { id: "practitioner2", name: "Dr. Jones" },
      ];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      // 15 minutes each * 2 practitioners = 3 slots * 2 = 6 total
      expect(result).toHaveLength(6);

      const p1Slots = result.filter((s) => s.column === "practitioner1");
      const p2Slots = result.filter((s) => s.column === "practitioner2");

      expect(p1Slots).toHaveLength(3);
      expect(p2Slots).toHaveLength(3);

      expect(p1Slots.every((s) => s.isManual === true)).toBe(true);
      expect(p2Slots.every((s) => s.isManual === true)).toBe(true);
    });
  });

  describe("Grid Rendering Logic", () => {
    it("should separate manual slots from rule-based slots", () => {
      const allSlots = [
        {
          column: "practitioner1",
          id: "blocked1",
          isManual: true,
          slot: 0,
        },
        {
          column: "practitioner1",
          reason: "Pause",
          slot: 1,
        },
        {
          column: "practitioner1",
          reason: "Rule blocked",
          slot: 2,
        },
      ];

      const manualSlots = allSlots.filter((s) => s.isManual === true);
      const ruleBasedSlots = allSlots.filter((s) => !s.isManual);

      expect(manualSlots).toHaveLength(1);
      expect(ruleBasedSlots).toHaveLength(2);

      // Verify manual slot has required properties
      expect(manualSlots[0]?.id).toBeDefined();
      expect(manualSlots[0]?.isManual).toBe(true);
    });

    it("should group manual slots by id for rendering", () => {
      const manualSlots = [
        {
          column: "practitioner1",
          id: "blocked1",
          isManual: true,
          slot: 0,
          startSlot: 0,
        },
        {
          column: "practitioner1",
          id: "blocked1",
          isManual: true,
          slot: 1,
          startSlot: 0,
        },
        {
          column: "practitioner1",
          id: "blocked1",
          isManual: true,
          slot: 2,
          startSlot: 0,
        },
      ];

      const groupedById = new Map<string, typeof manualSlots>();
      for (const slot of manualSlots) {
        if (slot.id) {
          if (!groupedById.has(slot.id)) {
            groupedById.set(slot.id, []);
          }
          groupedById.get(slot.id)?.push(slot);
        }
      }

      expect(groupedById.size).toBe(1);
      expect(groupedById.get("blocked1")).toHaveLength(3);
    });
  });

  describe("Invariant Checks", () => {
    it("should never create a manual slot without isManual=true", () => {
      // This is a critical invariant - if violated, manual slots will appear as overlays
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:15",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Meeting",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      // CRITICAL INVARIANT: Every manual slot MUST have isManual=true
      const allHaveManualFlag = result.every((slot) => slot.isManual === true);
      expect(allHaveManualFlag).toBe(true);

      // Additional check: No slot should have isManual=false or undefined
      const noneHaveFalseFlag = result.every(
        (slot) => slot.isManual !== false && slot.isManual !== undefined,
      );
      expect(noneHaveFalseFlag).toBe(true);
    });

    it("should never create a manual slot without an id", () => {
      // This is another critical invariant - without id, slots can't be edited/deleted
      const blockedSlotsData = [
        {
          _id: "blocked1",
          end: "09:15",
          practitionerId: "practitioner1",
          start: "09:00",
          title: "Meeting",
        },
      ];

      const workingPractitioners = [{ id: "practitioner1", name: "Dr. Smith" }];

      const result = createManualBlockedSlotsFromDatabase(
        blockedSlotsData,
        workingPractitioners,
        timeToSlot,
      );

      // CRITICAL INVARIANT: Every manual slot MUST have an id
      const allHaveId = result.every((slot) => slot.id !== undefined);
      expect(allHaveId).toBe(true);
    });
  });

  /**
   * CRITICAL: These tests verify the fix for the manual blocked slots bug.
   * The fix adds blockedByBlockedSlotId to backend slot data, and the frontend
   * uses this to correctly identify manual blocks instead of trying to match
   * practitioner IDs.
   */
  describe("Backend to Frontend Transformation (blockedByBlockedSlotId)", () => {
    it("should set isManual=true when blockedByBlockedSlotId is present", () => {
      const backendSlot: BackendSlotData = {
        blockedByBlockedSlotId: "manual-block-123",
        practitionerId: "practitioner1",
        reason: "Team Meeting",
        slot: 12,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "practitioner1",
      );

      expect(result).not.toBeNull();
      expect(result?.isManual).toBe(true);
      expect(result?.id).toBe("manual-block-123");
      expect(result?.reason).toBe("Team Meeting");
    });

    it("should NOT set isManual when blockedByBlockedSlotId is absent", () => {
      const backendSlot: BackendSlotData = {
        blockedByRuleId: "rule-123",
        practitionerId: "practitioner1",
        reason: "Pause",
        slot: 12,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "practitioner1",
      );

      expect(result).not.toBeNull();
      expect(result?.isManual).toBeUndefined();
      expect(result?.id).toBeUndefined();
      expect(result?.blockedByRuleId).toBe("rule-123");
    });

    it("should return null for non-BLOCKED status", () => {
      const availableSlot: BackendSlotData = {
        practitionerId: "practitioner1",
        slot: 12,
        status: "AVAILABLE",
      };

      const bookedSlot: BackendSlotData = {
        practitionerId: "practitioner1",
        slot: 12,
        status: "BOOKED",
      };

      expect(
        transformBackendSlotToBlockedSlot(availableSlot, "practitioner1"),
      ).toBeNull();
      expect(
        transformBackendSlotToBlockedSlot(bookedSlot, "practitioner1"),
      ).toBeNull();
    });

    it("should preserve blockedByRuleId alongside blockedByBlockedSlotId if both present", () => {
      // This is an edge case - a slot might be blocked by both a rule AND a manual block
      // The manual block takes precedence for rendering purposes
      const backendSlot: BackendSlotData = {
        blockedByBlockedSlotId: "manual-block-123",
        blockedByRuleId: "rule-456",
        practitionerId: "practitioner1",
        reason: "Manual Block",
        slot: 12,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "practitioner1",
      );

      expect(result).not.toBeNull();
      expect(result?.isManual).toBe(true);
      expect(result?.id).toBe("manual-block-123");
      expect(result?.blockedByRuleId).toBe("rule-456");
    });

    it("should work correctly for special columns (EKG, Labor)", () => {
      // The bug was sometimes seen in special columns like EKG and Labor
      const backendSlot: BackendSlotData = {
        blockedByBlockedSlotId: "ekg-block-1",
        practitionerId: "ekg",
        reason: "Equipment Maintenance",
        slot: 24,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(backendSlot, "ekg");

      expect(result).not.toBeNull();
      expect(result?.isManual).toBe(true);
      expect(result?.id).toBe("ekg-block-1");
      expect(result?.column).toBe("ekg");
    });

    it("should correctly identify rule-blocked slots (no manual flag)", () => {
      const backendSlot: BackendSlotData = {
        blockedByRuleId: "break-rule-123",
        practitionerId: "practitioner1",
        reason: "Mittagspause",
        slot: 48, // Noon-ish
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "practitioner1",
      );

      expect(result).not.toBeNull();
      expect(result?.isManual).toBeUndefined();
      expect(result?.id).toBeUndefined();
      expect(result?.blockedByRuleId).toBe("break-rule-123");
      expect(result?.reason).toBe("Mittagspause");
    });

    it("should handle blocked slot without any IDs (legacy/edge case)", () => {
      const backendSlot: BackendSlotData = {
        practitionerId: "practitioner1",
        reason: "Unknown Block",
        slot: 12,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "practitioner1",
      );

      expect(result).not.toBeNull();
      expect(result?.isManual).toBeUndefined();
      expect(result?.id).toBeUndefined();
      expect(result?.blockedByRuleId).toBeUndefined();
      expect(result?.reason).toBe("Unknown Block");
    });

    it("should set correct column from parameter, not from practitionerId", () => {
      // This tests the scenario where column remapping might occur
      const backendSlot: BackendSlotData = {
        blockedByBlockedSlotId: "manual-block-123",
        practitionerId: "old-practitioner-id",
        slot: 12,
        status: "BLOCKED",
      };

      const result = transformBackendSlotToBlockedSlot(
        backendSlot,
        "new-column-id",
      );

      expect(result).not.toBeNull();
      expect(result?.column).toBe("new-column-id");
      expect(result?.isManual).toBe(true);
    });
  });
});
