# Store de plugins por tenant

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
2.0.2). Its ZIP contributes only `cotizador_por_pasos`; the wizard's
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
