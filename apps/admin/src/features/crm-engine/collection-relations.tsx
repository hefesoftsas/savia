import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  useUpdateNodeInternals,
  MarkerType,
  Position,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X } from "lucide-react";
import { api } from "./api";
import {
  boundRelationField,
  bindRelationField,
} from "./relation-field-binding";
import { getCrmRuntime } from "./runtime";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "./collection-capabilities";
import { configSchema } from "@savia/crm-shared/metadata";
import type { CrmObject } from "@savia/crm-shared/metadata";
import type {
  RelationDefinition,
  RelationCardinality,
} from "@savia/crm-shared/relations";

type Field = { key: string; label: string };
function fieldsFor(object?: CrmObject, required: string[] = []): Field[] {
  const fields = [
    { key: "id", label: "ID" },
    ...Object.entries(object?.config.fields ?? {})
      .filter(([key]) => key !== "id")
      .map(([key, field]) => ({ key, label: field.label || key })),
  ];
  for (const key of required)
    if (key && !fields.some((field) => field.key === key))
      fields.push({ key, label: key });
  return fields;
}
function CollectionNode({
  id,
  data,
}: {
  id: string;
  data: {
    label: string;
    fields: Field[];
    active: string[];
    expanded: boolean;
    toggle: () => void;
    remove: () => void;
    createField: () => void;
    canCreateField: boolean;
  };
}) {
  const t = useMessages(studioMessages);
  const expanded = data.expanded;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [
    id,
    expanded,
    data.active.join(","),
    data.fields.map((field) => field.key).join(","),
    updateNodeInternals,
  ]);
  const visible = data.fields.filter(
    (field, index) => expanded || index < 6 || data.active.includes(field.key),
  );
  return (
    <div
      style={{
        width: 250,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="truncate font-semibold text-sm" title={data.label}>
          {data.label}
        </span>
        <div className="nodrag flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label={t("Crear campo en %{v1}", { v1: data.label })}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.createField();
                  }}
                  disabled={!data.canCreateField}
                  title={
                    data.canCreateField
                      ? t("Crear campo")
                      : t("El esquema se administra en el origen")
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {data.canCreateField
                ? t("Crear campo")
                : t("El esquema se administra en el origen")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={t("Quitar %{v1} del mapa", { v1: data.label })}
                onClick={(event) => {
                  event.stopPropagation();
                  data.remove();
                }}
                title={t("Quitar del mapa")}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t("Quitar del mapa")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {!data.canCreateField && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {t("Los campos se administran en el origen.")}
        </p>
      )}
      {visible.map((field) => (
        <div
          key={field.key}
          style={{
            position: "relative",
            padding: "7px 16px",
            minHeight: 44,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            style={{ width: 12, height: 12 }}
            id={`in:${field.key}`}
            aria-label={t("Destino %{v1}.%{v2}", {
              v1: data.label,
              v2: field.key,
            })}
          />
          <div style={{ fontSize: 12 }}>{field.label}</div>
          <div style={{ fontSize: 10, opacity: 0.65 }}>{field.key}</div>
          <Handle
            type="source"
            position={Position.Right}
            style={{ width: 12, height: 12 }}
            id={`out:${field.key}`}
            aria-label={t("Origen %{v1}.%{v2}", {
              v1: data.label,
              v2: field.key,
            })}
          />
        </div>
      ))}
      {data.fields.length > 6 && (
        <button
          type="button"
          className="nodrag"
          style={{ padding: "10px 16px", fontSize: 12 }}
          onClick={(event) => {
            event.stopPropagation();
            data.toggle();
          }}
        >
          {expanded
            ? t("Mostrar menos")
            : t("Mostrar todos (%{v1})", { v1: data.fields.length })}
        </button>
      )}
    </div>
  );
}
const nodeTypes = { collection: CollectionNode };
const selectStyle =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const cardinalities = {
  "one-to-one": "Uno a uno",
  "one-to-many": "Uno a muchos",
  "many-to-many": "Muchos a muchos",
} as const;
export default function CollectionRelations({
  objects,
  onOpenCollection,
  focusObject,
}: {
  focusObject?: string;
  objects: CrmObject[];
  onOpenCollection?: (name: string) => void;
}) {
  const t = useMessages(studioMessages);
  const [savedObjects, setSavedObjects] = useState<Record<string, CrmObject>>(
    {},
  );
  objects = useMemo(
    () =>
      objects
        .map((o) =>
          savedObjects[o.name] &&
          (savedObjects[o.name].version ?? 0) > (o.version ?? 0)
            ? savedObjects[o.name]
            : o,
        )
        .filter((o) => collectionCapabilities(o).read),
    [objects, savedObjects],
  );
  const runtime = getCrmRuntime();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["collection-relations", runtime.apiBasePath, runtime.domainId],
    queryFn: () => api<{ data: RelationDefinition[] }>("/collection-relations"),
  });
  const [hiddenObjects, setHiddenObjects] = useState<string[]>([]);
  const [fieldObject, setFieldObject] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldType, setFieldType] = useState("Textbox");
  const [fieldUnique, setFieldUnique] = useState(false);
  const [addedObjects, setAddedObjects] = useState<string[]>([]);
  const [objectToAdd, setObjectToAdd] = useState("");
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [panel, setPanel] = useState<
    "relation" | "collection" | "field" | null
  >(null);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [sourceObject, setSource] = useState(focusObject ?? "");
  const [targetObject, setTarget] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [cardinality, setCardinality] =
    useState<RelationCardinality>("one-to-many");
  const [expandedNodes, setExpandedNodes] = useState<string[]>([]);
  const [editing, setEditing] = useState<RelationDefinition | null>(null);
  const defaultStorage = (names: string[]): RelationDefinition["storage"] =>
    names.some((name) => {
      const object = objects.find((o) => o.name === name);
      return object && !supportsLocalRecordTools(object);
    })
      ? "local"
      : "fields";
  const [storage, setStorage] = useState<RelationDefinition["storage"]>(() =>
    defaultStorage([focusObject ?? ""]),
  );
  const [sourceInputField, setSourceInputField] = useState("");
  const [targetInputField, setTargetInputField] = useState("");
  const [sourceField, setSourceField] = useState("id");
  const [targetField, setTargetField] = useState("id");
  const [sourceDisplayField, setSourceDisplayField] = useState("");
  const [targetDisplayField, setTargetDisplayField] = useState("");
  const native = editing?.storage === "native";
  const fieldsUnavailable =
    defaultStorage([sourceObject, targetObject]) === "local";
  const unsupportedFields = storage === "fields" && fieldsUnavailable;
  function reset() {
    setSourceInputField("");
    setTargetInputField("");
    setPanel(null);
    setEditing(null);
    setSource(focusObject ?? "");
    setTarget("");
    setSourceLabel("");
    setTargetLabel("");
    setSourceField("id");
    setTargetField("id");
    setSourceDisplayField("");
    setTargetDisplayField("");
    setStorage(defaultStorage([focusObject ?? ""]));
    setCardinality("one-to-many");
    setError("");
  }
  function edit(relation: RelationDefinition) {
    setSourceInputField(
      boundRelationField(
        objects.find((o) => o.name === relation.sourceObject),
        relation.id,
      ),
    );
    setTargetInputField(
      boundRelationField(
        objects.find((o) => o.name === relation.targetObject),
        relation.id,
      ),
    );
    setPanel("relation");
    setEditing(relation);
    setSource(relation.sourceObject);
    setTarget(relation.targetObject);
    setSourceLabel(relation.sourceLabel);
    setTargetLabel(relation.targetLabel);
    setCardinality(relation.cardinality);
    setStorage(relation.storage);
    setSourceField(relation.sourceField ?? "id");
    setTargetField(relation.targetField ?? "id");
    setSourceDisplayField(relation.sourceDisplayField ?? "");
    setTargetDisplayField(relation.targetDisplayField ?? "");
    setError("");
    setConfirmId(null);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const name = (id: string) => objects.find((o) => o.name === id)?.label ?? id;
  const allRelations = query.data?.data ?? [];
  const focusedRelations = allRelations.filter(
    (r) =>
      !focusObject ||
      r.sourceObject === focusObject ||
      r.targetObject === focusObject,
  );
  const includedObjects = objects.filter(
    (o) =>
      !focusObject ||
      o.name === focusObject ||
      addedObjects.includes(o.name) ||
      focusedRelations.some(
        (r) => r.sourceObject === o.name || r.targetObject === o.name,
      ),
  );
  const visibleObjects = includedObjects.filter(
    (o) => !hiddenObjects.includes(o.name),
  );
  const includedNames = new Set(includedObjects.map((o) => o.name));
  const visibleNames = new Set(visibleObjects.map((o) => o.name));
  const relations = allRelations.filter(
    (r) =>
      includedNames.has(r.sourceObject) && includedNames.has(r.targetObject),
  );
  const availableObjects = objects.filter((o) => !visibleNames.has(o.name));
  const activeFields = (object: string) =>
    [
      ...relations.flatMap((r) => [
        r.sourceObject === object
          ? (r.storage === "local"
              ? boundRelationField(
                  objects.find((o) => o.name === object),
                  r.id,
                )
              : "") ||
            r.sourceField ||
            "id"
          : "",
        r.targetObject === object
          ? (r.storage === "local"
              ? boundRelationField(
                  objects.find((o) => o.name === object),
                  r.id,
                )
              : "") ||
            r.targetField ||
            "id"
          : "",
      ]),
      sourceObject === object ? sourceField : "",
      targetObject === object ? targetField : "",
    ].filter(Boolean);
  const rowHeights = visibleObjects.reduce<number[]>((rows, object, index) => {
    const fields = fieldsFor(object, activeFields(object.name));
    const visible = fields.filter(
      (field, index) =>
        expandedNodes.includes(object.name) ||
        index < 6 ||
        activeFields(object.name).includes(field.key),
    );
    rows[Math.floor(index / 2)] = Math.max(
      rows[Math.floor(index / 2)] ?? 0,
      visible.length * 52 + 280,
    );
    return rows;
  }, []);
  const nodes = visibleObjects.map((o, i) => ({
    id: o.name,
    type: "collection",
    position: positions[o.name] ?? {
      x: (i % 2) * 440,
      y: rowHeights
        .slice(0, Math.floor(i / 2))
        .reduce((total, height) => total + height, 0),
    },
    data: {
      label: o.label,
      remove: () => setHiddenObjects((current) => [...current, o.name]),
      createField: () => {
        reset();
        setFieldObject(o.name);
        setFieldName("");
        setFieldKey("");
        setFieldType("Textbox");
        setFieldUnique(false);
        setPanel("field");
      },
      canCreateField:
        supportsLocalRecordTools(o) &&
        (collectionCapabilities(o).schema ||
          collectionCapabilities(o).customFields),
      expanded: expandedNodes.includes(o.name),
      toggle: () =>
        setExpandedNodes((current) =>
          current.includes(o.name)
            ? current.filter((name) => name !== o.name)
            : [...current, o.name],
        ),
      fields: fieldsFor(o, activeFields(o.name)),
      active: activeFields(o.name),
    },
  }));
  function moveNodes(changes: NodeChange[]) {
    if (
      !changes.some((change) => change.type === "position" && change.position)
    )
      return;
    setPositions((current) => {
      const next = { ...current };
      for (const change of changes)
        if (change.type === "position" && change.position)
          next[change.id] = change.position;
      return next;
    });
  }
  function changeObject(side: "source" | "target", value: string) {
    const source = side === "source" ? value : sourceObject;
    const target = side === "target" ? value : targetObject;
    if (side === "source") {
      setSource(value);
      setSourceInputField("");
      setSourceField("id");
      setSourceDisplayField("");
    } else {
      setTarget(value);
      setTargetInputField("");
      setTargetField("id");
      setTargetDisplayField("");
    }
    if (!targetLabel || targetLabel === name(sourceObject))
      setTargetLabel(source ? name(source) : "");
    if (!sourceLabel || sourceLabel === name(targetObject))
      setSourceLabel(target ? name(target) : "");
    if (defaultStorage([source, target]) === "local") {
      setStorage("local");
      setSourceField("id");
      setTargetField("id");
    }
  }
  const edges = relations
    .filter(
      (r) =>
        visibleNames.has(r.sourceObject) && visibleNames.has(r.targetObject),
    )
    .map((r) => ({
      id: r.id,
      source: r.sourceObject,
      target: r.targetObject,
      sourceHandle: `out:${
        (r.storage === "local"
          ? boundRelationField(
              objects.find((o) => o.name === r.sourceObject),
              r.id,
            )
          : "") ||
        r.sourceField ||
        "id"
      }`,
      targetHandle: `in:${
        (r.storage === "local"
          ? boundRelationField(
              objects.find((o) => o.name === r.targetObject),
              r.id,
            )
          : "") ||
        r.targetField ||
        "id"
      }`,
      label: `${r.sourceLabel} · ${t(cardinalities[r.cardinality])}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      labelStyle: { fill: "var(--foreground)", fontSize: 12 },
      labelBgStyle: { fill: "var(--background)" },
      style: {
        stroke: "var(--primary)",
        strokeWidth: editing?.id === r.id ? 4 : 2,
        strokeDasharray: r.storage === "native" ? "5 4" : undefined,
      },
    }));
  const connect = ({
    source,
    target,
    sourceHandle,
    targetHandle,
  }: Connection) => {
    if (query.isPending || query.error || busy) return;
    if (source === target) {
      setError(t("Selecciona dos colecciones diferentes."));
      return;
    }
    if (!source || !target) return;

    const mode = defaultStorage([source, target]);
    const fromField =
      mode === "local" ? "id" : (sourceHandle?.replace(/^out:/, "") ?? "id");
    const toField =
      mode === "local" ? "id" : (targetHandle?.replace(/^in:/, "") ?? "id");
    const existing = allRelations.find((relation) =>
      relation.storage === "native"
        ? (relation.sourceObject === source &&
            relation.targetObject === target) ||
          (relation.sourceObject === target && relation.targetObject === source)
        : relation.sourceObject === source &&
          relation.targetObject === target &&
          (relation.sourceField ?? "id") === fromField &&
          (relation.targetField ?? "id") === toField,
    );
    if (existing) {
      edit(existing);
      return;
    }

    reset();
    setPanel("relation");
    setSource(source);
    setTarget(target);
    setStorage(mode);
    const rawSource = sourceHandle?.replace(/^out:/, "") ?? "id";
    const rawTarget = targetHandle?.replace(/^in:/, "") ?? "id";
    if (mode === "local") {
      if (inputFields(source).some((field) => field.key === rawSource))
        setSourceInputField(rawSource);
      if (inputFields(target).some((field) => field.key === rawTarget))
        setTargetInputField(rawTarget);
    }
    setSourceField(fromField);
    setTargetField(toField);
    setSourceLabel(name(target));
    setTargetLabel(name(source));
  };
  function selectCollection(id: string) {
    if (query.isPending || query.error) return;
    setSelectedCollection(id);
    const related = relations.filter(
      (r) => r.sourceObject === id || r.targetObject === id,
    );
    if (related.length === 1) edit(related[0]);
    else {
      setEditing(null);
      setPanel("collection");
    }
  }
  async function mutate(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
      await client.invalidateQueries({ queryKey: ["collection-relations"] });
      await client.invalidateQueries({ queryKey: ["record-links"] });
      setConfirmId(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("No se pudo guardar la relación. Intenta nuevamente."),
      );
    } finally {
      setBusy(false);
    }
  }
  function inputFields(name: string) {
    const object = objects.find((o) => o.name === name);
    if (!object || !supportsLocalRecordTools(object)) return [];
    return Object.entries(object.config.fields)
      .filter(
        ([, field]) =>
          ["Textbox", "Dropdown"].includes(field.type) &&
          !field.readOnly &&
          !field.config?.formula &&
          !field.config?.relation &&
          !field.config?.collectionOptions &&
          (!field.config?.collectionRelation ||
            field.config.collectionRelation === editing?.id ||
            !allRelations.some(
              (relation) =>
                relation.id === field.config?.collectionRelation &&
                relation.storage === "local",
            )),
      )
      .map(([key, field]) => ({ key, label: field.label || key }));
  }
  async function saveRelation() {
    const payload = {
      sourceObject,
      targetObject,
      sourceLabel: sourceLabel.trim(),
      targetLabel: targetLabel.trim(),
      cardinality,
      storage,
      sourceField,
      targetField,
      sourceDisplayField: sourceDisplayField || null,
      targetDisplayField: targetDisplayField || null,
    };
    const result = await api<{ data: RelationDefinition }>(
      editing
        ? `/collection-relations/${encodeURIComponent(editing.id)}`
        : "/collection-relations",
      editing ? "PUT" : "POST",
      { ...payload, ...(editing ? { version: editing.version } : {}) },
    );
    const saved = result.data?.id ? result.data : editing;
    if (saved) setEditing(saved);
    if (storage === "local" && saved) {
      for (const [objectName, field] of [
        [sourceObject, sourceInputField],
        [targetObject, targetInputField],
      ]) {
        const object = objects.find((o) => o.name === objectName);
        if (
          !object ||
          !supportsLocalRecordTools(object) ||
          (!field && !boundRelationField(object, saved.id))
        )
          continue;
        const next = bindRelationField(object, saved, field);
        if (JSON.stringify(next.config) === JSON.stringify(object.config))
          continue;
        const updated = await api<{ data: CrmObject }>(
          `/objects/${encodeURIComponent(objectName)}`,
          "PUT",
          next,
        );
        setSavedObjects((current) => ({
          ...current,
          [objectName]: updated.data,
        }));
      }
    }
    setAddedObjects((current) => [
      ...new Set([...current, sourceObject, targetObject]),
    ]);
    setHiddenObjects((current) =>
      current.filter((name) => name !== sourceObject && name !== targetObject),
    );
    await client.invalidateQueries();
    reset();
  }
  async function saveField() {
    if (busy) return;
    const object = objects.find((o) => o.name === fieldObject);
    if (
      !object ||
      !supportsLocalRecordTools(object) ||
      !(
        collectionCapabilities(object).schema ||
        collectionCapabilities(object).customFields
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (Object.hasOwn(object.config.fields, fieldKey))
        throw new Error(t("Ya existe un campo con ese identificador."));
      const config = {
        ...object.config,
        fields: {
          ...object.config.fields,
          [fieldKey]: {
            type: fieldType,
            label: fieldName.trim(),
            ...(fieldUnique ? { config: { unique: true } } : {}),
          },
        },
        fieldOrder: [
          ...(object.config.fieldOrder ?? Object.keys(object.config.fields)),
          fieldKey,
        ],
      };
      const validation = configSchema.safeParse(config);
      if (!validation.success)
        throw new Error(
          validation.error.issues.map((issue) => issue.message).join(" "),
        );
      const result = await api<{ data: CrmObject }>(
        `/objects/${encodeURIComponent(object.name)}`,
        "PUT",
        { ...object, config, version: object.version ?? 1 },
      );
      setSavedObjects((current) => ({
        ...current,
        [object.name]: result.data,
      }));
      setExpandedNodes((current) => [...new Set([...current, object.name])]);
      reset();
      await client.invalidateQueries();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("No se pudo crear el campo."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          {focusObject
            ? t("Relaciones de %{v1}", { v1: name(focusObject) })
            : t("Relaciones entre colecciones")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Agrega entidades al mapa y arrastra entre sus campos para preparar una relación. También puedes usar el formulario Nueva relación.",
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="relation-add-object">
              {t("Entidad para agregar al mapa")}
            </Label>
            <select
              id="relation-add-object"
              className={selectStyle}
              value={objectToAdd}
              onChange={(event) => setObjectToAdd(event.target.value)}
              disabled={!availableObjects.length}
            >
              <option value="">
                {availableObjects.length
                  ? t("Seleccionar entidad")
                  : t("Todas las entidades están en el mapa")}
              </option>
              {availableObjects.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            disabled={!objectToAdd}
            onClick={() => {
              setAddedObjects((current) => [
                ...new Set([...current, objectToAdd]),
              ]);
              setHiddenObjects((current) =>
                current.filter((name) => name !== objectToAdd),
              );
              setObjectToAdd("");
            }}
          >
            {t("Agregar entidad")}
          </Button>
        </div>
        <Button
          disabled={query.isPending || !!query.error}
          onClick={() => {
            reset();
            setPanel("relation");
          }}
        >
          {t("Nueva relación")}
        </Button>
      </div>
      {error && !panel && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {query.isPending && <p role="status">{t("Cargando relaciones…")}</p>}
      {query.error && (
        <div role="alert">
          {query.error.message}{" "}
          <Button variant="outline" onClick={() => query.refetch()}>
            {t("Reintentar")}
          </Button>
        </div>
      )}
      <div
        className="rounded-lg border"
        style={{
          height: "calc(100vh - 300px)",
          minHeight: 480,
          width: "100%",
          minWidth: 0,
        }}
        aria-label={t("Mapa de relaciones")}
      >
        <ReactFlow
          key={nodes.map((node) => node.id).join(",")}
          onNodesChange={moveNodes}
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          onConnect={connect}
          onEdgeClick={(_, edge) => {
            const relation = relations.find((r) => r.id === edge.id);
            if (relation) edit(relation);
          }}
          onNodeClick={(_, node) => selectCollection(node.id)}
          onNodeDoubleClick={(_, node) => onOpenCollection?.(node.id)}
          nodesDraggable={true}
          nodesConnectable={!query.isPending && !query.error && !busy}
          edgesReconnectable={false}
          deleteKeyCode={null}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": t("Acercar"),
            "controls.zoomOut.ariaLabel": t("Alejar"),
            "controls.fitView.ariaLabel": t("Ajustar mapa"),
          }}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <Sheet
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open && !busy) reset();
        }}
      >
        <SheetContent
          style={{
            width: "min(560px, 100vw)",
            maxWidth: "100vw",
            overflowY: "auto",
          }}
        >
          <SheetHeader>
            <SheetTitle>
              {panel === "field"
                ? t("Crear campo en %{v1}", { v1: name(fieldObject) })
                : panel === "collection"
                  ? t("Relaciones de %{v1}", { v1: name(selectedCollection) })
                  : editing
                    ? `${name(editing.sourceObject)} → ${name(editing.targetObject)}`
                    : t("Nueva relación")}
            </SheetTitle>
            <SheetDescription>
              {panel === "field"
                ? t(
                    "El campo se guarda en la entidad y queda disponible para conectar desde el mapa.",
                  )
                : editing
                  ? t("Configuración guardada de la relación seleccionada.")
                  : t(
                      "Configura los campos y la presentación de los registros relacionados.",
                    )}
            </SheetDescription>
          </SheetHeader>
          <div style={{ padding: "0 24px 24px" }}>
            {panel === "field" ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveField();
                }}
              >
                <fieldset disabled={busy} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-field-label">
                      {t("Nombre del campo")}
                    </Label>
                    <Input
                      id="new-field-label"
                      value={fieldName}
                      onChange={(event) => setFieldName(event.target.value)}
                      required
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-field-key">
                      {t("Identificador del campo")}
                    </Label>
                    <Input
                      id="new-field-key"
                      value={fieldKey}
                      onChange={(event) => setFieldKey(event.target.value)}
                      required
                      pattern="[a-z][a-z0-9_]{0,47}"
                      maxLength={48}
                    />
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "Usa minúsculas, números y guion bajo; por ejemplo, organizacion_id.",
                      )}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-field-type">{t("Tipo de campo")}</Label>
                    <select
                      id="new-field-type"
                      className={selectStyle}
                      value={fieldType}
                      onChange={(event) => setFieldType(event.target.value)}
                    >
                      <option value="Textbox">{t("Texto")}</option>
                      <option value="Number">{t("Número")}</option>
                      <option value="Checkbox">{t("Sí / No")}</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={fieldUnique}
                      onChange={(event) => setFieldUnique(event.target.checked)}
                    />
                    {t("Valores únicos")}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Para el lado «uno» de una relación, usa ID o un campo con valores únicos. La conexión por campos compara valores; no copia datos.",
                    )}
                  </p>
                  {error && (
                    <p role="alert" className="text-destructive">
                      {error}
                    </p>
                  )}
                  <Button disabled={!fieldName.trim() || !fieldKey || busy}>
                    {busy ? t("Guardando…") : t("Guardar campo")}
                  </Button>
                </fieldset>
              </form>
            ) : panel === "collection" ? (
              <div style={{ display: "grid", gap: 12 }}>
                {relations
                  .filter(
                    (r) =>
                      r.sourceObject === selectedCollection ||
                      r.targetObject === selectedCollection,
                  )
                  .map((r) => (
                    <Button
                      key={r.id}
                      variant="outline"
                      onClick={() => edit(r)}
                    >
                      {name(r.sourceObject)} · {r.sourceField ?? "id"} →{" "}
                      {name(r.targetObject)} · {r.targetField ?? "id"}
                    </Button>
                  ))}
                {!relations.some(
                  (r) =>
                    r.sourceObject === selectedCollection ||
                    r.targetObject === selectedCollection,
                ) && <p>{t("Esta colección aún no tiene relaciones.")}</p>}
                <Button
                  onClick={() => {
                    reset();
                    setSource(selectedCollection);
                    setTargetLabel(name(selectedCollection));
                    setStorage(defaultStorage([selectedCollection]));
                    setPanel("relation");
                  }}
                >
                  {t("Crear relación desde")} {name(selectedCollection)}
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    busy ||
                    unsupportedFields ||
                    query.isPending ||
                    query.error
                  )
                    return;
                  void mutate(saveRelation);
                }}
              >
                <h3 className="font-medium">
                  {editing ? t("Editar relación") : t("Crear relación")}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="relation-source">
                      {t("Colección de origen")}
                    </Label>
                    <select
                      id="relation-source"
                      className={selectStyle}
                      value={sourceObject}
                      disabled={!!editing}
                      onChange={(e) => changeObject("source", e.target.value)}
                      required
                    >
                      <option value="">{t("Seleccionar colección")}</option>
                      {objects.map((o) => (
                        <option key={o.name} value={o.name}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relation-target">
                      {t("Colección de destino")}
                    </Label>
                    <select
                      id="relation-target"
                      className={selectStyle}
                      value={targetObject}
                      disabled={!!editing}
                      onChange={(e) => changeObject("target", e.target.value)}
                      required
                    >
                      <option value="">{t("Seleccionar colección")}</option>
                      {objects.map((o) => (
                        <option
                          key={o.name}
                          value={o.name}
                          disabled={o.name === sourceObject}
                        >
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relation-source-label">
                      {t("Nombre visto desde el origen")}
                    </Label>
                    <Input
                      id="relation-source-label"
                      value={sourceLabel}
                      onChange={(e) => setSourceLabel(e.target.value)}
                      required
                      maxLength={120}
                      placeholder={t("Clientes")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relation-target-label">
                      {t("Nombre visto desde el destino")}
                    </Label>
                    <Input
                      id="relation-target-label"
                      value={targetLabel}
                      onChange={(e) => setTargetLabel(e.target.value)}
                      required
                      maxLength={120}
                      placeholder={t("Organización")}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relation-storage">
                    {t("Cómo se relacionan los registros")}
                  </Label>
                  <select
                    id="relation-storage"
                    className={selectStyle}
                    value={storage}
                    disabled={native}
                    onChange={(e) => {
                      setStorage(
                        e.target.value as RelationDefinition["storage"],
                      );
                      if (e.target.value === "local") {
                        setSourceField("id");
                        setTargetField("id");
                      }
                    }}
                  >
                    <option value="fields" disabled={fieldsUnavailable}>
                      {t("Coincidencia entre campos")}
                    </option>
                    <option value="local">
                      {t("Asociación manual entre registros")}
                    </option>
                    {native && (
                      <option value="native">{t("Relación nativa")}</option>
                    )}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      [
                        "source-field",
                        t("Campo de origen"),
                        sourceObject,
                        sourceField,
                        setSourceField,
                        native || storage === "local",
                      ],
                      [
                        "target-field",
                        t("Campo de destino"),
                        targetObject,
                        targetField,
                        setTargetField,
                        native || storage === "local",
                      ],
                      [
                        "source-display",
                        t("Campo para mostrar el origen"),
                        sourceObject,
                        sourceDisplayField,
                        setSourceDisplayField,
                        false,
                      ],
                      [
                        "target-display",
                        t("Campo para mostrar el destino"),
                        targetObject,
                        targetDisplayField,
                        setTargetDisplayField,
                        false,
                      ],
                    ] as const
                  ).map(([id, label, object, value, setter, disabled]) => (
                    <div className="space-y-2" key={id}>
                      <Label htmlFor={`relation-${id}`}>{label}</Label>
                      <select
                        id={`relation-${id}`}
                        className={selectStyle}
                        value={value}
                        disabled={disabled || !object}
                        onChange={(e) => setter(e.target.value)}
                      >
                        {id.endsWith("display") && (
                          <option value="">
                            {t("Automático (nombre del registro)")}
                          </option>
                        )}
                        {fieldsFor(
                          objects.find((o) => o.name === object),
                          native && !id.endsWith("display") ? [value] : [],
                        ).map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label} ({field.key})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {storage === "local" && (
                  <div className="space-y-3 rounded-md border p-3">
                    <p className="text-sm">
                      {t(
                        "Selecciona el campo que mostrará el selector en cada formulario. La cardinalidad determina si admite una o varias selecciones.",
                      )}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(
                        [
                          [
                            "source-input",
                            t("Campo del formulario de origen"),
                            sourceObject,
                            sourceInputField,
                            setSourceInputField,
                          ],
                          [
                            "target-input",
                            t("Campo del formulario de destino"),
                            targetObject,
                            targetInputField,
                            setTargetInputField,
                          ],
                        ] as const
                      ).map(([id, label, object, value, setter]) => (
                        <div className="space-y-2" key={id}>
                          <Label htmlFor={id}>{label}</Label>
                          <select
                            id={id}
                            className={selectStyle}
                            value={value}
                            disabled={!inputFields(object).length}
                            onChange={(event) => setter(event.target.value)}
                          >
                            <option value="">
                              {t("Sin campo en el formulario")}
                            </option>
                            {inputFields(object).map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label} ({field.key})
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {native
                    ? t(
                        "La relación nativa usa %{v1} → %{v2}. Estos campos y la cardinalidad se administran en su origen; puedes editar los nombres y los campos para mostrar.",
                        { v1: sourceField, v2: targetField },
                      )
                    : storage === "fields"
                      ? t(
                          "Los registros se relacionan cuando los valores de ambos campos coinciden. No se copian ni se modifican sus datos.",
                        )
                      : t(
                          "Seleccionas los registros que deseas asociar. Savia guarda sus identificadores (ID).",
                        )}
                </p>
                {fieldsUnavailable && !native && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t(
                      "La coincidencia entre campos solo está disponible para colecciones locales de CRM. Para estas colecciones, usa una asociación manual o edita su relación nativa existente.",
                    )}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Ejemplo: desde una Organización ves «Clientes»; desde cada Cliente ves «Organización».",
                  )}
                </p>
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="relation-cardinality">
                    {t("Cardinalidad de origen a destino")}
                  </Label>
                  <select
                    id="relation-cardinality"
                    className={selectStyle}
                    value={cardinality}
                    disabled={native}
                    onChange={(e) =>
                      setCardinality(e.target.value as RelationCardinality)
                    }
                  >
                    {Object.entries(cardinalities).map(([value, label]) => (
                      <option key={value} value={value}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "La asociación se guarda en Savia. Los registros conservan su origen.",
                  )}
                </p>
                {error && (
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  disabled={
                    busy ||
                    unsupportedFields ||
                    !sourceObject ||
                    !targetObject ||
                    sourceObject === targetObject ||
                    !sourceLabel.trim() ||
                    !targetLabel.trim()
                  }
                >
                  {busy
                    ? t("Guardando…")
                    : editing
                      ? t("Guardar cambios")
                      : t("Crear relación")}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={reset}
                  >
                    {t("Cancelar edición")}
                  </Button>
                )}
              </form>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <details>
        <summary>
          {t("Relaciones definidas (")}
          {relations.length})
        </summary>
        <div className="space-y-3">
          <h3 className="font-medium">{t("Relaciones definidas")}</h3>
          {!query.isPending && !query.error && relations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("Aún no hay relaciones. Crea la primera con el formulario.")}
            </p>
          )}
          {relations.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
            >
              <div>
                <p className="font-medium">
                  {name(r.sourceObject)} → {name(r.targetObject)}
                </p>
                <p className="text-sm">
                  {r.sourceLabel} / {r.targetLabel} ·{" "}
                  {t(cardinalities[r.cardinality])}
                </p>
                <p className="text-sm text-muted-foreground">
                  {r.storage === "native"
                    ? t("Relación nativa · administrada en su origen")
                    : r.storage === "fields"
                      ? t("Coincidencia de campos · %{v1} → %{v2}", {
                          v1: r.sourceField ?? "",
                          v2: r.targetField ?? "",
                        })
                      : t("Asociación local · guardada en Savia")}
                </p>
              </div>
              <Button variant="outline" disabled={busy} onClick={() => edit(r)}>
                {t("Editar relación")}
              </Button>
              {r.storage !== "native" &&
                (confirmId === r.id ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      {t(
                        "Se eliminarán esta definición y sus asociaciones. Los registros se conservan.",
                      )}
                    </p>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void mutate(() =>
                          api(
                            `/collection-relations/${encodeURIComponent(r.id)}`,
                            "DELETE",
                          ),
                        )
                      }
                    >
                      {t("Confirmar eliminación")}
                    </Button>{" "}
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmId(null)}
                    >
                      {t("Cancelar")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmId(r.id)}
                  >
                    {t("Eliminar relación")}
                  </Button>
                ))}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
