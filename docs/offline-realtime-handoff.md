# Handoff: borrado de usuarios, offline-first y realtime — 2026-09-17/18

> Estado al cierre: todo commiteado en `main`, CI verde y desplegado en preview
> (`savia-preview.hefesoft.com`, verificado). Este documento resume qué se hizo,
> qué se decidió NO hacer (con motivos) y qué queda abierto.

## 1. Origen: el video del delete que "reaparece"

Reporte: en Usuarios, eliminar mostraba "Elemento eliminado / Deshacer", la fila
desaparecía y luego volvía con un error en inglés
(`A commercial tenant must retain at least one active user`).

Causa: el `DeleteButton` genérico es optimista con deshacer; el backend rechazaba
con sus guards (`LAST_ACTIVE_MEMBER`, último admin, auto-eliminación) y la UI
revertía. En el caso del video el backend tenía razón: "Agencia Consulta" era el
único usuario activo del Tenant #1 y la invariante lo protege.

### Fix aplicado (`fix(admin): confirm user deletes pessimistically…`)
- `apps/admin/src/features/users/user-pages.tsx`: nuevo `UserDeleteButton`
  pesimista con diálogo `Confirm`; espera al servidor y traduce cada guard a
  español (`deleteUserErrorMessage`). Reemplaza al botón con deshacer en lista,
  show y edit.
- `UserEdit` a `mutationMode="optimistic"` (luego también `TenantEdit`); los
  borrados quedan pesimistas a propósito.
- Tabs Activos/Suspendidos/Todos con `onValueChange` (antes `onClick`: el teclado
  no cambiaba el filtro).
- `identity-user-data-provider.ts`: `delete` devuelve `{ id }` si no hay
  `previousData` (antes resolvía `data: undefined`).
- Tests: `identity-user-data-provider.test.ts` + `user-delete-errors.test.ts`.

## 2. Offline-first por fases (plan: `docs/superpowers/plans/2026-09-17-offline-first.md`)

### Fase 1 — lecturas en caché (`feat(admin): Dexie-backed offline reads…`)
- `apps/admin/src/offline/`: Dexie `savia-offline` (v1 `queryCache`),
  persister TanStack (`@tanstack/react-query-persist-client` +
  `@tanstack/query-async-storage-persister`, pineados a 5.102.8),
  allowlist `persisted-keys.ts`, `query-client.ts` (sin retry sin red,
  mutaciones sin retry), `offline-banner.tsx`, `offline-error.ts`.
- Sesión tolerante a red (`better-auth-oauth-session.ts`): conserva el token si
  el refresh cae por red + últimos permisos en memoria (nunca persistidos) para
  no cerrar sesión ni ocultar recursos sin red.
- Caché inicial: usuarios, tenants y metadatos del studio.

### Fase 2 — outbox (`feat(offline): outbox queue for personal preferences`)
- Tabla `outbox` (Dexie v2), elegibilidad estricta: **solo preferencias
  personales** (apariencia, menú). Identidad excluida por diseño (los guards no
  tienen resolución automática segura).
- `flushOutbox` secuencial; fallos se marcan (nunca auto-retry de 409);
  offline aborta y conserva pendientes. UI `OutboxStatus` ("Cambios pendientes").
- Cableado en `appearance-preferences-sync.tsx` y `app-sidebar.tsx`.

### Delta (`feat(sync): monotonic collection versions for delta refetch`)
- Migración `0051_collection_versions.sql` + bump en el proxy studio (rutas /v1/studio, alias /v1/dynamic-crm);
  la versión viaja en el evento realtime y el cliente (`collectionVersions`,
  Dexie v3) salta eventos ya cubiertos.
- Espejo por fila rechazado: backends heterogéneos (D1 local, HubSpot, Postgres).

### Fase 3 — service worker (`feat(offline): precache app shell…`)
- `vite-plugin-pwa` (generateSW, autoUpdate). Precache solo del shell
  (27 entradas, 2,8 MB — el dist trae ~9k chunks/43 MB, no se precachea todo).
  `/v1/*` y `/api/*` excluidos de Cache Storage: los datos viven solo en Dexie.

### Opt-in PII por colección (`feat(offline): per-collection PII opt-in…`)
- `OFFLINE_PII_COLLECTIONS` (piloto: `cotizaciones`, `cotizaciones_detalle`);
  solo listas `pipeline`/`summary`, nunca detalles/archivos.
- TTL 12 h al restaurar + **wipe total al logout** (`onLogout` en el auth
  provider; `queryClient`/`persister` viven en `app-services`).
- **Política administrable** (`feat(offline): per-collection offline…`):
  tabla `offline_collection_policies` (migración 0052), endpoints
  `/v1/offline/collections` (lectura: miembro; escritura: platform/tenant_admin)
  y pantalla `/offline-policies` (toggle + intervalo 30–86400 s, aplica
  `staleTime`/`refetchInterval` por colección). Sin snapshot: rige el piloto.

### Dónde vive cada cosa en IndexedDB (`savia-offline`)
- `queryCache`: caché TanStack. `outbox`: mutaciones pendientes/fallidas.
- `collectionVersions`: `tenant:<id>:<colección>` → versión.
- Las políticas viven en el servidor (D1), no en IDB.

## 3. Realtime push (`feat(realtime): …Durable Object` + hibernación + quirúrgico)

- DO `RealtimeHub` por sala (`platform`, `tenant:<id>`); tickets de un solo uso
  (`POST /v1/realtime/ticket`); eventos solo-hints (`topic`+`type`+id, sin PII).
- Publican: mutaciones de identidad, tenants y proxy studio (records/views).
- Hibernación (topics en tags, tickets en SQLite, ping manual — se quitó
  `WebSocketRequestResponsePair` porque rompe el workerd local viejo y tumbaba
  el API en dev). Costo estimado a su escala: **$0 extra** (dentro de la cuota).
- Cliente (`apps/admin/src/realtime/`): hook con backoff, punto "En vivo",
  `applyRealtimeListEvent` (borrados quirúrgicos sin request), debounce+toast
  en tablas de registros. Degrada sin `AppServicesProvider` (motor embebido).

## 4. Propuestas rechazadas (con motivos, validados con el usuario)

- **Listas de users/tenants como pantallas low-code sin delete**: imposible hoy
  (low-code = colecciones del dominio; identidad no lo es), las acciones custom
  igual necesitarían UI propia, no existe "cargada por defecto" y **cero
  dependencias se irían** (verificado: todo es compartido).
- **Jotai/Redux Toolkit**: TanStack ya maneja estado de servidor; el estado
  cliente son banderas. Jotai solo si aparece estado compartido real (ej. outbox
  global ya resuelto con polling local).
- **Cachear todo**: IndexedDB sin cifrar + sobrevive al logout + dato operativo
  rancio + endpoints con secretos. Se resolvió con opt-in + TTL + wipe.
- **Polling como realtime**: el usuario lo rechazó; se hizo push.

## 5. Costos (tarifas Cloudflare sep-2026 verificadas)

Realtime a su escala ≈ **$0/mes** (dentro de los 400k GB-s y 1M requests
incluidos del plan Paid $5). Palanca futura: nada que hacer; la hibernación ya
está. Vigilar dashboard el primer mes.

## 6. Operación y verificación

- Preview despliega solo con push a `main` (CI → deploy). Verificado:
  `/sw.js` 200, `/openapi.json` con `ticket` y `offline/collections`.
- Local: `pnpm dev` (admin 5173, api 8787, auth 8788). Legacy `:8790` **no lo
  levanta `dev-local.sh`** — normal sin Docker.
- CI honesto a recordar: `public-release-hygiene` rechaza placas literales
  (rompió un build por poner una placa de ejemplo en un test), `schema.test.ts` exige conteo
  exacto de tablas (actualizar por migración: va en 286).
- `main` se mueve con commits de otro agente en el mismo directorio
  (i18n, `crm/nango`, skeletons). Sus archivos sin commitear se dejaron
  intactos siempre; revisar `git status` antes de cada commit.

## 7. Hilos abiertos

1. Confirmación visual del usuario en preview (pendiente de él).
2. Outbox cubre apariencia + menú; para más dominios, extender `ELIGIBLE_ACTIONS`.
3. `WebSocketRequestResponsePair`: no reintroducir sin verificar `wrangler dev`.
4. Agregar colección offline = 1 línea en `OFFLINE_PII_COLLECTIONS` + caso de test.
