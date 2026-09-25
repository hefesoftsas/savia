import { useCallback, useEffect, useMemo, useState } from "react";
import { usePermissions } from "ra-core";
import type { AuthPermissions } from "@/auth/auth-session";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";

export const SAVIA_REQUEST_SCOPE_KEY = "savia-request-scope";

const SCOPE_PATTERN = /^[A-Za-z0-9:_.-]{1,120}$/;

export function isValidScope(value: string): boolean {
  return SCOPE_PATTERN.test(value.trim());
}

export function scopeForTenantId(id: number): string {
  return `agency:${id}`;
}

export type ScopeMembership = {
  tenantId?: number;
  agencyId?: number;
  role: string;
};

function isAdminRole(role: string): boolean {
  return role === "tenant_admin" || role === "agency_admin";
}

/** Tenant scopes the user may administer, sorted for stable display. */
export function adminMembershipScopes(
  memberships: readonly ScopeMembership[] | undefined,
): string[] {
  if (!memberships) return [];
  const scopes = new Set<string>();
  for (const membership of memberships) {
    if (!isAdminRole(membership.role)) continue;
    const id = membership.tenantId ?? membership.agencyId;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
      scopes.add(scopeForTenantId(id));
  }
  return [...scopes].sort();
}

export function resolveScope(input: {
  dedicatedTenantId?: number | null;
  memberships?: readonly ScopeMembership[];
  isPlatformAdmin: boolean;
  override?: string | null;
}): string | undefined {
  const adminScopes = adminMembershipScopes(input.memberships);
  const override = input.override?.trim() ?? "";
  if (override) {
    if (!isValidScope(override)) return fallback(input);
    if (input.isPlatformAdmin || adminScopes.includes(override))
      return override;
    return fallback(input);
  }
  return fallback(input);
}

function fallback(input: {
  dedicatedTenantId?: number | null;
  memberships?: readonly ScopeMembership[];
  isPlatformAdmin: boolean;
}): string | undefined {
  if (
    typeof input.dedicatedTenantId === "number" &&
    Number.isSafeInteger(input.dedicatedTenantId) &&
    input.dedicatedTenantId > 0
  )
    return scopeForTenantId(input.dedicatedTenantId);
  const adminScopes = adminMembershipScopes(input.memberships);
  if (!input.isPlatformAdmin && adminScopes.length === 1) return adminScopes[0];
  return undefined;
}

export function scopeLabel(scope: string | undefined): string {
  return scope ?? "Plataforma (catálogo global)";
}

function readStoredOverride(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(SAVIA_REQUEST_SCOPE_KEY);
    return stored && isValidScope(stored) ? stored : null;
  } catch {
    return null;
  }
}

export type TenantOption = { id: number; name: string; scope: string };

export type TenantOptionsState = {
  status: "idle" | "loading" | "ready" | "error";
  options: TenantOption[];
};

/**
 * Commercial tenants a platform administrator may inspect, for the scope
 * picker. Never throws: outside providers it stays idle.
 *
 * La lista se conserva en memoria mientras la sesión y los permisos sigan
 * siendo los mismos: entrar y salir de la ruta no repite la consulta.
 */
let cachedTenantOptions: TenantOption[] | null = null;
let cachedTenantClient: unknown = null;

export function clearCachedTenantOptions(): void {
  cachedTenantOptions = null;
  cachedTenantClient = null;
}

export function useTenantOptions(enabled: boolean): TenantOptionsState {
  const [state, setState] = useState<TenantOptionsState>(() =>
    enabled && cachedTenantOptions
      ? { status: "ready", options: cachedTenantOptions }
      : { status: "idle", options: [] },
  );

  let apiClient: { get: (path: string) => Promise<unknown> } | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    apiClient = useAppServices()?.apiClient;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Outside services provider (e.g. unit tests).
  }

  useEffect(() => {
    if (!enabled || !apiClient) return;
    // Reutiliza la lista conservada si el cliente (sesión) no cambió.
    if (cachedTenantOptions && cachedTenantClient === apiClient) {
      setState({ status: "ready", options: cachedTenantOptions });
      return;
    }
    let cancelled = false;
    setState((previous) =>
      previous.status === "ready" && previous.options.length
        ? previous
        : { status: "loading", options: [] },
    );
    apiClient
      .get("/v1/tenants")
      .then((response) => {
        if (cancelled) return;
        const rows = (response as { data?: unknown })?.data;
        const options = (Array.isArray(rows) ? rows : [])
          .filter(
            (row): row is { id: number; name: string; kind: string } =>
              !!row &&
              typeof row === "object" &&
              typeof (row as { id: unknown }).id === "number" &&
              typeof (row as { name: unknown }).name === "string" &&
              (row as { kind: unknown }).kind === "commercial",
          )
          .map((row) => ({
            id: row.id,
            name: row.name,
            scope: scopeForTenantId(row.id),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        cachedTenantOptions = options;
        cachedTenantClient = apiClient;
        setState({ status: "ready", options });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", options: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, apiClient]);

  return state;
}

export type SaviaRequestScopeState = {
  scope: string | undefined;
  label: string;
  ready: boolean;
  isPlatformAdmin: boolean;
  canOverride: boolean;
  options: string[];
  applyOverride(scope: string | null): void;
};

export function useSaviaRequestScope(): SaviaRequestScopeState {
  const [override, setOverrideState] = useState<string | null>(() =>
    readStoredOverride(),
  );

  let dedicatedTenantId: number | null = null;
  let tenantLoading = false;
  let tenantIsPlatformAdmin = false;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const current = useCurrentTenant();
    dedicatedTenantId =
      current.isDedicated && current.kind === "commercial" ? current.id : null;
    tenantLoading = current.isLoading;
    tenantIsPlatformAdmin = current.isPlatformAdmin;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Outside tenant providers (e.g. unit tests): platform catalog.
  }

  let permissions: AuthPermissions | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { permissions: resolved } = usePermissions<AuthPermissions>();
    permissions = resolved ?? undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Outside react-admin context (e.g. unit tests).
  }

  const isPlatformAdmin =
    tenantIsPlatformAdmin || Boolean(permissions?.canManageIdentity);
  const adminScopes = useMemo(
    () => adminMembershipScopes(permissions?.memberships),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(permissions?.memberships)],
  );
  const scope = resolveScope({
    dedicatedTenantId,
    memberships: permissions?.memberships,
    isPlatformAdmin,
    override,
  });
  const canOverride =
    isPlatformAdmin || (!tenantIsPlatformAdmin && adminScopes.length > 1);

  const applyOverride = useCallback(
    (next: string | null) => {
      const normalized = next?.trim() ?? "";
      if (
        normalized &&
        (!isValidScope(normalized) ||
          (!isPlatformAdmin && !adminScopes.includes(normalized)))
      )
        return;
      setOverrideState(normalized || null);
      try {
        if (typeof window !== "undefined") {
          if (normalized)
            window.localStorage.setItem(SAVIA_REQUEST_SCOPE_KEY, normalized);
          else window.localStorage.removeItem(SAVIA_REQUEST_SCOPE_KEY);
        }
      } catch {
        // Storage unavailable: keep the in-memory scope only.
      }
    },
    [adminScopes, isPlatformAdmin],
  );

  return {
    scope,
    label: scopeLabel(scope),
    ready: !tenantLoading,
    isPlatformAdmin,
    canOverride,
    options: isPlatformAdmin ? [] : adminScopes,
    applyOverride,
  };
}
