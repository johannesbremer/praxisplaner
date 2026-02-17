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
  const conflictBehavior = enabled ? "replace" : "allow";

  useHotkey(
    "Mod+Z",
    () => {
      void onUndo();
    },
    {
      conflictBehavior,
      enabled,
      requireReset: true,
    },
  );

  useHotkey(
    "Mod+Shift+Z",
    () => {
      void onRedo();
    },
    {
      conflictBehavior,
      enabled,
      requireReset: true,
    },
  );

  useHotkey(
    "Mod+Y",
    () => {
      void onRedo();
    },
    {
      conflictBehavior,
      enabled,
      requireReset: true,
    },
  );
}
