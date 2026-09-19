import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import { parseTenantSlugFromHostname } from "@savia/tenant-host";
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
type Asset = "logo" | "cover";
function message(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "No tienes permisos para modificar la marca de esta agencia.";
  if (
    error instanceof ApiClientError &&
    [400, 413, 415, 422].includes(error.status)
  )
    return "Revisa los datos y las imágenes. Se permiten PNG, JPEG o WEBP de hasta 2 MB.";
  return "No se pudo completar la operación. Revisa tu conexión y vuelve a intentarlo.";
}
export function TenantBrandingPage({ services }: { services: AppServices }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dedicated = !!parseTenantSlugFromHostname(window.location.hostname);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected("");
    setTenants([]);
    void services.apiClient
      .get<{ data: Tenant | Tenant[] }>(
        dedicated ? "/v1/tenants/current" : "/v1/tenants",
        { signal: controller.signal },
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        const list = Array.isArray(response.data)
          ? response.data
          : [response.data];
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
        setSelected(valid[0] ? String(valid[0].id) : "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [services.apiClient, dedicated, attempt]);
  return (
    <main className="tenant-branding-page" lang="es">
      <header className="tenant-branding-heading">
        <h1>Marca de tu agencia</h1>
        <p>
          Personaliza la identidad y la pantalla de acceso de tu equipo. Revisa
          la vista previa y guarda cuando esté lista.
        </p>
      </header>
      {loading ? (
        <p role="status">Cargando agencias…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Volver a cargar
          </Button>
        </div>
      ) : tenants.length ? (
        <>
          {dedicated ? (
            <p className="tenant-branding-agency">{tenants[0].name}</p>
          ) : (
            <div className="tenant-branding-selector">
              <label htmlFor="branding-tenant">Agencia</label>
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
                Cambiar de agencia descarta los cambios que no hayas guardado.
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
        <p>No hay agencias disponibles para esta cuenta.</p>
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
  const [previews, setPreviews] = useState<Partial<Record<Asset, string>>>({});
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
        "Revisa los textos, los colores y las imágenes antes de guardar.",
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
    if (
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
      if (
        typeof url !== "string" ||
        !url.startsWith(`/api/public/tenant-branding/assets/${tenantId}/`) ||
        !parseTenantBranding({ ...draft, [`${kind}Url`]: url })
      )
        throw new Error("Invalid asset URL");
      const preview = URL.createObjectURL(file);
      if (objectUrls.current[kind])
        URL.revokeObjectURL(objectUrls.current[kind]!);
      objectUrls.current[kind] = preview;
      setPreviews((previous) => ({ ...previous, [kind]: preview }));
      edit(`${kind}Url`, url);
      setNotice(
        "Imagen lista en la vista previa. Guarda los cambios para publicarla.",
      );
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(message(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending(undefined);
    }
  }
  function removeImage(kind: Asset) {
    if (objectUrls.current[kind])
      URL.revokeObjectURL(objectUrls.current[kind]!);
    delete objectUrls.current[kind];
    setPreviews((previous) => ({ ...previous, [kind]: undefined }));
    edit(`${kind}Url`, null);
  }
  if (loading) return <p role="status">Cargando marca…</p>;
  if (!draft)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button
          variant="outline"
          onClick={() => setReload((value) => value + 1)}
        >
          Volver a cargar
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
            Puedes consultar la marca. Solo los administradores de esta agencia
            pueden modificarla.
          </p>
        )}
        <fieldset disabled={disabled}>
          <legend>Identidad</legend>
          <div className="tenant-branding-field">
            <label htmlFor="branding-name">Nombre visible</label>
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
              <label htmlFor="branding-primary">Color principal</label>
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
              <label htmlFor="branding-accent">Color de acento</label>
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
          <legend>Pantalla de acceso</legend>
          <div className="tenant-branding-field">
            <label htmlFor="branding-title">Título de acceso</label>
            <Input
              id="branding-title"
              value={draft.loginTitle}
              maxLength={120}
              required
              onChange={(event) => edit("loginTitle", event.target.value)}
            />
          </div>
          <div className="tenant-branding-field">
            <label htmlFor="branding-description">Mensaje de bienvenida</label>
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
          <legend>Imágenes</legend>
          <p className="tenant-branding-help">
            PNG, JPEG o WEBP de hasta 2 MB. El logo se ajusta sin recortes; la
            portada puede recortarse para llenar el espacio.
          </p>
          {(["logo", "cover"] as const).map((kind) => (
            <div className="tenant-branding-field" key={kind}>
              <label htmlFor={`branding-${kind}`}>
                {kind === "logo" ? "Subir logo" : "Subir portada"}
              </label>
              <Input
                id={`branding-${kind}`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload(kind, event)}
              />
              {pending === kind && <p role="status">Subiendo imagen…</p>}
              {draft[`${kind}Url`] && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => removeImage(kind)}
                >
                  {kind === "logo" ? "Quitar logo" : "Quitar portada"}
                </Button>
              )}
            </div>
          ))}
        </fieldset>
        {error && (
          <div role="alert" className="tenant-branding-error">
            <p>{error}</p>
            {conflict && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                Cargar versión guardada
              </Button>
            )}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="tenant-branding-actions">
          <Button type="submit" disabled={disabled || !dirty || conflict}>
            {pending === "save" ? "Guardando…" : "Guardar cambios"}
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
            Descartar cambios
          </Button>
        </div>
        {dirty && (
          <p className="tenant-branding-help">
            Cambios sin guardar. La vista previa solo se muestra aquí.
          </p>
        )}
      </form>
      <aside
        className="tenant-branding-preview"
        aria-label="Vista previa de marca"
        style={previewStyle}
      >
        <div className="tenant-branding-preview-label">
          Vista previa · acceso
        </div>
        <div className="tenant-branding-preview-content">
          {(previews.cover ?? draft.coverUrl) && (
            <img
              className="tenant-branding-cover"
              src={previews.cover ?? draft.coverUrl!}
              alt="Portada de la agencia"
            />
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
              Correo electrónico
            </div>
            <div className="tenant-branding-preview-button" aria-hidden="true">
              Continuar
            </div>
            <p className="tenant-branding-preview-caption">
              Vista previa, sin inicio de sesión.
            </p>
          </div>
        </div>
        <div className="tenant-branding-preview-label">
          Vista previa · aplicación
        </div>
        <div className="tenant-branding-preview-nav">
          <span className="tenant-branding-preview-selected">Inicio</span>
          <span>Mi agencia</span>
        </div>
      </aside>
    </div>
  );
}
