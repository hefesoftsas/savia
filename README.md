# Savia

## License

Savia — Developed by Hefesoft SAS, Colombia.

Savia is source-available under the [Savia Source-Available License 1.0](LICENSE),
not an OSI-approved open-source license. Companies with total monthly revenue
above USD 20,000 must obtain a commercial Savia license from Hefesoft SAS.
Redistributions must publish corresponding source, including modifications,
and all deployments must preserve visible Savia/Hefesoft attribution.
See the [licensing guide](docs/licensing.md) and [NOTICE](NOTICE).

> New developers: start at [docs/](docs/) (onboarding track + guides index).

Savia es una plataforma low code independiente de la industria. Permite crear
colecciones, relaciones, formularios y pantallas por organización, con API,
permisos y persistencia en Cloudflare Workers/D1 y R2.

Las soluciones de negocio se instalan como paquetes de configuración. Seguros
es el primer paquete: añade clientes, aseguradoras, cotizaciones, pólizas,
pagos y siniestros. Una organización nueva funciona sin instalarlo.

En **Administrar páginas → Paquetes de soluciones**, selecciona el espacio,
descarga un paquete o importa su JSON, revisa los cambios e instálalo. Puedes
desactivarlo y reactivarlo conservando los registros. Consulta la
[guía de paquetes](docs/solution-packages.md) y el
[paquete Seguros](solutions/insurance/manifest.json).

## Componentes

- `apps/admin`: frontend React con React Admin, shadcn y el diseñador low code
  (Studio) en `#/studio?domain=platform&view=admin` (`#/crm` sigue como
  alias heredado).
- `apps/api`: API pública, contrato OpenAPI y operaciones de dominio.
- `apps/auth`: Better Auth, login, MFA con TOTP y proveedor OAuth/OIDC.
- `apps/mcp`: acceso MCP a la misma superficie documental de la API.
- `apps/connector-gateway`: Worker privado genérico que ejecuta adaptadores
  declarados por extensiones, con conexiones cifradas por tenant.

## Container development

With Docker Desktop (or Docker Engine with Compose) running, start from the
repository root:

```sh
docker compose up --build
```

Open [Admin](http://127.0.0.1:5173/) or the
[API reference](http://127.0.0.1:8787/docs). The container installs the pinned
pnpm dependencies, applies local migrations, and starts the development stack
with live reload. Node and pnpm are not required on the host.

VS Code users can also select **Dev Containers: Reopen in Container**; the
included `.devcontainer/devcontainer.json` uses the same Compose service.
See [local setup](docs/onboarding/03-local-setup.md) for login, persistent data,
optional secrets, and troubleshooting.

## Inicio local

API, Auth, MCP, el Worker privado de conectores y Admin se ejecutan
directamente en el equipo, con recarga inmediata; Docker no es necesario para
operar Savia localmente:

```sh
pnpm dev
```

El MCP se inicia en ese mismo comando cuando existe
`SAVIA_MCP_SHARED_SECRET`; sin ese secreto el resto de la aplicación funciona
localmente, pero el asistente permanece deshabilitado.

Abre el admin en `http://127.0.0.1:5173/` por defecto. Si ese puerto
está ocupado, el lanzador elige el siguiente disponible y muestra la URL; también
puedes fijarlo con `SAVIA_ADMIN_PORT`. La API y las páginas de autenticación se
sirven localmente desde `http://127.0.0.1:8787`.

Un solo runtime local de Wrangler ejecuta la API central y el gateway de
conectores como Workers separados. El proceso posee
`apps/api/.wrangler/state`, evitando bloqueos SQLite durante la recarga; no
levantes otro Wrangler sobre ese mismo estado.

El lanzador genera configuraciones y `.dev.vars` privados por Worker bajo
`apps/api/.wrangler/local-runtime`, a partir de los archivos locales existentes y
`infra/secrets`; no modifica esos originales ni imprime sus valores. Admin usa
las rutas de la API central directamente, por lo que se debe conservar el origen
de Vite como URL de API durante el desarrollo.

Para reiniciar únicamente los datos generados por Miniflare, primero revisa el
plan sin modificar nada:

```sh
node scripts/reset-savia-local-state.mjs
```

El borrado requiere una confirmación explícita y afecta solo los estados locales
de API, Auth y Savia Request; nunca `infra/secrets`, PostgreSQL ni un servicio
remoto:

```sh
node scripts/reset-savia-local-state.mjs --confirm-local-reset
```

PostgreSQL no es necesario para operar Savia diariamente: sirve únicamente como
fuente para importaciones legadas. Cuando se requiera recuperar esa fuente, se
inicia de forma explícita con `pnpm legacy:postgres`; antes de importar se puede
validar con `POSTGRES_URL=... sh scripts/verify-postgres-source.sh`.

### Conexiones de extensiones

Cada extensión puede declarar sus conectores y acciones. Los administradores
guardan las credenciales y valores de configuración desde la pantalla de la
extensión; los secretos no vuelven al navegador después de guardarse. Los
adaptadores de una solución se ejecutan únicamente en el Worker privado.

Para probar conexiones localmente, crea
`infra/secrets/connector-gateway.dev.env` (ignorado por Git) con
`EXTENSION_CONNECTIONS_ENCRYPTION_KEY`, material base64 de exactamente 32
bytes. `pnpm dev` entrega esa clave únicamente a la API central y al Worker de
conectores, aplica las migraciones locales y levanta sus service bindings.

```sh
pnpm dev
```

## Autenticación del admin

### Usuarios de prueba locales

La D1 local de Miniflare incluye las siguientes cuentas para probar los
distintos niveles de acceso. Son exclusivas del entorno local: no existen ni
deben usarse en producción.

| Usuario                   | Correo                                   | Acceso                        |
| ------------------------- | ---------------------------------------- | ----------------------------- |
| Savia Local Administrator | `savia.admin@example.test`               | Administrador de plataforma   |
| Agencia Consulta          | `agency-viewer-flow-20260902@savia.test` | Solo lectura en la agencia 12 |

La contraseña temporal de las dos cuentas es `TestUser321!`. El
administrador de plataforma conserva MFA activo, por lo que también requiere
el código TOTP ya enrolado. Las cuentas y su contraseña viven en el estado
local ignorado de Miniflare; al borrar o recrear ese estado deben
reaprovisionarse.

El admin usa Authorization Code con PKCE contra Better Auth. Después de
iniciar sesión y completar MFA cuando aplique:

1. Better Auth entrega un access token de cinco minutos.
2. El API guarda el refresh token en una cookie `HttpOnly`, restringida a las
   rutas de autenticación del admin; el frontend nunca la lee ni la almacena.
3. El admin recupera la sesión al recargar y renueva el access token antes de
   que venza.
4. Todas las llamadas al API incluyen `Authorization: Bearer <access token>`.
5. Al cerrar sesión se elimina tanto la cookie de renovación como la sesión de
   Better Auth.

El cliente OAuth de Admin solicita `offline_access` exclusivamente para este
flujo de renovación. Los permisos se calculan a partir de los scopes
`savia.api.read` y `savia.api.write`; el modelo de roles puede ampliarse sin
cambiar el mecanismo de autenticación.

## Desarrollo

```sh
pnpm typecheck
pnpm test
sh scripts/verify-local-stack.sh
```

El contrato de la API se publica en `/openapi.json` y la documentación Scalar
en `/docs`.

## CRM externo por agencia (HubSpot)

Los administradores de agencia pueden administrar la conexión de CRM de su
agencia en `#/crm-connections`. La primera integración habilitada es HubSpot;
(esto es el CRM externo — no confundir con Studio, el diseñador low-code en
`#/studio`).
la API ofrece operaciones normalizadas para contactos, empresas y negocios en
`/v1/crm/*`, siempre acotadas por `agencyId` y por la membresía activa del
usuario. Nango gestiona el consentimiento y los tokens OAuth, mientras Savia no
recibe ni almacena credenciales de CRM externo. La configuración de producción y la
prueba de conexión están documentadas en el
[runbook de Nango y HubSpot](docs/runbooks/nango-hubspot.md).

## Asistente operativo

El panel administrativo incorpora un asistente conectado a la misma API de
dominio mediante FastMCP. Las consultas se ejecutan de inmediato; un cambio se
guarda como una propuesta con vigencia de cinco minutos y sólo se ejecuta tras
la confirmación explícita del mismo usuario.

Para habilitarlo localmente crea archivos ignorados por Git. El API recibe la
clave de OpenRouter y el secreto compartido; el proceso MCP recibe únicamente
el secreto compartido:

```dotenv
# infra/secrets/assistant-api.dev.env
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
# Genera una vez con: openssl rand -base64 32
ASSISTANT_SETTINGS_ENCRYPTION_KEY=...
SAVIA_MCP_SHARED_SECRET=usa-un-valor-aleatorio-largo
```

```dotenv
# infra/secrets/mcp.dev.env
SAVIA_MCP_SHARED_SECRET=el-mismo-valor-aleatorio-largo
```

Después de configurarlos, reinicia `pnpm dev`. El MCP queda ligado únicamente a
`127.0.0.1:8789` y el API lo llama en `http://127.0.0.1:8789/mcp`. En
producción, carga `OPENROUTER_API_KEY`,
`ASSISTANT_SETTINGS_ENCRYPTION_KEY` y `SAVIA_MCP_SHARED_SECRET` como secretos
de GitHub del entorno `production`. `ASSISTANT_SETTINGS_ENCRYPTION_KEY` debe
ser material base64 de 32 bytes; no lo rotes hasta volver a cifrar las claves
guardadas con una rotación planificada. El
workflow despliega `apps/mcp` como el Worker privado `savia-mcp`, sin ruta
pública, y `savia-agencies` lo invoca por un service binding interno. El MCP
recibe solamente `SAVIA_MCP_SHARED_SECRET`; la clave de OpenRouter nunca llega
al frontend ni al Worker MCP.
