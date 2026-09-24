import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./api";

type StoreConnectorField = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  secret: boolean;
};

export type StoreConnectorDeclaration = {
  id: string;
  label: string;
  fields: StoreConnectorField[];
};

type ConnectionSummary = {
  connectionId: string;
  connectorId: string;
  configured: true;
};

function fieldValue(
  field: StoreConnectorField,
  raw: string,
  checked: boolean,
): unknown {
  if (field.type === "boolean") return checked;
  if (field.type === "number") return raw.trim() === "" ? "" : Number(raw);
  return raw;
}

/**
 * Configuración de conexiones de un plugin del store: los valores
 * (incluidos secretos) se guardan cifrados en el host y solo se usan
 * en la ejecución server-side de sus acciones http.
 */
export function StoreConnections({
  extensionId,
  connectors,
}: {
  extensionId: string;
  connectors: StoreConnectorDeclaration[];
}) {
  const t = useMessages(automationMessages);
  const [summaries, setSummaries] = useState<ConnectionSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [checks, setChecks] = useState<Record<string, Record<string, boolean>>>(
    {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    const response = await api<{ data: ConnectionSummary[] }>(
      `/extensions/${extensionId}/connections`,
    );
    setSummaries(response.data);
  }

  useEffect(() => {
    reload().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [extensionId]);

  async function save(connectorId: string, fields: StoreConnectorField[]) {
    setBusy(connectorId);
    setError("");
    try {
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        const value = fieldValue(
          field,
          drafts[connectorId]?.[field.name] ?? "",
          checks[connectorId]?.[field.name] ?? false,
        );
        if (value === "" && !field.required && field.type !== "boolean")
          continue;
        values[field.name] = value;
      }
      await api(
        `/extensions/${extensionId}/connections/${connectorId}`,
        "PUT",
        { connectorId, values },
      );
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function remove(connectionId: string) {
    setBusy(connectionId);
    setError("");
    try {
      await api(
        `/extensions/${extensionId}/connections/${connectionId}`,
        "DELETE",
      );
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  const configured = new Set(summaries.map((item) => item.connectionId));

  return (
    <div className="space-y-4 px-6 pb-5">
      <h4 className="text-sm font-medium text-foreground">{t("Conexiones")}</h4>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {summaries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Sin conexiones configuradas.")}
        </p>
      ) : null}
      {connectors.map((connector) => (
        <div key={connector.id} className="space-y-2 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{connector.label}</span>
            {configured.has(connector.id) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void remove(connector.id)}
                aria-label={t("Eliminar %{value0}", {
                  value0: connector.label,
                })}
              >
                {t("Eliminar")}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {connector.fields.map((field) => (
              <label key={field.name} className="space-y-1 text-sm">
                <span className="text-muted-foreground">
                  {field.name}
                  {field.required ? " *" : ""}
                </span>
                {field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={checks[connector.id]?.[field.name] ?? false}
                    onChange={(event) =>
                      setChecks((current) => ({
                        ...current,
                        [connector.id]: {
                          ...current[connector.id],
                          [field.name]: event.target.checked,
                        },
                      }))
                    }
                  />
                ) : (
                  <Input
                    type={
                      field.secret
                        ? "password"
                        : field.type === "number"
                          ? "number"
                          : "text"
                    }
                    value={drafts[connector.id]?.[field.name] ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [connector.id]: {
                          ...current[connector.id],
                          [field.name]: event.target.value,
                        },
                      }))
                    }
                    autoComplete="off"
                  />
                )}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => void save(connector.id, connector.fields)}
            aria-label={t("Configurar conexión de %{value0}", {
              value0: connector.label,
            })}
          >
            {t("Guardar conexión")}
          </Button>
        </div>
      ))}
    </div>
  );
}
