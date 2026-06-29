import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import type { AppointmentColor } from "./schema";

export const DEFAULT_APPOINTMENT_COLOR: AppointmentColor = "blue";

export function isAppointmentColor(value: string): value is AppointmentColor {
  switch (value) {
    case "blue":
    case "fuchsia":
    case "green":
    case "indigo":
    case "lime":
    case "orange":
    case "red":
    case "rose":
    case "slate":
    case "teal":
    case "violet":
    case "yellow": {
      return true;
    }
    default: {
      return false;
    }
  }
}

export async function resolveAppointmentColorForType(
  db: DatabaseReader,
  appointmentType: Doc<"appointmentTypes">,
): Promise<AppointmentColor> {
  if (appointmentType.color !== undefined) {
    return appointmentType.color;
  }

  let folderId = appointmentType.treeFolderId;
  const visitedFolderIds = new Set<string>();
  while (folderId !== undefined && !visitedFolderIds.has(folderId)) {
    visitedFolderIds.add(folderId);
    const folder = await db.get("appointmentTypeFolders", folderId);
    if (!folder || folder.deleted === true) {
      break;
    }
    if (folder.color !== undefined) {
      return folder.color;
    }
    folderId = folder.parentFolderId;
  }

  return DEFAULT_APPOINTMENT_COLOR;
}
