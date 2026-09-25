import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useCanAccess } from "ra-core";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppServices } from "@/features/assistant/assistant-context";
import {
  createSaviaRequestApi,
  type SaviaRequestApi,
  type SaviaRequestScope,
} from "./savia-request-api";
import {
  clearCachedTenantOptions,
  useSaviaRequestScope,
} from "./savia-request-scope";
import {
  clearAllSaviaRequestSnapshots,
  clearSaviaRequestSnapshot,
  readSaviaRequestSnapshot,
  writeSaviaRequestSnapshot,
} from "./savia-request-cache";
import type { FlowSummary, RequestFlow } from "./types";

type WorkspaceValue = {
  active: boolean;
  view: SaviaRequestView;
  flows: FlowSummary[];
  folders: string[];
  flow: RequestFlow | null;
  stepIndex: number;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  api: SaviaRequestApi;
  scope: string | undefined;
  scopeLabel: string;
  scopeReady: boolean;
  canOverrideScope: boolean;
  scopeOptions: string[];
  isPlatformAdmin: boolean;
  applyScopeOverride(scope: string | null): void;
  selectFlow(id: string, stepIndex?: number): Promise<void>;
  reloadFlow(): Promise<boolean>;
  openSecrets(): void;
  saveDraft(): Promise<boolean>;
  updateDraft(next: RequestFlow): void;
  discardDraft(): void;
  clearSelection(): void;
  refreshNavigation(): Promise<FlowSummary[]>;
};

const SaviaRequestWorkspaceContext = createContext<WorkspaceValue | null>(null);

export type SaviaRequestView = "flow" | "secretos";

function requestedView(search: string): SaviaRequestView {
  return new URLSearchParams(search).get("view") === "secretos"
    ? "secretos"
    : "flow";
}

function requestedStep(search: string): number {
  const value = Number(new URLSearchParams(search).get("step") ?? "0");
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function flowSelection(id: string, step: number) {
  return `/savia-request?flow=${encodeURIComponent(id)}&step=${step}`;
}

function secretsSelection() {
  return "/savia-request?view=secretos";
}

function safeStepIndex(flow: RequestFlow, step: number) {
  return Math.min(Math.max(step, 0), Math.max(flow.steps.length - 1, 0));
}

export function SaviaRequestProvider({ children }: PropsWithChildren) {
  const services = useAppServices();
  const scopeState = useSaviaRequestScope();
  const scope: SaviaRequestScope | undefined = scopeState.scope
    ? { tenant: scopeState.scope }
    : undefined;
  const scopeKey = scopeState.scope ?? "__platform__";
  const api = useMemo(
    () => createSaviaRequestApi(services.apiClient, scope),
    [services.apiClient, scopeState.scope],
  );
  const { canAccess, isPending } = useCanAccess({
    resource: "savia-request",
    action: "list",
  });
  const location = useLocation();
  const navigate = useNavigate();
  const onRoute = location.pathname.startsWith("/savia-request");
  const authorized = Boolean(canAccess) && !isPending && scopeState.ready;
  const active = authorized && onRoute;
  const view = requestedView(location.search);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [flow, setFlow] = useState<RequestFlow | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<RequestFlow | null>(null);
  const dirtyRef = useRef(false);
  const scopeRef = useRef<string | undefined>(scopeState.scope);
  const requestRef = useRef(0);
  const identityRef = useRef<string | null>(null);
  // Evita revalidar la navegación dos veces seguidas: tras sincronizar la
  // URL el efecto se re-ejecuta y caería en la rama temprana con datos
  // recién revalidados.
  const navRevalidatedAtRef = useRef(0);
  // La revalidación en segundo plano corre una vez por activación
  // (ámbito+URL+vista): los re-renders por cambios de estado no refetchean.
  const revalidatedRef = useRef("");

  const replaceFlow = useCallback((next: RequestFlow | null) => {
    draftRef.current = next;
    setFlow(next);
  }, []);

  const persistSnapshot = useCallback(() => {
    writeSaviaRequestSnapshot(scopeState.scope, {
      flows,
      folders,
      flow: draftRef.current,
      stepIndex,
      error,
      updatedAt: Date.now(),
    });
  }, [error, flows, folders, scopeState.scope, stepIndex]);

  // Al salir de la ruta se conserva en memoria; al cambiar de tenant,
  // perder permisos o cerrar sesión se limpia inmediatamente.
  useEffect(() => {
    if (onRoute) return;
    if (!authorized) return;
    persistSnapshot();
  }, [authorized, onRoute, persistSnapshot]);

  // Aislamiento entre usuarios: si cambia la identidad, vacía estado y caché.
  useEffect(() => {
    let active = true;
    try {
      const session = (
        services as { authSession?: { getIdentity?: () => Promise<unknown> } }
      ).authSession;
      if (!session?.getIdentity) return;
      void session
        .getIdentity()
        .then((identity) => {
          if (!active) return;
          const id = String((identity as { id?: unknown }).id ?? "anon");
          if (identityRef.current === null) {
            identityRef.current = id;
            return;
          }
          if (identityRef.current !== id) {
            identityRef.current = id;
            dirtyRef.current = false;
            setDirty(false);
            replaceFlow(null);
            setFlows([]);
            setFolders([]);
            setStepIndex(0);
            setError(null);
            clearAllSaviaRequestSnapshots();
            clearCachedTenantOptions();
          }
        })
        .catch(() => undefined);
    } catch {
      // Fuera del proveedor de servicios (tests): sin aislamiento por usuario.
    }
    return () => {
      active = false;
    };
  }, [replaceFlow, services]);

  const refreshNavigation = useCallback(async () => {
    const [nextFlows, nextFolders] = await Promise.all([
      api.listFlows(),
      api.listFolders(),
    ]);
    setFlows(nextFlows);
    setFolders(nextFolders);
    return nextFlows;
  }, [api]);

  const saveDraft = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft || !dirtyRef.current) return true;
    setBusy(true);
    setError(null);
    try {
      await api.saveFlow(draft);
      dirtyRef.current = false;
      setDirty(false);
      await refreshNavigation();
      return true;
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "No pudimos guardar el flow.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, refreshNavigation]);

  const updateDraft = useCallback(
    (next: RequestFlow) => {
      dirtyRef.current = true;
      setDirty(true);
      replaceFlow(next);
    },
    [replaceFlow],
  );

  const discardDraft = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
    replaceFlow(null);
    setStepIndex(0);
  }, [replaceFlow]);

  const clearSelection = useCallback(() => {
    discardDraft();
    navigate("/savia-request", { replace: true });
  }, [discardDraft, navigate]);

  const selectFlow = useCallback(
    async (id: string, requested = 0) => {
      if (id === draftRef.current?.id) {
        const current = draftRef.current;
        const nextStep = safeStepIndex(current, requested);
        if (nextStep === stepIndex && view === "flow") return;
        setStepIndex(nextStep);
        navigate(flowSelection(id, nextStep));
        return;
      }
      if (!(await saveDraft())) return;
      navigate(flowSelection(id, requested));
    },
    [navigate, saveDraft, stepIndex, view],
  );

  const openSecrets = useCallback(() => {
    navigate(secretsSelection());
  }, [navigate]);

  const reloadFlow = useCallback(async () => {
    const current = draftRef.current;
    if (!current) {
      await refreshNavigation();
      return true;
    }
    setBusy(true);
    setError(null);
    try {
      const fresh = await api.readFlow(current.id);
      dirtyRef.current = false;
      setDirty(false);
      replaceFlow(fresh);
      setStepIndex((index) => safeStepIndex(fresh, index));
      await refreshNavigation();
      return true;
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "No pudimos recargar el flow.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, refreshNavigation, replaceFlow]);

  useEffect(() => {
    if (scopeRef.current === scopeState.scope) return;
    const previous = scopeRef.current;
    scopeRef.current = scopeState.scope;
    // Cambiar de tenant limpia el estado visible y su caché de inmediato;
    // nunca mezcla ámbitos.
    if (previous !== undefined) clearSaviaRequestSnapshot(previous);
    clearSaviaRequestSnapshot(scopeState.scope);
    dirtyRef.current = false;
    setDirty(false);
    navRevalidatedAtRef.current = 0;
    revalidatedRef.current = "";
    replaceFlow(null);
    setFlows([]);
    setFolders([]);
    setStepIndex(0);
    setError(null);
    navigate("/savia-request", { replace: true });
  }, [navigate, replaceFlow, scopeState.scope]);

  // Perder permisos limpia estado y caché de inmediato (no es "salir").
  useEffect(() => {
    if (isPending) return;
    if (canAccess) return;
    dirtyRef.current = false;
    setDirty(false);
    navRevalidatedAtRef.current = 0;
    revalidatedRef.current = "";
    replaceFlow(null);
    setFlows([]);
    setFolders([]);
    setStepIndex(0);
    setError(null);
    clearAllSaviaRequestSnapshots();
    clearCachedTenantOptions();
  }, [canAccess, isPending, replaceFlow]);

  useEffect(() => {
    if (!active) return;

    const effectScope = scopeState.scope;
    const effectKey = scopeKey;
    const requestId = ++requestRef.current;
    const isCurrent = () =>
      requestRef.current === requestId && scopeRef.current === effectScope;

    const requestedFlowId = new URLSearchParams(location.search).get("flow");
    const step = requestedStep(location.search);

    // Al regresar al mismo ámbito, muestra lo conservado de inmediato.
    // Salir de la ruta conserva el estado visible, así que normalmente ya
    // está en pantalla y solo se revalida en segundo plano. Hidratar desde
    // el snapshot solo si el estado está vacío (p. ej. remontaje).
    const snapshot = readSaviaRequestSnapshot(effectScope);
    const hasSnapshot =
      Boolean(snapshot) &&
      (snapshot!.flows.length > 0 ||
        snapshot!.flow != null ||
        snapshot!.folders.length > 0);
    if (hasSnapshot && snapshot) {
      if (flows.length === 0 && !draftRef.current && !dirtyRef.current) {
        setFlows(snapshot.flows);
        setFolders(snapshot.folders);
        replaceFlow(snapshot.flow);
        setStepIndex(snapshot.stepIndex);
        if (snapshot.error) setError(snapshot.error);
      }
      if (requestedFlowId && requestedFlowId === draftRef.current?.id) {
        const nextStep = safeStepIndex(draftRef.current, step);
        setStepIndex(nextStep);
        if (nextStep !== step) {
          navigate(flowSelection(requestedFlowId, nextStep), {
            replace: true,
          });
        }
        // Revalida navegación en segundo plano sin bloquear, salvo que se
        // acabe de revalidar (p. ej. tras sincronizar la URL).
        if (Date.now() - navRevalidatedAtRef.current > 15_000) {
          navRevalidatedAtRef.current = Date.now();
          void (async () => {
            try {
              const [nextFlows, nextFolders] = await Promise.all([
                api.listFlows(),
                api.listFolders(),
              ]);
              if (!isCurrent()) return;
              setFlows(nextFlows);
              setFolders(nextFolders);
            } catch {
              // Conserva lo mostrado; el error se reintenta al navegar.
            }
          })();
        }
        return;
      }
      // Revalidación en segundo plano: no sustituye el contenido por una
      // pantalla de carga y nunca sobrescribe un borrador con cambios.
      // Corre una vez por activación; los re-renders por cambios de estado
      // (p. ej. stepIndex) no refetchean. Marca el instante para que la
      // re-ejecución tras sincronizar la URL no dispare otra revalidación.
      const activationKey = `${effectKey}|${location.search}|${view}`;
      if (revalidatedRef.current === activationKey) return;
      revalidatedRef.current = activationKey;
      navRevalidatedAtRef.current = Date.now();
      void (async () => {
        try {
          if (view === "secretos") {
            const [nextFlows, nextFolders] = await Promise.all([
              api.listFlows(),
              api.listFolders(),
            ]);
            if (!isCurrent()) return;
            setFlows(nextFlows);
            setFolders(nextFolders);
            return;
          }
          const flowsPromise = api.listFlows();
          const foldersPromise = api.listFolders();
          const nextFlows = await flowsPromise;
          if (!isCurrent()) return;
          const summary =
            nextFlows.find((candidate) => candidate.id === requestedFlowId) ??
            nextFlows.find(
              (candidate) => candidate.id === draftRef.current?.id,
            ) ??
            nextFlows[0];
          const flowPromise = summary
            ? api.readFlow(summary.id)
            : Promise.resolve(null);
          // Las carpetas aplican por su cuenta: nunca retrasan el detalle.
          void foldersPromise
            .then((nextFolders) => {
              if (isCurrent()) setFolders(nextFolders);
            })
            .catch(() => undefined);
          const nextFlow = await flowPromise;
          if (!isCurrent()) return;
          setFlows(nextFlows);
          if (nextFlow && !dirtyRef.current) {
            const currentId = draftRef.current?.id;
            if (!currentId || currentId === nextFlow.id || !currentId) {
              replaceFlow(nextFlow);
              const navStep = requestedFlowId
                ? safeStepIndex(nextFlow, step)
                : safeStepIndex(nextFlow, snapshot.stepIndex);
              setStepIndex(navStep);
              dirtyRef.current = false;
              setDirty(false);
              if (!isCurrent()) return;
              // La URL debe reflejar la selección visible, como en la
              // primera carga (sin flow= el regreso quedaría sin enlace).
              if (
                requestedFlowId !== summary.id ||
                (requestedFlowId != null && navStep !== step)
              ) {
                navigate(flowSelection(summary.id, navStep), {
                  replace: true,
                });
              }
            }
          } else if (!summary) {
            if (!dirtyRef.current) {
              replaceFlow(null);
              setStepIndex(0);
            }
          }
          if (!isCurrent()) return;
          setError(null);
        } catch {
          // Una respuesta tardía o fallida no reemplaza el ámbito actual.
        }
      })();
      return;
    }

    if (requestedFlowId && requestedFlowId === draftRef.current?.id) {
      const nextStep = safeStepIndex(draftRef.current, step);
      setStepIndex(nextStep);
      if (nextStep !== step) {
        navigate(flowSelection(requestedFlowId, nextStep), { replace: true });
      }
      return;
    }
    // Sin estado conservado: primera carga con listas en paralelo y detalle
    // en cuanto se conoce el ID, sin que carpetas bloquee el detalle.
    setBusy(true);
    setError(null);

    if (view === "secretos") {
      // La pantalla de secretos es independiente del flow: solo carga la
      // navegación y conserva intacto cualquier borrador en curso.
      void (async () => {
        try {
          const [nextFlows, nextFolders] = await Promise.all([
            api.listFlows(),
            api.listFolders(),
          ]);
          if (!isCurrent()) return;
          setFlows(nextFlows);
          setFolders(nextFolders);
        } catch (exception) {
          if (!isCurrent()) return;
          setError(
            exception instanceof Error
              ? exception.message
              : "No pudimos cargar los flows.",
          );
        } finally {
          if (isCurrent()) setBusy(false);
        }
      })();

      return;
    }

    void (async () => {
      try {
        if (dirtyRef.current) {
          const saved = await saveDraft();
          if (!isCurrent()) return;
          if (!saved) {
            const current = draftRef.current;
            if (current) {
              navigate(flowSelection(current.id, stepIndex), { replace: true });
            }
            return;
          }
        }
        const flowsPromise = api.listFlows();
        const foldersPromise = api.listFolders();
        const nextFlows = await flowsPromise;
        if (!isCurrent()) return;
        setFlows(nextFlows);
        const summary =
          nextFlows.find((candidate) => candidate.id === requestedFlowId) ??
          nextFlows[0];
        const flowPromise = summary
          ? api.readFlow(summary.id)
          : Promise.resolve(null);
        // Las carpetas aplican por su cuenta: una consulta lenta de
        // carpetas nunca retrasa el detalle del flow seleccionado.
        void foldersPromise
          .then((nextFolders) => {
            if (isCurrent()) setFolders(nextFolders);
          })
          .catch(() => undefined);
        const nextFlow = await flowPromise;
        if (!isCurrent()) return;
        if (!summary || !nextFlow) {
          replaceFlow(null);
          setStepIndex(0);
          dirtyRef.current = false;
          setDirty(false);
          return;
        }
        const nextStep = safeStepIndex(nextFlow, step);
        replaceFlow(nextFlow);
        dirtyRef.current = false;
        setDirty(false);
        setStepIndex(nextStep);
        if (requestedFlowId !== summary.id || nextStep !== step) {
          navigate(flowSelection(summary.id, nextStep), { replace: true });
        }
      } catch (exception) {
        if (!isCurrent()) return;
        setError(
          exception instanceof Error
            ? exception.message
            : "No pudimos cargar los flows.",
        );
      } finally {
        if (isCurrent()) setBusy(false);
      }
    })();
  }, [
    active,
    api,
    scopeKey,
    location.search,
    navigate,
    replaceFlow,
    saveDraft,
    scopeState.scope,
    stepIndex,
    view,
  ]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      active,
      view,
      flows,
      folders,
      flow,
      stepIndex,
      dirty,
      busy,
      error,
      api,
      scope: scopeState.scope,
      scopeLabel: scopeState.label,
      scopeReady: scopeState.ready,
      canOverrideScope: scopeState.canOverride,
      scopeOptions: scopeState.options,
      isPlatformAdmin: scopeState.isPlatformAdmin,
      applyScopeOverride: scopeState.applyOverride,
      selectFlow,
      reloadFlow,
      openSecrets,
      saveDraft,
      updateDraft,
      discardDraft,
      clearSelection,
      refreshNavigation,
    }),
    [
      active,
      view,
      api,
      busy,
      error,
      flow,
      flows,
      folders,
      refreshNavigation,
      saveDraft,
      selectFlow,
      reloadFlow,
      openSecrets,
      stepIndex,
      dirty,
      updateDraft,
      discardDraft,
      clearSelection,
      scopeState.scope,
      scopeState.label,
      scopeState.ready,
      scopeState.canOverride,
      scopeState.options,
      scopeState.isPlatformAdmin,
      scopeState.applyOverride,
    ],
  );

  return (
    <SaviaRequestWorkspaceContext.Provider value={value}>
      {children}
    </SaviaRequestWorkspaceContext.Provider>
  );
}

export function useSaviaRequestWorkspace() {
  const value = useContext(SaviaRequestWorkspaceContext);
  if (!value) {
    throw new Error(
      "SaviaRequestProvider is required to use the Savia Request workspace.",
    );
  }
  return value;
}
