import { useHotkey } from "@tanstack/react-hotkeys";

interface UseUndoRedoHotkeysOptions {
  enabled?: boolean;
  onRedo: () => Promise<void> | void;
  onUndo: () => Promise<void> | void;
}

export function useUndoRedoHotkeys({
  enabled = true,
  onRedo,
  onUndo,
}: UseUndoRedoHotkeysOptions) {
  const conflictBehavior = "replace";

  useHotkey(
    "Mod+Z",
    (event) => {
      if (event.repeat) {
        return;
      }
      void onUndo();
    },
    {
      conflictBehavior,
      enabled,
    },
  );

  useHotkey(
    "Mod+Shift+Z",
    (event) => {
      if (event.repeat) {
        return;
      }
      void onRedo();
    },
    {
      conflictBehavior,
      enabled,
    },
  );

  useHotkey(
    "Mod+Y",
    (event) => {
      if (event.repeat) {
        return;
      }
      void onRedo();
    },
    {
      conflictBehavior,
      enabled,
    },
  );
}
