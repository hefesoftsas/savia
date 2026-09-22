import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { AssistantConfigurationClient } from "@/api/assistant-configuration-client";

type ActiveAgencyClient = Pick<
  AssistantConfigurationClient,
  "activeAgency" | "setActiveAgency"
>;

export function ActiveAgencySelector({
  client,
}: {
  client: ActiveAgencyClient;
}) {
  const [state, setState] = useState<Awaited<ReturnType<ActiveAgencyClient["activeAgency"]>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void client.activeAgency().then(
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

  if (!state || state.agencies.length < 2) return null;

  const selectAgency = async (agencyId: number) => {
    const previous = state;
    setSaving(true);
    setError(null);
    try {
      setState(await client.setActiveAgency(agencyId));
    } catch (exception) {
      setState(previous);
      setError(
        exception instanceof Error
          ? exception.message
          : "No fue posible actualizar la agencia activa.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="assistant-active-agency">
          Agencia activa
        </label>
        <select
          id="assistant-active-agency"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-44 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          value={state.activeAgencyId ?? ""}
          onChange={(event) => void selectAgency(Number(event.target.value))}
          disabled={saving}
        >
          <option value="" disabled>Elige una agencia</option>
          {state.agencies.map((agency) => (
            <option key={agency.id} value={agency.id}>{agency.name}</option>
          ))}
        </select>
        {saving ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Guardando agencia activa" /> : null}
      </div>
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export const ActiveTenantSelector = ActiveAgencySelector;
export type ActiveTenantClient = ActiveAgencyClient;

