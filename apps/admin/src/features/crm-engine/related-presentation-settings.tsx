import { useQuery } from "@tanstack/react-query";
import type { CrmObject } from "@savia/crm-shared/metadata";
import type { RelationDefinition } from "@savia/crm-shared/relations";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import { supportsLocalRecordTools } from "./collection-capabilities";
import { PropertySection } from "./property-section";

export function RelatedPresentationSettings({
  objectName,
  config,
  objects,
  onChange,
}: {
  objectName: string;
  config: Record<string, unknown>;
  objects: CrmObject[];
  onChange: (next: Record<string, unknown>) => void;
}) {
  const runtime = getCrmRuntime();
  const relations = useQuery({
    queryKey: ["collection-relations", runtime.apiBasePath, runtime.domainId],
    queryFn: () => api<{ data: RelationDefinition[] }>("/collection-relations"),
    enabled: !!config.collectionRelation,
  });
  const relation = relations.data?.data.find(
    (r) => r.id === config.collectionRelation,
  );
  const targetName =
    relation?.sourceObject === objectName
      ? relation.targetObject
      : relation?.sourceObject;
  const target = objects.find((o) => o.name === targetName);
  const parent = objects.find((o) => o.name === objectName);
  const supported =
    relation?.storage === "local" &&
    !!target &&
    supportsLocalRecordTools(target) &&
    (!parent || supportsLocalRecordTools(parent));
  const presentation = String(config.relationPresentation ?? "selector");
  const multiple =
    relation?.cardinality === "many-to-many" ||
    (relation?.sourceObject === objectName &&
      relation?.cardinality === "one-to-many");
  const eligible = Object.entries(target?.config.fields ?? {}).filter(
    ([, field]) =>
      !field.hidden &&
      !["R2Attachment", "FormHtml", "DisplayText"].includes(field.type) &&
      !field.config?.collectionRelation,
  );
  const selected = Array.isArray(config.relationFields)
    ? (config.relationFields as string[])
    : eligible.map(([key]) => key);
  const patch = (key: string, value: unknown) =>
    onChange({ ...config, [key]: value });
  return (
    <PropertySection
      title="Registros relacionados"
      searchTerms="relación subformulario tabla columnas permisos"
      help="Edita registros relacionados junto con el formulario principal. Solo disponible para colecciones locales."
    >
      {relations.isPending && <p role="status">Cargando relación…</p>}
      {relations.error && (
        <p role="alert">
          No se pudo cargar la relación.{" "}
          <button type="button" onClick={() => void relations.refetch()}>
            Reintentar
          </button>
        </p>
      )}
      <label className="studio-control">
        Presentación
        <select
          aria-label="Presentación de registros relacionados"
          value={presentation}
          disabled={!supported}
          onChange={(event) =>
            onChange({
              ...config,
              relationPresentation: event.target.value,
              multiple,
            })
          }
        >
          <option value="selector">Selector de registros</option>
          <option value="subform">Subformulario</option>
          {multiple && <option value="table">Tabla editable</option>}
        </select>
      </label>
      {!supported && !relations.isPending && (
        <p className="studio-field-help">
          Los subformularios y tablas requieren una relación entre colecciones
          locales. Las fuentes externas conservan su selector.
        </p>
      )}
      {supported && presentation !== "selector" && (
        <>
          <fieldset>
            <legend>Campos visibles</legend>
            {eligible.map(([key, field]) => (
              <label className="studio-flag" key={key}>
                <input
                  type="checkbox"
                  checked={
                    !!field.required ||
                    !!field.config?.requiredWhen ||
                    selected.includes(key)
                  }
                  disabled={!!field.required || !!field.config?.requiredWhen}
                  onChange={(event) =>
                    patch(
                      "relationFields",
                      event.target.checked
                        ? [...selected, key]
                        : selected.filter((k) => k !== key),
                    )
                  }
                />
                {field.label}
                {field.required || field.config?.requiredWhen
                  ? " (obligatorio)"
                  : ""}
              </label>
            ))}
          </fieldset>
          <p className="studio-field-help">
            El orden sigue el formulario de la colección relacionada. Los campos
            obligatorios siempre se incluyen. Sus validaciones se configuran en
            esa colección.
          </p>
          <fieldset>
            <legend>Acciones permitidas</legend>
            {(
              [
                ["relationAllowCreate", "Crear registros"],
                ["relationAllowEdit", "Editar registros"],
                ["relationAllowLink", "Vincular existentes"],
                ["relationAllowUnlink", "Desvincular registros"],
              ] as const
            ).map(([key, label]) => (
              <label className="studio-flag" key={key}>
                <input
                  type="checkbox"
                  checked={config[key] !== false}
                  onChange={(event) => patch(key, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="studio-field-help">
            Desvincular conserva el registro original. Los permisos de acceso
            siguen aplicándose. Se admite un nivel de detalle; los archivos se
            gestionan desde el registro relacionado.
          </p>
        </>
      )}
    </PropertySection>
  );
}
