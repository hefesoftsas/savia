import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
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
  type StudioObject,
  type RecordSurface,
  type ScreenNavigationSection,
} from "@savia/studio-shared/metadata";
import { type LookupIcon } from "@savia/studio-shared/request-page";
import { api } from "./api";
import { LookupIconPicker } from "./lookup-icon-picker";

const surfaceLabels: Record<RecordSurface, keyof typeof studioMessages> = {
  modal: "Ventana modal",
  drawer: "Panel lateral corto",
  "drawer-long": "Panel lateral largo",
  page: "Otra página",
};

const screenNavigationSectionLabels: Record<
  ScreenNavigationSection,
  keyof typeof studioMessages
> = {
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
  object: StudioObject;
  section: ScreenNavigationSection;
  icon: LookupIcon;
  busy: boolean;
  compact?: boolean;
  onSectionChange: (section: ScreenNavigationSection) => void;
  onIconChange: (icon: LookupIcon) => void;
}) {
  const t = useMessages(studioMessages);
  return (
    <div
      className={`screen-navigation-fields${compact ? " screen-navigation-fields--compact" : ""}`}
    >
      <label className="screen-presentation-field">
        <span>{t("Sección del menú")}</span>
        <select
          aria-label={t("Sección de %{v1} en el menú", { v1: object.label })}
          disabled={busy}
          value={section}
          onChange={(event) =>
            onSectionChange(event.target.value as ScreenNavigationSection)
          }
        >
          {screenNavigationSections.map((entry) => (
            <option key={entry} value={entry}>
              {t(screenNavigationSectionLabels[entry])}
            </option>
          ))}
        </select>
      </label>
      <div className="screen-presentation-field">
        <span>{t("Icono")}</span>
        <LookupIconPicker
          value={icon}
          onChange={onIconChange}
          libraries={["lucide"]}
          aria-label={t("Icono de %{v1} en el menú", { v1: object.label })}
        />
      </div>
    </div>
  );
}

export function reorderScreensList(
  screens: StudioObject[],
  sourceName: string,
  beforeName?: string,
): StudioObject[] {
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
  object: StudioObject;
  kind: "create" | "edit";
  value: RecordSurface;
  busy: boolean;
  onChange: (mode: RecordSurface) => void;
}) {
  const t = useMessages(studioMessages);
  const label = kind === "create" ? t("Nuevo registro") : t("Editar registro");
  return (
    <label className="screen-presentation-field">
      <span>{label}</span>
      <select
        aria-label={t("Abrir %{v1} de %{v2} en", {
          v1: label,
          v2: object.label,
        })}
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value as RecordSurface)}
      >
        {recordSurfaces.map((surface) => (
          <option key={surface} value={surface}>
            {t(surfaceLabels[surface])}
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
  objects: StudioObject[];
  initialRemoval?: string;
  onCancel?: () => void;
  onSaved: (object: StudioObject) => Promise<void>;
  variant?: "table" | "detail";
}) {
  const t = useMessages(studioMessages);
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
    object: StudioObject,
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
      const list = await api<{ data: StudioObject[] }>("/objects");
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
          ? t("Pantalla oculta")
          : changes.hidden === false
            ? t("Pantalla recuperada")
            : t("Cambios guardados"),
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
              <h2 id="screen-presentation-identity">
                {t("Identidad en el menú")}
              </h2>
              {isPluginScreen(object.name) ? (
                <span className="screen-admin-plugin-badge">{t("Plugin")}</span>
              ) : null}
            </div>
            <span
              className={`screen-setting-status${hidden ? " is-hidden" : ""}`}
            >
              {hidden ? t("Fuera del menú") : t("Visible en Tu negocio")}
            </span>
          </div>
          <p className="screen-presentation-lede">
            {t("El nombre que verán las personas en el menú de Tu negocio.")}
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
              {t("Nombre de la pantalla")}
            </label>
            <div className="screen-name-controls">
              <Input
                id={`screen-name-${object.name}`}
                aria-label={t("Nombre de pantalla %{v1}", { v1: object.label })}
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
                    aria-label={t("Guardar nombre de %{v1}", {
                      v1: object.label,
                    })}
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
                  {t("Guardar nombre")}
                </TooltipContent>
              </Tooltip>
            </div>
          </form>
        </section>
        <section
          className="screen-presentation-section"
          aria-labelledby="screen-presentation-navigation"
        >
          <h2 id="screen-presentation-navigation">
            {t("Ubicación en el menú")}
          </h2>
          <p className="screen-presentation-lede">
            {t(
              "Elige en qué sección aparece la pantalla y el icono que la identifica.",
            )}
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
          <h2 id="screen-presentation-forms">
            {t("Cómo se abren los formularios")}
          </h2>
          <p className="screen-presentation-lede">
            {t(
              "Elige dónde aparece el formulario al crear o editar un registro.",
            )}
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
          <h2 id="screen-presentation-menu">
            {t("Visibilidad en la barra lateral")}
          </h2>
          <p className="screen-presentation-lede">
            {hidden
              ? t(
                  "Esta pantalla está oculta de la barra lateral, pero sigue disponible para ser llamada desde otras páginas o flujos.",
                )
              : t(
                  "Esta pantalla aparece visible en la barra lateral izquierda.",
                )}
          </p>
          <div className="screen-sidebar-visibility-toggle mb-4">
            <div className="flex items-center justify-between gap-4 py-2 border-b border-border/50">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">
                  {t("Mostrar en la barra lateral")}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Desactívalo si esta pantalla solo se llamará desde otras páginas o flujos.",
                  )}
                </p>
              </div>
              <Switch
                aria-label={t("Mostrar u ocultar %{v1} en la barra lateral", {
                  v1: object.label,
                })}
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
                {t("¿Eliminar «")}
                {object.label}
                {t("» de Tu negocio? Los registros se conservarán.")}
              </p>
              <div>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setRemoving(null)}
                >
                  {t("Cancelar")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={!!busy}
                  onClick={() => save(object, { hidden: true })}
                >
                  {t("Eliminar del menú")}
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
                  {t("Guardando…")}
                </>
              ) : hidden ? (
                t("Recuperar en el menú")
              ) : (
                t("Eliminar del menú")
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
            <th scope="col">{t("Pantalla")}</th>
            <th scope="col">{t("Nuevo registro")}</th>
            <th scope="col">{t("Editar registro")}</th>
            <th scope="col">{t("Menú")}</th>
            <th scope="col">
              <span className="sr-only">{t("Acciones")}</span>
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
                          {hidden
                            ? t("Fuera del menú")
                            : t("Visible en Tu negocio")}
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
                            {t("Nombre de la pantalla")}
                          </label>
                          <div className="flex items-center gap-1.5">
                            {isPluginScreen(object.name) ? (
                              <span className="screen-admin-plugin-badge">
                                {t("Plugin")}
                              </span>
                            ) : null}
                            <span
                              className={`screen-setting-status${hidden ? " is-hidden" : ""}`}
                            >
                              {hidden
                                ? t("Fuera del menú")
                                : t("Visible en Tu negocio")}
                            </span>
                          </div>
                        </div>
                        <div className="screen-name-controls">
                          <Input
                            id={`screen-name-${object.name}`}
                            aria-label={t("Nombre de pantalla %{v1}", {
                              v1: object.label,
                            })}
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
                            aria-label={t("Guardar nombre de %{v1}", {
                              v1: object.label,
                            })}
                            disabled={
                              !!busy ||
                              !(labels[object.name] ?? object.label).trim() ||
                              (labels[object.name] ?? object.label).trim() ===
                                object.label ||
                              (labels[object.name] ?? object.label).trim()
                                .length > 100
                            }
                          >
                            {t("Guardar")}
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
                            {t("Nuevo registro")}
                          </span>
                          <select
                            aria-label={t("Abrir Nuevo registro de %{v1} en", {
                              v1: object.label,
                            })}
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
                                {t(surfaceLabels[value])}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td>
                        <label className="screen-mode">
                          <span className="screen-mode-label">
                            {t("Editar registro")}
                          </span>
                          <select
                            aria-label={t("Abrir Editar registro de %{v1} en", {
                              v1: object.label,
                            })}
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
                                {t(surfaceLabels[value])}
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
                              ? t("Recuperar pantalla %{v1}", {
                                  v1: object.label,
                                })
                              : t("Eliminar pantalla %{v1}", {
                                  v1: object.label,
                                })
                          }
                          aria-label={t("%{v1} pantalla %{v2}", {
                            v1: hidden ? t("Recuperar") : t("Eliminar"),
                            v2: object.label,
                          })}
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
                          {t("¿Eliminar «")}
                          {object.label}
                          {t("» de Tu negocio? Los registros se conservarán.")}
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
                            {t("Cancelar")}
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!!busy}
                            onClick={() => save(object, { hidden: true })}
                          >
                            {t("Eliminar del menú")}
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
