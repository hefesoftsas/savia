import type {
  CreateWorkflowRequest,
  WorkflowRuntime,
  WorkflowTrigger,
} from "@savia/flows-types";
import FileDown from "lucide-react/icons/file-down";
import Logs from "lucide-react/icons/logs";
import MapIcon from "lucide-react/icons/map";
import PlusCircle from "lucide-react/icons/plus-circle";
import Workflow from "lucide-react/icons/workflow";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/components/auth-context";
import { InsetError } from "@/components/inset-error";
import { InsetLoading } from "@/components/inset-loading";
import { InsetLayout } from "@/components/layouts/inset-layout";
import { useTour } from "@/components/tour";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateWorkflowDialog } from "@/components/workflow/create-workflow-dialog";
import { buildInitialTriggerNodes } from "@/components/workflow/trigger-node-mapping";
import { useOrgUrl } from "@/hooks/use-org-url";
import { usePageBreadcrumbs } from "@/hooks/use-page";
import { useDashboard } from "@/services/dashboard-service";
import { useNodeTypes } from "@/services/type-service";
import { createWorkflow, useWorkflows } from "@/services/workflow-service";

export function DashboardPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const navigate = useNavigate();
  const { setBreadcrumbs } = usePageBreadcrumbs([]);
  const { dashboardStats, dashboardStatsError, isDashboardStatsLoading } =
    useDashboard();
  const { getOrgUrl } = useOrgUrl();
  const { organization, user } = useAuth();
  const canManage = Boolean(
    user?.platformAdmin ||
    organization?.role === "admin" ||
    organization?.role === "owner",
  );
  const orgId = organization?.id || "";
  const { mutateWorkflows } = useWorkflows();
  const { nodeTypes } = useNodeTypes({ revalidateOnFocus: false });
  const { start: startTour } = useTour();

  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const handleCreateWorkflow = async (
    name: string,
    trigger: WorkflowTrigger,
    description?: string,
    runtime?: WorkflowRuntime,
  ) => {
    if (!orgId) return;

    try {
      const initialNodes = buildInitialTriggerNodes(trigger, nodeTypes || []);
      const request: CreateWorkflowRequest = {
        name,
        description,
        trigger,
        runtime,
        nodes: initialNodes,
        edges: [],
      };

      const newWorkflow = await createWorkflow(request, orgId);

      mutateWorkflows();
      navigate(getOrgUrl(`workflows/${newWorkflow.id}`));
    } catch (error) {
      console.error("Failed to create workflow:", error);
    }
  };

  if (isDashboardStatsLoading) {
    return <InsetLoading title="Dashboard" />;
  } else if (dashboardStatsError) {
    return (
      <InsetError
        title="Dashboard"
        errorMessage={dashboardStatsError?.message || "An error occurred"}
      />
    );
  }

  if (!dashboardStats) {
    return (
      <InsetLayout title="Dashboard">
        <div className="flex flex-1 items-center justify-center">
          No dashboard data available.
        </div>
      </InsetLayout>
    );
  }

  return (
    <InsetLayout title="Dashboard">
      {/* Getting Started */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            Create your first workflow or explore templates
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={startTour}>
            <MapIcon className="mr-2 size-4" />
            Take a Tour
          </Button>
          {canManage ? (
            <Button
              variant="default"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <PlusCircle className="mr-2 size-4" />
              Create Workflow
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link to={getOrgUrl("templates")}>
              <FileDown className="mr-2 size-4" />
              Browse Templates
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <Card data-tour="workflows-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xl">Workflows</CardTitle>
            <Workflow className="size-8 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{dashboardStats.workflows}</div>
            <p className="text-xs text-muted-foreground pt-1">
              Number of workflows
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs h-8"
              asChild
            >
              <Link to={getOrgUrl("workflows")}>View Workflows</Link>
            </Button>
          </CardContent>
        </Card>
        <Card data-tour="executions-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xl">Executions</CardTitle>
            <Logs className="size-8 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">
              {dashboardStats.executions.total}
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Number of executions
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs h-8"
              asChild
            >
              <Link to={getOrgUrl("executions")}>View Executions</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {canManage ? (
        <CreateWorkflowDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onCreateWorkflow={handleCreateWorkflow}
        />
      ) : null}
    </InsetLayout>
  );
}
