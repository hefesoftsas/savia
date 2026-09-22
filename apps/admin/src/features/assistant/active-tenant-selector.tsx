import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type {
  AssistantActiveTenant,
  AssistantConfigurationClient,
} from "@/api/assistant-configuration-client";

export type ActiveTenantClient = {
  activeTenant?: () => Promise<AssistantActiveTenant>;
  setActiveTenant?: (tenantId: number) => Promise<AssistantActiveTenant>;
  activeAgency?: () => Promise<AssistantActiveTenant>;
  setActiveAgency?: (agencyId: number) => Promise<AssistantActiveTenant>;
};

export function ActiveTenantSelector({
  client,
}: {
  client: ActiveTenantClient;
}) {
  const [state, setState] = useState<AssistantActiveTenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActive = () => {
    if (client.activeTenant) return client.activeTenant();
    if (client.activeAgency) return client.activeAgency();
    return Promise.reject(new Error("No active tenant method"));
  };

  const updateActive = (tenantId: number) => {
    if (client.setActiveTenant) return client.setActiveTenant(tenantId);
    if (client.setActiveAgency) return client.setActiveAgency(tenantId);
    return Promise.reject(new Error("No setActiveTenant method"));
  };

  useEffect(() => {
    let active = true;
    void fetchActive().then(
      (next) => {
        if (active) setState(next);
      },
      () => {
        if (active) setState({ agencies: [], tenants: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const tenants = state?.tenants ?? state?.agencies ?? [];
  const activeTenantId = state?.activeTenantId ?? state?.activeAgencyId;

  if (!state || tenants.length < 2) return null;

  const selectTenant = async (tenantId: number) => {
    const previous = state;
    setSaving(true);
    setError(null);
    try {
      setState(await updateActive(tenantId));
    } catch (exception) {
      setState(previous);
      setError(
        exception instanceof Error
          ? exception.message
          : "No fue posible actualizar la organización activa.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor="assistant-active-agency"
        >
          Organización activa
        </label>
        <select
          id="assistant-active-agency"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-44 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          value={activeTenantId ?? ""}
          onChange={(event) => void selectTenant(Number(event.target.value))}
          disabled={saving}
        >
          <option value="" disabled>
            Elige una organización
          </option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
        {saving ? (
          <LoaderCircle
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Guardando organización activa"
          />
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const ActiveAgencySelector = ActiveTenantSelector;
export type ActiveAgencyClient = ActiveTenantClient;
