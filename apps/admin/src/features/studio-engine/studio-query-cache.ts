import { QueryClient } from "@tanstack/react-query";

export function createStudioQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 0,
        refetchOnWindowFocus: false,
        networkMode: "always",
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

type StudioCacheEntry = {
  client: QueryClient;
  owner: string;
  bootstrapped: boolean;
  bootstrapFailed: boolean;
};

const entries = new Map<string, StudioCacheEntry>();
let currentOwner: string | undefined;

function tenantKeyOf(tenantId: string): string {
  return tenantId.trim() || "default";
}

/**
 * Cliente de consultas de Studio conservado en memoria por combinación de
 * sesión y tenant. Vive en los servicios de la app (módulo singleton),
 * fuera de StudioRoot, para reutilizarlo al volver al mismo tenant.
 * Nunca comparte datos entre tenants: cada tenant tiene su entrada.
 */
export function getStudioQueryEntry(
  tenantId: string,
  owner: string,
): StudioCacheEntry {
  const key = tenantKeyOf(tenantId);
  const existing = entries.get(key);
  if (existing && existing.owner === owner) return existing;
  if (existing) {
    try {
      void existing.client.cancelQueries();
    } catch {
      // La cancelación es mejor esfuerzo al rotar de sesión.
    }
    existing.client.clear();
    entries.delete(key);
  }
  const entry: StudioCacheEntry = {
    client: createStudioQueryClient(),
    owner,
    bootstrapped: false,
    bootstrapFailed: false,
  };
  entries.set(key, entry);
  return entry;
}

export function getStudioQueryClient(
  tenantId: string,
  owner: string,
): QueryClient {
  return getStudioQueryEntry(tenantId, owner).client;
}

export function isStudioBootstrapped(tenantId: string, owner: string): boolean {
  const entry = entries.get(tenantKeyOf(tenantId));
  return Boolean(
    entry &&
    entry.owner === owner &&
    entry.bootstrapped &&
    !entry.bootstrapFailed,
  );
}

export function markStudioBootstrapped(tenantId: string, owner: string): void {
  const entry = entries.get(tenantKeyOf(tenantId));
  if (entry && entry.owner === owner) {
    entry.bootstrapped = true;
    entry.bootstrapFailed = false;
  }
}

export function markStudioBootstrapFailed(
  tenantId: string,
  owner: string,
): void {
  const entry = entries.get(tenantKeyOf(tenantId));
  if (entry && entry.owner === owner) {
    entry.bootstrapFailed = true;
    entry.bootstrapped = false;
  }
}

export function clearStudioTenant(tenantId: string, owner?: string): void {
  const key = tenantKeyOf(tenantId);
  const entry = entries.get(key);
  if (!entry) return;
  if (owner !== undefined && entry.owner !== owner) return;
  try {
    void entry.client.cancelQueries();
  } catch {
    // Mejor esfuerzo.
  }
  entry.client.clear();
  entries.delete(key);
}

/**
 * Vacía los clientes al cerrar sesión, cambiar de usuario o perder
 * autorización. No toca LocalWorkspace ni suscripciones: solo consultas.
 */
export function clearStudioQueryCache(): void {
  for (const [, entry] of entries) {
    try {
      void entry.client.cancelQueries();
    } catch {
      // Mejor esfuerzo.
    }
    entry.client.clear();
  }
  entries.clear();
  currentOwner = undefined;
}

/** Conserva solo los tenants válidos después de cambiar los permisos. */
export function pruneStudioQueryCache(validTenantIds: Set<string>): void {
  const valid = new Set([...validTenantIds].map(tenantKeyOf));
  for (const [key, entry] of entries) {
    if (!valid.has(key)) {
      try {
        void entry.client.cancelQueries();
      } catch {
        // Mejor esfuerzo.
      }
      entry.client.clear();
      entries.delete(key);
    }
  }
}

/**
 * Fija el propietario (sesión+usuario) actual. Si cambia, vacía todo para
 * aislar usuarios. Devuelve true si rotó.
 */
export function setStudioQueryOwner(owner: string | undefined): boolean {
  if (owner === currentOwner) return false;
  if (currentOwner !== undefined || owner !== undefined) {
    if (owner !== currentOwner) {
      clearStudioQueryCache();
      currentOwner = owner;
      return true;
    }
  }
  currentOwner = owner;
  return false;
}

export function getStudioQueryOwner(): string | undefined {
  return currentOwner;
}

export function studioCacheOwner(
  environment: string,
  identityId: string | number,
): string {
  return `${environment}|${String(identityId)}`;
}

/** Mark one tenant's retained Studio queries stale after a local plugin install. */
export function invalidateStudioTenantQueries(tenantId: string): Promise<void> {
  const entry = entries.get(tenantKeyOf(tenantId));
  return entry
    ? entry.client.invalidateQueries({ refetchType: "none" })
    : Promise.resolve();
}
