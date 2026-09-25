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

function domainKeyOf(domainId: string): string {
  return domainId.trim() || "default";
}

/**
 * Cliente de consultas de Studio conservado en memoria por combinación de
 * sesión y dominio. Vive en los servicios de la app (módulo singleton),
 * fuera de StudioRoot, para reutilizarlo al volver al mismo dominio.
 * Nunca comparte datos entre dominios: cada dominio tiene su entrada.
 */
export function getStudioQueryEntry(
  domainId: string,
  owner: string,
): StudioCacheEntry {
  const key = domainKeyOf(domainId);
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
  domainId: string,
  owner: string,
): QueryClient {
  return getStudioQueryEntry(domainId, owner).client;
}

export function isStudioBootstrapped(domainId: string, owner: string): boolean {
  const entry = entries.get(domainKeyOf(domainId));
  return Boolean(
    entry &&
    entry.owner === owner &&
    entry.bootstrapped &&
    !entry.bootstrapFailed,
  );
}

export function markStudioBootstrapped(domainId: string, owner: string): void {
  const entry = entries.get(domainKeyOf(domainId));
  if (entry && entry.owner === owner) {
    entry.bootstrapped = true;
    entry.bootstrapFailed = false;
  }
}

export function markStudioBootstrapFailed(
  domainId: string,
  owner: string,
): void {
  const entry = entries.get(domainKeyOf(domainId));
  if (entry && entry.owner === owner) {
    entry.bootstrapFailed = true;
    entry.bootstrapped = false;
  }
}

export function clearStudioDomain(domainId: string, owner?: string): void {
  const key = domainKeyOf(domainId);
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

/** Conserva solo los dominios válidos (p. ej. tras eliminar un dominio). */
export function pruneStudioQueryCache(validDomainIds: Set<string>): void {
  const valid = new Set([...validDomainIds].map(domainKeyOf));
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
