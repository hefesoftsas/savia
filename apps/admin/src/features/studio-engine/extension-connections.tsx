import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  ExtensionConnectionSummary,
  ExtensionRuntimeClient,
} from "../../api/extension-runtime-client";

export type ExtensionConnectionField = {
  name: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  json?: boolean;
};

export type ExtensionConnectionConnector = {
  connectorId: string;
  label: string;
  fields: readonly ExtensionConnectionField[];
};

type ExtensionConnectionsClient = Pick<
  ExtensionRuntimeClient,
  "listConnections" | "replaceConnection" | "removeConnection"
>;

export function ExtensionConnections({
  extensionId,
  label,
  connectors,
  client,
}: {
  extensionId: string;
  label?: string;
  connectors: readonly ExtensionConnectionConnector[];
  client: ExtensionConnectionsClient;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();
  const message = (reason: unknown) =>
    reason instanceof Error
      ? reason.message
      : t("No se pudo actualizar la conexión. Intenta de nuevo.");

  const [connections, setConnections] = useState<ExtensionConnectionSummary[]>(
    [],
  );
  const [connectionId, setConnectionId] = useState("");
  const [connectorId, setConnectorId] = useState(
    connectors[0]?.connectorId ?? "",
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const connector = useMemo(
    () => connectors.find((item) => item.connectorId === connectorId),
    [connectorId, connectors],
  );

  async function reload() {
    setConnections(await client.listConnections(extensionId));
  }

  useEffect(() => {
    let active = true;
    void client
      .listConnections(extensionId)
      .then((listed) => {
        if (active) setConnections(listed);
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, extensionId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connector || !connectionId.trim()) {
      setError(t("Elige un conector y asigna un identificador a la conexión."));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const configuredValues = Object.fromEntries(
        connector.fields.map((field) => {
          const value = values[field.name] ?? "";
          if (!field.json) return [field.name, value];
          try {
            const parsed: unknown = JSON.parse(value);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error("invalid");
            return [field.name, parsed];
          } catch {
            throw new Error(
              t("%{value0} debe ser un objeto JSON válido.", {
                value0: field.label,
              }),
            );
          }
        }),
      );
      await client.replaceConnection(extensionId, connectionId.trim(), {
        connectorId: connector.connectorId,
        values: configuredValues,
      });
      setValues({});
      setNotice(
        t("Conexión guardada. Los valores secretos no se vuelven a mostrar."),
      );
      await reload();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await client.removeConnection(extensionId, id);
      setNotice(t("Conexión eliminada."));
      await reload();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!connectors.length) return null;

  return (
    <section
      aria-label={t("Conexiones de %{value0}", {
        value0: label ?? extensionId,
      })}
      className="border-t bg-muted/20 px-6 py-5"
    >
      <div className="max-w-2xl space-y-4">
        <div>
          <h4 className="text-sm font-semibold">{t("Conexiones")}</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Configura una conexión para este espacio. Las credenciales se cifran y no se muestran de nuevo.",
            )}
          </p>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            className="text-sm text-emerald-700 dark:text-emerald-300"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        <form
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2"
          onSubmit={(event) => void save(event)}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            {t("Identificador")}
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={busy}
              onChange={(event) => setConnectionId(event.target.value)}
              value={connectionId}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t("Conector")}
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={busy}
              onChange={(event) => {
                setConnectorId(event.target.value);
                setValues({});
              }}
              value={connectorId}
            >
              {connectors.map((item) => (
                <option key={item.connectorId} value={item.connectorId}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {connector?.fields.map((field) => (
            <label
              className="grid gap-1.5 text-sm font-medium"
              key={field.name}
            >
              {field.label}
              {field.multiline ? (
                <textarea
                  className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
                  disabled={busy}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  value={values[field.name] ?? ""}
                />
              ) : (
                <input
                  autoComplete={field.secret ? "new-password" : undefined}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  disabled={busy}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  type={field.secret ? "password" : "text"}
                  value={values[field.name] ?? ""}
                />
              )}
            </label>
          ))}
          <div className="sm:col-span-2">
            <Button disabled={busy} type="submit">
              {busy ? t("Guardando…") : t("Guardar conexión")}
            </Button>
          </div>
        </form>
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("Cargando conexiones…")}
          </p>
        ) : null}
        {!loading && connections.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {connections.map((connection) => (
              <li
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={connection.connectionId}
              >
                <div>
                  <p className="text-sm font-medium">
                    {connection.connectionId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connection.connectorId} {t("· Actualizada")}{" "}
                    {new Date(connection.updatedAt).toLocaleString(
                      intlLocale(locale),
                    )}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => void remove(connection.connectionId)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("Eliminar conexión")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
