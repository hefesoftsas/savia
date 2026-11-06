import type {
  SaviaCollectionEvent,
  SaviaCollectionOperation,
  SaviaCollectionSchema,
} from "@savia/studio-shared/savia-flows";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { makeOrgRequest } from "@/services/utils";
import {
  notifySaviaSubscriptionChange,
  onSaviaSubscriptionChange,
} from "@/services/savia-collections";
import type { BaseWidgetProps } from "../widget";
import { coerceSaviaFieldValue, saviaFieldControl } from "./savia-field-inputs";

const OPERATIONS: SaviaCollectionOperation[] = [
  "created",
  "updated",
  "deleted",
  "restored",
];
interface CatalogResponse {
  collections: SaviaCollectionSchema[];
}
interface Subscription {
  enabled: boolean;
  batches?: { pending: number; failed: number };
  config: null | {
    collection: string;
    operations: SaviaCollectionOperation[];
    watchedFields?: string[];
    conditions?: Array<{
      field: string;
      source: "before" | "after";
      equals: unknown;
    }>;
    ignoreOwnChanges: true;
    batchWindowSeconds?: 0 | 60;
  };
}

export function SaviaCollectionTriggerWidget({
  disabled = false,
  surface = "inspector",
}: BaseWidgetProps) {
  const { organization } = useAuth();
  const { id: workflowId } = useParams<{ id: string }>();
  const [collections, setCollections] = useState<SaviaCollectionSchema[]>([]);
  const [config, setConfig] = useState<Subscription["config"]>(null);
  const [enabled, setEnabled] = useState(false);
  const [batches, setBatches] = useState({ pending: 0, failed: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isManager = ["owner", "admin"].includes(organization?.role ?? "");

  useEffect(() => {
    if (!organization?.id || !workflowId) return;
    let active = true;
    const refresh = () => {
      void Promise.all([
        makeOrgRequest<CatalogResponse>(organization.id, "/savia/collections"),
        makeOrgRequest<Subscription>(
          organization.id,
          "/workflows",
          `/${workflowId}/savia-trigger`,
        ),
      ])
        .then(([catalog, subscription]) => {
          if (!active) return;
          setCollections(
            (catalog.collections ?? []).filter(
              (collection) => collection.capabilities.read,
            ),
          );
          setConfig(
            subscription.config ?? {
              collection: "",
              operations: ["created"],
              ignoreOwnChanges: true,
            },
          );
          setEnabled(subscription.enabled);
          setBatches(subscription.batches ?? { pending: 0, failed: 0 });
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Collection trigger configuration unavailable",
            );
        });
    };
    refresh();
    const unsubscribe = onSaviaSubscriptionChange(workflowId, refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [organization?.id, workflowId]);

  const selected = collections.find(
    (collection) => collection.name === config?.collection,
  );
  const update = (next: NonNullable<Subscription["config"]>) =>
    setConfig({ ...next, ignoreOwnChanges: true });
  const save = async () => {
    if (!organization?.id || !workflowId || !config) return;
    setBusy(true);
    setError("");
    try {
      const result = await makeOrgRequest<Subscription>(
        organization.id,
        "/workflows",
        `/${workflowId}/savia-trigger`,
        {
          method: "PUT",
          body: JSON.stringify(config),
        },
      );
      setEnabled(result.enabled);
      notifySaviaSubscriptionChange(workflowId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not enable collection trigger",
      );
    } finally {
      setBusy(false);
    }
  };
  const retryBatches = async () => {
    if (!organization?.id || !workflowId) return;
    setBusy(true);
    setError("");
    try {
      await makeOrgRequest(
        organization.id,
        "/workflows",
        `/${workflowId}/savia-trigger/batches/retry`,
        { method: "POST" },
      );
      notifySaviaSubscriptionChange(workflowId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not retry collection batches",
      );
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (!organization?.id || !workflowId) return;
    setBusy(true);
    setError("");
    try {
      await makeOrgRequest(
        organization.id,
        "/workflows",
        `/${workflowId}/savia-trigger`,
        { method: "DELETE" },
      );
      setEnabled(false);
      notifySaviaSubscriptionChange(workflowId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not disable collection trigger",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!config)
    return (
      <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
        {error || "Loading collection trigger configuration…"}
      </div>
    );
  if (surface === "canvas")
    return (
      <div className="space-y-1 p-3 text-xs">
        <p className="font-medium">
          {selected?.label || "Choose a collection"}
        </p>
        <p className="capitalize text-muted-foreground">
          {config.operations.join(" · ")}
        </p>
        <p className={enabled ? "text-primary" : "text-muted-foreground"}>
          {enabled ? "Subscription enabled" : "Subscription disabled"}
        </p>
        <p className="text-muted-foreground">Select this node to configure.</p>
      </div>
    );
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Collection trigger</p>
          <p className="text-xs text-muted-foreground">
            Subscription is {enabled ? "enabled" : "disabled"}
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs ${enabled ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
        >
          {enabled ? "Enabled" : "Not enabled"}
        </span>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Local collection</span>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2"
          value={config.collection}
          disabled={disabled || busy}
          onChange={(event) =>
            update({
              ...config,
              collection: event.target.value,
              watchedFields: [],
              conditions: [],
            })
          }
        >
          <option value="">Choose a collection</option>
          {collections.map((collection) => (
            <option key={collection.name} value={collection.name}>
              {collection.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Run on</legend>
        <div className="grid grid-cols-2 gap-2">
          {OPERATIONS.map((operation) => (
            <label
              key={operation}
              className="flex items-center gap-2 text-sm capitalize"
            >
              <input
                type="checkbox"
                checked={config.operations.includes(operation)}
                disabled={disabled || busy}
                onChange={(event) =>
                  update({
                    ...config,
                    operations: event.target.checked
                      ? [...new Set([...config.operations, operation])]
                      : config.operations.filter((item) => item !== operation),
                  })
                }
              />
              {operation}
            </label>
          ))}
        </div>
      </fieldset>
      {selected && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Watch changed fields</legend>
          <p className="text-xs text-muted-foreground">
            Leave all unchecked to run for every field change.
          </p>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {selected.fields.map((field) => (
              <label
                key={field.name}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={config.watchedFields?.includes(field.name) ?? false}
                  disabled={disabled || busy}
                  onChange={(event) => {
                    const fields = new Set(config.watchedFields ?? []);
                    if (event.target.checked) fields.add(field.name);
                    else fields.delete(field.name);
                    update({ ...config, watchedFields: [...fields] });
                  }}
                />
                {field.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {selected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Equality conditions</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy || selected.fields.length === 0}
              onClick={() =>
                update({
                  ...config,
                  conditions: [
                    ...(config.conditions ?? []),
                    {
                      field: selected.fields[0].name,
                      source: "after",
                      equals: "",
                    },
                  ],
                })
              }
            >
              Add condition
            </Button>
          </div>
          {(config.conditions ?? []).map((condition, index) => {
            const field =
              selected.fields.find((item) => item.name === condition.field) ??
              selected.fields[0];
            return (
              <div
                key={`${index}-${condition.field}`}
                className="grid grid-cols-2 items-end gap-2"
              >
                <label className="min-w-0 space-y-1 text-xs">
                  <span>Field</span>
                  <select
                    aria-label={`Condition ${index + 1} field`}
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2"
                    value={condition.field}
                    disabled={disabled || busy || selected.fields.length === 0}
                    onChange={(event) =>
                      replaceCondition(
                        config,
                        index,
                        { ...condition, field: event.target.value, equals: "" },
                        update,
                      )
                    }
                  >
                    {selected.fields.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span>Value source</span>
                  <select
                    aria-label={`Condition ${index + 1} source`}
                    className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={condition.source}
                    disabled={disabled || busy}
                    onChange={(event) =>
                      replaceCondition(
                        config,
                        index,
                        {
                          ...condition,
                          source: event.target.value as "before" | "after",
                        },
                        update,
                      )
                    }
                  >
                    <option value="after">After</option>
                    <option value="before">Before</option>
                  </select>
                </label>
                {field && (
                  <ConditionValueEditor
                    field={field}
                    index={index}
                    value={condition.equals}
                    disabled={disabled || busy}
                    onChange={(equals) =>
                      replaceCondition(
                        config,
                        index,
                        { ...condition, equals },
                        update,
                      )
                    }
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove condition ${index + 1}`}
                  disabled={disabled || busy}
                  onClick={() =>
                    update({
                      ...config,
                      conditions: (config.conditions ?? []).filter(
                        (_, entry) => entry !== index,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <label className="block space-y-1 text-xs">
        <span>Delivery mode</span>
        <select
          aria-label="Collection event delivery mode"
          className="h-9 w-full rounded-md border border-input bg-background px-2"
          value={config.batchWindowSeconds ?? 0}
          disabled={disabled || busy || !isManager}
          onChange={(event) =>
            update({
              ...config,
              batchWindowSeconds: Number(event.target.value) as 0 | 60,
            })
          }
        >
          <option value="0">Run once per matching change</option>
          <option value="60">Group changes for one minute</option>
        </select>
        <span className="block text-muted-foreground">
          Grouping sends up to 50 matching changes to the trigger's events
          output per run. Use that array to process every record; event contains
          the first change.
        </span>
      </label>
      {batches.pending > 0 ? (
        <p className="text-xs text-muted-foreground">
          {batches.pending} collection batches waiting to run.
        </p>
      ) : null}
      {batches.failed > 0 ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-border p-3 text-xs"
        >
          <p>
            {batches.failed} collection batches stopped after repeated failures.
            Review the workflow before retrying.
          </p>
          {isManager ? (
            <Button
              size="sm"
              variant="outline"
              disabled={
                disabled || busy || !enabled || config.batchWindowSeconds !== 60
              }
              onClick={retryBatches}
            >
              Retry stopped batches
            </Button>
          ) : null}
        </div>
      ) : null}
      {!isManager && (
        <p className="text-xs text-muted-foreground">
          An organization manager must enable this subscription.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={
            disabled ||
            busy ||
            !isManager ||
            !config.collection ||
            config.operations.length === 0
          }
          onClick={save}
        >
          {busy
            ? "Saving…"
            : enabled
              ? "Save and keep enabled"
              : "Save and enable"}
        </Button>
        {enabled && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || busy || !isManager}
            onClick={disable}
          >
            Disable
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The current workflow graph and configuring user access are checked again
        for every event. Disabling stops new admissions; runs admitted before
        disable may still finish.
      </p>
    </div>
  );
}

function ConditionValueEditor({
  field,
  index,
  value,
  disabled,
  onChange,
}: {
  field: SaviaCollectionSchema["fields"][number];
  index: number;
  value: unknown;
  disabled: boolean;
  onChange(value: unknown): void;
}) {
  const control = saviaFieldControl(field);
  const label = `Condition ${index + 1} value for ${field.label}`;
  if (control.kind === "boolean")
    return (
      <label className="flex h-9 items-center gap-2 text-xs">
        <span>Equals</span>
        <input
          aria-label={label}
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  if (control.kind === "select")
    return (
      <label className="min-w-0 space-y-1 text-xs">
        <span>Equals</span>
        <select
          aria-label={label}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2"
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
  return (
    <label className="min-w-0 space-y-1 text-xs">
      <span>Equals</span>
      <Input
        aria-label={label}
        type={
          control.kind === "number"
            ? "number"
            : control.kind === "date"
              ? "date"
              : "text"
        }
        value={value === null || value === undefined ? "" : String(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(coerceSaviaFieldValue(field, event.target.value))
        }
      />
    </label>
  );
}

function replaceCondition(
  config: NonNullable<Subscription["config"]>,
  index: number,
  value: NonNullable<Subscription["config"]>["conditions"] extends
    (infer T)[] | undefined
    ? T
    : never,
  update: (config: NonNullable<Subscription["config"]>) => void,
) {
  update({
    ...config,
    conditions: (config.conditions ?? []).map((condition, entry) =>
      entry === index ? value : condition,
    ),
  });
}

export function saviaCollectionTriggerConfig(nodeId: string) {
  return { nodeId };
}
export type SaviaCollectionTriggerEvent = SaviaCollectionEvent;
