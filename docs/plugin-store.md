# Store de plugins por tenant

## Loading performance

Plugin shells preload their entry module while the sandbox bootstrap downloads.
Signed entry URLs remain stable within a one-minute window; grants still expire
within two minutes and are validated on every request. JavaScript responses use
an artifact checksum ETag and `private, no-cache`: the browser may retain static
code, but must revalidate before reusing it. A matching conditional request checks
the active installation and version, returns `304`, and avoids transferring the
module body from D1. Disabled installations and invalid or expired grants return
`404` with `no-store`. The shell itself remains `no-store`.

This caches executable artifacts only, not application records, credentials, or
permission decisions. The iframe remains sandboxed with an opaque origin, and
all business requests still pass through the authenticated host transport.
The host shows a loading state until the sandbox announces readiness; startup
errors or a missing readiness message after 30 seconds offer a retry. Retrying
creates a fresh iframe, and pending replies from the previous frame are discarded.

For screen frames, the host starts the standard tenant-scoped settings GET while
the shell and entry module load. The first `savia.settings.get()` consumes that
frame-local request; later reads and reads after a settings write go to the API
again. Identity changes discard pending settings results, and a cleared session
does not start a replacement request. Widgets do not prefetch settings.

After deploying, compare full reloads and return navigation separately. Record
time until the plugin form and required settings are visible, and confirm entry
revalidation in the browser network panel. Local tests verify request counts,
conditional delivery, and isolation; they do not predict Cloudflare latency.

## Selecting a workspace in Screens

Screens has a visible **Tenant** selector and direct **Screens** and **Plugins**
buttons. Select the tenant first, then open Screens to create or manage its
screens, or Plugins to install, enable or disable its packages. When opening
Screens without a workspace in the URL, a single authorized tenant is selected
automatically; multiple tenants require a choice.

The platform and independent domains are available under **Advanced
administration**, together with domain creation. They never appear in the Tenant
selector. An active independent domain is explicitly labeled, and existing domain
links remain supported. Creating an independent domain does not create a tenant.

The workspace selector reloads its authorized catalog from the API when opened;
new tenants are not hidden behind the persistent metadata cache.

Switching workspaces preserves the screen administration or packages tab, but
discards the previous workspace's object, record, filters and editing context.
Object-specific administration returns to the destination's administration list.
Screens, plugin installations and their settings use the selected workspace API;
they are not shared merely because the same user administers both tenants.
Successful extension and plugin-store mutations invalidate the selected
workspace's cached extension catalog before refreshing the menu, so immediate
refreshes cannot reuse the previous activation state while invalidation runs.

Release-managed ZIP plugins still follow the automatic deployment policy below:
the next deployment activates them in every workspace, including installations
that a tenant disabled. This policy is separate from interactive tenant changes.

Los administradores de cada espacio pueden **subir plugins como ZIP**,
**instalarlos y activarlos solo para su espacio**, sin modificar el
release de Savia. El store por tenant es la fuente de plugins; el release
no publica extensiones sectoriales compiladas. Véase
`docs/onboarding/08-plugins.md`.

## Formato del ZIP (v1)

```
mi-plugin.zip
├── savia-extension.json   # manifiesto savia.extension v1 (`custom.*` para terceros)
├── store.json             # opcional: acciones simuladas + defaults (savia.store v1)
└── dist/plugin.js         # ESM autocontenido (un solo archivo)
```

- `savia-extension.json`: mismo contrato que `extension-package.ts`
  (`format`, `formatVersion: 1`, `id`, semver, `label`, `description`,
  `requires`, `apiVersion: 1`). Los plugins de terceros usan `custom.`;
  los ports sectoriales conservan su id `insurance.*`.
- `dist/plugin.js`: **ya compilado** (p. ej. con esbuild en modo
  `bundle --format=esm`), máximo **2 MB**, ZIP máximo 6 MB. Debe
  exportar `render(element, savia)`. Ver ejemplo funcional en
  `docs/examples/plugin-store-hola/` y port real en
  `store-ports/quotes-ui/`.
- `store.json` (opcional): configuración declarativa `savia.store` v1
  con `actions`, `connectors` y `settings.defaults`. Tres clases de acciones:
  - `simulation`: el host responde con la plantilla `output` rellena
    desde el `input` (`{{input.a.b}}`, `{{uuid}}`, `{{now}}`), sin red
    ni secretos. Ideal para UI y demos.
  - `delegate`: el host reescribe el contexto a una acción del host
    (`{ id, kind: "delegate", extension, action }`). Exige que la
    extensión destino esté disponible en el tenant (si no, 409). El
    catálogo actual no publica acciones compiladas; los ports de
    cotización usan `savia-request` directamente.
  - `savia-request`: ejecución nativa en el host
    (`{ id, kind: "savia-request", flows: [...], normalize:
"insurance-quote" }`). Valida modo/flow/input, propaga
    `x-savia-tenant` y `x-savia-actor`, y normaliza la respuesta con
    la lógica pura compartida. Solo flows declarados; sin servicio
    inyectado responde 502. Nunca es de lectura: excluida del
    asistente.
  - `http`: el host ejecuta una petición declarada con la conexión del
    tenant (ver § Conectores declarativos).

El objeto `savia` expone el subconjunto sandbox del host:

```js
const colecciones = await savia.collections.list();
const clientes = savia.collections.collection("clientes");
const page = await clientes.list({ page: 1, perPage: 25 });
await clientes.create({ name: "ACME" });
await clientes.update(id, changes, { version });
await clientes.remove(id, { version });
const esquema = await clientes.describe();

// Ajustes del tenant (defaults de store.json) y acciones simuladas:
const settings = await savia.settings.get();
await savia.settings.replace(next, version);
const quote = await savia.actions.execute("quote", { input: {...} });
```

The shell forwards `fetch()` calls to relative `/api/*` paths to the host.
Other `fetch` targets are rejected during upload. The parent sends these
requests to the selected workspace API with the current user's session.
The API enforces permissions for each route. The iframe cannot read cookies
or send requests directly to other origins.
The host includes the active light or dark theme in the shell URL so the iframe
uses the matching background on its first paint. Subsequent theme changes still
arrive through the existing `postMessage` theme bridge. The host keeps the
iframe hidden behind that background until the shell has loaded, avoiding a
white blank frame while the browser fetches it.

## Límites del sandbox (no negociables en v1)

El JS se ejecuta en un `iframe sandbox="allow-scripts allow-downloads"` con origen
opaco: sin acceso al DOM padre, `localStorage`, cookies ni red
directa. Cada llamada `savia.*` viaja por `postMessage` y el host la
reenvía a la API con la sesión y permisos del usuario actual.
The download permission lets an installed plugin export generated files such as
quote PDFs; the frame remains on an opaque origin.
Saved quote details render independently of the recent action-run refresh;
an unavailable run list must not keep the quote history behind a loading state.
An unfinished saved quote can be retried from its history entry. The wizard
prefills the saved vehicle fields, requests the missing applicant and contact
data again, and reuses the original quote reference and detail records. Only
unfinished products are sent to providers again; existing offers remain visible.

La subida valida el código estáticamente y **rechaza (422)**:

- `eval()`, `Function()` como constructor o llamada, `require()`,
  imports desnudos o remotos (todo debe venir empaquetado),
  `fetch` salvo rutas relativas al host (`/api/...`, que el shell
  redirige), `WebSocket`/`XMLHttpRequest`, `localStorage`/`indexedDB`/
  cookies, acceso a bindings (`D1Database`, `R2Bucket`, …),
  `process.*` o APIs `Deno.*`/`Bun.*`.
- Manifiestos sin prefijo `custom.`, sin `dist/plugin.js`, `store.json`
  inválido, o ZIPs corruptos/con rutas fuera del archivo (zip-slip).

Sin backend propio: si el plugin necesita lógica de servidor, debe
usar las colecciones del host o una extensión del release. Los
artefactos con código de terceros que requieran aislamiento de
servidor quedan fuera de esta versión.

## Flujo por tenant

1. **Administrar pantallas → Paquetes y extensiones → Mis plugins**.
2. **Subir plugin** (`.zip`). El artefacto queda guardado solo en ese
   espacio (tabla `plugin_store_artifacts`, clave por
   `tenant_id + id + version`); otros espacios no lo ven.
3. **Instalar** y **Activar/Desactivar** con los mismos endpoints de
   extensiones (`POST /api/extensions/:id/install`,
   `PATCH /api/extensions/:id { enabled }`); el catálogo
   `GET /api/extensions` incluye los plugins del store con
   `store: true`.
4. **Ver** renderiza el plugin en su iframe aislado.
5. **Eliminar** exige desactivar primero; nunca borra registros.

Plugin screens report their natural content height through the sandbox bridge.
Admin resizes the iframe when content or viewport width changes, so the page
has one vertical scroll area in the host. Widgets and frames with an explicit
height retain their configured size. The host only accepts finite positive
heights from the current iframe, capped at 100,000 px to keep pathological
content bounded; navigating or retrying resets its height.

The catalog loads artifact metadata and configuration with a constant number of
database reads, without loading JavaScript bundles. It shows the manifest from
the latest semantic version. For an installed plugin, screens and widgets come
from the installed version even when disabled; if that version is missing or
its configuration is invalid, they are empty rather than falling back to the
latest configuration.

Re-subir la misma versión con distinto contenido se rechaza (409):
publica una versión semver nueva. La instalación conserva datos y
respeta dependencias `requires` (solo built-ins del host o extensiones
activas del mismo espacio).

## Empaquetar

```bash
# Ejemplo mínimo (sin build):
mkdir -p /tmp/store-hola/dist
cp docs/examples/plugin-store-hola/src-plugin.js /tmp/store-hola/dist/plugin.js
cp docs/examples/plugin-store-hola/savia-extension.json /tmp/store-hola/
zip -q -X -r hola-plugin.zip savia-extension.json dist/plugin.js
```

Para código con JSX/TS o dependencias, usa el empaquetador (compila a
un solo ESM autocontenido, incorpora el CSS importado en `dist/plugin.js`,
valida y comprime). El shell recibe los colores del tema del host:

```bash
pnpm store:pack store-ports/quotes-ui
# dist/plugin-store/custom.quotes-ui-1.0.0.store.zip + SHA-256
```

Si el plugin usa JSX/TS o dependencias y lo empaquetas a mano,
compílalo antes a un solo ESM autocontenido, por ejemplo:

```bash
npx esbuild src/plugin.tsx --bundle --format=esm --outfile=dist/plugin.js
```

## Publicar en ambientes

`pnpm store:publish` empaqueta y sube todos los ports (o una lista)
a un ambiente, con la sesión de un administrador del espacio:

```bash
export SAVIA_API_URL=https://api.tudominio.com
export SAVIA_SESSION_COOKIE="$(...)"  # header Cookie completo del navegador

# Solo empaquetar, sin red:
pnpm store:publish --tenant agency:101 --dry-run
# Subir todo:
pnpm store:publish --tenant agency:101
# Subir e instalar, solo algunos:
pnpm store:publish --tenant agency:101 --install --ports quotes-ui,collections
# Por dominio en lugar de tenant:
pnpm store:publish --domain platform --install
```

Repite por ambiente (dev, staging, producción) cambiando
`SAVIA_API_URL`. Para un preview efímero, resuelve la URL desde la
rama sin escribirla a mano:

```bash
pnpm store:publish --preview-branch chibchombiano26/mi-rama --tenant agency:101 --install
# apiUrl = https://savia-agencies-preview-<slug>.workers.dev
```

La cookie viaja tal cual a la API, que la valida
contra el servicio de auth y exige administración del espacio.
El tenant debe existir en ese ambiente (el preview trae DB aislada).

## Conectores declarativos (`http`)

Un `store.json` puede declarar conectores con esquema JSON propio,
campos secretos y allowlist de hosts:

```json
{
  "connectors": [
    {
      "id": "sura",
      "label": "Sura Seguros",
      "secretFields": ["apiKey"],
      "configSchema": {
        "type": "object",
        "required": ["baseUrl", "apiKey"],
        "properties": {
          "baseUrl": { "type": "string" },
          "apiKey": { "type": "string" }
        }
      },
      "allowedHosts": ["api.sura.com", "*.seguros.test"]
    }
  ],
  "actions": [
    {
      "id": "cotizar",
      "kind": "http",
      "connector": "sura",
      "request": {
        "method": "POST",
        "url": "https://{{connection.baseUrl}}/cotizar",
        "headers": { "Authorization": "Bearer {{connection.apiKey}}" },
        "body": { "placa": "{{input.placa}}" }
      }
    }
  ]
}
```

El administrador configura la conexión en **Mis plugins → Conexiones**
(los secretos viajan cifrados con AES-GCM por tenant y nunca se
exponen en lecturas). Al ejecutar, el host revela los valores en
memoria, interpola URL/cabeceras/cuerpo y devuelve
`{ status, data }` con secretos redactados (por nombre de clave y por
valor exacto). Sin conexión configurada responde 422, salvo acciones
con `connectionOptional: true`.

**Salvaguardas**: solo `https`, sin credenciales en la URL, sin
literales IP ni `localhost`/`.local`/`.internal`/metadatos cloud, sin
puertos no-443, host obligado en `allowedHosts`, sin redirects
(`manual`), timeout de 20 s y respuesta máxima de 1 MB. Riesgo
residual documentado: el reenlace DNS hacia IPs privadas no se puede
resolver dentro del Worker. Los secretos están prohibidos en la query
de la URL (`{{connection.<secreto>}}` en `request.url` se rechaza en la
subida) porque viajan en claro en el `fetch` saliente.

## Cuotas

Por tenant: máximo 10 versiones por plugin y 20 MB agregados en el
store. Al superarlos la subida responde 409/413: elimina versiones
viejas antes de publicar.

## Colecciones declaradas

`store.json` acepta `collections[]` con el objeto (contrato del
diseñador) y sus campos requeridos:

```json
{
  "collections": [
    {
      "object": {
        "name": "tareas",
        "label": "Tareas",
        "description": "",
        "config": {
          "version": 2,
          "fields": {
            "name": { "type": "Textbox", "label": "Nombre", "required": true }
          },
          "fieldOrder": ["name"]
        }
      },
      "requiredFields": { "name": { "types": ["Textbox"], "required": true } }
    }
  ]
}
```

Al instalar, el host crea la colección mínima si falta, conserva la
compatible (incluidos campos y registros extra) y rechaza la
instalación sin activarla si existe una incompatible. Reinstalar repara
la colección faltante. No hay migraciones ni borrados: desactivar
conserva datos.

## Migración fuera del release

Los plugins sectoriales salen del release sin cambiar su id: el
manifiesto del store acepta cualquier id válido (`custom.*` queda como
convención para terceros). El catálogo muestra los ZIP subidos al
espacio.

1. Genera el port (`pnpm store:port insurance-renewals`) o escríbelo
   a mano para casos especiales (`store-ports/quotes-ui`,
   `store-ports/portfolio`).
2. Empaqueta (`pnpm store:pack store-ports/renewals`) y verifica con
   `node --test scripts/store-ports.test.mjs`.
3. En el tenant: subir → instalar (migra y provisiona) → activar.
   Desactivar conserva datos; eliminar el artefacto lo quita del catálogo
   y no restaura ninguna versión compilada.

Ports incluidos (`store-ports/`): accounting, activities, claims,
**collections** (piloto), commissions, compliance, customer-portal,
data-quality, documents, endorsements, **http-echo** (demo),
issuance, opportunities, payments, **portfolio** (resumen en cliente),
**quotes-ui** (savia-request nativo), **quotes**
(`insurance.quotes` con ejecución nativa, sin release), renewals, reports, service,
settlements, **calendar, campaigns, carriers, communications,
document-generation** (puertos gateway: conectores `endpoint`+`token`
con `allowConfiguredHost` y acciones con el envelope
`{version, extensionId, actionId, tenantId, principalId, payload}` +
`Idempotency-Key`, idéntico al release). Generados con
`pnpm store:port <paquete>` (sondea pantallas, colecciones, defaults
y acciones gateway) y verificados con
`node --test scripts/store-ports.test.mjs`. `automation` viaja como
datos (`store.json → bundles`, servidos por el host con el mismo gate).
Fuera de alcance por ahora: MCP de terceros.

## Widgets de Mi Día

`store.json` acepta `widgets[]` (`id`, `collection`, `title`) y la
entrada expone `widgets[id](element, savia, widget)` (con `render`
como respaldo). Mi Día los ofrece al crear widgets y los renderiza en
iframe (320 px) cuando el plugin está activo; desactivarlo restaura el
aviso habitual. El port `portfolio` incluye el resumen como widget.

## Asistente

`savia_extension_insurance_portfolio` ahora se calcula en el worker
MCP con las colecciones del tenant (sin proveedor compilado).
`store.json` puede marcar acciones de lectura con `mcp: { label,
summary }` (solo `simulation` y `http` GET; las escrituras no se
exponen). El worker MCP publica dos herramientas estáticas y de solo
lectura: `savia_store_catalog` (plugins activos y acciones con
etiquetas saneadas y prefijo de origen) y `savia_store_execute`
(verifica la acción contra el catálogo antes de ejecutar con la sesión
delegada). El texto del autor se valida en la subida (sin
instrucciones, sin enlaces, con topes) y se vuelve a sanear al servir.
Ver ADR 0004.

## Port de referencia: Cotizaciones UI

For new quote installations, use `store-ports/quotes/` (`insurance.quotes`
2.0.3). Its ZIP contributes only `cotizador_por_pasos`; the wizard's
configuration remains inside that screen. Install the independent
`savia.insurance-quoter` solution to create the wizard object and hidden
quote-history collections. `savia.insurance-management` is optional and
installs the remaining insurance management screens separately.
Uploading a newer ZIP leaves an installed older version's screens, actions,
and public quote links on that installed version until the extension is
upgraded. Upgrading `insurance.quotes` to 2.0.0 intentionally removes the
old direct-quote and administration screen bindings; their existing objects
and records are not deleted.

The older `quotes-ui` port below remains a compatibility example and still
contributes three screens.

`store-ports/quotes-ui/` monta las tres pantallas reales del cotizador
(`Directa`, `Por pasos`, `Administrar`) y delega `quote` a
`insurance.quotes` (savia-request vía release, sin credenciales del
tenant). Prerrequisitos del tenant: `insurance.quotes` activa +
colecciones `clientes` (mapeo) y `savia.insurance`.
El test `packages/studio-server/test/store-port-quotes.test.ts` verifica
el ZIP empaquetado de punta a punta (se omite si no está construido).
El test `packages/studio-server/test/store-savia-request.test.ts` prueba la
cadena real completa sin red: plugin del store → delegación →
connector-gateway → app savia-request (modo mock) → respuesta normalizada.

## Referencias

- Contrato + `store.json` + plantillas: `packages/studio-shared/src/plugin-store.ts`.
- API y sandbox: `packages/studio-server/src/plugin-store.ts`.
- Acciones simuladas y settings del store:
  `packages/studio-server/src/extension-actions.ts`.
- Estado por tenant: `packages/studio-server/src/extensions.ts`,
  migraciones `0068_plugin_store.sql` / `0022_plugin_store.sql` y
  `0069_plugin_store_config.sql` / `0023_plugin_store_config.sql`.
- Empaquetador: `scripts/pack-store-plugin.mjs` (`pnpm store:pack`).
- Ports: `store-ports/quotes-ui/`, `store-ports/http-echo/`.
- UI: `apps/admin/src/features/studio-engine/plugin-store.tsx`,
  `custom-plugin-frame.tsx` y `store-connections.tsx`.
- Widgets: `apps/admin/src/features/my-day-widgets/plugin-widget.tsx`.
- MCP: `apps/mcp/src/extensions/store.ts` y `portfolio.ts`.

## Fuera de alcance (futuro)

- **R2 para entradas grandes** si D1 rechaza filas de ~1 MB en
  producción.

## Automatic deployment of release plugin ZIPs

Preview and production workflows discover every `.zip` file directly inside
`deployment/plugins/`. Required plugins are installed/updated **and
activated** in every existing tenant and data domain, including the implicit
platform domain. Plugins listed under `optional` in
`deployment/plugins/sources.json` are uploaded to every workspace catalog but
never auto-installed: they show up as installable in **Mis plugins** and each
workspace enables them on demand. This folder is the explicit release policy:
placing a ZIP there opts that plugin into deployment across all workspaces,
including workspaces where it was previously disabled or absent. Tenant settings,
connections, secrets, and records are preserved by the existing installation API.
Plugins outside this folder are not managed by this deployment step.

`deployment/plugins/sources.json` optionally lists repository ports to package into
the same folder before deployment. `ports` are required (upload + install and
activate everywhere); `optional` ports are packaged and uploaded only, so workspaces
can install them on demand without receiving them by default. The initial release
includes the `quotes` port as required and the remaining insurance ports as
optional; their ZIPs are generated from the current checked-out source, so plugin
fixes ship with the application. Add other ready-made ZIPs directly to the folder
(hand-placed ZIPs are always auto-installed), or add port directory names to
`ports` or `optional`. Keep one ZIP per plugin id. Dependencies included
in the folder are installed first; missing dependencies still follow normal
installation validation and fail the deployment when unavailable in a workspace.

The runner uses the existing Cloudflare deployment credentials and environment
D1 database id. It starts an authenticated, temporary Wrangler remote session,
uses the normal ZIP upload and extension installation handlers, and terminates
the session afterward. No workspace account, copied cookie, per-tenant target list,
or public deployment endpoint is required. The session accepts a random one-run
secret and can only upload/install against workspaces discovered in that database.

Version numbers remain immutable: bump the manifest version when changing code
or `store.json`. Repeated deployment of identical content is safe. Upload rejects
changed JavaScript or configuration under an existing version, even if its
manifest is unchanged. Release upload errors identify the plugin id, version,
and tenant; publish changed content as a new version. ZIP metadata/timestamps do
not count as content changes.
Newer tenant versions are retained and activated instead of being downgraded.

A failure in any workspace fails the release workflow. Workspaces are updated
sequentially, so the process is not globally atomic; rerun after resolving the
error. Existing store quotas and object compatibility checks apply. Removing a
ZIP from the folder does not uninstall it or delete data. Tenants created after a
deployment receive these plugins at the next deployment.

Plugin installation provisions every declared collection. For existing collections,
new optional fields are added with a versioned schema update; existing fields,
labels, layouts and customizations are preserved. Required and conditionally
required fields are not added automatically because existing records may not
satisfy them. Invalid collection declarations are rejected during ZIP upload.

## Shared private registry

An optional [shared private plugin registry](guides/plugin-registry.md) stores immutable ZIP releases in a dedicated R2 bucket outside environment databases. Tenant administrators can import a pinned release from **Shared catalog** into their local store. Execution, installation state, data and credentials remain local. Exact tenant mappings and server-only read credentials control access; existing uploads are not automatically published.

### Host-managed editor panels

Screen shells negotiate the optional `savia.ui` capability with their parent
before rendering. An older host falls back after two seconds; plugins must keep
an inline editor when `savia.ui` is absent. Use
`await savia.ui.openPanel({ view: "record-editor", title, params: { recordId } })`
from the list, omitting `recordId` to create a record. A saved result refreshes
the list; cancellation preserves its filters, page and scroll.

The host derives a second shell from the owning plugin and selected screen, when
available. The store viewer can open panels without a selected screen. It
passes `savia.ui.panel` through a source-checked, nonce-correlated handshake; the
plugin renders only its editor in that frame. Arbitrary URLs, tenant overrides,
unknown views and nested panels are rejected. Both frames retain the existing
sandbox and authenticated API bridge. Session changes dispose the panel.

Editors report `{ dirty, busy }` with `setPanelState`, use `requestClose` for
Cancel, and call `completePanel({ status: "saved" })` only after a successful
mutation. The host owns discard confirmation, full-viewport framing and focus
transfer; the plugin owns fields, validation and a fixed action footer. The
host drawer is at most 640 px wide on desktop and fills narrow screens.
Configured fields accept input immediately while relationship options load;
saving stays disabled until relationship validation is ready. Closing still
checks for unsaved changes. Relationship collections load concurrently, with
one shared request chain per collection within each editor load. Failed
saves keep the draft in memory. No draft is persisted in browser storage.

The eleven Workbench ports share this editor implementation. Release their ZIPs
alongside the host and shell. Catalog upload alone does not replace an installed
version: update existing installations explicitly, preserving optional plugins
that are uninstalled or disabled. Verify the installed version in each target
workspace before considering the rollout complete.

Shared Workbench styles also enter other ports through package exports. Version
every rebuilt deployment artifact whose bytes change: the tenant catalog rejects
replacing an existing plugin ID and version with different contents. Keep the
release set in `deployment/plugins/sources.json` consistent when shared code or
styles change.

### Prepared editor lifecycle

Ports can additionally export `renderPanel(element, savia)`, synchronously returning
an unmount function. With that export, `savia.ui.preparePanel?.()` prepares one
hidden, inert iframe after the list is ready. It imports code without rendering
the list or running record effects. Each opening receives a fresh `ui.panel`
activation and SDK; closing invokes cleanup and revokes that SDK. Do not use
ambient `fetch` in reusable editors: use the activation-bound `savia` API.

The iframe remains in the same mounted drawer container between openings. Loading
can be cancelled; writes and dirty drafts retain busy/discard protection. Host
messages and responses are checked against the source, session and activation.
Old ports continue using a new frame per opening. Identity changes, navigation
and workspace authorization revocation discard prepared frames. This optimization
does not persist executable code or make an unprepared app start offline.

### Opt-in local records

`localRecords.collection<T>(name)` exposes `list`, `get`, `describe`, `create`,
`update` and `remove`. Reads have the normal collection shapes. Writes return
`{ data, persistence: "local" | "server", mutationId? }`. A local receipt follows
an atomic record/outbox transaction; it is **not** confirmation from the backend.
The existing workspace sync panel reports pending operations, conflicts and errors.

Only record CRUD and object metadata can request this transport. Eligibility,
hydration, schema and authorization belong to the selected workspace, not the
plugin. Remote collections use the network. Legacy `collections` semantics stay
network-confirmed, including business actions and payment writes. A payment reads
a fresh backend version before computing its update. Files, settings, integrations
and bulk operations do not gain offline persistence.

`localRecords.subscribe?.(listener)` reports scoped replica changes so a list can
refresh without remounting the editor or resetting its filters. Call its returned
unsubscribe function when unmounting. See [local-first collections](local-first-collections.md)
for preparation, authorization and conflict behavior.

## Tenant-configured field lookups

Store screens can opt compatible text fields into tenant customization with
`lookupFields: ["customer", "owner"]` in their `store.json` screen declaration.
The installed, enabled version controls which fields are offered in **Screens →
Configure → Connected fields**. Workbench fields opt in with `lookup: true`.
Custom renderers can read the same metadata through `collection.describe()`;
declaring a field does not automatically change a custom renderer.

A tenant administrator chooses a readable/listable collection, display field,
one to five search fields, and an optional equality filter. The configuration
lives in the source object's existing versioned schema as
`fields.<field>.config.pluginLookup`. Saving uses the schema authorization,
validation, version-conflict and audit path. It does not store provider
credentials in the plugin. Connected collections use their normal adapter and
its capabilities; unsupported searches remain explicit errors.

The lookup records a label snapshot in the original text field and the selected
record ID in a separate optional text field. This is a logical reference, not a
database foreign key or an automatic synchronization of customer names. Writes do
not enforce target existence; consumers must resolve stored IDs through the normal
target collection API and its ACL, never treat an ID as authorization. Legacy
text is preserved and never matched automatically. Changing the source collection
allocates a new ID field, retaining previous references without interpreting them
against a different collection. Disabling a lookup retains the fields and data.

The picker searches in bounded pages rather than loading the entire collection.
It uses the normal ACL-filtered collection API, including field and row access,
and the existing local transport when supported. Connected sources still need
their server connection. The plugin never acquires permissions beyond the signed-in
user. A missing/inaccessible selection keeps its existing text snapshot; users
can explicitly replace or clear it. Editing search text alone does not overwrite
a saved selection. Selecting a result saves its ID and text together in the
normal record mutation (and local outbox when supported).

Plugin screens, hosted forms, and the plugin catalog reuse Savia’s branded loading
indicator within their content area. Failed frame startup retains its retry action.

For scaffolding, shared SDK/UI packages, automated local rebuilds, and test doubles,
see [Plugin development](guides/plugin-development.md).
