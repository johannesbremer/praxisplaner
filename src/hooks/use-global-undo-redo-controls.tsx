import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface UndoRedoControls {
  canRedo: boolean;
  canUndo: boolean;
  onRedo: () => Promise<void> | void;
  onUndo: () => Promise<void> | void;
}

interface UndoRedoControlsContextValue {
  controls: null | UndoRedoControls;
  setControls: (controls: null | UndoRedoControls) => void;
}

const UndoRedoControlsContext =
  createContext<null | UndoRedoControlsContextValue>(null);

export function UndoRedoControlsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [controls, setControls] = useState<null | UndoRedoControls>(null);

  const contextValue = useMemo(
    () => ({
      controls,
      setControls,
    }),
    [controls],
  );

  return (
    <UndoRedoControlsContext.Provider value={contextValue}>
      {children}
    </UndoRedoControlsContext.Provider>
  );
}

export function useGlobalUndoRedoControls() {
  const context = useContext(UndoRedoControlsContext);
  if (!context) {
    throw new Error(
      "useGlobalUndoRedoControls must be used within UndoRedoControlsProvider",
    );
  }

  return context.controls;
}

export function useRegisterGlobalUndoRedoControls(
  controls: null | UndoRedoControls,
) {
  const context = useContext(UndoRedoControlsContext);
  if (!context) {
    throw new Error(
      "useRegisterGlobalUndoRedoControls must be used within UndoRedoControlsProvider",
    );
  }

  useEffect(() => {
    context.setControls(controls);
    return () => {
      context.setControls(null);
    };
  }, [context, controls]);
}
