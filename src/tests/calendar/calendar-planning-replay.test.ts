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
        rememberRecreatedAppointmentId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: () => ({
          appointmentTypeId,
          locationId,
          occupancyScope: {
            calendarResourceColumn: "ekg",
            kind: "resource",
          },
        }),
        resolveCurrentAppointmentId: (id) => id,
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
        rememberRecreatedAppointmentId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
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

  it("replays an update against the recreated appointment id after creation redo", async () => {
    const originalAppointmentId = toTableId<"appointments">("appointment_old");
    const recreatedAppointmentId = toTableId<"appointments">("appointment_new");
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
      _id: originalAppointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      placement,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const recreatedBefore = {
      ...before,
      _id: recreatedAppointmentId,
    };
    const afterState = {
      end: "2026-04-25T10:00:00+02:00[Europe/Berlin]" as const,
      placement,
      start: "2026-04-25T09:30:00+02:00[Europe/Berlin]" as const,
    };
    const idMap = new Map([[originalAppointmentId, originalAppointmentId]]);
    const rememberRecreatedAppointmentId = vi.fn<
      CalendarPlanningCommandExecutorContext["rememberRecreatedAppointmentId"]
    >(({ currentId, originalId }) => {
      idMap.set(originalId, currentId);
    });
    const runUpdateAppointmentInternal = vi.fn(() => Promise.resolve(null));
    const createCommand = {
      kind: "appointment.create" as const,
      label: "Termin erstellt",
      payload: {
        appointmentTypeLineageKey,
        appointmentTypeTitle: "Check-up",
        createArgs: {
          appointmentTypeId,
          isSimulation: false,
          locationId,
          practiceId,
          start: before.start,
          title: before.title,
        },
        createEnd: before.end,
        currentAppointmentId: originalAppointmentId,
        placement,
      },
    };
    const updateCommand = {
      kind: "appointment.update" as const,
      label: "Termin aktualisiert",
      payload: {
        afterSnapshot: {
          ...before,
          ...afterState,
        },
        afterState,
        appointmentId: originalAppointmentId,
        before,
        beforeState: {
          end: before.end,
          placement,
          start: before.start,
        },
      },
    };

    const context = {
      ensureLatestConflictData: vi.fn(() => Promise.resolve()),
      forgetAppointmentHistoryDoc: vi.fn(),
      forgetBlockedSlotHistoryDoc: vi.fn(),
      getCurrentAppointmentDoc: (id) =>
        id === recreatedAppointmentId ? recreatedBefore : undefined,
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
      rememberCreatedAppointmentFromStrings: vi.fn(() => true),
      rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
      rememberRecreatedAppointmentId,
      resolveAppointmentReferenceDisplayIds: () => ({
        appointmentTypeId,
        locationId,
        occupancyScope: {
          calendarResourceColumn: "ekg" as const,
          kind: "resource" as const,
        },
      }),
      resolveCurrentAppointmentId: (id) => idMap.get(id) ?? id,
      runCreateAppointmentInternal: vi.fn(() =>
        Promise.resolve(recreatedAppointmentId),
      ),
      runCreateBlockedSlotInternal: vi.fn(),
      runDeleteAppointmentInternal: vi.fn(),
      runDeleteBlockedSlotInternal: vi.fn(),
      runUpdateAppointmentInternal,
      runUpdateBlockedSlotInternal: vi.fn(),
    } satisfies CalendarPlanningCommandExecutorContext;

    await expect(
      executeCalendarPlanningCommand(createCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });
    await expect(
      executeCalendarPlanningCommand(updateCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });

    expect(rememberRecreatedAppointmentId).toHaveBeenCalledWith({
      currentId: recreatedAppointmentId,
      originalId: originalAppointmentId,
    });
    expect(runUpdateAppointmentInternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: recreatedAppointmentId }),
    );
  });
});
