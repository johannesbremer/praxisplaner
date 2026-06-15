import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarPlanningCommandExecutorContext } from "../../components/calendar/calendar-planning-replay";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  toTableId,
} from "../../../convex/identity";
import { createCalendarPlacement } from "../../../lib/calendar-occupancy";
import { executeCalendarPlanningCommand } from "../../components/calendar/calendar-planning-replay";
import { buildCalendarAppointmentRecord } from "./test-records";

describe("calendar planning replay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remembers appointment update redo with a fresh local timestamp", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234);

    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const beforePlacement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        calendarResourceColumn: "ekg",
        kind: "resource",
      },
    });
    const beforeStart = "2026-04-25T09:00:00+02:00[Europe/Berlin]" as const;
    const beforeEnd = "2026-04-25T09:30:00+02:00[Europe/Berlin]" as const;
    const afterStart = "2026-04-25T09:30:00+02:00[Europe/Berlin]" as const;
    const afterEnd = "2026-04-25T10:00:00+02:00[Europe/Berlin]" as const;
    const before = buildCalendarAppointmentRecord({
      _id: appointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      end: beforeEnd,
      placement: beforePlacement,
      practiceId,
      start: beforeStart,
      title: "Check-up",
    });
    const afterState = {
      end: afterEnd,
      placement: beforePlacement,
      start: afterStart,
    };
    const afterSnapshot = {
      ...before,
      ...afterState,
    };
    const rememberAppointmentHistoryDoc =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberAppointmentHistoryDoc"]
      >();

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointment.update",
        label: "Termin aktualisiert",
        payload: {
          afterSnapshot,
          afterState,
          appointmentId,
          before,
          beforeState: {
            end: before.end,
            placement: before.placement,
            start: before.start,
          },
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: () => before,
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: () => false,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map([
            [appointmentTypeLineageKey, appointmentTypeId],
          ]),
          appointmentTypeLineageKeyById: new Map([
            [appointmentTypeId, appointmentTypeLineageKey],
          ]),
          locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
          locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc,
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedAppointmentFromStrings: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        resolveAppointmentReferenceDisplayIds: () => ({
          appointmentTypeId,
          locationId,
          occupancyScope: {
            calendarResourceColumn: "ekg",
            kind: "resource",
          },
        }),
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(() => Promise.resolve(null)),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(rememberAppointmentHistoryDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        lastModified: 1_234n,
        start: afterState.start,
      }),
    );
  });

  it("treats already-applied appointment update redo as applied", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const placement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        calendarResourceColumn: "ekg",
        kind: "resource",
      },
    });
    const before = buildCalendarAppointmentRecord({
      _id: appointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      placement,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const afterState = {
      end: "2026-04-25T10:00:00+02:00[Europe/Berlin]" as const,
      placement,
      start: "2026-04-25T09:30:00+02:00[Europe/Berlin]" as const,
    };
    const afterSnapshot = {
      ...before,
      ...afterState,
    };
    const runUpdateAppointmentInternal = vi.fn(() => Promise.resolve(null));

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointment.update",
        label: "Termin aktualisiert",
        payload: {
          afterSnapshot,
          afterState,
          appointmentId,
          before,
          beforeState: {
            end: before.end,
            placement,
            start: before.start,
          },
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: () => afterSnapshot,
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: () => false,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map([
            [appointmentTypeLineageKey, appointmentTypeId],
          ]),
          appointmentTypeLineageKeyById: new Map([
            [appointmentTypeId, appointmentTypeLineageKey],
          ]),
          locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
          locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedAppointmentFromStrings: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runUpdateAppointmentInternal,
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(runUpdateAppointmentInternal).not.toHaveBeenCalled();
  });
});
