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
 * - record-*, managed-customer, customers, plate/vehicle lookups,
 *   operational-tasks, savia-request, assistant, my-day, dashboard
 *   (customer PII or live data that goes stale dangerously)
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
  return typeof first === "string" && PERSISTED_RESOURCE_PREFIXES.has(first);
}
