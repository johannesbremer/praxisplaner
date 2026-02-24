import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface UndoRedoControls {
  canRedo: boolean;
  canUndo: boolean;
  onRedo: () => Promise<void> | void;
  onUndo: () => Promise<void> | void;
}

interface UndoRedoControlsContextValue {
  clearControls: (ownerId: symbol) => void;
  controls: null | UndoRedoControls;
  setControls: (controls: null | UndoRedoControls, ownerId: symbol) => void;
}

const UndoRedoControlsContext =
  createContext<null | UndoRedoControlsContextValue>(null);

export function UndoRedoControlsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{
    controls: null | UndoRedoControls;
    ownerId: null | symbol;
  }>({
    controls: null,
    ownerId: null,
  });

  const setControls = useCallback(
    (controls: null | UndoRedoControls, ownerId: symbol) => {
      setState({
        controls,
        ownerId,
      });
    },
    [],
  );

  const clearControls = useCallback((ownerId: symbol) => {
    setState((current) => {
      if (current.ownerId !== ownerId) {
        return current;
      }
      return {
        controls: null,
        ownerId: null,
      };
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      clearControls,
      controls: state.controls,
      setControls,
    }),
    [clearControls, setControls, state.controls],
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
  const ownerIdRef = useRef(Symbol("undo-redo-controls-owner"));
  if (!context) {
    throw new Error(
      "useRegisterGlobalUndoRedoControls must be used within UndoRedoControlsProvider",
    );
  }

  const { clearControls, setControls } = context;

  useEffect(() => {
    const ownerId = ownerIdRef.current;

    if (controls) {
      setControls(controls, ownerId);
    } else {
      clearControls(ownerId);
    }
    return () => {
      clearControls(ownerId);
    };
  }, [clearControls, controls, setControls]);
}
