import { describe, expect, it, vi } from "vitest";

import { createAppointmentTypeDeleteReplayAdapter } from "../utils/appointment-type-delete-replay";

describe("appointment type delete replay", () => {
  it("restores appointment types with the replay-resolved folder id", async () => {
    const createAppointmentType = vi.fn(() =>
      Promise.resolve({ entityId: "restored-type", ruleSetId: "draft-2" }),
    );
    const restoredTypes: { _id: string; lineageKey: string }[] = [];
    const removeRestoredRef = vi.fn();
    const upsertRestoredRef = vi.fn();
    const replay = createAppointmentTypeDeleteReplayAdapter({
      createAppointmentType,
      deleteAppointmentType: vi.fn(),
      findExistingByLineage: vi.fn((lineageKey) =>
        restoredTypes.find((type) => type.lineageKey === lineageKey),
      ),
      initialEntityId: "deleted-type",
      isMissingEntityError: () => false,
      isSameDefinition: () => true,
      lineageKey: "type-lineage",
      removeRestoredRef,
      resolvePractitionerIds: () => ({
        ids: ["current-practitioner"],
        status: "ok",
      }),
      resolveTreeFolderId: () => ({
        folderId: "current-folder",
        status: "ok",
      }),
      selectedRuleSetId: () => "draft-2",
      snapshot: {
        staleFolderId: "discarded-folder",
      },
      toRestoredRef: (_snapshot, result, treeFolderId) => ({
        id: result.entityId,
        treeFolderId,
      }),
      upsertRestoredRef,
    });

    await expect(replay.undo()).resolves.toEqual({ status: "applied" });
    expect(createAppointmentType).toHaveBeenCalledWith(
      { staleFolderId: "discarded-folder" },
      ["current-practitioner"],
      "current-folder",
    );
    expect(upsertRestoredRef).toHaveBeenCalledWith({
      id: "restored-type",
      treeFolderId: "current-folder",
    });
  });

  it("prunes restored refs when redoing the delete", async () => {
    const deleteAppointmentType = vi.fn(() => Promise.resolve());
    const removeRestoredRef = vi.fn();
    const replay = createAppointmentTypeDeleteReplayAdapter({
      createAppointmentType: vi.fn(),
      deleteAppointmentType,
      findExistingByLineage: vi.fn(),
      initialEntityId: "restored-type",
      isMissingEntityError: () => false,
      isSameDefinition: () => true,
      lineageKey: "type-lineage",
      removeRestoredRef,
      resolvePractitionerIds: () => ({ ids: [], status: "ok" }),
      resolveTreeFolderId: () => ({ folderId: null, status: "ok" }),
      selectedRuleSetId: () => "draft-2",
      snapshot: {},
      toRestoredRef: () => ({}),
      upsertRestoredRef: vi.fn(),
    });

    await expect(replay.redo()).resolves.toEqual({ status: "applied" });
    expect(deleteAppointmentType).toHaveBeenCalledWith({
      appointmentTypeId: "restored-type",
      appointmentTypeLineageKey: "type-lineage",
    });
    expect(removeRestoredRef).toHaveBeenCalledWith({
      appointmentTypeId: "restored-type",
      appointmentTypeLineageKey: "type-lineage",
    });
  });
});
