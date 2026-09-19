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
import { Button } from "@/components/ui/button";

type Selections = Record<string, string[]>;
const enc = encodeURIComponent;

export default function CollectionRecordForm(props: DynamicFormProps) {
  const runtime = getCrmRuntime();
  if (isDatabaseKind(props.object.config.studio?.collection?.kind))
    return <DatabaseRecordForm {...props} />;
  if (!runtime.apiBasePath?.startsWith("/v1/data-domains/"))
    return <DynamicForm {...props} />;
  return (
    <ManualRelationsForm
      key={`${runtime.apiBasePath}:${props.object.name}:${props.values?.id ?? "new"}`}
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
  const [initialValues, setInitialValues] = useState<Record<string,unknown>>({});
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const persisted = useRef<Selections>({});
  const savedRecord = useRef<CrmRecord | undefined>(undefined);
  const definitions = useQuery({
    queryKey: ["collection-relations", runtime.apiBasePath, runtime.domainId],
    queryFn: () => api<{data: RelationDefinition[]}>("/collection-relations"),
  });
  const bindings = useMemo(() => Object.entries(props.object.config.fields).flatMap(([field, definition]) => {
    const relation = definitions.data?.data.find(r => r.id === definition.config?.collectionRelation && r.storage === "local" && (r.sourceObject === object || r.targetObject === object));
    if (!relation) return [];
    const outgoing = relation.sourceObject === object;
    return [{field, relation, other:outgoing ? relation.targetObject : relation.sourceObject, multiple:relation.cardinality === "many-to-many" || (outgoing && relation.cardinality === "one-to-many"), displayField:outgoing ? relation.targetDisplayField : relation.sourceDisplayField}];
  }), [props.object, definitions.data, object]);
  const relations = bindings.map(binding=>binding.relation);
  const formObject = useMemo(() => ({...props.object,config:{...props.object.config,fields:Object.fromEntries(Object.entries(props.object.config.fields).map(([field,definition])=>{
    const binding=bindings.find(binding=>binding.field===field);
    return [field,binding ? {...definition,type:"Textbox",config:{...definition.config,multiple:binding.multiple,collectionRelationTarget:binding.other,relationDisplayField:binding.displayField}} : definition];
  }))}}),[props.object,bindings]);
  const existing = useQuery({
    queryKey: ["record-link-form", runtime.apiBasePath, object, recordId],
    enabled: !!recordId && definitions.isSuccess && relations.length > 0,
    queryFn: async () => {
      const result: Selections = {};
      for (let page = 1; ; page++) {
        const response = await api<{data: RecordRelationGroup[]}>(`/record-links/${enc(object)}/${enc(recordId)}?page=${page}&perPage=100`);
        const groups = response.data.filter(group => group.definition.storage === "local");
        for (const group of groups) result[group.definition.id] = [...(result[group.definition.id] ?? []), ...group.records.map(record => record.id)];
        if (!groups.some(group => group.total > page * 100)) break;
      }
      return result;
    },
  });
  const ready = definitions.isSuccess && (!recordId || !relations.length || existing.isSuccess);
  useEffect(() => {
    if (!ready || initialized) return;
    const initial = recordId ? existing.data ?? {} : {};
    persisted.current = initial;
    setInitialValues({...props.values,...Object.fromEntries(bindings.map(binding => [binding.field,binding.multiple ? initial[binding.relation.id] ?? [] : initial[binding.relation.id]?.[0] ?? ""]))});
    setInitialized(true);
  }, [ready, initialized, recordId, existing.data, props.values, bindings]);
  const error = definitions.error ?? existing.error;
  async function save(data: Record<string, unknown>, previous?: CrmRecord) {
    if (!ready || !initialized) throw new Error("Espera a que se carguen las relaciones antes de guardar.");
    setBusy(true);
    try {
      const saved = await props.onSave(data, savedRecord.current ?? previous);
      if (saved) savedRecord.current = saved;
      for (const relation of relations) {
        const binding = bindings.find(binding => binding.relation.id === relation.id)!;
        const value = data[binding.field];
        const wanted = (Array.isArray(value) ? value : value ? [value] : []).map(String);
        const current = persisted.current[relation.id] ?? [];
        if (!saved) {
          if (wanted.length || current.length) throw new Error("No se recibió el identificador del registro para guardar sus relaciones.");
          continue;
        }
        const path = `/record-links/${enc(object)}/${enc(saved.id)}/${enc(relation.id)}`;
        // Remove before adding so replacing the single side respects cardinality.
        for (const id of current.filter(id => !wanted.includes(id))) {
          await api(path, "DELETE", {targetId: id});
          persisted.current = {...persisted.current, [relation.id]: (persisted.current[relation.id] ?? []).filter(value => value !== id)};
        }
        for (const id of wanted.filter(id => !current.includes(id))) {
          await api(path, "POST", {targetId: id});
          persisted.current = {...persisted.current, [relation.id]: [...(persisted.current[relation.id] ?? []), id]};
        }
      }
      await client.invalidateQueries({queryKey:["record-links"]});
      await client.invalidateQueries({queryKey:["record-link-form"]});
      return saved;
    } catch (error) {
      if (savedRecord.current) throw new Error(`El registro está guardado, pero falta completar la operación. ${error instanceof Error ? error.message : "No se pudieron guardar las relaciones."} Puedes reintentar sin crear otro registro.`);
      throw error;
    } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    {!ready && !error && <p role="status">Cargando relaciones…</p>}
    {error && <p role="alert">{error.message} <Button type="button" variant="outline" onClick={() => { void definitions.refetch(); if (recordId) void existing.refetch(); }}>Reintentar</Button></p>}
    <fieldset disabled={!ready || !initialized || busy} className="min-w-0">
      {initialized && <DynamicForm {...props} object={formObject} values={initialValues} onSave={save} />}
    </fieldset>
  </div>;
}
