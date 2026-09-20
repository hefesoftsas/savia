import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  WebhookDestinationInput,
  WebhookDestinationSummary,
} from "@savia/crm-shared/workflow-webhooks";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
const scope = () =>
  JSON.stringify([
    getCrmRuntime().domainId,
    getCrmRuntime().apiBasePath,
    getCrmRuntime().localWorkspace?.scope,
  ]);
export function WorkflowWebhookSettings({
  workflowId,
}: {
  workflowId: string;
}) {
  const t = useMessages(automationMessages);

  const client = useQueryClient(),
    key = ["workflow-webhook", scope(), workflowId];
  const endpoint = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ data: { id: string } | null }>(`/workflows/${workflowId}/webhook`),
  });
  const [secret, setSecret] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const change = async (rotate: boolean) => {
    setBusy(true);
    setError("");
    setSecret(null);
    try {
      const response = await api<{ data: { id: string; secret?: string } }>(
        `/workflows/${workflowId}/webhook${rotate ? "/rotate" : ""}`,
        "POST",
      );
      client.setQueryData(key, { data: { id: response.data.id } });
      setSecret(response.data.secret ?? null);
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
  const example = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_SECRET' \\\n  -H 'Idempotency-Key: unique-event-id' \\\n  -d '{"name":"Example"}'`;
  return (
    <section className="wf-webhook" aria-label={t("Webhook recibido")}>
      <h3>{t("Recibir eventos externos")}</h3>
      <p className="wf-muted">
        {t(
          "Publica y activa el flujo para recibir eventos. Los campos JSON estarán disponibles como variables, por ejemplo",
        )}{" "}
        <code>trigger.name</code>.
      </p>
      {endpoint.isPending ? (
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
        disabled={busy || endpoint.isPending}
        onClick={() => void change(!!url)}
      >
        {busy
          ? t("Guardando…")
          : url
            ? t("Rotar secreto del webhook")
            : t("Crear URL y secreto")}
      </Button>
      {secret ? (
        <div className="wf-webhook-secret">
          <label>
            {t("Secreto del webhook")}
            <Input readOnly value={secret} />
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
const empty: WebhookDestinationInput = { name: "", url: "", authType: "none" };
export function WorkflowDestinationPicker({
  value,
  onChange,
}: {
  value: { destinationId: string; destinationRevision: number };
  onChange: (v: { destinationId: string; destinationRevision: number }) => void;
}) {
  const t = useMessages(automationMessages);

  const client = useQueryClient(),
    key = ["workflow-webhook-destinations", scope()];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ data: WebhookDestinationSummary[] }>(
        "/workflow-webhook-destinations",
      ),
  });
  const [editing, setEditing] = useState<
      WebhookDestinationSummary | null | undefined
    >(undefined),
    [form, setForm] = useState<WebhookDestinationInput>(empty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = query.data?.data.find((d) => d.id === value.destinationId);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(async () => {
      const response = await api<{ data: WebhookDestinationSummary }>(
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
          disabled={busy || query.isPending}
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
                  await api(
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
              placeholder={t("https://api.tusistema.com/eventos")}
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
                    ? { authHeader: "X-API-Key" }
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
            <>
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
              {editing ? (
                <p className="wf-muted">
                  {t(
                    "Deja vacío para conservar la credencial. Rotarla también afecta las versiones anteriores con la misma autenticación.",
                  )}
                </p>
              ) : null}
            </>
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
                    await api(
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
