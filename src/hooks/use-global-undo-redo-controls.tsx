import { err, ok, type Result } from "neverthrow";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  captureFrontendError,
  type FrontendError,
  missingContextError,
} from "../utils/frontend-errors";

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
      setState((current) => {
        if (
          current.ownerId === ownerId &&
          isSameControls(current.controls, controls)
        ) {
          return current;
        }

        return {
          controls,
          ownerId,
        };
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

export function useGlobalUndoRedoControls(): Result<
  null | UndoRedoControls,
  FrontendError
> {
  const context = useContext(UndoRedoControlsContext);
  if (!context) {
    return err(
      missingContextError(
        "useGlobalUndoRedoControls",
        "UndoRedoControlsProvider",
      ),
    );
  }

  return ok(context.controls);
}

export function useRegisterGlobalUndoRedoControls(
  controls: null | UndoRedoControls,
) {
  const rawContext = useContext(UndoRedoControlsContext);
  const contextResult: Result<UndoRedoControlsContextValue, FrontendError> =
    rawContext
      ? ok(rawContext)
      : err(
          missingContextError(
            "useRegisterGlobalUndoRedoControls",
            "UndoRedoControlsProvider",
          ),
        );
  const ownerIdRef = useRef(Symbol("undo-redo-controls-owner"));
  const controlsRef = useRef<null | UndoRedoControls>(controls);
  const context = contextResult.match(
    (value) => value,
    (error) => {
      captureFrontendError(
        error,
        undefined,
        "register-global-undo-redo-controls-context",
      );
      return null;
    },
  );
  const clearControls = context?.clearControls;
  const setControls = context?.setControls;
  const canUndo = controls?.canUndo ?? false;
  const canRedo = controls?.canRedo ?? false;
  const hasControls = controls !== null;

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  const stableUndo = useCallback(() => {
    return controlsRef.current?.onUndo();
  }, []);

  const stableRedo = useCallback(() => {
    return controlsRef.current?.onRedo();
  }, []);

  useEffect(() => {
    const ownerId = ownerIdRef.current;

    if (!clearControls || !setControls) {
      return;
    }

    if (hasControls) {
      setControls(
        {
          canRedo,
          canUndo,
          onRedo: stableRedo,
          onUndo: stableUndo,
        },
        ownerId,
      );
    } else {
      clearControls(ownerId);
    }
  }, [
    canRedo,
    canUndo,
    clearControls,
    hasControls,
    setControls,
    stableRedo,
    stableUndo,
  ]);

  useEffect(() => {
    const ownerId = ownerIdRef.current;

    if (!clearControls) {
      return;
    }

    return () => {
      clearControls(ownerId);
    };
  }, [clearControls]);
}

function isSameControls(
  current: null | UndoRedoControls,
  next: null | UndoRedoControls,
) {
  if (current === next) {
    return true;
  }

  if (!current || !next) {
    return false;
  }

  return (
    current.canRedo === next.canRedo &&
    current.canUndo === next.canUndo &&
    current.onRedo === next.onRedo &&
    current.onUndo === next.onUndo
  );
}
