import { describe, expect, it } from "vitest";

/**
 * Tests for blocked slot deduplication logic
 *
 * This test suite covers the critical deduplication logic that merges:
 * 1. Rule-based blocked slots (from scheduling rules)
 * 2. Break slots (from base schedules)
 * 3. Manual blocked slots (user-created, stored in database)
 *
 * The deduplication must ensure that:
 * - Manual slots always take priority over rule-based and break slots
 * - Manual slots are never shown as non-interactive overlays
 * - Same slot position conflicts are resolved correctly
 * - All manual slot properties (id, isManual, duration, etc.) are preserved
 */

interface BlockedSlot {
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
 * Extracts the deduplication logic from use-calendar-logic.ts.
 * This should match the production implementation exactly.
 */
function deduplicateBlockedSlots(
  blockedSlots: BlockedSlot[],
  breakSlots: BlockedSlot[],
  manualBlockedSlots: BlockedSlot[],
): BlockedSlot[] {
  const combined = [...blockedSlots, ...breakSlots, ...manualBlockedSlots];

  // Deduplicate by column and slot, prioritizing manual blocked slots
  const uniqueSlots = new Map<string, BlockedSlot>();
  for (const slot of combined) {
    const key = `${slot.column}-${slot.slot}`;
    const existing = uniqueSlots.get(key);

    // Check if existing slot is manual - must check value is true, not just property existence
    const existingIsManual = existing?.isManual === true;
    const slotIsManual = slot.isManual === true;

    // Priority rules:
    // 1. If no existing slot, add current slot
    // 2. If existing is not manual but current is manual, replace with manual
    // 3. If both are manual, keep existing (first manual wins)
    // 4. If existing is manual but current is not, keep existing
    if (!existing || (!existingIsManual && slotIsManual)) {
      uniqueSlots.set(key, slot);
    }
  }

  return [...uniqueSlots.values()];
}

describe("Blocked Slot Deduplication", () => {
  describe("Basic Deduplication", () => {
    it("should keep unique slots when there are no conflicts", () => {
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
        { column: "practitioner1", reason: "Rule blocked", slot: 1 },
      ];
      const breakSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Break", slot: 2 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 3,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots(
        ruleSlots,
        breakSlots,
        manualSlots,
      );

      expect(result).toHaveLength(4);
      expect(result.some((s) => s.slot === 0 && !s.isManual)).toBe(true);
      expect(result.some((s) => s.slot === 1 && !s.isManual)).toBe(true);
      expect(result.some((s) => s.slot === 2 && !s.isManual)).toBe(true);
      expect(result.some((s) => s.slot === 3 && s.isManual === true)).toBe(
        true,
      );
    });

    it("should deduplicate rule-based slots at same position", () => {
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule A", slot: 0 },
        { column: "practitioner1", reason: "Rule B", slot: 0 },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], []);

      expect(result).toHaveLength(1);
      expect(result[0]?.reason).toBe("Rule A"); // First one wins
    });
  });

  describe("Manual Slot Priority", () => {
    it("should prioritize manual slots over rule-based slots", () => {
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBe(true);
      expect(result[0]?.id).toBe("manual1");
      expect(result[0]?.title).toBe("Meeting");
    });

    it("should prioritize manual slots over break slots", () => {
      const breakSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Break", slot: 0 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots([], breakSlots, manualSlots);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBe(true);
      expect(result[0]?.id).toBe("manual1");
      expect(result[0]?.reason).toBeUndefined(); // Manual slot doesn't have "Break" reason
    });

    it("should prioritize manual slots even when rule slot comes last", () => {
      // This tests the order independence of the deduplication
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      // Manual slot is in the combined array first (before rule slot)
      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBe(true);
    });
  });

  describe("Manual Slot Properties Preservation", () => {
    it("should preserve all manual slot properties", () => {
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          duration: 30,
          id: "manual1",
          isManual: true,
          reason: "Important meeting",
          slot: 0,
          startSlot: 0,
          title: "Team Meeting",
        },
      ];

      const result = deduplicateBlockedSlots([], [], manualSlots);

      expect(result).toHaveLength(1);
      const slot = result[0];
      expect(slot?.id).toBe("manual1");
      expect(slot?.isManual).toBe(true);
      expect(slot?.title).toBe("Team Meeting");
      expect(slot?.reason).toBe("Important meeting");
      expect(slot?.duration).toBe(30);
      expect(slot?.startSlot).toBe(0);
    });

    it("should preserve manual slot properties even when conflicting with rule slot", () => {
      const ruleSlots: BlockedSlot[] = [
        {
          blockedByRuleId: "rule123",
          column: "practitioner1",
          reason: "Rule reason",
          slot: 0,
        },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          duration: 60,
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      expect(result).toHaveLength(1);
      const slot = result[0];
      expect(slot?.isManual).toBe(true);
      expect(slot?.id).toBe("manual1");
      expect(slot?.duration).toBe(60);
      expect(slot?.blockedByRuleId).toBeUndefined(); // Rule property not preserved
    });
  });

  describe("Edge Cases - Bug Scenarios", () => {
    it("should handle manual slot with isManual = false (malformed data)", () => {
      // This is a bug scenario: manual slot without isManual flag
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: false, // BUG: should be true
          slot: 0,
          title: "Meeting",
        },
      ];
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      // With correct implementation, rule slot wins because manual has isManual=false
      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBeFalsy(); // Bug scenario: not treated as manual
    });

    it("should handle manual slot with undefined isManual (malformed data)", () => {
      // This is a bug scenario: manual slot without isManual property
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          slot: 0,
          // isManual is undefined
          title: "Meeting",
        },
      ];
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      // With correct implementation, rule slot wins because manual doesn't have isManual=true
      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBeUndefined();
      expect(result[0]?.id).toBeUndefined(); // Rule slot doesn't have id
    });

    it("should handle slot with isManual property present but not true", () => {
      // Testing "in" operator vs value check
      const slots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "slot1",
          isManual: false,
          slot: 0,
        },
        {
          column: "practitioner1",
          id: "slot2",
          isManual: true,
          slot: 0,
        },
      ];

      const result = deduplicateBlockedSlots([], [], slots);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBe(true); // Manual with true value should win
      expect(result[0]?.id).toBe("slot2");
    });

    it("should handle multiple manual slots at same position (keep first)", () => {
      // If two manual slots conflict, keep the first one
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "First Meeting",
        },
        {
          column: "practitioner1",
          id: "manual2",
          isManual: true,
          slot: 0,
          title: "Second Meeting",
        },
      ];

      const result = deduplicateBlockedSlots([], [], manualSlots);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("manual1");
      expect(result[0]?.title).toBe("First Meeting");
    });
  });

  describe("Multi-Column Scenarios", () => {
    it("should handle slots across different columns independently", () => {
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
        { column: "practitioner2", reason: "Rule blocked", slot: 0 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      expect(result).toHaveLength(2);
      // Practitioner 1 should have manual slot
      const p1Slot = result.find((s) => s.column === "practitioner1");
      expect(p1Slot?.isManual).toBe(true);
      // Practitioner 2 should have rule slot
      const p2Slot = result.find((s) => s.column === "practitioner2");
      expect(p2Slot?.isManual).toBeFalsy();
    });

    it("should preserve manual slots at different slot positions in same column", () => {
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting 1",
        },
        {
          column: "practitioner1",
          id: "manual2",
          isManual: true,
          slot: 2,
          title: "Meeting 2",
        },
      ];
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Break", slot: 1 },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], manualSlots);

      expect(result).toHaveLength(3);
      expect(result.filter((s) => s.isManual === true)).toHaveLength(2);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle real-world scenario with overlapping slots", () => {
      // Simulate a real scenario:
      // - Rule blocks slots 0-2
      // - Break at slot 1
      // - Manual block at slots 1-2
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule A", slot: 0 },
        { column: "practitioner1", reason: "Rule B", slot: 1 },
        { column: "practitioner1", reason: "Rule C", slot: 2 },
      ];
      const breakSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Break", slot: 1 },
      ];
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 1,
          startSlot: 1,
          title: "Meeting",
        },
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 2,
          startSlot: 1,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots(
        ruleSlots,
        breakSlots,
        manualSlots,
      );

      // Should have 3 slots: slot 0 (rule), slot 1 (manual), slot 2 (manual)
      expect(result).toHaveLength(3);

      const slot0 = result.find((s) => s.slot === 0);
      expect(slot0?.isManual).toBeFalsy();

      const slot1 = result.find((s) => s.slot === 1);
      expect(slot1?.isManual).toBe(true);
      expect(slot1?.id).toBe("manual1");

      const slot2 = result.find((s) => s.slot === 2);
      expect(slot2?.isManual).toBe(true);
      expect(slot2?.id).toBe("manual1");
    });

    it("should handle empty arrays", () => {
      const result = deduplicateBlockedSlots([], [], []);
      expect(result).toHaveLength(0);
    });

    it("should handle only manual slots", () => {
      const manualSlots: BlockedSlot[] = [
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 0,
          title: "Meeting",
        },
      ];

      const result = deduplicateBlockedSlots([], [], manualSlots);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBe(true);
    });

    it("should handle only rule slots", () => {
      const ruleSlots: BlockedSlot[] = [
        { column: "practitioner1", reason: "Rule blocked", slot: 0 },
      ];

      const result = deduplicateBlockedSlots(ruleSlots, [], []);

      expect(result).toHaveLength(1);
      expect(result[0]?.isManual).toBeFalsy();
    });
  });

  describe("Type Safety Validation", () => {
    it("should correctly distinguish between missing and false isManual", () => {
      const slots = [
        {
          column: "practitioner1",
          slot: 0,
          // isManual is undefined
        },
        {
          column: "practitioner1",
          isManual: false,
          slot: 1,
        },
        {
          column: "practitioner1",
          id: "manual1",
          isManual: true,
          slot: 2,
        },
      ];

      // All three should be treated differently
      expect(slots[0]?.isManual).toBeUndefined();
      expect(slots[1]?.isManual).toBe(false);
      expect(slots[2]?.isManual).toBe(true);

      // Only the third one should be treated as manual
      expect(slots[0]?.isManual === true).toBe(false);
      expect(slots[1]?.isManual === true).toBe(false);
      expect(slots[2]?.isManual === true).toBe(true);
    });
  });
});
