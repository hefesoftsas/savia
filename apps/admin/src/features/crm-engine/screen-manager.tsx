import { withScreen } from "./screen-metadata";
export { withScreen, sortScreens } from "./screen-metadata";
import { Fragment, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isPluginScreen } from "./extension-screens";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Save, Trash2, Undo2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import {
  recordSurfaces,
  screenNavigationSections,
  type CrmObject,
  type RecordSurface,
  type ScreenNavigationSection,
} from "@savia/crm-shared/metadata";
import { type LookupIcon } from "@savia/crm-shared/request-page";
import { api } from "./api";
import { LookupIconPicker } from "./lookup-icon-picker";

const surfaceLabels: Record<RecordSurface, string> = {
  modal: "Ventana modal",
  drawer: "Panel lateral corto",
  "drawer-long": "Panel lateral largo",
  page: "Otra página",
};

const screenNavigationSectionLabels: Record<ScreenNavigationSection, string> = {
  operation: "Trabajo",
  productivity: "Construir",
  administration: "Administración",
  management: "Plataforma",
};

function ScreenNavigationFields({
  object,
  section,
  icon,
  busy,
  compact = false,
  onSectionChange,
  onIconChange,
}: {
  object: CrmObject;
  section: ScreenNavigationSection;
  icon: LookupIcon;
  busy: boolean;
  compact?: boolean;
  onSectionChange: (section: ScreenNavigationSection) => void;
  onIconChange: (icon: LookupIcon) => void;
}) {
  return (
    <div
      className={`screen-navigation-fields${compact ? " screen-navigation-fields--compact" : ""}`}
    >
      <label className="screen-presentation-field">
        <span>Sección del menú</span>
        <select
          aria-label={`Sección de ${object.label} en el menú`}
          disabled={busy}
          value={section}
          onChange={(event) =>
            onSectionChange(event.target.value as ScreenNavigationSection)
          }
        >
          {screenNavigationSections.map((entry) => (
            <option key={entry} value={entry}>
              {screenNavigationSectionLabels[entry]}
            </option>
          ))}
        </select>
      </label>
      <div className="screen-presentation-field">
        <span>Icono</span>
        <LookupIconPicker
          value={icon}
          onChange={onIconChange}
          libraries={["lucide"]}
          aria-label={`Icono de ${object.label} en el menú`}
        />
      </div>
    </div>
  );
}

export function reorderScreensList(
  screens: CrmObject[],
  sourceName: string,
  beforeName?: string,
): CrmObject[] {
  const source = screens.find((screen) => screen.name === sourceName);
  if (!source) return screens;
  const next = screens.filter((screen) => screen.name !== sourceName);
  let insertAt = next.length;
  if (beforeName) {
    const targetIndex = next.findIndex((screen) => screen.name === beforeName);
    insertAt = targetIndex < 0 ? next.length : targetIndex;
  }
  next.splice(insertAt, 0, source);
  return next;
}

function ScreenModeSelect({
  object,
  kind,
  value,
  busy,
  onChange,
}: {
  object: CrmObject;
  kind: "create" | "edit";
  value: RecordSurface;
  busy: boolean;
  onChange: (mode: RecordSurface) => void;
}) {
  const label = kind === "create" ? "Nuevo registro" : "Editar registro";
  return (
    <label className="screen-presentation-field">
      <span>{label}</span>
      <select
        aria-label={`Abrir ${label} de ${object.label} en`}
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value as RecordSurface)}
      >
        {recordSurfaces.map((surface) => (
          <option key={surface} value={surface}>
            {surfaceLabels[surface]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ScreenManager({
  objects,
  onSaved,
  initialRemoval,
  onCancel,
  variant = "table",
}: {
  objects: CrmObject[];
  initialRemoval?: string;
  onCancel?: () => void;
  onSaved: (object: CrmObject) => Promise<void>;
  variant?: "table" | "detail";
}) {
  const [drafts, setDrafts] = useState(objects);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(
    initialRemoval ?? null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setDrafts((prev) => {
      const localByName = new Map(prev.map((item) => [item.name, item]));
      return objects.map((incoming) => {
        const local = localByName.get(incoming.name);
        if (!local) return incoming;
        return withScreen(incoming, {
          createMode: local.config.studio?.screen?.createMode,
          editMode: local.config.studio?.screen?.editMode,
          hidden:
            incoming.config.studio?.screen?.hidden ??
            local.config.studio?.screen?.hidden,
          section:
            incoming.config.studio?.screen?.section ??
            local.config.studio?.screen?.section,
          icon:
            incoming.config.studio?.screen?.icon ??
            local.config.studio?.screen?.icon,
        });
      });
    });
  }, [objects]);
  async function save(
    object: CrmObject,
    changes: {
      label?: string;
      hidden?: boolean;
      createMode?: RecordSurface;
      editMode?: RecordSurface;
      section?: ScreenNavigationSection;
      icon?: LookupIcon;
    },
  ) {
    if (busy) return;
    const optimistic = withScreen(object, changes);
    setDrafts((prev) =>
      prev.map((item) => (item.name === object.name ? optimistic : item)),
    );
    setBusy(object.name);
    setError("");
    try {
      const list = await api<{ data: CrmObject[] }>("/objects");
      const latest =
        list.data.find((item) => item.name === object.name) ?? object;
      const result = await api(`/objects/${object.name}/screen`, "PATCH", {
        ...changes,
        version: latest.version ?? 1,
      });
      setDrafts((prev) =>
        prev.map((item) =>
          item.name === result.data.name ? result.data : item,
        ),
      );
      await onSaved(result.data);
      if (changes.label !== undefined)
        setLabels((prev) => {
          const next = { ...prev };
          delete next[object.name];
          return next;
        });
      setRemoving(null);
      toast.success(
        changes.hidden === true
          ? "Pantalla oculta"
          : changes.hidden === false
            ? "Pantalla recuperada"
            : "Cambios guardados",
      );
    } catch (e) {
      setDrafts((prev) =>
        prev.map((item) => (item.name === object.name ? object : item)),
      );
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (variant === "detail" && drafts.length === 1 && !initialRemoval) {
    const object = drafts[0];
    const hidden = !!object.config.studio?.screen?.hidden;
    const createMode = object.config.studio?.screen?.createMode ?? "modal";
    const editMode = object.config.studio?.screen?.editMode ?? "modal";
    const section = object.config.studio?.screen?.section ?? "operation";
    const icon = object.config.studio?.screen?.icon ?? "file-text";
    return (
      <div className="screen-manager screen-manager-detail">
        {error ? (
          <p role="alert" className="screen-manager-error">
            {error}
          </p>
        ) : null}
        <section
          className="screen-presentation-section"
          aria-labelledby="screen-presentation-identity"
        >
          <div className="screen-presentation-section-header">
            <div className="flex items-center gap-2">
              <h2 id="screen-presentation-identity">Identidad en el menú</h2>
              {isPluginScreen(object.name) ? (
                <span className="screen-admin-plugin-badge">Plugin</span>
              ) : null}
            </div>
            <span
              className={`screen-setting-status${hidden ? " is-hidden" : ""}`}
            >
              {hidden ? "Fuera del menú" : "Visible en Tu negocio"}
            </span>
          </div>
          <p className="screen-presentation-lede">
            El nombre que verán las personas en el menú de Tu negocio.
          </p>
          <form
            className="screen-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              const label = (labels[object.name] ?? object.label).trim();
              if (label && label.length <= 100 && label !== object.label)
                void save(object, { label });
            }}
          >
            <label htmlFor={`screen-name-${object.name}`}>
              Nombre de la pantalla
            </label>
            <div className="screen-name-controls">
              <Input
                id={`screen-name-${object.name}`}
                aria-label={`Nombre de pantalla ${object.label}`}
                value={labels[object.name] ?? object.label}
                maxLength={100}
                disabled={!!busy}
                onChange={(event) =>
                  setLabels((prev) => ({
                    ...prev,
                    [object.name]: event.target.value,
                  }))
                }
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    variant="default"
                    size="icon"
                    aria-label={`Guardar nombre de ${object.label}`}
                    disabled={
                      !!busy ||
                      !(labels[object.name] ?? object.label).trim() ||
                      (labels[object.name] ?? object.label).trim() ===
                        object.label ||
                      (labels[object.name] ?? object.label).trim().length > 100
                    }
                  >
                    <Save aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  Guardar nombre
                </TooltipContent>
              </Tooltip>
            </div>
          </form>
        </section>
        <section
          className="screen-presentation-section"
          aria-labelledby="screen-presentation-navigation"
        >
          <h2 id="screen-presentation-navigation">Ubicación en el menú</h2>
          <p className="screen-presentation-lede">
            Elige en qué sección aparece la pantalla y el icono que la
            identifica.
          </p>
          <ScreenNavigationFields
            object={object}
            section={section}
            icon={icon}
            busy={!!busy}
            onSectionChange={(section) => save(object, { section })}
            onIconChange={(icon) => save(object, { icon })}
          />
        </section>
        <section
          className="screen-presentation-section"
          aria-labelledby="screen-presentation-forms"
        >
          <h2 id="screen-presentation-forms">Cómo se abren los formularios</h2>
          <p className="screen-presentation-lede">
            Elige dónde aparece el formulario al crear o editar un registro.
          </p>
          <div className="screen-presentation-fields">
            <ScreenModeSelect
              object={object}
              kind="create"
              value={createMode}
              busy={!!busy}
              onChange={(createMode) => save(object, { createMode })}
            />
            <ScreenModeSelect
              object={object}
              kind="edit"
              value={editMode}
              busy={!!busy}
              onChange={(editMode) => save(object, { editMode })}
            />
          </div>
        </section>
        <section
          className="screen-presentation-section"
          aria-labelledby="screen-presentation-menu"
        >
          <h2 id="screen-presentation-menu">Visibilidad en la barra lateral</h2>
          <p className="screen-presentation-lede">
            {hidden
              ? "Esta pantalla está oculta de la barra lateral, pero sigue disponible para ser llamada desde otras páginas o flujos."
              : "Esta pantalla aparece visible en la barra lateral izquierda."}
          </p>
          <div className="screen-sidebar-visibility-toggle mb-4">
            <div className="flex items-center justify-between gap-4 py-2 border-b border-border/50">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">
                  Mostrar en la barra lateral
                </span>
                <p className="text-xs text-muted-foreground">
                  Desactívalo si esta pantalla solo se llamará desde otras
                  páginas o flujos.
                </p>
              </div>
              <Switch
                aria-label={`Mostrar u ocultar ${object.label} en la barra lateral`}
                checked={!hidden}
                disabled={!!busy}
                onCheckedChange={(checked) =>
                  save(object, { hidden: !checked })
                }
              />
            </div>
          </div>
          {removing === object.name && !hidden ? (
            <div className="screen-removal">
              <p>
                ¿Eliminar «{object.label}» de Tu negocio? Los registros se
                conservarán.
              </p>
              <div>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setRemoving(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={!!busy}
                  onClick={() => save(object, { hidden: true })}
                >
                  Eliminar del menú
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant={hidden ? "outline" : "outline"}
              disabled={!!busy}
              onClick={() =>
                hidden
                  ? save(object, { hidden: false })
                  : setRemoving(object.name)
              }
            >
              {busy === object.name ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  Guardando…
                </>
              ) : hidden ? (
                "Recuperar en el menú"
              ) : (
                "Eliminar del menú"
              )}
            </Button>
          )}
        </section>
      </div>
    );
  }
  return (
    <div className="screen-manager">
      {error && (
        <p role="alert" className="screen-manager-error">
          {error}
        </p>
      )}
      <table className="screen-manager-table">
        <colgroup>
          <col className="screen-col-name" />
          <col className="screen-col-mode" />
          <col className="screen-col-mode" />
          <col className="screen-col-navigation" />
          <col className="screen-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Pantalla</th>
            <th scope="col">Nuevo registro</th>
            <th scope="col">Editar registro</th>
            <th scope="col">Menú</th>
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((object) => {
            const hidden = !!object.config.studio?.screen?.hidden;
            const section =
              object.config.studio?.screen?.section ?? "operation";
            const icon = object.config.studio?.screen?.icon ?? "file-text";
            return (
              <Fragment key={object.name}>
                <tr>
                  <th scope="row" className="screen-setting-title">
                    {initialRemoval ? (
                      <>
                        <strong>{object.label}</strong>
                        <span
                          className={`screen-setting-status${hidden ? " is-hidden" : ""}`}
                        >
                          {hidden ? "Fuera del menú" : "Visible en Tu negocio"}
                        </span>
                      </>
                    ) : (
                      <form
                        className="screen-name-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const label = (
                            labels[object.name] ?? object.label
                          ).trim();
                          if (
                            label &&
                            label.length <= 100 &&
                            label !== object.label
                          )
                            void save(object, { label });
                        }}
                      >
                        <div className="screen-name-form-meta">
                          <label htmlFor={`screen-name-${object.name}`}>
                            Nombre de la pantalla
                          </label>
                          <div className="flex items-center gap-1.5">
                            {isPluginScreen(object.name) ? (
                              <span className="screen-admin-plugin-badge">
                                Plugin
                              </span>
                            ) : null}
                            <span
                              className={`screen-setting-status${hidden ? " is-hidden" : ""}`}
                            >
                              {hidden
                                ? "Fuera del menú"
                                : "Visible en Tu negocio"}
                            </span>
                          </div>
                        </div>
                        <div className="screen-name-controls">
                          <Input
                            id={`screen-name-${object.name}`}
                            aria-label={`Nombre de pantalla ${object.label}`}
                            value={labels[object.name] ?? object.label}
                            maxLength={100}
                            disabled={!!busy}
                            onChange={(event) =>
                              setLabels((prev) => ({
                                ...prev,
                                [object.name]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            aria-label={`Guardar nombre de ${object.label}`}
                            disabled={
                              !!busy ||
                              !(labels[object.name] ?? object.label).trim() ||
                              (labels[object.name] ?? object.label).trim() ===
                                object.label ||
                              (labels[object.name] ?? object.label).trim()
                                .length > 100
                            }
                          >
                            Guardar
                          </Button>
                        </div>
                      </form>
                    )}
                  </th>
                  {!initialRemoval ? (
                    <>
                      <td>
                        <label className="screen-mode">
                          <span className="screen-mode-label">
                            Nuevo registro
                          </span>
                          <select
                            aria-label={`Abrir Nuevo registro de ${object.label} en`}
                            value={
                              object.config.studio?.screen?.createMode ??
                              "modal"
                            }
                            disabled={!!busy}
                            onChange={(e) =>
                              save(object, {
                                createMode: e.target.value as RecordSurface,
                              })
                            }
                          >
                            {recordSurfaces.map((value) => (
                              <option key={value} value={value}>
                                {surfaceLabels[value]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td>
                        <label className="screen-mode">
                          <span className="screen-mode-label">
                            Editar registro
                          </span>
                          <select
                            aria-label={`Abrir Editar registro de ${object.label} en`}
                            value={
                              object.config.studio?.screen?.editMode ?? "modal"
                            }
                            disabled={!!busy}
                            onChange={(e) =>
                              save(object, {
                                editMode: e.target.value as RecordSurface,
                              })
                            }
                          >
                            {recordSurfaces.map((value) => (
                              <option key={value} value={value}>
                                {surfaceLabels[value]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td className="screen-navigation-cell">
                        <ScreenNavigationFields
                          object={object}
                          section={section}
                          icon={icon}
                          busy={!!busy}
                          compact
                          onSectionChange={(section) =>
                            save(object, { section })
                          }
                          onIconChange={(icon) => save(object, { icon })}
                        />
                      </td>
                      <td className="screen-setting-action">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!!busy}
                          title={
                            hidden
                              ? `Recuperar pantalla ${object.label}`
                              : `Eliminar pantalla ${object.label}`
                          }
                          aria-label={`${hidden ? "Recuperar" : "Eliminar"} pantalla ${object.label}`}
                          onClick={() =>
                            hidden
                              ? save(object, { hidden: false })
                              : setRemoving(object.name)
                          }
                        >
                          {busy === object.name ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : hidden ? (
                            <Undo2 size={16} />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </Button>
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} />
                  )}
                </tr>
                {removing === object.name && !hidden ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="screen-removal">
                        <p>
                          ¿Eliminar «{object.label}» de Tu negocio? Los
                          registros se conservarán.
                        </p>
                        <div>
                          <Button
                            variant="outline"
                            disabled={!!busy}
                            onClick={() =>
                              initialRemoval && onCancel
                                ? onCancel()
                                : setRemoving(null)
                            }
                          >
                            Cancelar
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!!busy}
                            onClick={() => save(object, { hidden: true })}
                          >
                            Eliminar del menú
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
