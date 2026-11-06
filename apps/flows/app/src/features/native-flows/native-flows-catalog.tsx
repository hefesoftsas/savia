import { useEffect, useState } from "react";
import useSWR from "swr";
import { GitBranch, Plus, Workflow as WorkflowIcon } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  nativeWorkflowRequest,
  type NativeWorkflow,
} from "@/services/native-workflow-service";

export function filterNativeWorkflows(
  workflows: NativeWorkflow[],
  searchTerm: string,
): NativeWorkflow[] {
  const term = searchTerm.toLocaleLowerCase().trim();
  if (!term) return workflows;
  return workflows.filter((flow) =>
    `${flow.name} ${flow.definition.trigger.type}`
      .toLocaleLowerCase()
      .includes(term),
  );
}

export function NativeFlowsCatalog({
  searchTerm = "",
  onWorkflowCountChange,
}: {
  searchTerm?: string;
  onWorkflowCountChange?: (count: number) => void;
}) {
  const { organizationId } = useParams();
  const { organization } = useAuth();
  const navigate = useNavigate();
  const orgId = organizationId || organization?.id || "";
  const key = orgId ? `/savia/native/${orgId}/workflows` : null;
  const { data, error, isLoading, mutate } = useSWR(key, () =>
    nativeWorkflowRequest<{ data: NativeWorkflow[] }>(orgId, "/workflows"),
  );
  const workflows = data?.data ?? [];
  const visibleWorkflows = filterNativeWorkflows(workflows, searchTerm);
  useEffect(() => {
    onWorkflowCountChange?.(workflows.length);
  }, [onWorkflowCountChange, workflows.length]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setCreateError("");
    try {
      const result = await nativeWorkflowRequest<{ data: NativeWorkflow }>(
        orgId,
        "/workflows",
        "POST",
        {
          name: name.trim(),
          definition: {
            trigger: { type: "manual" },
            nodes: [{ id: "step_1", type: "transform", values: {} }],
          },
        },
      );
      await mutate();
      navigate(`/org/${orgId}/native-flows/${result.data.id}`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="native-catalog" aria-labelledby="native-flows-title">
      <div className="native-catalog-heading">
        <div className="native-catalog-icon" aria-hidden="true">
          <WorkflowIcon size={18} />
        </div>
        <div className="native-catalog-title">
          <h2 id="native-flows-title">Savia data workflows</h2>
          <p>Automate collection events, scheduled work, and assigned tasks.</p>
        </div>
        <Button size="sm" onClick={() => setCreating((value) => !value)}>
          <Plus size={16} /> New workflow
        </Button>
      </div>
      {creating ? (
        <div className="native-create-row">
          <Input
            aria-label="Workflow name"
            autoFocus
            placeholder="Name this workflow"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
          <Button
            disabled={!name.trim() || saving}
            onClick={() => void create()}
          >
            {saving ? "Creating…" : "Create workflow"}
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {createError ? (
        <p role="alert" className="native-inline-error">
          {createError}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading Savia workflows…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="native-inline-error">
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : null}
      {!isLoading && !error && !visibleWorkflows.length ? (
        <Card>
          <CardContent className="native-empty">
            <GitBranch size={20} />
            <span>
              {searchTerm.trim()
                ? "No Savia data workflows match this search."
                : "No Savia data workflows yet. Create one to automate collection events, scheduled work, and assigned tasks."}
            </span>
          </CardContent>
        </Card>
      ) : null}
      {visibleWorkflows.map((flow) => (
        <button
          key={flow.id}
          className="native-catalog-row"
          onClick={() => navigate(`/org/${orgId}/native-flows/${flow.id}`)}
        >
          <span className="native-catalog-row-icon">
            <GitBranch size={16} />
          </span>
          <span className="native-catalog-row-copy">
            <strong>{flow.name}</strong>
            <small>
              {flow.definition.trigger.type.replace(/_/g, " ")} · revision{" "}
              {flow.revision}
            </small>
          </span>
          <span
            className={
              flow.enabled ? "wf-badge wf-badge-ok" : "wf-badge wf-badge-muted"
            }
          >
            {flow.enabled ? "Active" : "Inactive"}
          </span>
        </button>
      ))}
    </section>
  );
}
