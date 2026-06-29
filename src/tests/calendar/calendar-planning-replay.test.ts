import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarPlanningCommandExecutorContext } from "../../components/calendar/calendar-planning-replay";

import {
  asAppointmentTypeLineageKey,
  asLocationLineageKey,
  asPractitionerLineageKey,
  toTableId,
} from "../../../convex/identity";
import { createCalendarPlacement } from "../../../lib/calendar-occupancy";
import { executeCalendarPlanningCommand } from "../../components/calendar/calendar-planning-replay";
import { toCalendarAppointmentResult } from "../../components/calendar/calendar-view-models";
import {
  buildCalendarAppointmentRecord,
  buildCalendarBlockedSlotRecord,
} from "./test-records";

describe("calendar planning replay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a missing created appointment as already undone", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const locationId = toTableId<"locations">("location_1");
    const practiceId = toTableId<"practices">("practice_1");
    const placement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        calendarResourceColumn: "ekg",
        kind: "resource",
      },
    });
    const forgetAppointmentHistoryDoc = vi.fn();

    await expect(
      executeCalendarPlanningCommand(
        {
          kind: "appointment.create",
          label: "Termin erstellt",
          payload: {
            appointmentTypeLineageKey,
            appointmentTypeTitle: "Check-up",
            createArgs: {
              appointmentTypeId,
              isSimulation: false,
              locationId,
              practiceId,
              start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
              title: "Check-up",
            },
            createEnd: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
            currentAppointmentId: appointmentId,
            placement,
          },
        },
        "undo",
        {
          ensureLatestConflictData: vi.fn(),
          forgetAppointmentHistoryDoc,
          forgetBlockedSlotHistoryDoc: vi.fn(),
          getCurrentAppointmentDoc: vi.fn(),
          getCurrentBlockedSlotDoc: vi.fn(),
          hasAppointmentConflict: () => false,
          hasBlockedSlotConflict: () => false,
          isMissingAppointmentError: () => true,
          referenceMaps: {
            appointmentTypeIdByLineageKey: new Map(),
            appointmentTypeLineageKeyById: new Map(),
            locationIdByLineageKey: new Map(),
            locationLineageKeyById: new Map(),
            practitionerIdByLineageKey: new Map(),
            practitionerLineageKeyById: new Map(),
          },
          rememberAppointmentHistoryDoc: vi.fn(),
          rememberBlockedSlotHistoryDoc: vi.fn(),
          rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
          rememberRecreatedAppointmentId: vi.fn(),
          rememberRecreatedBlockedSlotId: vi.fn(),
          resolveAppointmentReferenceDisplayIds: vi.fn(),
          resolveCurrentAppointmentId: (id) => id,
          resolveCurrentBlockedSlotId: (id) => id,
          runCreateAppointmentInternal: vi.fn(),
          runCreateBlockedSlotInternal: vi.fn(),
          runDeleteAppointmentInternal: vi.fn(() =>
            Promise.reject(new Error("not found")),
          ),
          runDeleteBlockedSlotInternal: vi.fn(),
          runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
          runRestoreDeletedAppointmentInternal: vi.fn(),
          runUpdateAppointmentInternal: vi.fn(),
          runUpdateBlockedSlotInternal: vi.fn(),
        },
      ),
    ).resolves.toEqual({ status: "applied" });
    expect(forgetAppointmentHistoryDoc).toHaveBeenCalledWith(appointmentId);
  });

  it("treats a missing created blocked slot as already undone", async () => {
    const blockedSlotId = toTableId<"blockedSlots">("blocked_slot_1");
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const placement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        kind: "practitioner",
        practitionerLineageKey,
      },
    });
    const forgetBlockedSlotHistoryDoc = vi.fn();

    await expect(
      executeCalendarPlanningCommand(
        {
          kind: "blockedSlot.create",
          label: "Sperrung erstellt",
          payload: {
            blockedSlotReferences: placement,
            createArgs: {
              end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
              isSimulation: false,
              locationId,
              occupancyScope: { kind: "practitioner", practitionerId },
              practiceId,
              start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
              title: "Block",
            },
            currentBlockedSlotId: blockedSlotId,
            now: 1,
          },
        },
        "undo",
        {
          ensureLatestConflictData: vi.fn(),
          forgetAppointmentHistoryDoc: vi.fn(),
          forgetBlockedSlotHistoryDoc,
          getCurrentAppointmentDoc: vi.fn(),
          getCurrentBlockedSlotDoc: vi.fn(),
          hasAppointmentConflict: () => false,
          hasBlockedSlotConflict: () => false,
          isMissingBlockedSlotError: () => true,
          referenceMaps: {
            appointmentTypeIdByLineageKey: new Map(),
            appointmentTypeLineageKeyById: new Map(),
            locationIdByLineageKey: new Map(),
            locationLineageKeyById: new Map(),
            practitionerIdByLineageKey: new Map(),
            practitionerLineageKeyById: new Map(),
          },
          rememberAppointmentHistoryDoc: vi.fn(),
          rememberBlockedSlotHistoryDoc: vi.fn(),
          rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
          rememberRecreatedAppointmentId: vi.fn(),
          rememberRecreatedBlockedSlotId: vi.fn(),
          resolveAppointmentReferenceDisplayIds: vi.fn(),
          resolveCurrentAppointmentId: (id) => id,
          resolveCurrentBlockedSlotId: (id) => id,
          runCreateAppointmentInternal: vi.fn(),
          runCreateBlockedSlotInternal: vi.fn(),
          runDeleteAppointmentInternal: vi.fn(),
          runDeleteBlockedSlotInternal: vi.fn(() =>
            Promise.reject(new Error("not found")),
          ),
          runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
          runRestoreDeletedAppointmentInternal: vi.fn(),
          runUpdateAppointmentInternal: vi.fn(),
          runUpdateBlockedSlotInternal: vi.fn(),
        },
      ),
    ).resolves.toEqual({ status: "applied" });
    expect(forgetBlockedSlotHistoryDoc).toHaveBeenCalledWith(blockedSlotId);
  });

  it("keeps created appointment undo conflicts for non-missing delete failures", async () => {
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
      occupancyScope: { calendarResourceColumn: "ekg", kind: "resource" },
    });

    await expect(
      executeCalendarPlanningCommand(
        {
          kind: "appointment.create",
          label: "Termin erstellt",
          payload: {
            appointmentTypeLineageKey,
            appointmentTypeTitle: "Check-up",
            createArgs: {
              appointmentTypeId,
              isSimulation: false,
              locationId,
              practiceId,
              start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
              title: "Check-up",
            },
            createEnd: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
            currentAppointmentId: appointmentId,
            placement,
          },
        },
        "undo",
        {
          ensureLatestConflictData: vi.fn(),
          forgetAppointmentHistoryDoc: vi.fn(),
          forgetBlockedSlotHistoryDoc: vi.fn(),
          getCurrentAppointmentDoc: vi.fn(),
          getCurrentBlockedSlotDoc: vi.fn(),
          hasAppointmentConflict: () => false,
          hasBlockedSlotConflict: () => false,
          isMissingAppointmentError: () => false,
          referenceMaps: {
            appointmentTypeIdByLineageKey: new Map(),
            appointmentTypeLineageKeyById: new Map(),
            locationIdByLineageKey: new Map(),
            locationLineageKeyById: new Map(),
            practitionerIdByLineageKey: new Map(),
            practitionerLineageKeyById: new Map(),
          },
          rememberAppointmentHistoryDoc: vi.fn(),
          rememberBlockedSlotHistoryDoc: vi.fn(),
          rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
          rememberRecreatedAppointmentId: vi.fn(),
          rememberRecreatedBlockedSlotId: vi.fn(),
          resolveAppointmentReferenceDisplayIds: vi.fn(),
          resolveCurrentAppointmentId: (id) => id,
          resolveCurrentBlockedSlotId: (id) => id,
          runCreateAppointmentInternal: vi.fn(),
          runCreateBlockedSlotInternal: vi.fn(),
          runDeleteAppointmentInternal: vi.fn(() =>
            Promise.reject(new Error("permission denied")),
          ),
          runDeleteBlockedSlotInternal: vi.fn(),
          runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
          runRestoreDeletedAppointmentInternal: vi.fn(),
          runUpdateAppointmentInternal: vi.fn(),
          runUpdateBlockedSlotInternal: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      message: "permission denied",
      status: "conflict",
    });
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
    const smiley = "😴";
    const before = buildCalendarAppointmentRecord({
      _id: appointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      end: beforeEnd,
      placement: beforePlacement,
      practiceId,
      smiley,
      start: beforeStart,
      title: "Check-up",
    });
    const afterState = {
      end: afterEnd,
      placement: beforePlacement,
      smiley,
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
            placement: before.placement,
            smiley,
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
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: () => ({
          appointmentTypeId,
          locationId,
          occupancyScope: {
            calendarResourceColumn: "ekg",
            kind: "resource",
          },
        }),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal,
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(runUpdateAppointmentInternal).toHaveBeenCalledWith(
      expect.not.objectContaining({
        smiley: expect.anything(),
      }),
    );
    expect(rememberAppointmentHistoryDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        lastModified: 1_234n,
        start: afterState.start,
      }),
    );
  });

  it("replays smiley-only appointment updates without scheduling fields", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
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
    const afterSnapshot = {
      ...before,
      smiley: "👍",
    };
    const runUpdateAppointmentInternal = vi.fn(() => Promise.resolve(null));

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointment.update",
        label: "Termin-Smiley geändert",
        payload: {
          afterSnapshot,
          afterState: {
            end: before.end,
            placement,
            smiley: "👍",
            start: before.start,
          },
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
        getCurrentAppointmentDoc: () => before,
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: () => false,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal,
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(runUpdateAppointmentInternal).toHaveBeenCalledWith({
      id: appointmentId,
      smiley: "👍",
    });
  });

  it("skips no-op appointment update replay without calling the backend", async () => {
    const appointmentId = toTableId<"appointments">("appointment_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
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
      smiley: "👍",
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const runUpdateAppointmentInternal = vi.fn(() => Promise.resolve(null));

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointment.update",
        label: "Termin-Smiley geändert",
        payload: {
          afterSnapshot: before,
          afterState: {
            end: before.end,
            placement,
            smiley: "👍",
            start: before.start,
          },
          appointmentId,
          before,
          beforeState: {
            end: before.end,
            placement,
            smiley: "👍",
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
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal,
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "noop" });
    expect(runUpdateAppointmentInternal).not.toHaveBeenCalled();
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
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
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
    let currentAppointmentDoc = recreatedBefore;
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
    const rememberAppointmentHistoryDoc =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberAppointmentHistoryDoc"]
      >();
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
        id === recreatedAppointmentId ? currentAppointmentDoc : undefined,
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
      rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
      rememberRecreatedAppointmentId,
      rememberRecreatedBlockedSlotId: vi.fn(),
      resolveAppointmentReferenceDisplayIds: () => ({
        appointmentTypeId,
        locationId,
        occupancyScope: {
          calendarResourceColumn: "ekg" as const,
          kind: "resource" as const,
        },
      }),
      resolveCurrentAppointmentId: (id) => idMap.get(id) ?? id,
      resolveCurrentBlockedSlotId: (id) => id,
      runCreateAppointmentInternal: vi.fn(() =>
        Promise.resolve({
          appointment: toCalendarAppointmentResult({
            appointmentTypeId,
            locationId,
            record: recreatedBefore,
          }),
          kind: "appointment.created" as const,
        }),
      ),
      runCreateBlockedSlotInternal: vi.fn(),
      runDeleteAppointmentInternal: vi.fn(),
      runDeleteBlockedSlotInternal: vi.fn(),
      runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
      runRestoreDeletedAppointmentInternal: vi.fn(),
      runUpdateAppointmentInternal,
      runUpdateBlockedSlotInternal: vi.fn(),
    } satisfies CalendarPlanningCommandExecutorContext;

    await expect(
      executeCalendarPlanningCommand(createCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });
    await expect(
      executeCalendarPlanningCommand(updateCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });
    currentAppointmentDoc = {
      ...updateCommand.payload.afterSnapshot,
      _id: recreatedAppointmentId,
    };
    await expect(
      executeCalendarPlanningCommand(updateCommand, "undo", context),
    ).resolves.toEqual({ status: "applied" });

    expect(rememberRecreatedAppointmentId).toHaveBeenCalledWith({
      currentId: recreatedAppointmentId,
      originalId: originalAppointmentId,
    });
    expect(runUpdateAppointmentInternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: recreatedAppointmentId }),
    );
    expect(rememberAppointmentHistoryDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: recreatedAppointmentId }),
    );
    expect(rememberAppointmentHistoryDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: recreatedAppointmentId }),
    );
  });

  it("replays a blocked-slot update against the recreated blocked-slot id after creation redo", async () => {
    const originalBlockedSlotId = toTableId<"blockedSlots">("blocked_old");
    const recreatedBlockedSlotId = toTableId<"blockedSlots">("blocked_new");
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const placement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        kind: "practitioner",
        practitionerLineageKey,
      },
    });
    const before = buildCalendarBlockedSlotRecord({
      _id: originalBlockedSlotId,
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      placement,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Block",
    });
    const recreatedBefore = {
      ...before,
      _id: recreatedBlockedSlotId,
    };
    let currentBlockedSlotDoc = recreatedBefore;
    const afterState = {
      end: "2026-04-25T10:00:00+02:00[Europe/Berlin]" as const,
      placement,
      start: "2026-04-25T09:30:00+02:00[Europe/Berlin]" as const,
      title: "Block",
    };
    const idMap = new Map([[originalBlockedSlotId, originalBlockedSlotId]]);
    const rememberRecreatedBlockedSlotId = vi.fn<
      CalendarPlanningCommandExecutorContext["rememberRecreatedBlockedSlotId"]
    >(({ currentId, originalId }) => {
      idMap.set(originalId, currentId);
    });
    const rememberBlockedSlotHistoryDoc =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberBlockedSlotHistoryDoc"]
      >();
    const runUpdateBlockedSlotInternal = vi.fn(() => Promise.resolve(null));
    const createCommand = {
      kind: "blockedSlot.create" as const,
      label: "Sperrung erstellt",
      payload: {
        blockedSlotReferences: placement,
        createArgs: {
          end: before.end,
          isSimulation: false,
          locationId,
          occupancyScope: { kind: "practitioner" as const, practitionerId },
          practiceId,
          start: before.start,
          title: before.title,
        },
        currentBlockedSlotId: originalBlockedSlotId,
        now: 1,
      },
    };
    const updateCommand = {
      kind: "blockedSlot.update" as const,
      label: "Sperrung aktualisiert",
      payload: {
        afterSnapshot: {
          ...before,
          ...afterState,
        },
        afterState,
        before,
        beforeState: {
          end: before.end,
          placement,
          start: before.start,
          title: before.title,
        },
        blockedSlotId: originalBlockedSlotId,
      },
    };

    const context = {
      ensureLatestConflictData: vi.fn(() => Promise.resolve()),
      forgetAppointmentHistoryDoc: vi.fn(),
      forgetBlockedSlotHistoryDoc: vi.fn(),
      getCurrentAppointmentDoc: vi.fn(),
      getCurrentBlockedSlotDoc: (id) =>
        id === recreatedBlockedSlotId ? currentBlockedSlotDoc : undefined,
      hasAppointmentConflict: () => false,
      hasBlockedSlotConflict: () => false,
      referenceMaps: {
        appointmentTypeIdByLineageKey: new Map(),
        appointmentTypeLineageKeyById: new Map(),
        locationIdByLineageKey: new Map([[locationLineageKey, locationId]]),
        locationLineageKeyById: new Map([[locationId, locationLineageKey]]),
        practitionerIdByLineageKey: new Map([
          [practitionerLineageKey, practitionerId],
        ]),
        practitionerLineageKeyById: new Map([
          [practitionerId, practitionerLineageKey],
        ]),
      },
      rememberAppointmentHistoryDoc: vi.fn(),
      rememberBlockedSlotHistoryDoc,
      rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
      rememberRecreatedAppointmentId: vi.fn(),
      rememberRecreatedBlockedSlotId,
      resolveAppointmentReferenceDisplayIds: vi.fn(),
      resolveCurrentAppointmentId: (id) => id,
      resolveCurrentBlockedSlotId: (id) => idMap.get(id) ?? id,
      runCreateAppointmentInternal: vi.fn(),
      runCreateBlockedSlotInternal: vi.fn(() =>
        Promise.resolve(recreatedBlockedSlotId),
      ),
      runDeleteAppointmentInternal: vi.fn(),
      runDeleteBlockedSlotInternal: vi.fn(),
      runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
      runRestoreDeletedAppointmentInternal: vi.fn(),
      runUpdateAppointmentInternal: vi.fn(),
      runUpdateBlockedSlotInternal,
    } satisfies CalendarPlanningCommandExecutorContext;

    await expect(
      executeCalendarPlanningCommand(createCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });
    await expect(
      executeCalendarPlanningCommand(updateCommand, "redo", context),
    ).resolves.toEqual({ status: "applied" });
    currentBlockedSlotDoc = {
      ...updateCommand.payload.afterSnapshot,
      _id: recreatedBlockedSlotId,
    };
    await expect(
      executeCalendarPlanningCommand(updateCommand, "undo", context),
    ).resolves.toEqual({ status: "applied" });

    expect(rememberRecreatedBlockedSlotId).toHaveBeenCalledWith({
      currentId: recreatedBlockedSlotId,
      originalId: originalBlockedSlotId,
    });
    expect(runUpdateBlockedSlotInternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: recreatedBlockedSlotId }),
    );
    expect(rememberBlockedSlotHistoryDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: recreatedBlockedSlotId }),
    );
    expect(rememberBlockedSlotHistoryDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: recreatedBlockedSlotId }),
    );
  });

  it("registers an appointment alias when undoing an appointment deletion", async () => {
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
    const deleted = buildCalendarAppointmentRecord({
      _id: originalAppointmentId,
      appointmentTypeLineageKey,
      appointmentTypeTitle: "Check-up",
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      placement,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Check-up",
    });
    const rememberRecreatedAppointmentId =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberRecreatedAppointmentId"]
      >();
    const hasAppointmentConflict = vi.fn<
      CalendarPlanningCommandExecutorContext["hasAppointmentConflict"]
    >(() => false);

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointment.delete",
        label: "Termin gelöscht",
        payload: {
          createArgs: {
            appointmentTypeId,
            isSimulation: false,
            locationId,
            practiceId,
            start: deleted.start,
            title: deleted.title,
          },
          createEnd: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
          currentAppointmentId: originalAppointmentId,
          deleted,
        },
      },
      "undo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId,
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(() =>
          Promise.resolve({
            appointment: toCalendarAppointmentResult({
              appointmentTypeId,
              locationId,
              record: {
                ...deleted,
                _id: recreatedAppointmentId,
              },
            }),
            kind: "appointment.created" as const,
          }),
        ),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(hasAppointmentConflict).toHaveBeenCalledWith(
      expect.objectContaining({ end: deleted.end }),
    );
    expect(rememberRecreatedAppointmentId).toHaveBeenCalledWith({
      currentId: recreatedAppointmentId,
      originalId: originalAppointmentId,
    });
  });

  it("registers a blocked-slot alias when undoing a blocked-slot deletion", async () => {
    const originalBlockedSlotId = toTableId<"blockedSlots">("blocked_old");
    const recreatedBlockedSlotId = toTableId<"blockedSlots">("blocked_new");
    const locationId = toTableId<"locations">("location_1");
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practitionerId = toTableId<"practitioners">("practitioner_1");
    const practitionerLineageKey = asPractitionerLineageKey(
      toTableId<"practitioners">("practitioner_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const placement = createCalendarPlacement({
      locationLineageKey,
      occupancyScope: {
        kind: "practitioner",
        practitionerLineageKey,
      },
    });
    const deleted = buildCalendarBlockedSlotRecord({
      _id: originalBlockedSlotId,
      end: "2026-04-25T09:30:00+02:00[Europe/Berlin]",
      placement,
      practiceId,
      start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      title: "Block",
    });
    const rememberRecreatedBlockedSlotId =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberRecreatedBlockedSlotId"]
      >();

    const result = await executeCalendarPlanningCommand(
      {
        kind: "blockedSlot.delete",
        label: "Sperrung gelöscht",
        payload: {
          createArgs: {
            end: deleted.end,
            isSimulation: false,
            locationId,
            occupancyScope: { kind: "practitioner", practitionerId },
            practiceId,
            start: deleted.start,
            title: deleted.title,
          },
          currentBlockedSlotId: originalBlockedSlotId,
          deleted,
        },
      },
      "undo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: () => false,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId,
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(() =>
          Promise.resolve(recreatedBlockedSlotId),
        ),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(rememberRecreatedBlockedSlotId).toHaveBeenCalledWith({
      currentId: recreatedBlockedSlotId,
      originalId: originalBlockedSlotId,
    });
  });

  it("restores appointment-plan creates from the stored series snapshot", async () => {
    const originalRootAppointmentId = toTableId<"appointments">("root_old");
    const originalStepAppointmentId = toTableId<"appointments">("step_old");
    const replacedRootAppointmentId =
      toTableId<"appointments">("root_replaced");
    const restoredRootAppointmentId = toTableId<"appointments">("root_new");
    const restoredStepAppointmentId = toTableId<"appointments">("step_new");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const locationId = toTableId<"locations">("location_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const snapshot = {
      appointments: [
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "Check-up",
          createdAt: 1n,
          end: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "ekg" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: originalRootAppointmentId,
          practiceId,
          replacesAppointmentId: replacedRootAppointmentId,
          seriesStepIndex: 0n,
          start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          title: "Check-up",
        },
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "BE",
          cancelledAt: 2n,
          createdAt: 1n,
          end: "2026-04-25T09:20:00+02:00[Europe/Berlin]",
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "labor" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: originalStepAppointmentId,
          practiceId,
          seriesStepId: "step-1",
          seriesStepIndex: 1n,
          start: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
          title: "BE",
        },
      ],
      series: {
        appointmentPlanSnapshot: [],
        createdAt: 1n,
        lastModified: 1n,
        practiceId,
        rootAppointmentId: originalRootAppointmentId,
        rootAppointmentTypeId: appointmentTypeId,
        rootAppointmentTypeLineageKey: appointmentTypeLineageKey,
        rootDurationMinutes: 10,
        ruleSetIdAtBooking: ruleSetId,
        scope: "real" as const,
        seriesId: "series_1",
      },
    };
    const rememberRecreatedAppointmentId =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberRecreatedAppointmentId"]
      >();
    const rememberAppointmentHistoryDoc =
      vi.fn<
        CalendarPlanningCommandExecutorContext["rememberAppointmentHistoryDoc"]
      >();
    const runRestoreAppointmentSeriesSnapshotInternal = vi.fn(() =>
      Promise.resolve({
        appointmentHistoryDocs: [
          toCalendarAppointmentResult({
            appointmentTypeId,
            locationId,
            record: buildCalendarAppointmentRecord({
              _id: restoredRootAppointmentId,
              appointmentTypeLineageKey,
              appointmentTypeTitle: "Check-up",
              calendarResourceColumn: "ekg",
              end: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
              locationLineageKey,
              practiceId,
              start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
              title: "Check-up",
            }),
          }),
          {
            ...toCalendarAppointmentResult({
              appointmentTypeId,
              locationId,
              record: buildCalendarAppointmentRecord({
                _id: restoredStepAppointmentId,
                appointmentTypeLineageKey,
                appointmentTypeTitle: "BE",
                calendarResourceColumn: "labor",
                end: "2026-04-25T09:20:00+02:00[Europe/Berlin]",
                locationLineageKey,
                practiceId,
                start: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
                title: "BE",
              }),
            }),
            cancelledAt: 2n,
          },
        ],
        appointments: [
          {
            appointmentId: restoredRootAppointmentId,
            originalAppointmentId: originalRootAppointmentId,
          },
          {
            appointmentId: restoredStepAppointmentId,
            originalAppointmentId: originalStepAppointmentId,
          },
        ],
        rootAppointmentId: restoredRootAppointmentId,
        seriesId: "series_1",
      }),
    );
    const hasAppointmentConflict = vi.fn<
      CalendarPlanningCommandExecutorContext["hasAppointmentConflict"]
    >((candidate) => {
      if (candidate.start === "2026-04-25T09:10:00+02:00[Europe/Berlin]") {
        return true;
      }

      return candidate.replacesAppointmentId !== replacedRootAppointmentId;
    });

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointmentSeries.create",
        label: "Kettentermine erstellt",
        payload: {
          currentRootAppointmentId: originalRootAppointmentId,
          snapshot,
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc,
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId,
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal: vi.fn(),
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal,
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(runRestoreAppointmentSeriesSnapshotInternal).toHaveBeenCalledWith({
      seriesId: "series_1",
      snapshot,
    });
    expect(hasAppointmentConflict).toHaveBeenCalledTimes(1);
    expect(hasAppointmentConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        replacesAppointmentId: replacedRootAppointmentId,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      }),
      undefined,
      undefined,
    );
    expect(rememberRecreatedAppointmentId).toHaveBeenCalledWith({
      currentId: restoredRootAppointmentId,
      originalId: originalRootAppointmentId,
    });
    expect(rememberRecreatedAppointmentId).toHaveBeenCalledWith({
      currentId: restoredStepAppointmentId,
      originalId: originalStepAppointmentId,
    });
    expect(rememberAppointmentHistoryDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: restoredRootAppointmentId,
        appointmentTypeLineageKey,
        start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      }),
    );
    expect(rememberAppointmentHistoryDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: restoredStepAppointmentId,
        appointmentTypeLineageKey,
        cancelledAt: 2n,
        start: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
      }),
    );
  });

  it("preflights appointment series update restores before deleting the current series", async () => {
    const currentRootAppointmentId = toTableId<"appointments">("root_current");
    const targetRootAppointmentId = toTableId<"appointments">("root_target");
    const restoredRootAppointmentId = toTableId<"appointments">("root_new");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const locationId = toTableId<"locations">("location_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const snapshotFor = (
      rootAppointmentId: typeof currentRootAppointmentId,
      start: string,
      end: string,
    ) => ({
      appointments: [
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "Check-up",
          createdAt: 1n,
          end,
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "ekg" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: rootAppointmentId,
          practiceId,
          seriesStepIndex: 0n,
          start,
          title: "Check-up",
        },
      ],
      series: {
        appointmentPlanSnapshot: [],
        createdAt: 1n,
        lastModified: 1n,
        practiceId,
        rootAppointmentId,
        rootAppointmentTypeId: appointmentTypeId,
        rootAppointmentTypeLineageKey: appointmentTypeLineageKey,
        rootDurationMinutes: 10,
        ruleSetIdAtBooking: ruleSetId,
        scope: "real" as const,
        seriesId: "series_1",
      },
    });
    const beforeSnapshot = snapshotFor(
      currentRootAppointmentId,
      "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      "2026-04-25T09:10:00+02:00[Europe/Berlin]",
    );
    const afterSnapshot = snapshotFor(
      targetRootAppointmentId,
      "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      "2026-04-25T10:10:00+02:00[Europe/Berlin]",
    );
    const runDeleteAppointmentInternal = vi.fn();
    const runRestoreAppointmentSeriesSnapshotInternal = vi.fn(() =>
      Promise.resolve({
        appointmentHistoryDocs: [
          toCalendarAppointmentResult({
            appointmentTypeId,
            locationId,
            record: buildCalendarAppointmentRecord({
              _id: restoredRootAppointmentId,
              appointmentTypeLineageKey,
              appointmentTypeTitle: "Check-up",
              calendarResourceColumn: "ekg",
              end: "2026-04-25T10:10:00+02:00[Europe/Berlin]",
              locationLineageKey,
              practiceId,
              start: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
              title: "Check-up",
            }),
          }),
        ],
        appointments: [
          {
            appointmentId: restoredRootAppointmentId,
            originalAppointmentId: targetRootAppointmentId,
          },
        ],
        rootAppointmentId: restoredRootAppointmentId,
        seriesId: "series_1",
      }),
    );
    const hasAppointmentConflict = vi.fn<
      CalendarPlanningCommandExecutorContext["hasAppointmentConflict"]
    >(() => false);

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointmentSeries.update",
        label: "Kettentermine aktualisiert",
        payload: {
          after: {
            currentRootAppointmentId: targetRootAppointmentId,
            snapshot: afterSnapshot,
          },
          before: {
            currentRootAppointmentId,
            snapshot: beforeSnapshot,
          },
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal,
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal,
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(hasAppointmentConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      }),
      undefined,
      expect.any(Set),
    );
    expect(runDeleteAppointmentInternal).toHaveBeenCalledWith({
      id: currentRootAppointmentId,
    });
    expect(runRestoreAppointmentSeriesSnapshotInternal).toHaveBeenCalledWith({
      seriesId: "series_1",
      snapshot: afterSnapshot,
    });
  });

  it("does not delete the current appointment series when the restore target conflicts", async () => {
    const currentRootAppointmentId = toTableId<"appointments">("root_current");
    const targetRootAppointmentId = toTableId<"appointments">("root_target");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const snapshotFor = (
      rootAppointmentId: typeof currentRootAppointmentId,
      start: string,
      end: string,
    ) => ({
      appointments: [
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "Check-up",
          createdAt: 1n,
          end,
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "ekg" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: rootAppointmentId,
          practiceId,
          seriesStepIndex: 0n,
          start,
          title: "Check-up",
        },
      ],
      series: {
        appointmentPlanSnapshot: [],
        createdAt: 1n,
        lastModified: 1n,
        practiceId,
        rootAppointmentId,
        rootAppointmentTypeId: appointmentTypeId,
        rootAppointmentTypeLineageKey: appointmentTypeLineageKey,
        rootDurationMinutes: 10,
        ruleSetIdAtBooking: ruleSetId,
        scope: "real" as const,
        seriesId: "series_1",
      },
    });
    const beforeSnapshot = snapshotFor(
      currentRootAppointmentId,
      "2026-04-25T09:00:00+02:00[Europe/Berlin]",
      "2026-04-25T09:10:00+02:00[Europe/Berlin]",
    );
    const afterSnapshot = snapshotFor(
      targetRootAppointmentId,
      "2026-04-25T10:00:00+02:00[Europe/Berlin]",
      "2026-04-25T10:10:00+02:00[Europe/Berlin]",
    );
    const runDeleteAppointmentInternal = vi.fn();
    const runRestoreAppointmentSeriesSnapshotInternal = vi.fn();

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointmentSeries.update",
        label: "Kettentermine aktualisiert",
        payload: {
          after: {
            currentRootAppointmentId: targetRootAppointmentId,
            snapshot: afterSnapshot,
          },
          before: {
            currentRootAppointmentId,
            snapshot: beforeSnapshot,
          },
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc: vi.fn(),
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: vi.fn(() => true),
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => id,
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal,
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal,
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result.status).toBe("conflict");
    expect(runDeleteAppointmentInternal).not.toHaveBeenCalled();
    expect(runRestoreAppointmentSeriesSnapshotInternal).not.toHaveBeenCalled();
  });

  it("forgets current alias ids for every series appointment when deleting a restored series", async () => {
    const originalRootAppointmentId = toTableId<"appointments">("root_old");
    const originalStepAppointmentId = toTableId<"appointments">("step_old");
    const restoredRootAppointmentId = toTableId<"appointments">("root_new");
    const restoredStepAppointmentId = toTableId<"appointments">("step_new");
    const appointmentTypeId = toTableId<"appointmentTypes">("type_1");
    const locationId = toTableId<"locations">("location_1");
    const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
      toTableId<"appointmentTypes">("type_lineage_1"),
    );
    const locationLineageKey = asLocationLineageKey(
      toTableId<"locations">("location_lineage_1"),
    );
    const practiceId = toTableId<"practices">("practice_1");
    const ruleSetId = toTableId<"ruleSets">("rule_set_1");
    const snapshot = {
      appointments: [
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "Check-up",
          createdAt: 1n,
          end: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "ekg" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: originalRootAppointmentId,
          practiceId,
          seriesStepIndex: 0n,
          start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
          title: "Check-up",
        },
        {
          appointmentTypeLineageKey,
          appointmentTypeTitle: "BE",
          createdAt: 1n,
          end: "2026-04-25T09:20:00+02:00[Europe/Berlin]",
          isSimulation: false,
          lastModified: 1n,
          locationLineageKey,
          occupancyScope: {
            calendarResourceColumn: "labor" as const,
            kind: "resource" as const,
          },
          originalAppointmentId: originalStepAppointmentId,
          practiceId,
          seriesStepId: "step-1",
          seriesStepIndex: 1n,
          start: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
          title: "BE",
        },
      ],
      series: {
        appointmentPlanSnapshot: [],
        createdAt: 1n,
        lastModified: 1n,
        practiceId,
        rootAppointmentId: originalRootAppointmentId,
        rootAppointmentTypeId: appointmentTypeId,
        rootAppointmentTypeLineageKey: appointmentTypeLineageKey,
        rootDurationMinutes: 10,
        ruleSetIdAtBooking: ruleSetId,
        scope: "real" as const,
        seriesId: "series_1",
      },
    };
    const forgetAppointmentHistoryDoc =
      vi.fn<
        CalendarPlanningCommandExecutorContext["forgetAppointmentHistoryDoc"]
      >();
    const runDeleteAppointmentInternal = vi.fn(() =>
      Promise.resolve({
        kind: "appointmentSeries.deleted" as const,
        series: {
          appointments: [
            toCalendarAppointmentResult({
              appointmentTypeId,
              locationId,
              record: buildCalendarAppointmentRecord({
                _id: restoredRootAppointmentId,
                appointmentTypeLineageKey,
                appointmentTypeTitle: "Check-up",
                calendarResourceColumn: "ekg",
                end: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
                locationLineageKey,
                practiceId,
                start: "2026-04-25T09:00:00+02:00[Europe/Berlin]",
                title: "Check-up",
              }),
            }),
            toCalendarAppointmentResult({
              appointmentTypeId,
              locationId,
              record: buildCalendarAppointmentRecord({
                _id: restoredStepAppointmentId,
                appointmentTypeLineageKey,
                appointmentTypeTitle: "BE",
                calendarResourceColumn: "labor",
                end: "2026-04-25T09:20:00+02:00[Europe/Berlin]",
                locationLineageKey,
                practiceId,
                start: "2026-04-25T09:10:00+02:00[Europe/Berlin]",
                title: "BE",
              }),
            }),
          ],
          rootAppointmentId: restoredRootAppointmentId,
          seriesId: "series_1",
          snapshot,
        },
      }),
    );

    const result = await executeCalendarPlanningCommand(
      {
        kind: "appointmentSeries.delete",
        label: "Kettentermine gelöscht",
        payload: {
          currentRootAppointmentId: originalRootAppointmentId,
          snapshot,
        },
      },
      "redo",
      {
        ensureLatestConflictData: vi.fn(() => Promise.resolve()),
        forgetAppointmentHistoryDoc,
        forgetBlockedSlotHistoryDoc: vi.fn(),
        getCurrentAppointmentDoc: vi.fn(),
        getCurrentBlockedSlotDoc: vi.fn(),
        hasAppointmentConflict: () => false,
        hasBlockedSlotConflict: () => false,
        referenceMaps: {
          appointmentTypeIdByLineageKey: new Map(),
          appointmentTypeLineageKeyById: new Map(),
          locationIdByLineageKey: new Map(),
          locationLineageKeyById: new Map(),
          practitionerIdByLineageKey: new Map(),
          practitionerLineageKeyById: new Map(),
        },
        rememberAppointmentHistoryDoc: vi.fn(),
        rememberBlockedSlotHistoryDoc: vi.fn(),
        rememberCreatedBlockedSlotHistoryDoc: vi.fn(),
        rememberRecreatedAppointmentId: vi.fn(),
        rememberRecreatedBlockedSlotId: vi.fn(),
        resolveAppointmentReferenceDisplayIds: vi.fn(),
        resolveCurrentAppointmentId: (id) => {
          if (id === originalRootAppointmentId) {
            return restoredRootAppointmentId;
          }
          if (id === originalStepAppointmentId) {
            return restoredStepAppointmentId;
          }
          return id;
        },
        resolveCurrentBlockedSlotId: (id) => id,
        runCreateAppointmentInternal: vi.fn(),
        runCreateBlockedSlotInternal: vi.fn(),
        runDeleteAppointmentInternal,
        runDeleteBlockedSlotInternal: vi.fn(),
        runRestoreAppointmentSeriesSnapshotInternal: vi.fn(),
        runRestoreDeletedAppointmentInternal: vi.fn(),
        runUpdateAppointmentInternal: vi.fn(),
        runUpdateBlockedSlotInternal: vi.fn(),
      },
    );

    expect(result).toEqual({ status: "applied" });
    expect(runDeleteAppointmentInternal).toHaveBeenCalledWith({
      id: restoredRootAppointmentId,
    });
    expect(forgetAppointmentHistoryDoc).toHaveBeenCalledWith(
      restoredRootAppointmentId,
    );
    expect(forgetAppointmentHistoryDoc).toHaveBeenCalledWith(
      restoredStepAppointmentId,
    );
    expect(forgetAppointmentHistoryDoc).not.toHaveBeenCalledWith(
      originalStepAppointmentId,
    );
  });
});
