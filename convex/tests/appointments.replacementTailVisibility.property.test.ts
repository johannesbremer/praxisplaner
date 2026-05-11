import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import {
  createPropertySchedulingFixture,
  createPropertyTestContext,
  zonedWindow,
} from "../../src/tests/convex-property-fixtures";
import { assertAsyncProperty } from "../../src/tests/property-test-utils";
import { api } from "../_generated/api";

const replacementChainShapeArbitrary = fc.record({
  links: fc.array(
    fc.record({
      dayShift: fc.constantFrom(0, 1),
      slot: fc.integer({ max: 47, min: 0 }),
    }),
    { maxLength: 4, minLength: 0 },
  ),
  rootCancelled: fc.boolean(),
  rootSlot: fc.integer({ max: 47, min: 0 }),
});

interface ReplacementChainNode {
  dayOffset: number;
  slot: number;
}

describe("appointment replacement tail visibility properties", () => {
  test("same-day replacement chains expose only the current tail unless the root is cancelled", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        replacementChainShapeArbitrary,
        async ({ links, rootCancelled, rootSlot }) => {
          const t = createPropertyTestContext();
          const fixture = await createPropertySchedulingFixture(t);
          const chainNodes = buildReplacementChainNodes(rootSlot, links);
          const ids = await t.run(async (ctx) => {
            const now = BigInt(Date.now());
            const insertedIds: Id<"appointments">[] = [];
            for (const [index, node] of chainNodes.entries()) {
              const window = slotWindowForNode(fixture.date, node);
              const id = await ctx.db.insert("appointments", {
                appointmentTypeLineageKey: fixture.appointmentTypeId,
                appointmentTypeTitle: "Property Checkup",
                ...(rootCancelled && index === 0 ? { cancelledAt: now } : {}),
                createdAt: now,
                end: window.end,
                lastModified: now,
                locationLineageKey: fixture.locationId,
                practiceId: fixture.practiceId,
                practitionerLineageKey: fixture.practitionerId,
                ...(index === 0
                  ? {}
                  : { replacesAppointmentId: insertedIds[index - 1] }),
                start: window.start,
                title: `Chain ${index}`,
                userId: fixture.userId,
              });
              insertedIds.push(id);
            }
            return insertedIds;
          });

          const expectedVisibleIndices = getExpectedVisibleIndices(
            chainNodes,
            rootCancelled,
          );
          const expectedVisibleEntries = expectedVisibleIndices
            .map((index) => {
              const id = ids[index];
              const node = chainNodes[index];
              if (!id || !node) {
                return null;
              }
              return { id, node };
            })
            .filter((entry) => entry !== null)
            .toSorted(compareVisibleEntries);
          const expectedVisibleIds = expectedVisibleEntries.map(
            (entry) => entry.id,
          );
          const visibleIdsByDayOffset = new Map<number, Id<"appointments">[]>();
          for (const entry of expectedVisibleEntries) {
            const idsForDay =
              visibleIdsByDayOffset.get(entry.node.dayOffset) ?? [];
            idsForDay.push(entry.id);
            visibleIdsByDayOffset.set(entry.node.dayOffset, idsForDay);
          }

          const dayOffsets = new Set(chainNodes.map((node) => node.dayOffset));
          for (const dayOffset of dayOffsets) {
            const dayStart = Temporal.PlainDate.from(fixture.date)
              .add({ days: dayOffset })
              .toZonedDateTime({
                plainTime: { hour: 0, minute: 0 },
                timeZone: "Europe/Berlin",
              });
            const dayAppointments = await t.query(
              api.appointments.getCalendarDayAppointments,
              {
                activeRuleSetId: fixture.ruleSetId,
                dayEnd: dayStart.add({ days: 1 }).toString(),
                dayStart: dayStart.toString(),
                practiceId: fixture.practiceId,
                scope: "real",
                selectedRuleSetId: fixture.ruleSetId,
              },
            );
            expect(
              dayAppointments.map((appointment) => appointment._id),
            ).toEqual(visibleIdsByDayOffset.get(dayOffset) ?? []);
          }

          const appointments = await t.query(api.appointments.getAppointments, {
            activeRuleSetId: fixture.ruleSetId,
            scope: "real",
            selectedRuleSetId: fixture.ruleSetId,
          });
          const maxDayOffset = Math.max(
            ...chainNodes.map((node) => node.dayOffset),
          );
          const rangeStart = Temporal.PlainDate.from(fixture.date)
            .toZonedDateTime({
              plainTime: { hour: 0, minute: 0 },
              timeZone: "Europe/Berlin",
            })
            .toString();
          const appointmentsInRange = await t.query(
            api.appointments.getAppointmentsInRange,
            {
              activeRuleSetId: fixture.ruleSetId,
              end: Temporal.ZonedDateTime.from(rangeStart)
                .add({ days: maxDayOffset + 1 })
                .toString(),
              scope: "real",
              selectedRuleSetId: fixture.ruleSetId,
              start: rangeStart,
            },
          );

          expect(appointments.map((appointment) => appointment._id)).toEqual(
            expectedVisibleIds,
          );
          expect(
            appointmentsInRange.map((appointment) => appointment._id),
          ).toEqual(expectedVisibleIds);
        },
      ),
      "appointment replacement chain current tail visibility",
    );
  });
});

function buildReplacementChainNodes(
  rootSlot: number,
  links: readonly { dayShift: number; slot: number }[],
): ReplacementChainNode[] {
  const nodes: ReplacementChainNode[] = [{ dayOffset: 0, slot: rootSlot }];
  for (const link of links) {
    const previousNode = nodes.at(-1);
    if (!previousNode) {
      break;
    }
    nodes.push({
      dayOffset: previousNode.dayOffset + link.dayShift,
      slot: link.slot,
    });
  }
  return nodes;
}

function compareVisibleEntries(
  left: { id: Id<"appointments">; node: ReplacementChainNode },
  right: { id: Id<"appointments">; node: ReplacementChainNode },
) {
  if (left.node.dayOffset !== right.node.dayOffset) {
    return left.node.dayOffset - right.node.dayOffset;
  }
  if (left.node.slot !== right.node.slot) {
    return left.node.slot - right.node.slot;
  }
  return left.id.localeCompare(right.id);
}

function getExpectedVisibleIndices(
  nodes: ReplacementChainNode[],
  rootCancelled: boolean,
): number[] {
  const visibleIndices: number[] = [];
  let segmentStart = 0;

  while (segmentStart < nodes.length) {
    let segmentEnd = segmentStart;
    while (
      segmentEnd + 1 < nodes.length &&
      nodes[segmentEnd + 1]?.dayOffset === nodes[segmentEnd]?.dayOffset
    ) {
      segmentEnd += 1;
    }

    const segmentRootCancelled = segmentStart === 0 && rootCancelled;
    if (!segmentRootCancelled) {
      visibleIndices.push(segmentEnd);
    }

    segmentStart = segmentEnd + 1;
  }

  return visibleIndices;
}

function slotWindowForNode(
  baseDate: string,
  node: ReplacementChainNode,
): { end: string; start: string } {
  const date = Temporal.PlainDate.from(baseDate).add({ days: node.dayOffset });
  return zonedWindow(date, {
    hour: 8 + Math.floor(node.slot / 12),
    minute: (node.slot % 12) * 5,
  });
}
