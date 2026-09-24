import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import { parseTenantSlugFromHostname } from "@savia/tenant-host";
import { Building2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import {
  brandingForeground,
  parseTenantBranding,
  type TenantBranding,
} from "@savia/tenant-host/branding";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenantBranding } from "./tenant-branding-provider";
import "./tenant-branding.css";

type Tenant = {
  id: number;
  name: string;
  kind?: string;
  isActive?: boolean | number;
};
type Asset = "logo" | "cover" | "login-animation";
function isLoginAnimationData(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const animation = value as Record<string, unknown>;
  return (
    typeof animation.v === "string" &&
    /^\d/.test(animation.v) &&
    typeof animation.fr === "number" &&
    typeof animation.ip === "number" &&
    typeof animation.op === "number" &&
    Array.isArray(animation.layers)
  );
}
function message(error: unknown): keyof typeof settingsMessages {
  if (error instanceof ApiClientError && error.status === 403)
    return "No tienes permisos para modificar la marca de esta organización.";
  if (
    error instanceof ApiClientError &&
    [400, 413, 415, 422].includes(error.status)
  )
    return "Revisa los datos, las imágenes y la animación. Se permiten PNG, JPEG o WEBP y Lottie JSON de hasta 2 MB.";
  return "No se pudo completar la operación. Revisa tu conexión y vuelve a intentarlo.";
}
export function TenantBrandingPage({ services }: { services: AppServices }) {
  const t = useMessages(settingsMessages);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [canCreateOrganization, setCanCreateOrganization] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dedicated = !!parseTenantSlugFromHostname(window.location.hostname);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setErrorStatus(0);
    setSelected("");
    setTenants([]);
    setCanCreateOrganization(false);
    void (async () => {
      try {
        if (dedicated) {
          const response = await services.apiClient.get<{
            data: {
              id: unknown;
              name: unknown;
              kind: unknown;
            };
          }>("/v1/tenants/current", { signal: controller.signal });
          if (controller.signal.aborted) return;
          const current = response?.data;
          const valid =
            current &&
            Number.isSafeInteger(current.id) &&
            (current.id as number) > 0 &&
            current.kind !== "platform" &&
            typeof current.name === "string"
              ? [
                  {
                    id: current.id as number,
                    name: current.name as string,
                    kind: current.kind as string,
                    isActive: true as const,
                  },
                ]
              : [];
          setTenants(valid);
          setSelected(valid[0] ? String(valid[0].id) : "");
        } else {
          const response = await services.apiClient.get<{
            data: Tenant | Tenant[];
          }>("/v1/tenants", { signal: controller.signal });
          if (controller.signal.aborted) return;
          const list = Array.isArray(response.data)
            ? response.data
            : [response.data];
          // The tenant list endpoint exposes the internal platform tenant only
          // to platform administrators. Use that server-filtered result to offer
          // the create action only to people who can actually use it.
          const canCreateOrganization = list.some(
            (tenant) => tenant?.kind === "platform",
          );
          const valid = list.filter(
            (tenant) =>
              tenant &&
              Number.isSafeInteger(tenant.id) &&
              tenant.id > 0 &&
              tenant.kind !== "platform" &&
              tenant.isActive !== false &&
              tenant.isActive !== 0 &&
              typeof tenant.name === "string",
          );
          setTenants(valid);
          setCanCreateOrganization(canCreateOrganization);
          setSelected(valid[0] ? String(valid[0].id) : "");
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(message(cause));
          setErrorStatus(cause instanceof ApiClientError ? cause.status : 0);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [services.apiClient, dedicated, attempt]);
  return (
    <main className="tenant-branding-page" lang="es">
      <header className="tenant-branding-heading">
        <h1>{t("Marca de tu organización")}</h1>
        <p>
          {t(
            "Personaliza la identidad y la pantalla de acceso de tu equipo. Revisa la vista previa y guarda cuando esté lista.",
          )}
        </p>
      </header>
      {loading ? (
        <p role="status">{t("Cargando organizaciones…")}</p>
      ) : error ? (
        <div role="alert">
          <p>
            {errorStatus === 401
              ? t("Tu sesión expiró. Inicia sesión de nuevo para continuar.")
              : error in settingsMessages
                ? t(error as keyof typeof settingsMessages)
                : error}
          </p>
          <div className="tenant-branding-actions">
            {errorStatus === 401 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void services.authSession.login()}
              >
                {t("Iniciar sesión de nuevo")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("Volver a cargar")}
            </Button>
          </div>
        </div>
      ) : tenants.length ? (
        <>
          {dedicated ? (
            <p className="tenant-branding-agency">{tenants[0].name}</p>
          ) : (
            <div className="tenant-branding-selector">
              <label htmlFor="branding-tenant">{t("Organización")}</label>
              <select
                id="branding-tenant"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <p>
                {t(
                  "Cambiar de organización descarta los cambios que no hayas guardado.",
                )}
              </p>
            </div>
          )}
          {selected && (
            <BrandingEditor
              key={selected}
              tenantId={selected}
              services={services}
            />
          )}
        </>
      ) : (
        <section className="tenant-branding-empty" role="status">
          <div className="tenant-branding-empty-icon" aria-hidden="true">
            <Building2 />
          </div>
          <div className="tenant-branding-empty-copy">
            <h2>
              {canCreateOrganization
                ? t("Aún no hay organizaciones comerciales")
                : t("No tienes organizaciones asignadas")}
            </h2>
            <p>
              {canCreateOrganization
                ? t(
                    "Crea una organización para personalizar su identidad y su pantalla de acceso. Cuando exista, podrás elegirla aquí.",
                  )
                : t(
                    "Pide a un administrador de plataforma que te agregue a una organización para poder editar su marca.",
                  )}
            </p>
            {canCreateOrganization && (
              <Button asChild className="tenant-branding-empty-action">
                <Link to="/tenants/create">
                  <Plus aria-hidden="true" />
                  {t("Crear organización")}
                </Link>
              </Button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
function BrandingEditor({
  tenantId,
  services,
}: {
  tenantId: string;
  services: AppServices;
}) {
  const t = useMessages(settingsMessages);
  const { refetch } = useTenantBranding();
  const [saved, setSaved] = useState<TenantBranding>();
  const [draft, setDraft] = useState<TenantBranding>();
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | Asset>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [previews, setPreviews] = useState<
    Partial<Record<"logo" | "cover", string>>
  >({});
  const [animationName, setAnimationName] = useState("");
  const objectUrls = useRef<Partial<Record<Asset, string>>>({});
  const alive = useRef(true);
  const busy = useRef(false);
  const uploadRequest = useRef<AbortController | null>(null);
  const path = `/v1/tenants/${encodeURIComponent(tenantId)}/branding`;
  function clearPreviews() {
    for (const url of Object.values(objectUrls.current))
      URL.revokeObjectURL(url);
    objectUrls.current = {};
    setPreviews({});
    setAnimationName("");
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadRequest.current?.abort();
      for (const url of Object.values(objectUrls.current))
        URL.revokeObjectURL(url);
      objectUrls.current = {};
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");
    setConflict(false);
    setDraft(undefined);
    setSaved(undefined);
    setCanManage(false);
    clearPreviews();
    void services.apiClient
      .get<{ data: unknown; canManage: boolean }>(path, {
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        const value = parseTenantBranding(response.data);
        if (!value) throw new Error("Invalid branding");
        setDraft(value);
        setSaved(value);
        setCanManage(response.canManage === true);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [services.apiClient, path, reload]);
  function edit<Key extends keyof TenantBranding>(
    key: Key,
    value: TenantBranding[Key],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice("");
  }
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canManage || !dirty || busy.current || conflict) return;
    if (!parseTenantBranding(draft)) {
      setError(
        "Revisa los textos, los colores, las imágenes y la animación antes de guardar.",
      );
      return;
    }
    busy.current = true;
    setPending("save");
    setError("");
    setNotice("");
    try {
      const response = await services.apiClient.put<{ data: unknown }>(
        path,
        draft,
      );
      if (!alive.current) return;
      const value = parseTenantBranding(response.data);
      if (!value) throw new Error("Invalid branding");
      setSaved(value);
      setDraft(value);
      clearPreviews();
      setNotice("Marca guardada.");
      void refetch();
    } catch (cause) {
      if (alive.current) {
        if (cause instanceof ApiClientError && cause.status === 409) {
          setConflict(true);
          setError(
            "La marca fue actualizada por otra persona. Conservamos tus cambios. Cargar la versión guardada reemplazará esta edición.",
          );
        } else setError(message(cause));
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending(undefined);
    }
  }
  async function upload(kind: Asset, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft || !canManage || busy.current) return;
    if (kind === "login-animation") {
      const looksJson =
        file.type === "application/json" ||
        file.type === "" ||
        /\.json$/i.test(file.name);
      if (!looksJson || file.size > 2 * 1024 * 1024 || file.size === 0) {
        setError("Usa un archivo Lottie JSON válido de hasta 2 MB.");
        return;
      }
      try {
        if (!isLoginAnimationData(JSON.parse(await file.text()))) throw 0;
      } catch {
        setError("Usa un archivo Lottie JSON válido de hasta 2 MB.");
        return;
      }
    } else if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024 ||
      file.size === 0
    ) {
      setError("Usa una imagen PNG, JPEG o WEBP de hasta 2 MB.");
      return;
    }
    busy.current = true;
    setPending(kind);
    setError("");
    setNotice("");
    const controller = new AbortController();
    uploadRequest.current = controller;
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await services.apiClient.requestResponse(
        `${path}/assets/${kind}`,
        { method: "POST", body, signal: controller.signal },
      );
      if (!response.ok)
        throw new ApiClientError(
          response.status,
          "upload_failed",
          "Upload failed",
        );
      const result = (await response.json()) as { data?: { url?: unknown } };
      if (!alive.current || controller.signal.aborted) return;
      const url = result.data?.url;
      const urlKey =
        kind === "login-animation" ? "loginAnimationUrl" : `${kind}Url`;
      if (
        typeof url !== "string" ||
        !url.startsWith(`/api/public/tenant-branding/assets/${tenantId}/`) ||
        !parseTenantBranding({ ...draft, [urlKey]: url })
      )
        throw new Error("Invalid asset URL");
      if (kind === "login-animation") {
        setAnimationName(file.name);
        edit("loginAnimationUrl", url);
        setNotice(
          "Animación lista en la vista previa. Guarda los cambios para publicarla.",
        );
      } else {
        const preview = URL.createObjectURL(file);
        if (objectUrls.current[kind])
          URL.revokeObjectURL(objectUrls.current[kind]!);
        objectUrls.current[kind] = preview;
        setPreviews((previous) => ({ ...previous, [kind]: preview }));
        edit(`${kind}Url`, url);
        setNotice(
          "Imagen lista en la vista previa. Guarda los cambios para publicarla.",
        );
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(message(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending(undefined);
    }
  }
  function removeImage(kind: Asset) {
    if (kind === "login-animation") {
      setAnimationName("");
      edit("loginAnimationUrl", null);
      return;
    }
    if (objectUrls.current[kind])
      URL.revokeObjectURL(objectUrls.current[kind]!);
    delete objectUrls.current[kind];
    setPreviews((previous) => ({ ...previous, [kind]: undefined }));
    edit(`${kind}Url`, null);
  }
  if (loading) return <p role="status">{t("Cargando marca…")}</p>;
  if (!draft)
    return (
      <div role="alert">
        <p>
          {error in settingsMessages
            ? t(error as keyof typeof settingsMessages)
            : error}
        </p>
        <Button
          variant="outline"
          onClick={() => setReload((value) => value + 1)}
        >
          {t("Volver a cargar")}
        </Button>
      </div>
    );
  const disabled = !canManage || !!pending;
  const previewStyle = {
    "--brand-preview-primary": draft.primaryColor,
    "--brand-preview-foreground": brandingForeground(draft.primaryColor),
    "--brand-preview-accent": draft.accentColor,
    "--brand-preview-accent-foreground": brandingForeground(draft.accentColor),
  } as CSSProperties;
  return (
    <div className="tenant-branding-layout">
      <form
        className="tenant-branding-editor"
        onSubmit={save}
        aria-busy={!!pending}
      >
        {!canManage && (
          <p className="tenant-branding-note">
            {t(
              "Puedes consultar la marca. Solo los administradores de esta organización pueden modificarla.",
            )}
          </p>
        )}
        <fieldset disabled={disabled}>
          <legend>{t("Identidad")}</legend>
          <div className="tenant-branding-field">
            <label htmlFor="branding-name">{t("Nombre visible")}</label>
            <Input
              id="branding-name"
              value={draft.displayName}
              maxLength={120}
              required
              onChange={(event) => edit("displayName", event.target.value)}
            />
          </div>
          <div className="tenant-branding-colors">
            <div className="tenant-branding-field">
              <label htmlFor="branding-primary">{t("Color principal")}</label>
              <div className="tenant-branding-color">
                <input
                  id="branding-primary"
                  type="color"
                  value={draft.primaryColor}
                  onChange={(event) => edit("primaryColor", event.target.value)}
                />
                <span>{draft.primaryColor}</span>
              </div>
            </div>
            <div className="tenant-branding-field">
              <label htmlFor="branding-accent">{t("Color de acento")}</label>
              <div className="tenant-branding-color">
                <input
                  id="branding-accent"
                  type="color"
                  value={draft.accentColor}
                  onChange={(event) => edit("accentColor", event.target.value)}
                />
                <span>{draft.accentColor}</span>
              </div>
            </div>
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{t("Pantalla de acceso")}</legend>
          <div className="tenant-branding-field">
            <label htmlFor="branding-title">{t("Título de acceso")}</label>
            <Input
              id="branding-title"
              value={draft.loginTitle}
              maxLength={120}
              required
              onChange={(event) => edit("loginTitle", event.target.value)}
            />
          </div>
          <div className="tenant-branding-field">
            <label htmlFor="branding-description">
              {t("Mensaje de bienvenida")}
            </label>
            <textarea
              id="branding-description"
              value={draft.loginDescription}
              maxLength={600}
              rows={3}
              onChange={(event) => edit("loginDescription", event.target.value)}
            />
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{t("Animación de acceso")}</legend>
          <p className="tenant-branding-help">
            {t(
              "Archivo Lottie JSON de hasta 2 MB. Reemplaza la animación de Savia y tiene prioridad sobre la portada. Sin animación se muestra la de Savia.",
            )}
          </p>
          <div className="tenant-branding-field">
            <label htmlFor="branding-login-animation">
              {t("Subir animación Lottie")}
            </label>
            <Input
              id="branding-login-animation"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void upload("login-animation", event)}
            />
            {pending === "login-animation" && (
              <p role="status">{t("Subiendo animación…")}</p>
            )}
            {draft.loginAnimationUrl && (
              <p className="tenant-branding-help" role="status">
                {animationName
                  ? t("Animación seleccionada: %{name}.", {
                      name: animationName,
                    })
                  : t("Animación personalizada activa.")}
              </p>
            )}
            {draft.loginAnimationUrl && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => removeImage("login-animation")}
              >
                {t("Restaurar animación por defecto")}
              </Button>
            )}
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{t("Imágenes")}</legend>
          <p className="tenant-branding-help">
            {t(
              "PNG, JPEG o WEBP de hasta 2 MB. El logo se ajusta sin recortes; la portada puede recortarse para llenar el espacio.",
            )}
          </p>
          {(["logo", "cover"] as const).map((kind) => (
            <div className="tenant-branding-field" key={kind}>
              <label htmlFor={`branding-${kind}`}>
                {kind === "logo" ? t("Subir logo") : t("Subir portada")}
              </label>
              <Input
                id={`branding-${kind}`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload(kind, event)}
              />
              {pending === kind && <p role="status">{t("Subiendo imagen…")}</p>}
              {draft[`${kind}Url`] && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => removeImage(kind)}
                >
                  {kind === "logo" ? t("Quitar logo") : t("Quitar portada")}
                </Button>
              )}
            </div>
          ))}
        </fieldset>
        {error && (
          <div role="alert" className="tenant-branding-error">
            <p>
              {error in settingsMessages
                ? t(error as keyof typeof settingsMessages)
                : error}
            </p>
            {conflict && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                {t("Cargar versión guardada")}
              </Button>
            )}
          </div>
        )}
        {notice && (
          <p role="status">
            {notice in settingsMessages
              ? t(notice as keyof typeof settingsMessages)
              : notice}
          </p>
        )}
        <div className="tenant-branding-actions">
          <Button type="submit" disabled={disabled || !dirty || conflict}>
            {pending === "save" ? t("Guardando…") : t("Guardar cambios")}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={disabled || !dirty}
            onClick={() => {
              setDraft(saved);
              clearPreviews();
              setNotice("");
              if (!conflict) setError("");
            }}
          >
            {t("Descartar cambios")}
          </Button>
        </div>
        {dirty && (
          <p className="tenant-branding-help">
            {t("Cambios sin guardar. La vista previa solo se muestra aquí.")}
          </p>
        )}
      </form>
      <aside
        className="tenant-branding-preview"
        aria-label={t("Vista previa de marca")}
        style={previewStyle}
      >
        <div className="tenant-branding-preview-label">
          {t("Vista previa · acceso")}
        </div>
        <div className="tenant-branding-preview-content">
          {draft.loginAnimationUrl ? (
            <p className="tenant-branding-preview-animation" role="status">
              {t("Se mostrará tu animación Lottie en lugar de la portada.")}
            </p>
          ) : (
            (previews.cover ?? draft.coverUrl) && (
              <img
                className="tenant-branding-cover"
                src={previews.cover ?? draft.coverUrl!}
                alt={t("Portada de la organización")}
              />
            )
          )}
          <div className="tenant-branding-preview-form">
            <div className="tenant-branding-preview-identity">
              {(previews.logo ?? draft.logoUrl) && (
                <img
                  className="tenant-branding-logo"
                  src={previews.logo ?? draft.logoUrl!}
                  alt={`Logo de ${draft.displayName}`}
                />
              )}
              <strong>{draft.displayName}</strong>
            </div>
            <h2>{draft.loginTitle}</h2>
            <p>{draft.loginDescription}</p>
            <div className="tenant-branding-preview-input">
              {t("Correo electrónico")}
            </div>
            <div className="tenant-branding-preview-button" aria-hidden="true">
              {t("Continuar")}
            </div>
            <p className="tenant-branding-preview-caption">
              {t("Vista previa, sin inicio de sesión.")}
            </p>
          </div>
        </div>
        <div className="tenant-branding-preview-label">
          {t("Vista previa · aplicación")}
        </div>
        <div className="tenant-branding-preview-nav">
          <span className="tenant-branding-preview-selected">
            {t("Inicio")}
          </span>
          <span>{t("Mi organización")}</span>
        </div>
      </aside>
    </div>
  );
}
