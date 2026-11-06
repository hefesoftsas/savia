import type {
  SaviaCollectionField,
  SaviaCollectionSchema,
} from "@savia/studio-shared/savia-flows";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { Input } from "@/components/ui/input";
import { makeOrgRequest } from "@/services/utils";
import { useWorkflow } from "../../workflow-context";
import type { WorkflowParameter } from "../../workflow-types";
import type { BaseWidgetProps } from "../widget";
import {
  parseValidSaviaJson,
  saviaFieldControl,
  updateSaviaFieldMap,
} from "./savia-field-inputs";

interface CatalogResponse {
  collections: SaviaCollectionSchema[];
}
interface CollectionInputProps extends BaseWidgetProps {
  nodeId: string;
  nodeType: string;
  inputs: WorkflowParameter[];
}

export function SaviaCollectionInput({
  nodeId,
  nodeType,
  inputs,
  disabled = false,
  surface = "inspector",
}: CollectionInputProps) {
  const { organization } = useAuth();
  const { updateNodeData, edges = [] } = useWorkflow();
  const [collections, setCollections] = useState<SaviaCollectionSchema[]>([]);
  const [error, setError] = useState("");
  const currentCollection = String(
    inputs.find((item) => item.id === "collection")?.value ?? "",
  );
  const currentData = (inputs.find((item) => item.id === "data")?.value ??
    {}) as Record<string, unknown>;
  const currentFilters = (inputs.find((item) => item.id === "filters")?.value ??
    {}) as Record<string, unknown>;

  useEffect(() => {
    if (!organization?.id) return;
    let active = true;
    makeOrgRequest<CatalogResponse>(organization.id, "/savia/collections")
      .then((response) => {
        if (active) setCollections(response.collections ?? []);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Collection catalog unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [organization?.id]);

  const selected = useMemo(
    () => collections.find((item) => item.name === currentCollection),
    [collections, currentCollection],
  );
  const canWrite =
    nodeType === "savia-create-record"
      ? selected?.capabilities.create
      : selected?.capabilities.update;
  const fields =
    selected?.fields.filter(
      (field) => nodeType === "savia-list-records" || !field.readOnly,
    ) ?? [];
  const isConnected = (inputId: string) =>
    edges.some(
      (edge) => edge.target === nodeId && edge.targetHandle === inputId,
    );

  const setInput = (name: string, value: unknown) => {
    if (!updateNodeData) return;
    updateNodeData(nodeId, (current) => ({
      inputs: current.inputs.map((input) =>
        input.id === name ? ({ ...input, value } as WorkflowParameter) : input,
      ),
    }));
  };

  const setField = (field: SaviaCollectionField, value: unknown) => {
    if (isConnected(nodeType === "savia-list-records" ? "filters" : "data"))
      return;
    const target =
      nodeType === "savia-list-records" ? currentFilters : currentData;
    const next = updateSaviaFieldMap(target, field, value);
    setInput(nodeType === "savia-list-records" ? "filters" : "data", next);
  };

  if (surface === "canvas")
    return (
      <div className="space-y-1 p-3 text-xs">
        <p className="font-medium">
          {isConnected("collection")
            ? "Collection from workflow"
            : selected?.label || currentCollection || "Choose a collection"}
        </p>
        <p className="text-muted-foreground">
          {isConnected("data") || isConnected("filters")
            ? "Values connected to workflow"
            : "Select this node to set values."}
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Local collection</span>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2"
          value={currentCollection}
          disabled={disabled || isConnected("collection")}
          onChange={(event) => {
            setInput("collection", event.target.value);
            const dependentInput =
              nodeType === "savia-list-records" ? "filters" : "data";
            if (!isConnected(dependentInput)) setInput(dependentInput, {});
          }}
        >
          <option value="">Choose a collection</option>
          {collections
            .filter((collection) => {
              const capability =
                nodeType === "savia-list-records" ||
                nodeType === "savia-read-record"
                  ? nodeType === "savia-list-records"
                    ? "list"
                    : "read"
                  : nodeType === "savia-create-record"
                    ? "create"
                    : nodeType === "savia-update-record"
                      ? "update"
                      : "delete";
              return collection.capabilities[capability];
            })
            .map((collection) => (
              <option key={collection.name} value={collection.name}>
                {collection.label}
              </option>
            ))}
        </select>
      </label>
      {selected &&
        (nodeType === "savia-create-record" ||
          nodeType === "savia-update-record" ||
          nodeType === "savia-list-records") && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {nodeType === "savia-list-records"
                ? "Optional equality filters"
                : "Set values using this collection’s fields"}
            </p>
            {fields.map((field) => (
              <SaviaFieldEditor
                key={field.name}
                field={field}
                value={
                  (nodeType === "savia-list-records"
                    ? currentFilters
                    : currentData)[field.name]
                }
                disabled={
                  disabled ||
                  isConnected(
                    nodeType === "savia-list-records" ? "filters" : "data",
                  ) ||
                  (nodeType !== "savia-list-records" && !canWrite)
                }
                onChange={(value) => setField(field, value)}
              />
            ))}
            {fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No writable fields are available for this collection.
              </p>
            )}
          </div>
        )}
      {selected && nodeType === "savia-delete-record" && (
        <p className="text-xs text-muted-foreground">
          The current record version is required. Deletions remain recoverable.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!error && collections.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Loading collections or no collections are available.
        </p>
      )}
    </div>
  );
}

function SaviaFieldEditor({
  field,
  value,
  disabled,
  onChange,
}: {
  field: SaviaCollectionField;
  value: unknown;
  disabled: boolean;
  onChange(value: unknown): void;
}) {
  const [draft, setDraft] = useState(
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [jsonError, setJsonError] = useState("");
  useEffect(() => {
    setDraft(value === undefined ? "" : JSON.stringify(value, null, 2));
  }, [value]);
  const control = saviaFieldControl(field);
  const label = (
    <span className="font-medium">
      {field.label}
      {field.required ? " *" : ""}
    </span>
  );
  if (control.kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-sm">
        {label}
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  if (control.kind === "select")
    return (
      <label className="block space-y-1 text-sm">
        {label}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (control.kind === "json")
    return (
      <label className="block space-y-1 text-sm">
        {label}
        <textarea
          aria-label={field.label}
          className="min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (!next.trim() && !field.required) {
              setJsonError("");
              onChange(undefined);
              return;
            }
            const parsed = parseValidSaviaJson(next);
            if (parsed.valid) {
              onChange(parsed.value);
              setJsonError("");
            } else setJsonError("Enter valid JSON to save this value.");
          }}
        />
        {jsonError && (
          <span role="alert" className="text-xs text-destructive">
            {jsonError}
          </span>
        )}
      </label>
    );
  return (
    <label className="block space-y-1 text-sm">
      {label}
      <Input
        type={
          control.kind === "number"
            ? "number"
            : control.kind === "date"
              ? "date"
              : "text"
        }
        value={value === null || value === undefined ? "" : String(value)}
        required={field.required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function saviaCollectionInputConfig(
  nodeId: string,
  nodeType: string,
  inputs: WorkflowParameter[],
) {
  return { nodeId, nodeType, inputs };
}
