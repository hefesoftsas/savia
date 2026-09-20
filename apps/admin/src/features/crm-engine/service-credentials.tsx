import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, KeyRound, MapPin, Plug, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import { GeocodingSettingsPanel } from "./geocoding-settings-panel";
import "./service-credentials.css";

type IntegrationSummary = {
  id: string;
  name: string;
  connection?: { mode?: string; authType?: string };
  hasSecret?: boolean;
};

export default function ServiceCredentials({
  selected,
  domainTools,
  onNavigate,
}: {
  selected: string;
  domainTools: boolean;
  onNavigate: (name: string, view: string) => void;
}) {
  const t = useMessages(automationMessages);

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<{ data: IntegrationSummary[] }>("/integrations"),
  });

  const configuredIntegrations =
    integrations.data?.data.filter(
      (item) =>
        item.connection?.mode === "external" &&
        (item.hasSecret || item.connection?.authType === "none"),
    ) ?? [];
  const pendingIntegrations =
    integrations.data?.data.filter(
      (item) =>
        item.connection?.mode === "external" &&
        item.connection?.authType !== "none" &&
        !item.hasSecret,
    ) ?? [];

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("Configuración")}</p>
          <h1>{t("Claves y servicios")}</h1>
          <p>
            {t(
              "Administra las credenciales del espacio. Se cifran en el servidor y no se devuelven al navegador.",
            )}
          </p>
        </div>
        <span className="neutral-badge">
          <KeyRound size={14} aria-hidden="true" /> {t("Secretos del tenant")}
        </span>
      </div>

      <section className="credentials-section">
        <div className="credentials-section-heading">
          <MapPin size={18} aria-hidden="true" />
          <div>
            <h2>{t("Mapas y direcciones")}</h2>
            <p>
              {t(
                "Necesaria solo si activas autocompletar de direcciones con Geoapify. Photon y Nominatim no requieren clave.",
              )}
            </p>
          </div>
        </div>
        <GeocodingSettingsPanel />
      </section>

      <section className="credentials-section">
        <div className="credentials-section-heading">
          <Plug size={18} aria-hidden="true" />
          <div>
            <h2>{t("Integraciones OpenAPI")}</h2>
            <p>
              {t(
                "Cada integración guarda su propia URL base y credencial cuando conectas un proveedor externo.",
              )}
            </p>
          </div>
        </div>
        {integrations.isLoading ? (
          <p className="credentials-muted">{t("Cargando integraciones…")}</p>
        ) : integrations.error ? (
          <p className="credentials-error" role="alert">
            {integrations.error.message}
          </p>
        ) : integrations.data?.data.length ? (
          <ul className="credentials-list">
            {integrations.data.data.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span className="credentials-muted">
                    {item.connection?.mode === "external"
                      ? item.connection.authType === "none"
                        ? t("Conexión externa sin autenticación")
                        : item.hasSecret
                          ? t("Credencial guardada")
                          : t("Falta credencial")
                      : item.connection?.mode === "demo"
                        ? t("Modo demo")
                        : t("Sin conexión guardada")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="credentials-muted">
            {t("Aún no importaste integraciones en este espacio.")}
          </p>
        )}
        {(pendingIntegrations.length > 0 ||
          configuredIntegrations.length > 0) && (
          <p className="credentials-muted">
            {configuredIntegrations.length} {t("con credencial ·")}{" "}
            {pendingIntegrations.length} {t("pendientes")}
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => onNavigate(selected, "integrations")}
        >
          {t("Administrar integraciones")}
          <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </section>

      {domainTools ? (
        <section className="credentials-section">
          <div className="credentials-section-heading">
            <Database size={18} aria-hidden="true" />
            <div>
              <h2>{t("Fuentes de datos externas")}</h2>
              <p>
                {t(
                  "Los tokens de acceso para recursos JSON:API se guardan por fuente, no de forma global.",
                )}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => onNavigate(selected, "collection-sources")}
          >
            {t("Administrar fuentes de datos")}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </section>
      ) : null}
    </>
  );
}

export function serviceCredentialsHref() {
  const runtime = getCrmRuntime();
  if (runtime.navigate) return "#/service-credentials";
  return "?view=service-credentials";
}
