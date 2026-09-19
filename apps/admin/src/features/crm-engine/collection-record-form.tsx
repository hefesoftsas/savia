import { isDatabaseKind } from "@savia/crm-shared/database-sources";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CrmRecord } from "@savia/crm-shared/metadata";
import type {
  RelationDefinition,
  RecordRelationGroup,
} from "@savia/crm-shared/relations";
import DynamicForm, { type DynamicFormProps } from "./dynamic-form";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import type { RelatedRecordChanges } from "@savia/crm-shared/related-records";
import { relatedRows } from "./related-record-editor";
import { createRelatedRecordDraft } from "./related-record-drafts";
import { Button } from "@/components/ui/button";

type Selections = Record<string, string[]>;
type DraftSnapshot = {
  values: Record<string, unknown>;
  previous?: CrmRecord;
  previousIds: Selections;
  idempotencyKey: string;
};
const enc = encodeURIComponent;

export default function CollectionRecordForm(props: DynamicFormProps) {
  const runtime = getCrmRuntime();
  if (isDatabaseKind(props.object.config.studio?.collection?.kind))
    return <DatabaseRecordForm {...props} />;
  if (!/^\/v1\/(data-domains|dynamic-crm)\//.test(runtime.apiBasePath ?? ""))
    return <DynamicForm {...props} />;
  return (
    <ManualRelationsForm
      key={`${runtime.localWorkspace?.scope ?? ""}:${runtime.apiBasePath}:${props.object.name}:${props.values?.id ?? "new"}`}
      {...props}
    />
  );
}

function DatabaseRecordForm(props: DynamicFormProps) {
  const binding = props.object.config.studio!.collection!;
  const metadata = binding.databaseMetadata;
  const editing = Boolean(props.values?.id);
  const values = Object.fromEntries(
    Object.entries(props.values ?? {}).map(([name, value]) => [
      name,
      metadata?.fields.find((f) => f.name === name)?.valueType === "json" &&
      value != null
        ? JSON.stringify(value)
        : value,
    ]),
  );
  const optionalBoolean = (name: string) =>
    !editing &&
    metadata?.fields.some(
      (f) =>
        f.name === name &&
        f.valueType === "boolean" &&
        (f.nullable || f.hasDefault),
    );
  const object = {
    ...props.object,
    config: {
      ...props.object.config,
      fields: Object.fromEntries(
        Object.entries(props.object.config.fields).map(([name, field]) => [
          name,
          {
            ...field,
            ...(optionalBoolean(name)
              ? {
                  type: "Dropdown",
                  defaultValue: "",
                  options: [
                    { value: "true", label: "Sí" },
                    { value: "false", label: "No" },
                  ],
                  description:
                    "Deja sin seleccionar para usar el valor predeterminado de la base de datos.",
                }
              : {}),
            readOnly: field.readOnly || (editing && name === binding.idColumn),
          },
        ]),
      ),
    },
  };
  return (
    <DynamicForm
      {...props}
      object={object}
      values={values}
      onSave={async (data, previous) => {
        const filtered = Object.fromEntries(
          Object.entries(data).filter(([name, value]) => {
            const native = metadata?.fields.find((f) => f.name === name);
            if (
              !object.config.fields[name] ||
              object.config.fields[name].readOnly ||
              native?.generated ||
              (native && !native.writable)
            )
              return false;
            if (editing) {
              const original = values[name] ?? "";
              return JSON.stringify(value ?? "") !== JSON.stringify(original);
            }
            if (optionalBoolean(name) && value == null) return false;
            return (
              value !== undefined &&
              !(
                value === "" &&
                (!native || native.nullable || native.hasDefault)
              )
            );
          }),
        );
        if (editing && !Object.keys(filtered).length) return;
        return props.onSave(
          Object.fromEntries(
            Object.entries(filtered).map(([name, value]) => [
              name,
              optionalBoolean(name) && (value === "true" || value === "false")
                ? value === "true"
                : value,
            ]),
          ),
          previous,
        );
      }}
    />
  );
}

function ManualRelationsForm(props: DynamicFormProps) {
  const runtime = getCrmRuntime();
  const client = useQueryClient();
  const object = props.object.name;
  const recordId = String(props.values?.id ?? "");
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>(
    {},
  );
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [formGeneration, setFormGeneration] = useState(0);
  const draft = useRef<
    ReturnType<typeof createRelatedRecordDraft<DraftSnapshot>> | undefined
  >(undefined);
  const snapshot = useRef<DraftSnapshot | undefined>(undefined);
  const fresh = useRef<DraftSnapshot | undefined>(undefined);
  const confirmed = useRef(false);
  const initializedRef = useRef(false);
  useEffect(
    () => () => {
      void draft.current?.close();
    },
    [],
  );
  const persisted = useRef<Selections>({});
  const savedRecord = useRef<CrmRecord | undefined>(undefined);
  const definitions = useQuery({
    queryKey: ["collection-relations", runtime.apiBasePath, runtime.domainId],
    queryFn: () => api<{ data: RelationDefinition[] }>("/collection-relations"),
  });
  const bindings = useMemo(
    () =>
      Object.entries(props.object.config.fields).flatMap(
        ([field, definition]) => {
          const relation = definitions.data?.data.find(
            (r) =>
              r.id === definition.config?.collectionRelation &&
              r.storage === "local" &&
              (r.sourceObject === object || r.targetObject === object),
          );
          if (!relation) return [];
          const outgoing = relation.sourceObject === object;
          return [
            {
              field,
              relation,
              other: outgoing ? relation.targetObject : relation.sourceObject,
              multiple:
                relation.cardinality === "many-to-many" ||
                (outgoing && relation.cardinality === "one-to-many"),
              displayField: outgoing
                ? relation.targetDisplayField
                : relation.sourceDisplayField,
            },
          ];
        },
      ),
    [props.object, definitions.data, object],
  );
  const relations = bindings.map((binding) => binding.relation);
  const bundled = bindings.some((binding) =>
    ["subform", "table"].includes(
      String(
        props.object.config.fields[binding.field].config?.relationPresentation,
      ),
    ),
  );
  const formObject = useMemo(
    () => ({
      ...props.object,
      config: {
        ...props.object.config,
        fields: Object.fromEntries(
          Object.entries(props.object.config.fields).map(
            ([field, definition]) => {
              const binding = bindings.find(
                (binding) => binding.field === field,
              );
              return [
                field,
                binding
                  ? {
                      ...definition,
                      type: "Textbox",
                      config: {
                        ...definition.config,
                        multiple: binding.multiple,
                        collectionRelationTarget: binding.other,
                        relationDisplayField: binding.displayField,
                      },
                    }
                  : definition,
              ];
            },
          ),
        ),
      },
    }),
    [props.object, bindings],
  );
  const existing = useQuery({
    queryKey: ["record-link-form", runtime.apiBasePath, object, recordId],
    enabled: !!recordId && definitions.isSuccess && relations.length > 0,
    queryFn: async () => {
      const result: Selections = {};
      for (let page = 1; ; page++) {
        const response = await api<{ data: RecordRelationGroup[] }>(
          `/record-links/${enc(object)}/${enc(recordId)}?page=${page}&perPage=100`,
        );
        const groups = response.data.filter(
          (group) => group.definition.storage === "local",
        );
        if (
          bundled &&
          groups.some(
            (group) =>
              bindings.some(
                (binding) => binding.relation.id === group.definition.id,
              ) && group.total > 100,
          )
        )
          throw new Error(
            "Esta relación supera el límite de 100 registros. Edita sus vínculos desde la colección.",
          );
        if (page > 100)
          throw new Error(
            "No se pudieron cargar todos los vínculos. Reintenta antes de guardar.",
          );
        for (const group of groups)
          result[group.definition.id] = [
            ...(result[group.definition.id] ?? []),
            ...group.records.map((record) => record.id),
          ];
        if (!groups.some((group) => group.total > page * 100)) break;
      }
      return result;
    },
  });
  const ready =
    definitions.isSuccess &&
    (!recordId || !relations.length || existing.isSuccess);
  useEffect(() => {
    if (!definitions.isSuccess || initializedRef.current) return;
    let cancelled = false;
    const initial = recordId ? (existing.data ?? {}) : {};
    const values = {
      ...props.values,
      ...Object.fromEntries(
        bindings.map((binding) => [
          binding.field,
          ["subform", "table"].includes(
            String(
              props.object.config.fields[binding.field].config
                ?.relationPresentation,
            ),
          )
            ? (initial[binding.relation.id] ?? []).map((id) => ({ id }))
            : binding.multiple
              ? (initial[binding.relation.id] ?? [])
              : (initial[binding.relation.id]?.[0] ?? ""),
        ]),
      ),
    };
    const baseline: DraftSnapshot = {
      values,
      previous: recordId ? (props.values as CrmRecord) : undefined,
      previousIds: initial,
      idempotencyKey: crypto.randomUUID(),
    };
    fresh.current = baseline;
    let handle:
      ReturnType<typeof createRelatedRecordDraft<DraftSnapshot>> | undefined;
    if (bundled && runtime.localWorkspace?.scope && !props.ephemeralDraft) {
      try {
        handle = createRelatedRecordDraft<DraftSnapshot>(
          {
            workspaceScope: runtime.localWorkspace.scope,
            object,
            recordId: recordId || undefined,
          },
          setWarning,
        );
      } catch {
        setWarning(
          "No se pudo abrir el borrador local. Mantén el formulario abierto para conservar los cambios.",
        );
      }
    }
    draft.current = handle;
    void (async () => {
      const stored = await handle?.read();
      if (cancelled || (!stored && !ready)) return;
      const next = stored?.value ?? baseline;
      snapshot.current = next;
      persisted.current = next.previousIds;
      setInitialValues(next.values);
      setRestored(!!stored);
      initializedRef.current = true;
      setInitialized(true);
    })();
    return () => {
      cancelled = true;
      if (!initializedRef.current) void handle?.close();
    };
    // Capture the baseline once on readiness. Refetches must not rebase staged versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, definitions.isSuccess]);
  function observeValues(values: Record<string, unknown>) {
    props.onValuesChange?.(values);
    if (!bundled || !snapshot.current || confirmed.current) return;
    if (JSON.stringify(snapshot.current.values) === JSON.stringify(values))
      return;
    setDirty(true);
    snapshot.current = { ...snapshot.current, values };
    draft.current?.schedule(snapshot.current);
  }
  async function discardDraft() {
    setBusy(true);
    try {
      let next = { ...fresh.current!, idempotencyKey: crypto.randomUUID() };
      if (recordId) {
        await runtime.localWorkspace?.syncNow();
        const response = await api<{ data: CrmRecord }>(
          `/records/${enc(object)}/${enc(recordId)}`,
        );
        const links = await existing.refetch();
        if (links.error) throw links.error;
        if (!response.data?.id)
          throw new Error("No se pudo recargar el registro.");
        const previousIds = links.data ?? {};
        next = {
          ...next,
          previous: response.data,
          previousIds,
          values: {
            ...response.data,
            ...Object.fromEntries(
              bindings.map((binding) => [
                binding.field,
                ["subform", "table"].includes(
                  String(
                    props.object.config.fields[binding.field].config
                      ?.relationPresentation,
                  ),
                )
                  ? (previousIds[binding.relation.id] ?? []).map((id) => ({
                      id,
                    }))
                  : binding.multiple
                    ? (previousIds[binding.relation.id] ?? [])
                    : (previousIds[binding.relation.id]?.[0] ?? ""),
              ]),
            ),
          },
        };
      }
      await draft.current?.clear();
      fresh.current = next;
      snapshot.current = next;
      persisted.current = next.previousIds;
      confirmed.current = false;
      setInitialValues(next.values);
      setRestored(false);
      setDirty(false);
      setWarning("");
      setFormGeneration((value) => value + 1);
    } catch (error) {
      setWarning(
        error instanceof Error
          ? error.message
          : "No se pudo recargar el registro. Se conserva el borrador.",
      );
    } finally {
      setBusy(false);
    }
  }
  const error = definitions.error ?? existing.error;
  async function save(data: Record<string, unknown>, previous?: CrmRecord) {
    if (!initialized)
      throw new Error(
        "Espera a que se carguen las relaciones antes de guardar.",
      );
    setBusy(true);
    try {
      if (bundled) {
        const current = snapshot.current!;
        const completeValues = { ...current.values, ...data };
        const groups: RelatedRecordChanges[] = bindings.map((binding) => ({
          relationId: binding.relation.id,
          previousIds: persisted.current[binding.relation.id] ?? [],
          rows: relatedRows(completeValues[binding.field]),
        }));
        if (
          groups.length > 10 ||
          groups.reduce((count, group) => count + group.rows.length, 0) > 100
        )
          throw new Error(
            "El formulario admite hasta 10 relaciones y 100 registros relacionados en total.",
          );
        const parent = Object.fromEntries(
          Object.entries(completeValues).filter(
            ([name]) =>
              name in props.object.config.fields &&
              !props.object.config.fields[name].readOnly &&
              !bindings.some((binding) => binding.field === name),
          ),
        );
        current.values = completeValues;
        draft.current?.schedule(current);
        await draft.current?.flush();
        const saved = await props.onSave(parent, current.previous, groups, {
          idempotencyKey: current.idempotencyKey,
        });
        if (!saved)
          throw new Error(
            "No se recibió confirmación del guardado. El borrador se conserva para reintentar.",
          );
        confirmed.current = true;
        await draft.current?.clear();
        setRestored(false);
        await client.invalidateQueries({ queryKey: ["record-links"] });
        await client.invalidateQueries({ queryKey: ["record-link-form"] });
        return saved;
      }
      const saved = await props.onSave(data, savedRecord.current ?? previous);
      if (saved) savedRecord.current = saved;
      for (const relation of relations) {
        const binding = bindings.find(
          (binding) => binding.relation.id === relation.id,
        )!;
        const value = data[binding.field];
        const wanted = (
          Array.isArray(value) ? value : value ? [value] : []
        ).map(String);
        const current = persisted.current[relation.id] ?? [];
        if (!saved) {
          if (wanted.length || current.length)
            throw new Error(
              "No se recibió el identificador del registro para guardar sus relaciones.",
            );
          continue;
        }
        const path = `/record-links/${enc(object)}/${enc(saved.id)}/${enc(relation.id)}`;
        // Remove before adding so replacing the single side respects cardinality.
        for (const id of current.filter((id) => !wanted.includes(id))) {
          await api(path, "DELETE", { targetId: id });
          persisted.current = {
            ...persisted.current,
            [relation.id]: (persisted.current[relation.id] ?? []).filter(
              (value) => value !== id,
            ),
          };
        }
        for (const id of wanted.filter((id) => !current.includes(id))) {
          await api(path, "POST", { targetId: id });
          persisted.current = {
            ...persisted.current,
            [relation.id]: [...(persisted.current[relation.id] ?? []), id],
          };
        }
      }
      await client.invalidateQueries({ queryKey: ["record-links"] });
      await client.invalidateQueries({ queryKey: ["record-link-form"] });
      return saved;
    } catch (error) {
      if (savedRecord.current)
        throw new Error(
          `El registro está guardado, pero falta completar la operación. ${error instanceof Error ? error.message : "No se pudieron guardar las relaciones."} Puedes reintentar sin crear otro registro.`,
        );
      throw error;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {!initialized && !error && <p role="status">Cargando relaciones…</p>}
      {error && (
        <p role="alert">
          {error.message}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void definitions.refetch();
              if (recordId) void existing.refetch();
            }}
          >
            Reintentar
          </Button>
        </p>
      )}
      {warning && <p role="alert">{warning}</p>}
      {initialized && bundled && (restored || dirty) && (
        <div className="flex items-center gap-3">
          {restored && (
            <p role="status">
              Borrador recuperado. Se conservan las versiones originales.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void discardDraft()}
          >
            Descartar borrador y recargar
          </Button>
        </div>
      )}
      <fieldset disabled={!initialized || busy} className="min-w-0">
        {initialized && (
          <DynamicForm
            key={formGeneration}
            {...props}
            object={formObject}
            values={initialValues}
            onSave={save}
            onValuesChange={observeValues}
          />
        )}
      </fieldset>
    </div>
  );
}
