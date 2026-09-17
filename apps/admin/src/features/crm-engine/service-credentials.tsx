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
          <p className="eyebrow">Configuración</p>
          <h1>Claves y servicios</h1>
          <p>
            Administra las credenciales del espacio. Se cifran en el servidor y
            no se devuelven al navegador.
          </p>
        </div>
        <span className="neutral-badge">
          <KeyRound size={14} aria-hidden="true" /> Secretos del tenant
        </span>
      </div>

      <section className="credentials-section">
        <div className="credentials-section-heading">
          <MapPin size={18} aria-hidden="true" />
          <div>
            <h2>Mapas y direcciones</h2>
            <p>
              Necesaria solo si activas autocompletar de direcciones con
              Geoapify. Photon y Nominatim no requieren clave.
            </p>
          </div>
        </div>
        <GeocodingSettingsPanel />
      </section>

      <section className="credentials-section">
        <div className="credentials-section-heading">
          <Plug size={18} aria-hidden="true" />
          <div>
            <h2>Integraciones OpenAPI</h2>
            <p>
              Cada integración guarda su propia URL base y credencial cuando
              conectas un proveedor externo.
            </p>
          </div>
        </div>
        {integrations.isLoading ? (
          <p className="credentials-muted">Cargando integraciones…</p>
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
                        ? "Conexión externa sin autenticación"
                        : item.hasSecret
                          ? "Credencial guardada"
                          : "Falta credencial"
                      : item.connection?.mode === "demo"
                        ? "Modo demo"
                        : "Sin conexión guardada"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="credentials-muted">
            Aún no importaste integraciones en este espacio.
          </p>
        )}
        {(pendingIntegrations.length > 0 || configuredIntegrations.length > 0) && (
          <p className="credentials-muted">
            {configuredIntegrations.length} con credencial ·{" "}
            {pendingIntegrations.length} pendientes
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => onNavigate(selected, "integrations")}
        >
          Administrar integraciones
          <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </section>

      {domainTools ? (
        <section className="credentials-section">
          <div className="credentials-section-heading">
            <Database size={18} aria-hidden="true" />
            <div>
              <h2>Fuentes de datos externas</h2>
              <p>
                Los tokens de acceso para recursos JSON:API se guardan por
                fuente, no de forma global.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => onNavigate(selected, "collection-sources")}
          >
            Administrar fuentes de datos
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
