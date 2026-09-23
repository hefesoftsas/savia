# Store de plugins por tenant

Los administradores de cada espacio pueden **subir sus propios plugins
como ZIP**, **instalarlos y activarlos solo para su espacio**, sin
modificar el release de Savia. Es el complemento por tenant del
catálogo compilado (`docs/onboarding/08-plugins.md`): lo compilado
sigue igual; el store añade plugins privados por espacio.

## Formato del ZIP (v1)

```
mi-plugin.zip
├── savia-extension.json   # manifiesto savia.extension v1, id con prefijo custom.*
├── store.json             # opcional: acciones simuladas + defaults (savia.store v1)
└── dist/plugin.js         # ESM autocontenido (un solo archivo)
```

- `savia-extension.json`: mismo contrato que `extension-package.ts`
  (`format`, `formatVersion: 1`, `id`, semver, `label`, `description`,
  `requires`, `apiVersion: 1`). El `id` **debe empezar por `custom.`**
  para no suplantar extensiones del release.
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
  - `delegate`: el host reescribe el contexto a una acción compilada
    del release (`{ id, kind: "delegate", extension, action }`) y la
    ejecuta con sus secretos/servicios. Exige que la extensión destino
    esté disponible en el tenant (si no, 409). Así `custom.quotes-ui`
    ejecuta flujos savia-request vía `insurance.quotes` sin que el
    tenant gestione credenciales.
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

Además el shell redirige `fetch()` con **rutas relativas** (`/api/lookups/*`,
`/api/geocoding/*`) al host; cualquier otro `fetch` se rechaza en la
subida. El padre solo reenvía rutas permitidas (`/objects`, `/records/`,
`/extensions/`, `/lookups/`, `/geocoding/`, `/files/`, `/file/`).

## Límites del sandbox (no negociables en v1)

El JS se ejecuta en un `iframe sandbox="allow-scripts"` con origen
opaco: sin acceso al DOM padre, `localStorage`, cookies ni red
directa. Cada llamada `savia.*` viaja por `postMessage` y el host la
reenvía a la API con la sesión y permisos del usuario actual.

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
respeta dependencias `requires` (solo built-ins o extensiones
activas del mismo espacio) igual que las extensiones compiladas.

## Empaquetar

```bash
# Ejemplo mínimo (sin build):
mkdir -p /tmp/store-hola/dist
cp docs/examples/plugin-store-hola/src-plugin.js /tmp/store-hola/dist/plugin.js
cp docs/examples/plugin-store-hola/savia-extension.json /tmp/store-hola/
zip -q -X -r hola-plugin.zip savia-extension.json dist/plugin.js
```

Para código con JSX/TS o dependencias, usa el empaquetador (compila a
un solo ESM autocontenido, valida y comprime):

```bash
pnpm store:pack store-ports/quotes-ui
# dist/plugin-store/custom.quotes-ui-1.0.0.store.zip + SHA-256
```

Si el plugin usa JSX/TS o dependencias y lo empaquetas a mano,
compílalo antes a un solo ESM autocontenido, por ejemplo:

```bash
npx esbuild src/plugin.tsx --bundle --format=esm --outfile=dist/plugin.js
```

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

## Port de referencia: Cotizaciones UI

`store-ports/quotes-ui/` monta las tres pantallas reales del cotizador
(`Directa`, `Por pasos`, `Administrar`) y delega `quote` a
`insurance.quotes` (savia-request vía release, sin credenciales del
tenant). Prerrequisitos del tenant: `insurance.quotes` activa +
colecciones `clientes` (mapeo) y `savia.insurance`.
El test `packages/crm-server/test/store-port-quotes.test.ts` verifica
el ZIP empaquetado de punta a punta (se omite si no está construido).
El test `packages/crm-server/test/store-savia-request.test.ts` prueba la
cadena real completa sin red: plugin del store → delegación →
connector-gateway → app savia-request (modo mock) → respuesta normalizada.

## Referencias

- Contrato + `store.json` + plantillas: `packages/crm-shared/src/plugin-store.ts`.
- API y sandbox: `packages/crm-server/src/plugin-store.ts`.
- Acciones simuladas y settings del store:
  `packages/crm-server/src/extension-actions.ts`.
- Estado por tenant: `packages/crm-server/src/extensions.ts`,
  migraciones `0068_plugin_store.sql` / `0022_plugin_store.sql` y
  `0069_plugin_store_config.sql` / `0023_plugin_store_config.sql`.
- Empaquetador: `scripts/pack-store-plugin.mjs` (`pnpm store:pack`).
- Ports: `store-ports/quotes-ui/`, `store-ports/http-echo/`.
- UI: `apps/admin/src/features/crm-engine/plugin-store.tsx`,
  `custom-plugin-frame.tsx` y `store-connections.tsx`.

## Fuera de alcance (futuro)

- **R2 para entradas grandes** si D1 rechaza filas de ~1 MB en
  producción.

## Asistente

`store.json` puede marcar acciones de lectura con `mcp: { label,
summary }` (solo `simulation` y `http` GET; las escrituras no se
exponen). El worker MCP publica dos herramientas estáticas y de solo
lectura: `savia_store_catalog` (plugins activos y acciones con
etiquetas saneadas y prefijo de origen) y `savia_store_execute`
(verifica la acción contra el catálogo antes de ejecutar con la sesión
delegada). El texto del autor se valida en la subida (sin
instrucciones, sin enlaces, con topes) y se vuelve a sanear al servir.
Ver ADR 0004.
