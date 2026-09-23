import { Building2 } from "lucide-react";
import { useSaviaRequestWorkspace } from "./savia-request-provider";
import { useTenantOptions } from "./savia-request-scope";

export function SaviaRequestScopeBar() {
  const {
    scope,
    scopeLabel,
    canOverrideScope,
    scopeOptions,
    isPlatformAdmin,
    applyScopeOverride,
    busy,
  } = useSaviaRequestWorkspace();
  const tenants = useTenantOptions(canOverrideScope && isPlatformAdmin);

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm"
      role="status"
    >
      <Building2 className="size-4 text-primary" aria-hidden="true" />
      <span>
        <strong>Ámbito:</strong> {scopeLabel}
      </span>
      {scope ? (
        <span className="text-muted-foreground">
          · Los cambios solo afectan a este tenant.
        </span>
      ) : (
        <span className="text-muted-foreground">
          · Catálogo compartido de plataforma.
        </span>
      )}
      {canOverrideScope && !isPlatformAdmin ? (
        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">Tenant administrado</span>
          <select
            aria-label="Tenant administrado"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            disabled={busy}
            onChange={(event) => applyScopeOverride(event.target.value || null)}
            value={scope ?? ""}
          >
            <option value="">Seleccionar tenant…</option>
            {scopeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {canOverrideScope && isPlatformAdmin ? (
        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">Inspeccionar tenant</span>
          <select
            aria-label="Inspeccionar tenant"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            disabled={busy || tenants.status === "loading"}
            onChange={(event) => applyScopeOverride(event.target.value || null)}
            value={scope ?? ""}
          >
            <option value="">Catálogo global</option>
            {tenants.status === "loading" ? (
              <option value="" disabled>
                Cargando tenants…
              </option>
            ) : null}
            {tenants.options.map((option) => (
              <option key={option.scope} value={option.scope}>
                {option.name} (#{option.id})
              </option>
            ))}
            {scope &&
            !tenants.options.some((option) => option.scope === scope) ? (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ) : null}
          </select>
        </label>
      ) : null}
    </div>
  );
}
