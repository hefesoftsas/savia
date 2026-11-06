import type {
  WorkflowRuntime,
  WorkflowTrigger,
  WorkflowWithMetadata,
} from "@savia/flows-types";
import { ReactFlowProvider } from "@xyflow/react";
import MapIcon from "lucide-react/icons/map";
import MessageCircle from "lucide-react/icons/message-circle";
import Pencil from "lucide-react/icons/pencil";
import WorkflowIcon from "lucide-react/icons/workflow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { notifySaviaSubscriptionChange } from "@/services/savia-collections";

import { useAuth } from "@/components/auth-context";
import { InsetLoading } from "@/components/inset-loading";
import {
  ActionBarButton,
  ActionBarGroup,
  actionBarButtonActiveClassName,
  actionBarButtonOutlineClassName,
} from "@/components/ui/action-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useResizableSidebar } from "@/components/workflow/use-resizable-sidebar";
import { WorkflowBuilder } from "@/components/workflow/workflow-builder";
import { WorkflowError } from "@/components/workflow/workflow-error";
import type {
  WorkflowExecution,
  WorkflowNodeExecution,
} from "@/components/workflow/workflow-types";
import { useEditableWorkflow } from "@/hooks/use-editable-workflow";
import { useOrgUrl } from "@/hooks/use-org-url";
import { usePageBreadcrumbs } from "@/hooks/use-page";
import { useExecution } from "@/services/execution-service";
import { useObjectService } from "@/services/object-service";
import { useNodeTypes } from "@/services/type-service";
import { getWorkflow, setWorkflowEnabled } from "@/services/workflow-service";

/**
 * How closely the workflow is being looked at: schematic pills, or the full
 * wiring. Deliberately its own axis — flipping who holds the pen must never
 * change the zoom, and vice versa.
 */
type WorkflowPageView = "overview" | "wiring";

/** One option of a two-way axis switch: an icon, a tooltip, a predicate. */
function AxisButton({
  active,
  tooltip,
  disabled,
  accessibleName,
  onClick,
  children,
}: {
  active: boolean;
  tooltip: string;
  disabled?: boolean;
  accessibleName?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <ActionBarButton
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? actionBarButtonActiveClassName
          : actionBarButtonOutlineClassName
      }
      tooltip={tooltip}
      accessibleName={accessibleName}
      tooltipSide="bottom"
    >
      {children}
    </ActionBarButton>
  );
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organization, user } = useAuth();
  const orgId = organization?.id || "";
  const canAuthor = Boolean(
    user?.platformAdmin ||
    organization?.role === "admin" ||
    organization?.role === "owner",
  );
  const { getOrgUrl } = useOrgUrl();

  // ── View ────────────────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();

  // The view axis lives in the URL; setting it is "set or drop a param".
  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (value) params.set(key, value);
          else params.delete(key);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // One sidebar is shared with the workflow builder.
  const panel = useResizableSidebar({ initialVisible: true });

  // Both surfaces share the view axis, so switching between overview and
  // wiring keeps the same workflow and camera.
  const view: WorkflowPageView =
    searchParams.get("view") === "overview" ? "overview" : "wiring";

  const setView = useCallback(
    (next: WorkflowPageView) =>
      setParam("view", next === "overview" ? "overview" : null),
    [setParam],
  );

  // Old links may still carry an execution id; the live path is the
  // session's own trial result below.
  const { execution: handedOffExecution } = useExecution(
    searchParams.get("executionId"),
  );

  const handedOffBuilderExecution = useMemo<
    WorkflowExecution | undefined
  >(() => {
    if (!handedOffExecution) return undefined;
    return {
      id: handedOffExecution.id,
      status: handedOffExecution.status as WorkflowExecution["status"],
      nodeExecutions: (handedOffExecution.nodeExecutions || []).map(
        (nodeExecution): WorkflowNodeExecution => ({
          nodeId: nodeExecution.nodeId,
          status: nodeExecution.status as WorkflowNodeExecution["status"],
          outputs: nodeExecution.outputs || {},
          error: nodeExecution.error,
        }),
      ),
    };
  }, [handedOffExecution]);

  const [httpWorkflowMetadata, setHttpWorkflowMetadata] =
    useState<WorkflowWithMetadata | null>(null);

  const [isEnabled, setIsEnabled] = useState(true);
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      if (!id || !orgId) return;
      setIsTogglingEnabled(true);
      try {
        await setWorkflowEnabled(id, checked, orgId);
        setIsEnabled(checked);
        notifySaviaSubscriptionChange(id);
        toast.success(checked ? "Workflow enabled" : "Workflow disabled");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update workflow",
        );
      } finally {
        setIsTogglingEnabled(false);
      }
    },
    [id, orgId],
  );

  const { nodeTypes, nodeTypesError, isNodeTypesLoading } = useNodeTypes({
    revalidateOnFocus: false,
  });

  const { createObjectUrl } = useObjectService();

  const executionCallbackRef = useRef<
    ((execution: WorkflowExecution) => void) | null
  >(null);

  // Track the latest execution for scheduled workflows
  const [latestExecution, setLatestExecution] =
    useState<WorkflowExecution | null>(null);

  const {
    nodes: initialNodesForUI,
    edges: initialEdgesForUI,
    isInitializing: isWorkflowInitializing,
    savingError: workflowSavingError,
    connectionError: workflowConnectionError,
    isWSConnected: _isWSConnected,
    workflowMetadata,
    handleNodesChange,
    handleEdgesChange,
    executeWorkflow: wsExecuteWorkflow,
    updateMetadata: wsUpdateMetadata,
  } = useEditableWorkflow({
    workflowId: id,
    readOnly: !canAuthor,
    nodeTypes: nodeTypes || [],
    onExecutionUpdate: (execution) => {
      // Try to call the callback ref (for UI-triggered executions)
      if (executionCallbackRef.current) {
        executionCallbackRef.current(execution);
      } else {
        // For scheduled workflows or other backend-triggered executions,
        // update state so WorkflowBuilder can receive it
        setLatestExecution(execution);
      }
    },
  });

  const executeWorkflowWrapper = useCallback(
    (
      _workflowId: string,
      onExecution: (execution: WorkflowExecution) => void,
      triggerData?: unknown,
    ) => {
      executionCallbackRef.current = onExecution;
      wsExecuteWorkflow?.({
        parameters: triggerData as Record<string, unknown> | undefined,
      });

      // Return a cleanup function that clears the ref
      return () => {
        executionCallbackRef.current = null;
      };
    },
    [wsExecuteWorkflow],
  );

  // Fetch workflow metadata via HTTP (for description and other metadata)
  useEffect(() => {
    const fetchWorkflowMetadata = async () => {
      if (!id || !orgId) return;
      try {
        const metadata = await getWorkflow(id, orgId);
        setHttpWorkflowMetadata(metadata);
        setIsEnabled(metadata.enabled === true);
      } catch (error) {
        console.error("Failed to fetch workflow metadata:", error);
      }
    };
    fetchWorkflowMetadata();
  }, [id, orgId]);

  usePageBreadcrumbs(
    [
      { label: "Workflows", to: getOrgUrl("workflows") },
      {
        label:
          httpWorkflowMetadata?.name || workflowMetadata?.name || "Workflow",
      },
    ],
    [httpWorkflowMetadata?.name, workflowMetadata?.name],
  );

  const handleWorkflowUpdate = useCallback(
    (
      name: string,
      description?: string,
      trigger?: WorkflowTrigger,
      runtime?: WorkflowRuntime,
    ) => {
      if (!id) return;

      // Update via WebSocket - this updates the session state and persists to D1/R2
      wsUpdateMetadata?.({
        name,
        description,
        trigger,
        runtime,
      });
    },
    [id, wsUpdateMetadata],
  );

  useEffect(() => {
    if (workflowSavingError) {
      toast.error(`Workflow saving error: ${workflowSavingError}`);
    }
  }, [workflowSavingError]);

  useEffect(() => {
    if (workflowConnectionError) {
      toast.error(`Connection error: ${workflowConnectionError}`);
    }
  }, [workflowConnectionError]);

  if (nodeTypesError) {
    return (
      <WorkflowError
        message={nodeTypesError.message || "Failed to load node types."}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const isLoading =
    isNodeTypesLoading ||
    isWorkflowInitializing ||
    !initialNodesForUI ||
    !initialEdgesForUI;

  if (isLoading) {
    return <InsetLoading />;
  }

  if (!workflowMetadata) {
    return (
      <WorkflowError
        message={`Workflow with ID "${id}" not found, or could not be loaded via WebSocket.`}
        onRetry={() => navigate(getOrgUrl("workflows"))}
      />
    );
  }

  // The disabled AI entry explains the local-edition limit. Manual editing
  // and the overview/wiring controls remain available on both surfaces.
  const axisControls = (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {canAuthor ? (
          <ActionBarGroup>
            <AxisButton
              active={false}
              disabled
              accessibleName="AI authoring unavailable"
              onClick={() => {}}
              tooltip="AI authoring is unavailable in the local edition"
            >
              <span title="AI authoring is unavailable in the local edition">
                <MessageCircle className="size-4!" />
              </span>
            </AxisButton>
            <AxisButton
              active
              onClick={() => {}}
              tooltip="Edit the workflow by hand"
            >
              <Pencil className="size-4!" />
            </AxisButton>
          </ActionBarGroup>
        ) : null}
        <ActionBarGroup>
          <AxisButton
            active={view === "overview"}
            onClick={() => setView("overview")}
            tooltip="See the workflow at a glance"
          >
            <MapIcon className="size-4!" />
          </AxisButton>
          <AxisButton
            active={view === "wiring"}
            onClick={() => setView("wiring")}
            tooltip="See the full wiring"
          >
            <WorkflowIcon className="size-4!" />
          </AxisButton>
        </ActionBarGroup>
      </div>
    </TooltipProvider>
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlowProvider>
        <div className="h-full w-full flex flex-col relative">
          <div className="h-full w-full grow">
            <WorkflowBuilder
              workflowId={id || ""}
              workflowTrigger={
                (httpWorkflowMetadata?.trigger || workflowMetadata?.trigger) as
                  WorkflowTrigger | undefined
              }
              workflowRuntime={
                httpWorkflowMetadata?.runtime || workflowMetadata?.runtime
              }
              initialNodes={initialNodesForUI}
              initialEdges={initialEdgesForUI}
              nodeTypes={nodeTypes || []}
              mode={canAuthor ? "edit" : "readonly"}
              allowExecuteReadOnly={!canAuthor}
              preferHttpExecution={!canAuthor}
              onNodesChange={canAuthor ? handleNodesChange : undefined}
              onEdgesChange={canAuthor ? handleEdgesChange : undefined}
              executeWorkflow={canAuthor ? executeWorkflowWrapper : undefined}
              initialWorkflowExecution={
                latestExecution || handedOffBuilderExecution
              }
              view={view === "overview" ? "overview" : "detail"}
              onViewChange={(next) =>
                setView(next === "overview" ? "overview" : "wiring")
              }
              topCenterSlot={axisControls}
              createObjectUrl={createObjectUrl}
              workflowName={
                httpWorkflowMetadata?.name || workflowMetadata?.name || ""
              }
              workflowDescription={httpWorkflowMetadata?.description}
              onWorkflowUpdate={handleWorkflowUpdate}
              orgId={orgId}
              wsExecuteWorkflow={canAuthor ? wsExecuteWorkflow : undefined}
              sidebar={panel}
              isEnabled={isEnabled}
              isTogglingEnabled={isTogglingEnabled}
              onToggleEnabled={handleToggleEnabled}
            />
          </div>
        </div>
      </ReactFlowProvider>
    </div>
  );
}
