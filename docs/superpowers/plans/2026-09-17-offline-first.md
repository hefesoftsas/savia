# Offline-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app admin siga siendo útil sin red: lectura de datos en caché con aviso explícito, mutaciones en línea obligatoria donde hay guards de servidor (identidad), y cola offline solo para dominios que la toleren.

**Recommendation (best option): phased read-first, NOT a full sync engine.** Verdict: implementar Fase 0 + Fase 1 y dejar Fase 2 (outbox) y Fase 3 (service worker) como opcionales. Rationale:

- El dolor observado (video 2026-09-17: delete que "reaparece") no era falta de offline sino UI optimista contra guards de servidor (`LAST_ACTIVE_MEMBER`, último admin, auto-eliminación). Eso ya se corrigió con borrado pesimista + confirmación + mensajes en español.
- El 80% del valor offline está en **lectura en caché** (túneles caídos, red inestable): ver Usuarios, Tenants y CRM aunque la red falle, con banner "Sin conexión — datos guardados".
- Una **cola de mutaciones offline es peligrosa para identidad**: un borrado/suspensión encolado puede ser rechazado al sincronizar (el tenant pudo quedarse sin miembros mientras tanto, el usuario pudo ser suspendido por otro admin). Los conflictos no tienen resolución automática segura → identidad queda con red obligatoria y mensaje claro.
- Sin service worker la app igual necesita red para la **primera carga** (shell JS); el SW (Fase 3) solo se justifica si se pide modo avión real, no para red inestable.

**Architecture:** `QueryClient` propio con persister IndexedDB y allowlist de queryKeys seguras; banner online/offline con heartbeat al API; dataProvider sin cambios salvo mapear `TypeError: Failed to fetch` al mensaje offline existente; outbox IndexedDB solo para recursos elegibles (nunca `users`/`tenants`/suspensiones); service worker solo en Fase 3.

**Tech Stack:** TypeScript, React Admin (ra-core 5.15), TanStack Query 5, Dexie 4 (única capa IndexedDB: caché de queries hoy, tabla outbox mañana), `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister`, `navigator.onLine` + eventos online/offline, Vitest + Testing Library, pnpm.

**Decision 2026-09-17 (implemented): Dexie over idb-keyval.** Dexie es más pesado para solo guardar la caché, pero se eligió como única capa IndexedDB porque la Fase 2 (outbox) necesita tablas con índices y estados por operación, cosa que un key-value plano no da. Una sola base `savia-offline` (v1: `queryCache`) evita dos librerías y una migración de datos después.

**Decision 2026-09-17 (implemented): optimistic updates for edits, pessimistic for deletes.** `UserEdit` y `TenantEdit` usan `mutationMode="optimistic"` (revierten solos con error del servidor). Los borrados de identidad siguen pesimistas con confirmación: son destructivos y los guards de servidor (`LAST_ACTIVE_MEMBER`, último admin) los rechazan con frecuencia; el modo optimista/deshacer es lo que causaba el "parece que lo borra pero luego reaparece".

**Decision 2026-09-17 (implemented): all-screens rollout = reads + banner everywhere, mutations stay explicit.** El banner offline vive en la raíz y cubre todas las pantallas; la allowlist suma metadatos del studio CRM (`business-setup`, `collection-relations`, `collection-catalog`, `views`, `objects`). Quedan FUERA a propósito: credenciales (`integrations`, `geocoding-settings`, `collection-sources`), PII de clientes (`record-*`, `managed-customer`, `plate`/`vehicle`) y datos vivos (`operational-tasks`, `savia-request`, `assistant`, `my-day`, `dashboard`). Las mutaciones custom (cotizadores, syncs, credenciales, transferencias) siguen pesimistas explícitas con `retry: false`: tienen efectos de servidor que no se pueden "deshacer" visualmente. Los únicos `<Edit>` ra-core (usuarios, tenants) son optimistas; ningún borrado con deshacer queda en uso.

## Global Constraints

- **Nunca persistir tokens ni credenciales** (`apps/admin/PRODUCT.md`): el persister solo guarda caché de queries API; allowlist explícita, denylist para sesión/cuenta/password/assistente. El access token sigue fuera del almacenamiento persistente.
- Identidad (`users`, `tenants`, suspensiones, sesiones, password-reset) exige conexión: error en español inmediato, sin cola. (Ya implementado para delete en `user-pages.tsx`; extender el patrón.)
- El asistente ejecuta lecturas en vivo por FastMCP y los cambios quedan como propuestas: sin caché, muestra estado offline y bloquea envío.
- Cotizaciones: "guardar antes de ejecutar" ya persiste la intención en servidor; offline solo permite ver solicitudes guardadas, nunca ejecutar proveedor.
- Trabajar contra API local (puertos: admin 5173, api 8787); no `git push` ni despliegues; `pnpm install` tras cambios de dependencias.
- Código, tests y docs en inglés; mensajes de UI en español (convención actual).
- Commits convencionales en inglés (`feat:`, `fix:`, …).
- Cada fase es desplegable por separado y deja la app funcionando sin la siguiente.

---

## File Structure

| Archivo | Responsabilidad |
| --- | --- |
| `apps/admin/src/offline/db.ts` | Base Dexie `savia-offline` v1 (`queryCache`); misma base alojará la tabla outbox en Fase 2. |
| `apps/admin/src/offline/persisted-keys.ts` | Allowlist de prefijos de queryKey seguros para IndexedDB + denylist (sesión, cuenta, password, asistente). |
| `apps/admin/src/offline/query-persister.ts` | Persister TanStack sobre tabla Dexie con filtro `shouldDehydrateQuery`; fallback en memoria donde no hay IndexedDB (tests). |
| `apps/admin/src/offline/query-client.ts` | `createOfflineQueryClient()`: `gcTime` 7 días, `staleTime` 5 min, sin retry sin red, mutaciones sin retry. |
| `apps/admin/src/offline/use-online-status.ts` | Hook `navigator.onLine` + eventos online/offline. |
| `apps/admin/src/offline/offline-banner.tsx` | Banner fijo "Sin conexión — mostrando datos guardados" (igual en todas las pantallas). |
| `apps/admin/src/offline/offline-error.ts` | `isOfflineError(error)` reutilizable (`Failed to fetch`, `NetworkError`, `code AUTHENTICATION_UNAVAILABLE` con causa red). La rama offline de `deleteUserErrorMessage` vive aquí. |
| `apps/admin/src/auth/better-auth-oauth-session.ts` | Refresh tolerante a red (conserva token) + últimos permisos en memoria para no cerrar sesión ni ocultar recursos sin red. |
| `apps/admin/src/offline/mutation-outbox.ts` (Fase 2) | Cola IndexedDB: `enqueue/flush/discard`, elegibilidad por recurso, `last-write-wins` + revalidación contra servidor, reporte de rechazos. |
| `apps/admin/src/app.tsx` | Pasa `queryClient` al `Admin` y monta el banner en el layout. |
| `apps/admin/src/offline/*.test.ts` | Tests de allowlist, banner online/offline, persister filter y (Fase 2) flush con rechazo. |
| `apps/admin/package.json` | Nueva dep: `idb-keyval`. |

## Fase 0: Red obligatoria explícita (base, ~0.5 día)

Sin dependencias nuevas. Hace visible el estado offline en vez de fallar en silencio.

- [ ] **Step 1: helper offline compartido con prueba que falla.**
  Extraer la rama offline de `deleteUserErrorMessage` a `isOfflineError()` en `offline-error.ts`; test con `Error("Failed to fetch")`, `{ code: "AUTHENTICATION_UNAVAILABLE", status: 503 }` y un 403 real (debe dar NO offline).
- [ ] **Step 2: hook + banner mínimo.**
  `use-online-status.ts` (listeners `online`/`offline` + heartbeat cada 30 s solo si hay sesión) y `offline-banner.tsx` montado en el layout: visible solo offline, texto "Sin conexión. Los cambios requieren conexión." Test con mocks de `navigator.onLine` y `fetch`.
- [ ] **Step 3: verificar.**
  `pnpm --filter @savia/admin test -- offline` + `typecheck` + `impeccable detect` sobre banner y páginas tocadas. Criterio: sin red, cada mutación de identidad muestra mensaje offline en español en <1 s (sin toasts optimistas previos).

## Fase 1 (recomendada): Lectura en caché — la mejor opción costo/valor (~2–3 días)

- [ ] **Step 1: allowlist de queryKeys con prueba que falla.**
  `persisted-keys.ts`: permite `users`, `tenants`, lecturas CRM/dominios públicos; deniega `auth`, `me`, `account`, `password`, `assistant`, `sessions`, `savia-request` en vivo. Test: cada clave del dataProvider clasificada correctamente.
- [ ] **Step 2: persister + QueryClient offline.**
  `pnpm add dexie @tanstack/react-query-persist-client @tanstack/query-async-storage-persister -F @savia/admin`; `query-persister.ts` con `shouldDehydrateQuery` = allowlist; `query-client.ts` con `gcTime: 7d`, `staleTime: 5min`, `retry` apagado sin red, `refetchOnReconnect: "always"`, mutaciones sin retry. Test del filtro del persister (una query `users` se deshidrata, una `me` no).
- [ ] **Step 3: cablear en `app.tsx`.**
  `createOfflineQueryClient()` + `PersistQueryClientProvider`, banner con hora de la caché ("datos guardados de 18:38"). Sin red tras una visita previa: Usuarios/Tenants listan desde caché con banner; nunca pantalla en blanco ni logout falso (el `checkError` 401 por fallo de red NO limpia sesión: distinguir `TypeError` de red de un 401 real).
- [ ] **Step 4: no-logout-offline en el auth provider.**
  `react-admin-auth-provider.ts`: `checkSession`/`getPermissions` ante error de red lanzan error reintentable, no limpian sesión ni redirigen a login. Test: `fetch` rechazado ≠ sesión inválida.
- [ ] **Step 5: verificar.**
  Suite admin completa, `typecheck`, `impeccable detect` en lista/detalle con banner. Criterio manual: DevTools → Offline → recargar con caché previa: listas visibles + banner; mutar → mensaje offline en español.

## Fase 2 (opcional): Outbox solo para dominios tolerantes (~1 semana)

Solo si hay demanda real de "trabajar sin red". **Identidad excluida por diseño.**

- [ ] **Step 1: registro de elegibilidad.**
  Solo `user-preferences`, borradores CRM locales y campos de diseñador; jamás `users`, `tenants`, `suspension`, `sessions`, `password-reset`, `memberships`, comandos savia ni ejecución de cotizadores. Test: `canQueue("users","delete") === false`.
- [ ] **Step 2: cola + flush.**
  `mutation-outbox.ts`: `enqueue` con `{ resource, id, op, payload, queuedAt, baseVersion }`, flush secuencial al volver la red, `last-write-wins` con relectura del servidor, rechazos visibles uno a uno ("No se pudo sincronizar X: …") con reintentar/descartar. Nunca reintento automático de 409 de invariantes.
- [ ] **Step 3: indicador "Cambios pendientes (N)".**
  Integrado al banner; al pulsar muestra la cola con estado por operación. Test de flush con un éxito + un 409.
- [ ] **Step 4: verificar.**
  Criterio: crear preferencia offline → aparece "pendiente (1)" → online → se sincroniza sin duplicados; un 409 se reporta y no se reintenta solo.

**Decision 2026-09-17 (implemented): push realtime via per-tenant Durable Object, not polling.** `RealtimeHub` DO with one instance per room (`platform`, `tenant:<id>`); single-use ticket auth (`POST /v1/realtime/ticket`); hint-only events (`topic` + `type` + id, no payload/PII); clients refetch. Publish points: identity/tenant mutations + dynamic-crm proxy (`records`/`views`). Deletes stay pessimistic; realtime only invalidates. Hibernation API on (topics as socket tags, tickets in SQLite storage, ping auto-answered) so idle connections bill ~nothing. No `subscribe`/`unsubscribe` dynamism: the grant at connect time is the subscription, which is all our screens use.

**Decision 2026-09-17 (implemented): surgical realtime updates by id, no blind refetch-all.** `applyRealtimeListEvent` removes `deleted` rows from cached `{data,total}` lists without network (numeric/string ids match); creates/updates invalidate exactly one query prefix. Record tables keep debounced invalidates (complex grouped shapes) with an aggregated toast.

**Decision 2026-09-17 (implemented): delta via monotonic collection versions, not row mirrors.** `crm_collection_versions` (migration 0051) is bumped by the dynamic-crm proxy on every records/views mutation and the version travels in the realtime event; clients keep a Dexie version map and skip covered events. Full row mirrors were rejected: record backends are heterogeneous (local D1, HubSpot-shared, Postgres) and tombstoning all of them is disproportionate while push already scopes every invalidation.

## Fase 3 (implemented 2026-09-17): Service worker + app shell

`vite-plugin-pwa` (generateSW, autoUpdate) precaches only the boot shell (index.html, entry JS/CSS, icons ≈ 2.8 MB): dist ships ~9k chunks (43 MB) and precaching all of it would tax first visits, so remaining same-origin assets cache on first use (CacheFirst `savia-shell`). `/v1/*` and `/api/*` are excluded from Cache Storage on purpose — API payloads live only in the Dexie query cache under the persisted-keys allowlist. Served by the existing gateway worker (static assets + SPA fallback), no config change needed.

- [ ] Workbox precache del shell admin (JS/CSS) con `NetworkFirst` para `/v1/*`; estrategia de versión y purga de cachés viejas; e2e: primera visita online, luego offline total y la app arranca. Nota: suma superficie de bugs (cachés rancias, auth) — no hacerlo "de paso" en otra fase.

## Non-goals

- Sesiones Better Auth offline, MFA offline, chat del asistente offline, ejecución de proveedores de cotización offline, sincronización multi-dispositivo con resolución automática de conflictos.

## Risks

- Caché rancia mostrada como vigente → mitigado con hora visible + `staleTime` cortos + revalidación al reconectar.
- Persistir datos sensibles → mitigado con allowlist + test que falla si una clave nueva no está clasificada.
- Outbox contra invariantes de servidor → mitigado excluyendo identidad y sin reintentos de 409.
