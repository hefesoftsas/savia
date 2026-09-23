# Savia request integrado

El MVP de `insurer-flow-lab` se incorpora completo en Savia. El menú **Savia request** y `/#/savia-request` requieren administrador de plataforma. `/#/savia-request/docs` abre su Scalar independiente, con los ejemplos guardados y una operación por flow.

El editor se monta de forma nativa dentro de `apps/admin`: comparte su sidebar, la paleta Savia y la sesión del administrador. Usa `ApiClient`, que obtiene el token actual y lo envía únicamente a la API de Savia. La API aplica su autenticación habitual (sesión/MFA u OAuth con scopes de lectura/escritura). Sin `?tenant=` verifica `platform_admin` en cada llamada; con `?tenant=agency:ID` autoriza al miembro del tenant (lectura/ejecución para cualquier miembro activo, edición solo para administradores del tenant o de plataforma) y accede al Worker privado mediante `SAVIA_REQUEST` reenviando únicamente el scope como cabecera `x-savia-tenant`. Las cookies y tokens de Savia no se reenvían al motor ni a los proveedores.

Los endpoints del editor conservan sus payloads y respuestas bajo `/v1/savia-request/api/*`; la ejecución de versiones está en `/v1/savia-request/v1/flows/:id/runs`. El motor, hooks aislados, variables cifradas, árbol, duplicación, confirmaciones de borrado, historial y modos mock/live son los del MVP. El espacio sin tenant es el catálogo compartido de plataforma; con `?tenant=` cada tenant ve el catálogo más sus personalizaciones.

## Alcance por tenant

Las tablas globales (`flows`, `flow_variables`, `flow_versions`, `flow_runs`, `folders`, `installed_bundles`) son el catálogo de plataforma. La migración `0004_tenant_scope.sql` añade overlays (`tenant_flows`, `tenant_flow_variables`, `tenant_flow_versions`, `tenant_flow_runs`, `tenant_folders`, `tenant_bundles`) claveados por `tenant_id` (`agency:101`, `tenant:101`, …).

- Definiciones: el overlay del tenant gana; si no existe, aplica el catálogo. Borrar en scope de tenant escribe una lápida que oculta el flow global solo para ese tenant.
- Variables: fusión por clave (overlay gana). Los secretos de plataforma nunca se revelan a tenants (lecturas y reveals enmascaran; solo los secretos propios del tenant son revelables), pero sí se resuelven en memoria durante la ejecución para que los flows compartidos funcionen: los hooks nunca pueden tocar secretos y las vistas previas los redactan antes de persistir o responder. Guardar un secreto vacío en scope de tenant significa "sin override" (vuelve al default de plataforma). Modelo de confianza: un tenant admin podría dirigir un flow propio a un host externo, por eso `flow.save` audita los hosts destino y toda ejecución queda registrada con actor.
- Versiones y ejecuciones: aisladas por tenant; la ejecución publicada prefiere la versión del tenant y cae a la última de plataforma.
- El conector de cotizaciones (`insurance.quotes`) ejecuta siempre en el scope del `ExtensionActionContext.tenantId`.
- Ciclo de vida: `DELETE /api/admin/tenants/:tenant` purga los overlays del tenant (flows, variables con secretos sellados, versiones, ejecuciones, carpetas y bundles) y devuelve conteos; el audit del scope se conserva para forense posterior (no contiene secretos). El catálogo de plataforma se rechaza. La API lo invoca (best-effort, con log) para `agency:{id}` y `tenant:{id}` al eliminar un tenant, y los administradores de plataforma pueden invocarlo manualmente vía `/v1/savia-request/api/admin/tenants/:tenant`. Un caller con scope solo puede purgar su propio scope.
- Revertir: `POST /api/flows/:id/reset` elimina los overlays de definición y variables del tenant (los flows solo del tenant desaparecen; versiones e historial se conservan) y `DELETE /api/flows/:id/variables/:key` revierte una sola variable al default de plataforma. Solo aplican en scopes de tenant. Las respuestas incluyen `customized` (flow) y `overridden` (variable) para mostrar qué es personalizado.
- Auditoría (`savia_request_audit`, migración `0006` + core `0065`): quién cambió/reveló qué, por scope. El worker registra mutaciones, reveals, bundles y purgas (nunca valores de secretos; ejecuciones ya viven en `flow_runs`); como nunca ve sesiones, el gateway reenvía el principal como `x-savia-actor`. `GET /api/audit?limit=&cursor=` devuelve el scope propio, newest-first. La purga conserva el audit para forense.
- Paquete Seguros: la migración `0005_bundle_flow_state.sql` guarda procedencia por flow (versión + hash de contenido; mover carpetas no cuenta como drift). `GET /api/bundles/insurance-auto-light/status` reporta por scope `current | customized | outdated | hidden | not-installed` y `updateAvailable`. `POST .../sync` (`{flowIds?, force?}`) instala lo faltante, actualiza lo pristine-desactualizado preservando carpetas del tenant y solo añade variables faltantes (nunca sobrescribe ni resucita ocultos); lo personalizado se omite salvo `force`. `ensure` conserva su semántica (sobrescribe definiciones) y ahora también registra procedencia.
- Operación: en producción el worker comparte el D1 (`migrations_dir` core), por lo que los overlays viven en las tablas core de la migración `0064_savia_request_tenant_scope.sql` (réplica de `0004`/`0005` + `bundle_flow_state`, con espejo Postgres `0006`). El workflow `import-savia-request-variables` acepta `tenant` (`SAVIA_REQUEST_TENANT`, ej. `agency:101`): sin tenant importa al catálogo como antes; con tenant solo escribe overlays de ese scope, sin tocar globales, con la misma regla de no sobrescribir valores existentes.

Las pantallas anteriores `/auto-light-quotes/*` y `/provider-credentials` redirigen a Savia request. La API ya no registra las antiguas rutas de cotización, conectividad ni credenciales de proveedores, y no consume su antigua cola. Las tablas históricas y las pruebas aisladas de los componentes anteriores se conservan; esos componentes no se montan en producción.

## Desarrollo local

Desde la raíz: `pnpm install` y `pnpm dev`. El administrador usa el puerto 5173 o el siguiente disponible. La API está en 8787 y el motor privado en 8797. Se ejecuta todo localmente; no requiere desplegar en Cloudflare.

Para copiar una instalación existente del MVP a un destino todavía vacío:

```sh
python3 apps/savia-request/scripts/import-local-mvp.py /ruta/insurer-flow-lab
```

El script toma una instantánea SQLite consistente y copia la configuración de cifrado. Conserva inputs, carpetas, variables, versiones e historial sin llamadas a proveedores. Se niega a sobrescribir un destino existente. Los archivos privados quedan fuera de Git. En este entorno ya se realizó la copia: 21 flows visibles, 33 incluyendo eliminados, 165 variables, una versión y 50 ejecuciones.

## Despliegue

La configuración de producción añade el Worker privado `savia-request`, su binding `LOADER`, el binding de la API y la migración `0020_savia_request.sql`. El workflow utiliza el secreto `SAVIA_REQUEST_ENCRYPTION_KEY` como `ENCRYPTION_KEY` del Worker. No hay ruta pública, workers.dev ni URL de preview del motor.

Los datos locales no se publican con el código. Antes de trasladarlos a producción debe transferirse la instantánea privada y configurarse la misma clave para sus variables cifradas (o recifrarlas con la clave del destino). El 6 de septiembre de 2026 se desplegó el motor privado y se transfirió la instantánea al D1 existente: 33 flows (21 visibles), 165 variables, una versión, 54 ejecuciones y cuatro carpetas. La clave correspondiente se configuró en el Worker y como secreto de despliegue de GitHub. La migración SQL crea tablas sin borrar registros anteriores.

## Verificación

Las pruebas `apps/api/test/savia-request*.test.ts` cubren acceso anónimo y por roles a todas las rutas, aislamiento del token de Savia, propagación de errores, CRUD, variables cifradas, publicación, historial y ejecución simulada con hooks reales. Las pruebas del administrador cubren el menú, el redireccionamiento y el rechazo de acceso sin rol. Scalar y su CSS se empaquetan en la compilación del administrador.
