/**
 * Allowlist of TanStack Query keys that may be persisted to IndexedDB.
 *
 * React Admin dataProvider queries use `[resource, operation, params]`, and
 * the CRM studio hooks use `[topic, ...scope]`, so matching the first
 * segment is enough. Unknown keys default to NOT persisted: persisting a
 * new sensitive query must be a deliberate change here, never an accident.
 *
 * Deliberately EXCLUDED even though they look cacheable:
 * - session, identity-of-self, account, password flows, sessions (tokens
 *   and credentials stay out of persistent browser storage per PRODUCT.md)
 * - integrations, integration-runs, geocoding-settings, collection-sources
 *   (connection configs and API keys live behind these endpoints)
 * - record details/files/links, managed-customer, customers,
 *   plate/vehicle lookups, operational-tasks, savia-request, assistant,
 *   my-day, dashboard (customer PII or live data that goes stale
 *   dangerously)
 *
 * Customer-data LISTS are opt-in per collection below (never global), with
 * a short TTL enforced at restore time.
 */
const PERSISTED_RESOURCE_PREFIXES: ReadonlySet<string> = new Set([
  // React Admin resources (admin screens).
  "users",
  "tenants",
  // CRM studio metadata (no PII, no secrets): setup flag, relation
  // definitions, collection catalog, saved table views, object schemas.
  "business-setup",
  "collection-relations",
  "collection-catalog",
  "views",
  "objects",
]);

export function shouldPersistQueryKey(queryKey: unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return false;
  const [first] = queryKey;
  if (typeof first === "string" && PERSISTED_RESOURCE_PREFIXES.has(first)) {
    return true;
  }
  return isPiiQueryKey(queryKey);
}

/**
 * Per-collection opt-in for customer-data lists. NEVER global: each entry
 * is a deliberate PII decision (short TTL at restore, wiped on logout).
 * Only aggregate list queries (`pipeline`, `summary`) are eligible —
 * single-record details (`record-detail`, files, links) are never persisted.
 */
export const OFFLINE_PII_COLLECTIONS: ReadonlySet<string> = new Set([
  "cotizaciones",
  "cotizaciones_detalle",
]);

const PII_LIST_PREFIXES: ReadonlySet<string> = new Set([
  "pipeline",
  "summary",
]);

export function isPiiQueryKey(queryKey: unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey.length < 2) return false;
  const [first, second] = queryKey;
  return (
    typeof first === "string" &&
    PII_LIST_PREFIXES.has(first) &&
    typeof second === "string" &&
    OFFLINE_PII_COLLECTIONS.has(second)
  );
}
