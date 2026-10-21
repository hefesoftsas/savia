import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export interface ActiveScreenContextValue {
  route?: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

interface ActiveScreenContextState {
  current: ActiveScreenContextValue | null;
  setScreenContext: (context: ActiveScreenContextValue | null) => void;
}

const ActiveScreenContext = createContext<ActiveScreenContextState | null>(null);

export function ActiveScreenContextProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<ActiveScreenContextValue | null>(null);

  const setScreenContext = useCallback(
    (next: ActiveScreenContextValue | null) => {
      setCurrent((prev) => {
        if (
          prev?.route === next?.route &&
          prev?.entityType === next?.entityType &&
          prev?.entityId === next?.entityId &&
          prev?.summary === next?.summary
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      current,
      setScreenContext,
    }),
    [current, setScreenContext],
  );

  return (
    <ActiveScreenContext.Provider value={value}>
      {children}
    </ActiveScreenContext.Provider>
  );
}

export function useActiveScreenContext(): ActiveScreenContextValue | null {
  const context = useContext(ActiveScreenContext);
  return context?.current ?? null;
}

/**
 * Registers an active screen context while the caller component is mounted.
 * Automatically clears when unmounted.
 */
export function useRegisterScreenContext(
  screenContext: ActiveScreenContextValue | null,
) {
  const context = useContext(ActiveScreenContext);
  const setScreenContext = context?.setScreenContext;

  useEffect(() => {
    if (!setScreenContext) return;
    setScreenContext(screenContext);
    return () => {
      setScreenContext(null);
    };
  }, [
    setScreenContext,
    screenContext?.route,
    screenContext?.entityType,
    screenContext?.entityId,
    screenContext?.summary,
  ]);
}
