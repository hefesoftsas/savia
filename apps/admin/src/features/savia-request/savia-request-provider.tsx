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
} from "./savia-request-api";
import type { FlowSummary, RequestFlow } from "./types";

type WorkspaceValue = {
  active: boolean;
  flows: FlowSummary[];
  folders: string[];
  flow: RequestFlow | null;
  stepIndex: number;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  api: SaviaRequestApi;
  selectFlow(id: string, stepIndex?: number): Promise<void>;
  saveDraft(): Promise<boolean>;
  updateDraft(next: RequestFlow): void;
  discardDraft(): void;
  clearSelection(): void;
  refreshNavigation(): Promise<FlowSummary[]>;
};

const SaviaRequestWorkspaceContext = createContext<WorkspaceValue | null>(null);

function requestedStep(search: string): number {
  const value = Number(new URLSearchParams(search).get("step") ?? "0");
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function flowSelection(id: string, step: number) {
  return `/savia-request?flow=${encodeURIComponent(id)}&step=${step}`;
}

function safeStepIndex(flow: RequestFlow, step: number) {
  return Math.min(Math.max(step, 0), Math.max(flow.steps.length - 1, 0));
}

export function SaviaRequestProvider({ children }: PropsWithChildren) {
  const services = useAppServices();
  const api = useMemo(
    () => createSaviaRequestApi(services.apiClient),
    [services.apiClient],
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
    location.pathname.startsWith("/savia-request");
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [flow, setFlow] = useState<RequestFlow | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<RequestFlow | null>(null);
  const dirtyRef = useRef(false);

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
        if (nextStep === stepIndex) return;
        setStepIndex(nextStep);
        navigate(flowSelection(id, nextStep));
        return;
      }
      if (!(await saveDraft())) return;
      navigate(flowSelection(id, requested));
    },
    [navigate, saveDraft, stepIndex],
  );

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
  ]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      active,
      flows,
      folders,
      flow,
      stepIndex,
      dirty,
      busy,
      error,
      api,
      selectFlow,
      saveDraft,
      updateDraft,
      discardDraft,
      clearSelection,
      refreshNavigation,
    }),
    [
      active,
      api,
      busy,
      error,
      flow,
      flows,
      folders,
      refreshNavigation,
      saveDraft,
      selectFlow,
      stepIndex,
      dirty,
      updateDraft,
      discardDraft,
      clearSelection,
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
