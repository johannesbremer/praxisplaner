import { describe, expect, it } from "vitest";

import {
  createAppointmentTypeTreeDeleteOverlay,
  createAppointmentTypeTreeRestoreOverlay,
  getActiveAppointmentTypeTreeOverlay,
  mergeAppointmentTypeFoldersByLineage,
  mergeAppointmentTypesByLineage,
} from "../utils/appointment-type-tree-overlay";

interface TestAppointmentType {
  lineageKey: string;
  name: string;
}

interface TestFolder {
  id: string;
  lineageKey: string;
  name: string;
}

const getFolderLineageKey = (folder: TestFolder) => folder.lineageKey;

describe("appointment type tree overlay", () => {
  it("merges restored tree items until query data catches up", () => {
    const restoredType = { lineageKey: "type-a", name: "Checkup" };
    const restoredFolder = {
      id: "folder-copy",
      lineageKey: "folder-a",
      name: "Root Folder",
    };
    const overlay = createAppointmentTypeTreeRestoreOverlay(
      {
        appointmentTypes: [restoredType],
        folders: [restoredFolder],
      },
      getFolderLineageKey,
    );

    const activeBeforeCatchup = getActiveAppointmentTypeTreeOverlay({
      baseAppointmentTypes: [],
      baseFolders: [],
      getFolderLineageKey,
      overlay,
    });

    expect(activeBeforeCatchup).toBe(overlay);
    expect(
      mergeAppointmentTypesByLineage(
        [],
        overlay.appointmentTypes,
        overlay.deletedAppointmentTypeLineageKeys,
      ),
    ).toEqual([restoredType]);
    expect(
      mergeAppointmentTypeFoldersByLineage(
        [],
        overlay.folders,
        overlay.deletedFolderLineageKeys,
        getFolderLineageKey,
      ),
    ).toEqual([restoredFolder]);

    expect(
      getActiveAppointmentTypeTreeOverlay({
        baseAppointmentTypes: [restoredType],
        baseFolders: [restoredFolder],
        getFolderLineageKey,
        overlay,
      }),
    ).toBeNull();
  });

  it("filters deleted tree items until query data catches up", () => {
    const existingType = { lineageKey: "type-a", name: "Checkup" };
    const existingFolder = {
      id: "folder-copy",
      lineageKey: "folder-a",
      name: "Root Folder",
    };
    const overlay = createAppointmentTypeTreeDeleteOverlay<
      TestAppointmentType,
      TestFolder,
      string,
      string
    >({
      appointmentTypeLineageKeys: [existingType.lineageKey],
      folderLineageKeys: [existingFolder.lineageKey],
    });

    expect(
      mergeAppointmentTypesByLineage(
        [existingType],
        overlay.appointmentTypes,
        overlay.deletedAppointmentTypeLineageKeys,
      ),
    ).toEqual([]);
    expect(
      mergeAppointmentTypeFoldersByLineage(
        [existingFolder],
        overlay.folders,
        overlay.deletedFolderLineageKeys,
        getFolderLineageKey,
      ),
    ).toEqual([]);

    expect(
      getActiveAppointmentTypeTreeOverlay({
        baseAppointmentTypes: [],
        baseFolders: [],
        getFolderLineageKey,
        overlay,
      }),
    ).toBeNull();
  });
});
