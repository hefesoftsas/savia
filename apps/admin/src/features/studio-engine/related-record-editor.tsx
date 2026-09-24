import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IFieldProps } from "@form-eng/core";
import {
  fieldEntries,
  R2_ATTACHMENT_TYPE,
  type StudioObject,
  type StudioRecord,
} from "@savia/studio-shared/metadata";
import type { RelatedRecordChanges } from "@savia/studio-shared/related-records";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RelatedRecordSubform } from "./related-record-subform";
import DynamicForm from "./dynamic-form";
import { CollectionRelationPicker } from "./collection-relation-picker";
import { relationRecordLabel } from "./relation-record-label";
import { getStudioRuntime } from "./runtime";
import { api } from "./api";

type Row = RelatedRecordChanges["rows"][number];
const PAGE_SIZE = 10;
export function relatedRows(value: unknown, clean = true): Row[] {
  return Array.isArray(value)
    ? value.map((row) =>
        typeof row === "string"
          ? { id: row }
          : clean
            ? (Object.fromEntries(
                Object.entries(row as object).filter(
                  ([key]) => key !== "__errors",
                ),
              ) as Row)
            : (row as Row),
      )
    : value
      ? [{ id: String(value) }]
      : [];
}
/** All mutations here are form values; only the parent's save may persist them. */
export function RelatedRecordEditor(props: IFieldProps) {
  const t = useMessages(recordsMessages);

  const inputPrefix = useId();
  const runtime = getStudioRuntime();
  const target = String(props.config?.collectionRelationTarget ?? "");
  const multiple = !!props.config?.multiple;
  const allowCreate =
    !props.readOnly && props.config?.relationAllowCreate !== false;
  const allowEdit =
    !props.readOnly && props.config?.relationAllowEdit !== false;
  const allowLink =
    !props.readOnly && props.config?.relationAllowLink !== false;
  const allowUnlink =
    !props.readOnly && props.config?.relationAllowUnlink !== false;
  const rows = relatedRows(props.value, false);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const editingSequence = useRef(0);
  const [editing, setEditing] = useState<{
    key: number;
    index: number;
    values: Record<string, unknown>;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const activePage = Math.min(
    page,
    Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
  );
  const visibleRows = rows.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE,
  );
  const schema = useQuery({
    queryKey: ["related-object", runtime.apiBasePath, runtime.domainId, target],
    enabled: expanded && !!target,
    queryFn: () =>
      api<{ data: StudioObject }>(`/objects/${encodeURIComponent(target)}`),
  });
  const details = useQuery({
    queryKey: [
      "related-page",
      runtime.apiBasePath,
      runtime.domainId,
      target,
      visibleRows.map((row) => row.id),
    ],
    enabled: expanded && visibleRows.some((row) => row.id),
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          visibleRows
            .filter((row) => row.id)
            .map(async (row) => {
              const result = await api<{ data: StudioRecord }>(
                `/records/${encodeURIComponent(target)}/${encodeURIComponent(row.id!)}`,
              );
              return [row.id, result.data];
            }),
        ),
      ),
  });
  const childObject = useMemo(() => {
    if (!schema.data) return undefined;
    const source = schema.data.data;
    const configured = props.config?.relationFields as string[] | undefined;
    // Retain schema values for dependencies; hide optional unselected fields and
    // exclude them from patches while keeping required fields available.
    const order = [
      ...(configured ?? []),
      ...fieldEntries(source).map(([name]) => name),
    ].filter(
      (name, index, all) =>
        all.indexOf(name) === index && source.config.fields[name],
    );
    return {
      ...source,
      config: {
        ...source.config,
        fieldOrder: order,
        studio: {
          ...source.config.studio,
          wizard: undefined,
          collection: undefined,
          business: undefined,
        },
        fields: Object.fromEntries(
          Object.entries(source.config.fields).map(([name, originalField]) => {
            const field: typeof originalField = {
              ...originalField,
              config: {
                ...originalField.config,
                inputId: `${inputPrefix}-${name}`,
              },
            };
            const unsupported =
              field.type === R2_ATTACHMENT_TYPE ||
              !!field.config?.relation ||
              !!field.config?.collectionRelation;
            return [
              name,
              unsupported
                ? {
                    ...field,
                    hidden: true,
                    readOnly: true,
                    config: {
                      ...field.config,
                      relationPresentation: undefined,
                      collectionRelationTarget: undefined,
                    },
                  }
                : configured &&
                    !configured.includes(name) &&
                    !field.required &&
                    !field.config?.requiredWhen
                  ? { ...field, hidden: true, readOnly: true }
                  : field,
            ];
          }),
        ),
      },
    } as StudioObject;
  }, [schema.data, props.config?.relationFields, inputPrefix]);
  function change(next: Row[]) {
    if (props.readOnly) return;
    if (next.length > 100 || (!multiple && next.length > 1)) {
      setError(
        multiple
          ? t("Máximo 100 registros relacionados por formulario.")
          : t(
              "Esta relación admite un solo registro. Desvincula el actual para reemplazarlo.",
            ),
      );
      return;
    }
    setError("");
    props.setFieldValue?.(props.fieldName!, next);
  }
  async function edit(index: number) {
    if (props.readOnly) return;
    setError("");
    setLoading(true);
    try {
      const row = rows[index];
      const original: Record<string, unknown> = row.id
        ? (
            await api<{ data: StudioRecord }>(
              `/records/${encodeURIComponent(target)}/${encodeURIComponent(row.id)}`,
            )
          ).data
        : {};
      // Retain the version associated with staged edits so concurrent changes conflict.
      setEditing({
        key: ++editingSequence.current,
        index,
        values: {
          ...original,
          ...row.data,
          ...(row.id
            ? { id: row.id, _version: row.version ?? original._version }
            : {}),
        },
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function stage(data: Record<string, unknown>, errors?: string[]) {
    if (!editing || !childObject) return;
    const writable = Object.fromEntries(
      Object.entries(data).filter(([name]) => {
        const field = childObject.config.fields[name];
        return (
          field &&
          !field.readOnly &&
          !field.config?.formula &&
          field.type !== R2_ATTACHMENT_TYPE &&
          !field.config?.relation &&
          !field.config?.collectionRelation
        );
      }),
    );
    const row: Row & { __errors?: string[] } = editing.values.id
      ? {
          id: String(editing.values.id),
          version: Number(editing.values._version),
          data: writable,
        }
      : { data: writable };
    if (errors?.length) row.__errors = errors;
    if (editing.index === -1) {
      change([...rows, row]);
      setEditing({ ...editing, index: rows.length });
    } else
      change(
        rows.map((current, index) => (index === editing.index ? row : current)),
      );
  }
  const label = (row: Row, index: number) =>
    relationRecordLabel(
      {
        ...details.data?.[row.id ?? ""],
        ...row.data,
        id: row.id ?? t("Nuevo %{p0}", { p0: index + 1 }),
      },
      props.config?.relationDisplayField as string | undefined,
    );
  const columns = childObject
    ? (
        (props.config?.relationFields as string[] | undefined) ??
        fieldEntries(childObject)
          .filter(([, field]) => !field.hidden)
          .map(([name]) => name)
      )
        .filter(
          (name) =>
            childObject.config.fields[name] &&
            !childObject.config.fields[name].hidden,
        )
        .slice(0, 6)
    : [];
  return (
    <div className="min-w-0 space-y-3">
      <Button
        type="button"
        variant="outline"
        aria-expanded={expanded}
        aria-controls={`${props.fieldName}-related`}
        className="w-full justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? t("Ocultar registros") : t("Mostrar registros")}
        <span>{rows.length}</span>
      </Button>
      {expanded && (
        <div id={`${props.fieldName}-related`} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              "Los cambios se guardan con el formulario principal. Desvincular conserva el registro original.",
            )}
          </p>
          {schema.isPending && <p role="status">{t("Cargando campos…")}</p>}
          {(schema.error || details.error || error) && (
            <p role="alert" className="text-sm text-destructive">
              {schema.error?.message ?? details.error?.message ?? error}{" "}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void schema.refetch();
                  void details.refetch();
                  setError("");
                }}
              >
                {t("Reintentar")}
              </Button>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                !allowCreate ||
                !!editing ||
                !childObject ||
                rows.length >= 100 ||
                (!multiple && rows.length > 0)
              }
              onClick={() =>
                setEditing({
                  key: ++editingSequence.current,
                  index: -1,
                  values: {},
                })
              }
            >
              {t("Crear relacionado")}
            </Button>
          </div>
          <span
            id={`${props.fieldName}-link_label`}
            className="block text-sm font-medium"
          >
            {t("Vincular existente")}
          </span>
          <CollectionRelationPicker
            {...props}
            fieldName={`${props.fieldName}-link`}
            config={{ ...props.config, multiple: true }}
            readOnly={!allowLink || (!multiple && rows.length > 0)}
            value={[]}
            setFieldValue={(_field, value) => {
              const ids = (Array.isArray(value) ? value : []).map(String);
              // The picker only links. Unlinking is an explicit action on each row below.
              change([
                ...rows,
                ...ids
                  .filter((id) => !rows.some((row) => row.id === id))
                  .map((id) => ({ id })),
              ]);
            }}
          />
          {!rows.length && (
            <p className="py-3 text-sm text-muted-foreground">
              {t(
                "Sin registros relacionados. Crea uno o vincula uno existente.",
              )}
            </p>
          )}
          {!!rows.length && (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t("Registros relacionados")}
                </caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="px-2 py-2 text-left">
                      {t("Registro")}
                    </th>
                    {props.config?.relationPresentation === "table" &&
                      columns.map((name) => (
                        <th
                          key={name}
                          scope="col"
                          className="px-2 py-2 text-left"
                        >
                          {childObject!.config.fields[name].label}
                        </th>
                      ))}
                    <th scope="col" className="px-2 py-2 text-right">
                      {t("Acciones")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, offset) => {
                    const index = (activePage - 1) * PAGE_SIZE + offset;
                    const name = label(row, index);
                    const data = {
                      ...details.data?.[row.id ?? ""],
                      ...row.data,
                    };
                    return (
                      <tr key={row.id ?? `new-${index}`} className="border-b">
                        <th
                          scope="row"
                          className="px-2 py-2 text-left font-normal"
                        >
                          {name}
                          {row.data && (
                            <span className="block text-xs text-muted-foreground">
                              {row.id
                                ? t("Editado · sin guardar")
                                : t("Nuevo · sin guardar")}
                            </span>
                          )}
                        </th>
                        {props.config?.relationPresentation === "table" &&
                          columns.map((field) => (
                            <td
                              key={field}
                              className="max-w-48 truncate px-2 py-2"
                            >
                              {String(data[field] ?? "—")}
                            </td>
                          ))}
                        <td className="px-2 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={
                                !(row.id ? allowEdit : allowCreate) ||
                                loading ||
                                !childObject
                              }
                              aria-label={t("Editar %{p0}", { p0: name })}
                              onClick={() => void edit(index)}
                            >
                              {t("Editar")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!allowUnlink}
                              aria-label={t("Desvincular %{p0}", { p0: name })}
                              onClick={() => {
                                setEditing(null);
                                change(
                                  rows.filter(
                                    (_, position) => position !== index,
                                  ),
                                );
                              }}
                            >
                              {t("Desvincular")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > PAGE_SIZE && (
            <nav
              aria-label={t("Páginas de registros relacionados")}
              className="flex items-center justify-between"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activePage === 1}
                onClick={() => setPage(activePage - 1)}
              >
                {t("Anterior")}
              </Button>
              <span className="text-sm">
                {t("Página")} {activePage} {t("de")}{" "}
                {Math.ceil(rows.length / PAGE_SIZE)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activePage * PAGE_SIZE >= rows.length}
                onClick={() => setPage(activePage + 1)}
              >
                {t("Siguiente")}
              </Button>
            </nav>
          )}
        </div>
      )}
      {editing &&
        childObject &&
        props.config?.relationPresentation === "subform" && (
          <RelatedRecordSubform
            key={editing.key}
            object={childObject}
            values={editing.values}
            onChange={stage}
            onClose={() => setEditing(null)}
          />
        )}
      <Dialog
        open={!!editing && props.config?.relationPresentation !== "subform"}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing?.index === -1
                ? t("Crear relacionado")
                : t("Editar relacionado")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Aplica los cambios y guarda el formulario principal para confirmarlos. Las relaciones anidadas y los archivos se editan desde el registro original.",
              )}
            </DialogDescription>
          </DialogHeader>
          {editing && childObject && (
            <DynamicForm
              key={`${editing.index}:${editing.values.id ?? "new"}`}
              object={childObject}
              values={editing.values}
              submitLabel="Aplicar al formulario"
              onCancel={() => setEditing(null)}
              onSave={async (data) => {
                stage(data);
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
