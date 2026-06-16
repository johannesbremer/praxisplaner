export interface AppointmentTypeTreeOverlay<
  TAppointmentType extends { lineageKey: TAppointmentTypeLineageKey },
  TFolder,
  TAppointmentTypeLineageKey extends string,
  TFolderLineageKey extends string,
> {
  appointmentTypeLineageKeys: ReadonlySet<TAppointmentTypeLineageKey>;
  appointmentTypes: TAppointmentType[];
  deletedAppointmentTypeLineageKeys: ReadonlySet<TAppointmentTypeLineageKey>;
  deletedFolderLineageKeys: ReadonlySet<TFolderLineageKey>;
  folderLineageKeys: ReadonlySet<TFolderLineageKey>;
  folders: TFolder[];
}

export interface AppointmentTypeTreeOverlayDeleteParams<
  TAppointmentTypeLineageKey extends string,
  TFolderLineageKey extends string,
> {
  appointmentTypeLineageKeys: TAppointmentTypeLineageKey[];
  folderLineageKeys: TFolderLineageKey[];
}

export interface AppointmentTypeTreeOverlayRestoreParams<
  TAppointmentType,
  TFolder,
> {
  appointmentTypes: TAppointmentType[];
  folders: TFolder[];
}

export function createAppointmentTypeTreeDeleteOverlay<
  TAppointmentType extends { lineageKey: TAppointmentTypeLineageKey },
  TFolder,
  TAppointmentTypeLineageKey extends string,
  TFolderLineageKey extends string,
>(
  params: AppointmentTypeTreeOverlayDeleteParams<
    TAppointmentTypeLineageKey,
    TFolderLineageKey
  >,
): AppointmentTypeTreeOverlay<
  TAppointmentType,
  TFolder,
  TAppointmentTypeLineageKey,
  TFolderLineageKey
> {
  return {
    appointmentTypeLineageKeys: new Set(),
    appointmentTypes: [],
    deletedAppointmentTypeLineageKeys: new Set(
      params.appointmentTypeLineageKeys,
    ),
    deletedFolderLineageKeys: new Set(params.folderLineageKeys),
    folderLineageKeys: new Set(),
    folders: [],
  };
}

export function createAppointmentTypeTreeRestoreOverlay<
  TAppointmentType extends { lineageKey: TAppointmentTypeLineageKey },
  TFolder,
  TAppointmentTypeLineageKey extends string,
  TFolderLineageKey extends string,
>(
  params: AppointmentTypeTreeOverlayRestoreParams<TAppointmentType, TFolder>,
  getFolderLineageKey: (folder: TFolder) => TFolderLineageKey,
): AppointmentTypeTreeOverlay<
  TAppointmentType,
  TFolder,
  TAppointmentTypeLineageKey,
  TFolderLineageKey
> {
  return {
    appointmentTypeLineageKeys: new Set(
      params.appointmentTypes.map(
        (appointmentType) => appointmentType.lineageKey,
      ),
    ),
    appointmentTypes: params.appointmentTypes,
    deletedAppointmentTypeLineageKeys: new Set(),
    deletedFolderLineageKeys: new Set(),
    folderLineageKeys: new Set(
      params.folders.map((folder) => getFolderLineageKey(folder)),
    ),
    folders: params.folders,
  };
}

export function getActiveAppointmentTypeTreeOverlay<
  TAppointmentType extends { lineageKey: TAppointmentTypeLineageKey },
  TFolder,
  TAppointmentTypeLineageKey extends string,
  TFolderLineageKey extends string,
>(params: {
  baseAppointmentTypes: TAppointmentType[];
  baseFolders: TFolder[];
  getFolderLineageKey: (folder: TFolder) => TFolderLineageKey;
  overlay: AppointmentTypeTreeOverlay<
    TAppointmentType,
    TFolder,
    TAppointmentTypeLineageKey,
    TFolderLineageKey
  > | null;
}): AppointmentTypeTreeOverlay<
  TAppointmentType,
  TFolder,
  TAppointmentTypeLineageKey,
  TFolderLineageKey
> | null {
  if (params.overlay === null) {
    return null;
  }

  const baseFolderLineageKeys = new Set(
    params.baseFolders.map((folder) => params.getFolderLineageKey(folder)),
  );
  const baseAppointmentTypeLineageKeys = new Set(
    params.baseAppointmentTypes.map(
      (appointmentType) => appointmentType.lineageKey,
    ),
  );
  const foldersCaughtUp = [...params.overlay.folderLineageKeys].every(
    (lineageKey) => baseFolderLineageKeys.has(lineageKey),
  );
  const appointmentTypesCaughtUp = [
    ...params.overlay.appointmentTypeLineageKeys,
  ].every((lineageKey) => baseAppointmentTypeLineageKeys.has(lineageKey));
  const deletedFoldersCaughtUp = [
    ...params.overlay.deletedFolderLineageKeys,
  ].every((lineageKey) => !baseFolderLineageKeys.has(lineageKey));
  const deletedAppointmentTypesCaughtUp = [
    ...params.overlay.deletedAppointmentTypeLineageKeys,
  ].every((lineageKey) => !baseAppointmentTypeLineageKeys.has(lineageKey));

  return foldersCaughtUp &&
    appointmentTypesCaughtUp &&
    deletedFoldersCaughtUp &&
    deletedAppointmentTypesCaughtUp
    ? null
    : params.overlay;
}

export function mergeAppointmentTypeFoldersByLineage<
  TFolder,
  TFolderLineageKey extends string,
>(
  baseFolders: TFolder[],
  optimisticFolders: TFolder[],
  deletedLineageKeys: ReadonlySet<TFolderLineageKey>,
  getFolderLineageKey: (folder: TFolder) => TFolderLineageKey,
) {
  const baseLineageKeys = new Set(
    baseFolders.map((folder) => getFolderLineageKey(folder)),
  );
  return [
    ...baseFolders.filter(
      (folder) => !deletedLineageKeys.has(getFolderLineageKey(folder)),
    ),
    ...optimisticFolders.filter(
      (folder) =>
        !deletedLineageKeys.has(getFolderLineageKey(folder)) &&
        !baseLineageKeys.has(getFolderLineageKey(folder)),
    ),
  ];
}

export function mergeAppointmentTypesByLineage<
  TAppointmentType extends { lineageKey: TAppointmentTypeLineageKey },
  TAppointmentTypeLineageKey extends string,
>(
  baseAppointmentTypes: TAppointmentType[],
  optimisticAppointmentTypes: TAppointmentType[],
  deletedLineageKeys: ReadonlySet<TAppointmentTypeLineageKey>,
) {
  const baseLineageKeys = new Set(
    baseAppointmentTypes.map((appointmentType) => appointmentType.lineageKey),
  );
  return [
    ...baseAppointmentTypes.filter(
      (appointmentType) => !deletedLineageKeys.has(appointmentType.lineageKey),
    ),
    ...optimisticAppointmentTypes.filter(
      (appointmentType) =>
        !deletedLineageKeys.has(appointmentType.lineageKey) &&
        !baseLineageKeys.has(appointmentType.lineageKey),
    ),
  ];
}
