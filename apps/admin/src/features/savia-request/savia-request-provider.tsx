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
import { useSaviaRequestScope } from "./savia-request-scope";
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
  const active =
    Boolean(canAccess) &&
    !isPending &&
    scopeState.ready &&
    location.pathname.startsWith("/savia-request");
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

  const replaceFlow = useCallback((next: RequestFlow | null) => {
    draftRef.current = next;
    setFlow(next);
  }, []);

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
    scopeRef.current = scopeState.scope;
    dirtyRef.current = false;
    setDirty(false);
    replaceFlow(null);
    setFlows([]);
    setFolders([]);
    setStepIndex(0);
    setError(null);
    navigate("/savia-request", { replace: true });
  }, [navigate, replaceFlow, scopeState.scope]);

  useEffect(() => {
    if (!active) {
      replaceFlow(null);
      setFlows([]);
      setFolders([]);
      setStepIndex(0);
      setError(null);
      dirtyRef.current = false;
      setDirty(false);
      return;
    }

    let cancelled = false;
    const requestedFlowId = new URLSearchParams(location.search).get("flow");
    const step = requestedStep(location.search);
    if (requestedFlowId && requestedFlowId === draftRef.current?.id) {
      const nextStep = safeStepIndex(draftRef.current, step);
      setStepIndex(nextStep);
      if (nextStep !== step) {
        navigate(flowSelection(requestedFlowId, nextStep), { replace: true });
      }
      return;
    }
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
          if (cancelled) return;
          setFlows(nextFlows);
          setFolders(nextFolders);
        } catch (exception) {
          if (cancelled) return;
          setError(
            exception instanceof Error
              ? exception.message
              : "No pudimos cargar los flows.",
          );
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        if (dirtyRef.current) {
          const saved = await saveDraft();
          if (cancelled) return;
          if (!saved) {
            const current = draftRef.current;
            if (current) {
              navigate(flowSelection(current.id, stepIndex), { replace: true });
            }
            return;
          }
        }
        const [nextFlows, nextFolders] = await Promise.all([
          api.listFlows(),
          api.listFolders(),
        ]);
        if (cancelled) return;
        setFlows(nextFlows);
        setFolders(nextFolders);
        const summary =
          nextFlows.find((candidate) => candidate.id === requestedFlowId) ??
          nextFlows[0];
        if (!summary) {
          replaceFlow(null);
          setStepIndex(0);
          dirtyRef.current = false;
          setDirty(false);
          return;
        }
        const nextFlow = await api.readFlow(summary.id);
        if (cancelled) return;
        const nextStep = safeStepIndex(nextFlow, step);
        replaceFlow(nextFlow);
        dirtyRef.current = false;
        setDirty(false);
        setStepIndex(nextStep);
        if (requestedFlowId !== summary.id || nextStep !== step) {
          navigate(flowSelection(summary.id, nextStep), { replace: true });
        }
      } catch (exception) {
        if (cancelled) return;
        setError(
          exception instanceof Error
            ? exception.message
            : "No pudimos cargar los flows.",
        );
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    active,
    api,
    location.search,
    navigate,
    replaceFlow,
    saveDraft,
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
