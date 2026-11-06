import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  WebhookDestinationInput,
  WebhookDestinationSummary,
} from "@savia/studio-shared/workflow-webhooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  nativeWebhookCacheKey,
  nativeWebhookDestinationsCacheKey,
  nativeWorkflowRequest,
  webhookCurlExample,
} from "@/services/native-workflow-service";
import { useNativeMessages } from "./use-native-messages";

const empty: WebhookDestinationInput = { name: "", url: "", authType: "none" };

export function WorkflowWebhookSettings({
  organizationId,
  workflowId,
}: {
  organizationId: string;
  workflowId: string;
}) {
  const t = useNativeMessages();
  const key = nativeWebhookCacheKey(organizationId, workflowId);
  const endpoint = useSWR(key, () =>
    nativeWorkflowRequest<{ data: { id: string } | null }>(
      organizationId,
      `/workflows/${workflowId}/webhook`,
    ),
  );
  const identity = `${organizationId}:${workflowId}`;
  const [secret, setSecret] = useState<{
    identity: string;
    value: string;
  } | null>(null);
  const visibleSecret = secret?.identity === identity ? secret.value : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSecret(null);
    setError("");
  }, [organizationId, workflowId]);
  const change = async (rotate: boolean) => {
    setBusy(true);
    setError("");
    setSecret(null);
    try {
      const response = await nativeWorkflowRequest<{
        data: { id: string; secret?: string };
      }>(
        organizationId,
        `/workflows/${workflowId}/webhook${rotate ? "/rotate" : ""}`,
        "POST",
      );
      await endpoint.mutate({ data: { id: response.data.id } }, false);
      setSecret(
        response.data.secret ? { identity, value: response.data.secret } : null,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const url = endpoint.data?.data?.id
    ? new URL(
        `/api/public/workflow-webhooks/${endpoint.data.data.id}`,
        import.meta.env.VITE_SAVIA_API_URL || window.location.origin,
      ).href
    : "";
  const example = webhookCurlExample(url);
  return (
    <section className="wf-webhook" aria-label={t("Webhook recibido")}>
      <h3>{t("Recibir eventos externos")}</h3>
      <p className="wf-muted">
        {t(
          "Publica y activa el flujo para recibir eventos. Los campos JSON estarán disponibles como variables, por ejemplo",
        )}{" "}
        <code>trigger.name</code>.
      </p>
      {endpoint.isLoading ? (
        <p role="status">{t("Cargando webhook…")}</p>
      ) : null}
      {url ? (
        <>
          <label>
            {t("URL del webhook")}
            <Input readOnly value={url} />
          </label>
          <details>
            <summary>{t("Ejemplo de solicitud")}</summary>
            <pre>{example}</pre>
          </details>
          <p className="wf-muted">
            {t(
              "Reutiliza el identificador del evento si reenvías una solicitud. Rotar el secreto invalida el anterior inmediatamente.",
            )}
          </p>
        </>
      ) : null}
      <Button
        variant="outline"
        disabled={busy || endpoint.isLoading}
        onClick={() => void change(!!url)}
      >
        {busy
          ? t("Guardando…")
          : url
            ? t("Rotar secreto del webhook")
            : t("Crear URL y secreto")}
      </Button>
      {visibleSecret ? (
        <div className="wf-webhook-secret">
          <label>
            {t("Secreto del webhook")}
            <Input readOnly value={visibleSecret} />
          </label>
          <p className="wf-muted">
            {t("Cópialo ahora. No podrás volver a consultarlo.")}
          </p>
          <Button variant="outline" onClick={() => setSecret(null)}>
            {t("Ocultar secreto")}
          </Button>
        </div>
      ) : null}
      {error || endpoint.error ? (
        <p role="alert">{error || String(endpoint.error)}</p>
      ) : null}
    </section>
  );
}

export function WorkflowDestinationPicker({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: { destinationId: string; destinationRevision: number };
  onChange: (v: { destinationId: string; destinationRevision: number }) => void;
}) {
  const t = useNativeMessages();
  const { mutate } = useSWRConfig();
  const key = nativeWebhookDestinationsCacheKey(organizationId);
  const query = useSWR(key, () =>
    nativeWorkflowRequest<{ data: WebhookDestinationSummary[] }>(
      organizationId,
      "/workflow-webhook-destinations",
    ),
  );
  const [editing, setEditing] = useState<
    WebhookDestinationSummary | null | undefined
  >(undefined);
  const [form, setForm] = useState<WebhookDestinationInput>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = query.data?.data.find((d) => d.id === value.destinationId);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate(key);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(async () => {
      const response = await nativeWorkflowRequest<{
        data: WebhookDestinationSummary;
      }>(
        organizationId,
        editing
          ? `/workflow-webhook-destinations/${editing.id}`
          : "/workflow-webhook-destinations",
        editing ? "PUT" : "POST",
        editing ? { revision: editing.revision, config: form } : form,
      );
      onChange({
        destinationId: response.data.id,
        destinationRevision: response.data.revision,
      });
      setEditing(undefined);
      setForm(empty);
    });
  return (
    <section className="wf-webhook" aria-label={t("Destino del webhook")}>
      <label>
        {t("Destino HTTPS")}
        <select
          value={value.destinationId}
          disabled={busy || query.isLoading}
          onChange={(e) => {
            const d = query.data?.data.find((v) => v.id === e.target.value);
            if (d)
              onChange({
                destinationId: d.id,
                destinationRevision: d.revision,
              });
          }}
        >
          <option value="">{t("Selecciona un destino")}</option>
          {query.data?.data.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.enabled ? "" : t(" · desactivado")}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="wf-muted">
          {t("Versión elegida:")} {value.destinationRevision}.{" "}
          {selected.enabled
            ? t("Destino activo.")
            : t("Destino desactivado; no se enviarán solicitudes.")}
        </p>
      ) : null}
      {selected && selected.revision !== value.destinationRevision ? (
        <Button
          variant="outline"
          onClick={() =>
            onChange({
              destinationId: selected.id,
              destinationRevision: selected.revision,
            })
          }
        >
          {t("Usar versión")} {selected.revision}
        </Button>
      ) : null}
      <div className="wf-actions">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setEditing(null);
            setForm(empty);
            setError("");
          }}
        >
          {t("Nuevo destino")}
        </Button>
        {selected ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(selected);
                setForm({
                  name: selected.name,
                  url: selected.url,
                  authType: selected.authType,
                  ...(selected.authHeader
                    ? { authHeader: selected.authHeader }
                    : {}),
                });
                setError("");
              }}
            >
              {t("Editar destino")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await nativeWorkflowRequest(
                    organizationId,
                    `/workflow-webhook-destinations/${selected.id}/enabled`,
                    "POST",
                    { enabled: !selected.enabled },
                  );
                })
              }
            >
              {selected.enabled
                ? t("Desactivar destino")
                : t("Activar destino")}
            </Button>
          </>
        ) : null}
      </div>
      {editing !== undefined ? (
        <fieldset className="wf-destination-form">
          <legend>{editing ? t("Editar destino") : t("Nuevo destino")}</legend>
          <label>
            {t("Nombre del destino")}
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t("URL HTTPS")}
            <Input
              type="url"
              placeholder="https://api.example.com/events"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>
          <label>
            {t("Autenticación")}
            <select
              value={form.authType}
              onChange={(e) =>
                setForm({
                  name: form.name,
                  url: form.url,
                  authType: e.target
                    .value as WebhookDestinationInput["authType"],
                  ...(e.target.value === "api-key"
                    ? { authHeader: form.authHeader || "X-API-Key" }
                    : {}),
                })
              }
            >
              <option value="none">{t("Sin credencial")}</option>
              <option value="bearer">{t("Token Bearer")}</option>
              <option value="api-key">{t("API key en cabecera")}</option>
            </select>
          </label>
          {form.authType === "api-key" ? (
            <label>
              {t("Nombre de cabecera")}
              <Input
                value={form.authHeader ?? ""}
                onChange={(e) =>
                  setForm({ ...form, authHeader: e.target.value })
                }
              />
            </label>
          ) : null}
          {form.authType !== "none" ? (
            <label>
              {t("Credencial")}
              <Input
                type="password"
                autoComplete="new-password"
                value={form.secret ?? ""}
                onChange={(e) =>
                  setForm({ ...form, secret: e.target.value || undefined })
                }
              />
            </label>
          ) : null}
          <div className="wf-actions">
            <Button
              disabled={busy || !form.name.trim() || !form.url}
              onClick={() => void save()}
            >
              {busy ? t("Guardando…") : t("Guardar destino")}
            </Button>
            {editing && form.secret ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await nativeWorkflowRequest(
                      organizationId,
                      `/workflow-webhook-destinations/${editing.id}/secret`,
                      "POST",
                      { secret: form.secret },
                    );
                    setForm({ ...form, secret: undefined });
                  })
                }
              >
                {t("Rotar solo credencial")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(undefined);
                setForm(empty);
              }}
            >
              {t("Cancelar")}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {error || query.error ? (
        <p role="alert">{error || String(query.error)}</p>
      ) : null}
      <p className="wf-muted">
        {t(
          "Se envía un POST JSON. Los fallos temporales tienen hasta 3 intentos con la misma clave de idempotencia; el receptor debe respetarla para evitar duplicados.",
        )}
      </p>
    </section>
  );
}
