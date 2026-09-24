# Paquetes de soluciones

Savia distingue el motor low code de la configuración sectorial. Este diseño
se inspira en los [plugins de NocoBase](https://docs.nocobase.com/plugin-development/server/)
y sus [migraciones versionadas](https://docs.nocobase.com/plugin-development/server/migration).
El formato JSON de Savia es propio; no ejecuta ni importa paquetes npm de NocoBase.

## Instalar

1. Abre **Administrar páginas** y selecciona la organización o dominio destino.
2. Expande **Paquetes de soluciones**.
3. Descarga una configuración del catálogo o importa un archivo JSON de hasta 2 MB.
4. Revisa los objetos que se crearán o actualizarán y resuelve los conflictos.
5. Pulsa **Instalar paquete**. Las colecciones quedan disponibles en el diseñador.

Solo los administradores del espacio pueden gestionar sus paquetes. La API
deriva el espacio de la ruta autorizada, nunca de un identificador enviado
dentro del archivo. Una instalación no concede permisos sobre otro espacio.

**Descargar** obtiene la plantilla publicada del catálogo. **Exportar instalado**
obtiene el manifiesto con el que se instaló ese paquete, sin registros ni
credenciales; no captura las personalizaciones posteriores del diseñador.

## Formato para otras industrias

```json
{
  "format": "savia.solution",
  "formatVersion": 1,
  "id": "example.inventory",
  "version": "1.0.0",
  "label": "Inventario",
  "description": "Productos del almacén",
  "requires": [],
  "objects": [
    {
      "name": "productos",
      "label": "Productos",
      "description": "",
      "config": {
        "version": 2,
        "fields": {
          "name": { "type": "Textbox", "label": "Nombre", "required": true }
        },
        "fieldOrder": ["name"]
      }
    }
  ]
}
```

Los objetos utilizan el contrato existente del diseñador: campos, relaciones
por `config.relation`, secciones, distribución y opciones de pantalla. Se
pueden crear relaciones mutuas en una misma instalación. `requires` enumera
extensiones disponibles en el despliegue o paquetes activos del mismo espacio.
El instalador valida identificadores, versiones, relaciones y colisiones.

Un paquete declarativo no puede definir capacidades privilegiadas,
`studio.collection`, `studio.business` ni scripts de campos HTML. Los
adaptadores con código se registran en el despliegue. Los flujos externos,
sus conexiones y secretos se configuran por separado; este formato no exporta
automatizaciones guardadas ni servicios externos completos.

## Etiquetas localizadas (ES/EN/PT)

El paquete, sus objetos y sus campos aceptan traducciones opcionales sin
migración de datos:

```json
{
  "label": "Seguros",
  "labels": { "en": "Insurance", "pt": "Seguros" },
  "description": "Clientes y pólizas.",
  "descriptions": { "en": "Customers and policies." },
  "objects": [
    {
      "name": "clientes",
      "label": "Clientes",
      "labels": { "en": "Customers", "pt": "Clientes" },
      "config": {
        "fields": {
          "name": {
            "type": "Textbox",
            "label": "Nombre",
            "labels": { "en": "Name", "pt": "Nome" }
          }
        }
      }
    }
  ]
}
```

Las claves ausentes o vacías usan el valor predeterminado en español; los
nombres de objeto, valores de opción y registros guardados nunca cambian.
La interfaz resuelve estas etiquetas según el idioma seleccionado al mostrar
el catálogo y la vista previa, que conserva los valores estables. Una
actualización que modifique campos existentes (incluidas sus etiquetas)
sigue la política habitual: requiere una migración específica en lugar de
sobrescribir personalizaciones.

## Extensiones TypeScript confiables

Una extensión con código usa un manifiesto `savia.extension` versionado, pero
su módulo TypeScript se incluye en el release de Savia y pasa por revisión y
pruebas antes de desplegarse. Un administrador no puede subir ni ejecutar
JavaScript, TypeScript o un `.tgz` desde un paquete de solución.

El catálogo compilado contiene las extensiones disponibles para esa versión de
Savia. La API permite consultar su estado, instalar una extensión incluida en
el catálogo y activarla o desactivarla por tenant:

- `GET /v1/data-domains/:domainId/api/extensions`
- `POST /v1/data-domains/:domainId/api/extensions/:id/install`
- `PATCH /v1/data-domains/:domainId/api/extensions/:id` con `{ "enabled": true | false }`

El host resuelve el tenant desde la ruta autorizada; el manifiesto no puede
seleccionar otro tenant. Una dependencia de `requires` solo se satisface si la
extensión es built-in del release o está activa en ese mismo tenant. Tampoco se
puede desactivar una extensión requerida por otra extensión o solución activa.
La instalación y desactivación conservan datos: este primer incremento no
ejecuta hooks ni migraciones arbitrarias de extensiones.

`insurance.quotes` es una extensión built-in del release. La migración de
compatibilidad actualiza las soluciones de Seguros existentes para requerirla,
sin que cada tenant tenga que registrar una copia de esa extensión.

### Ejemplo completo: Cartera de pólizas

`insurance.portfolio-dashboard` demuestra el contrato completo de una
extensión TypeScript incluida en el release. No es built-in: cada espacio la
instala y activa de forma independiente.
En **Administrar pantallas → Paquetes y extensiones**, el administrador puede
ver su estado, instalarla y activarla/desactivarla. Al activarla se habilita
**Cartera de pólizas** como una pantalla normal de Savia.

La pantalla custom no construye rutas HTTP. Recibe una API `savia` del host:

```ts
const polizas = savia.collections.collection<Poliza>("polizas");
const page = await polizas.list({ page: 1, perPage: 25 });
await polizas.create({ name: "POL-001", estado: "Vigente" });
await polizas.update(id, changes, { version });
await polizas.remove(id, { version });

const disponibles = await savia.collections.list();
const esquema = await polizas.describe();
const resumen = await savia.services.get("summary");
```

`collections.list()` y `describe()` devuelven solamente las colecciones y
esquemas expuestos por el tenant y usuario actuales. El host añade la ruta,
tenant, paginación por defecto y control de versión; el código del plugin no
recibe credenciales ni acceso directo a D1. `services.get()` se limita
automáticamente a la extensión dueña de la pantalla.

La ruta solo responde cuando la extensión está activa. El host limita la
lectura a los registros no eliminados de `polizas` del tenant resuelto y pasa
instantáneas JSON al reductor puro del paquete. Así la extensión puede contar
pólizas, vigencias, próximos vencimientos y primas sin tener D1, `Env`, un
tenant elegible ni permiso para consultar otras colecciones.

#### Provisionamiento de Pólizas

La instalación de `insurance.portfolio-dashboard` declara un requisito estático
de colección. Si el tenant no tiene `polizas`, el host crea en la misma
transacción una colección mínima con `name`, `inicio`, `fin`, `prima` y
`estado`, más su versión normal de esquema. No crea pólizas de muestra.

Si `polizas` ya existe y contiene esos campos con los tipos y estados
requeridos, Savia la conserva exactamente como está, incluidos relaciones,
campos adicionales, pantallas y registros. Esto hace compatible la colección
amplia creada por `savia.insurance`. Si existe una `polizas` incompatible, la
instalación devuelve un conflicto y no deja una fila de extensión activa.

`cartera` es una colección independiente: nunca se renombra, adopta, usa como
fuente ni modifica durante esta instalación. Si alguien borra `polizas` después
de activar la extensión, el resumen devuelve un error de requisito faltante y la UI
conserva **Reintentar** y ofrece **Reparar instalación**. Esta acción repite el
`POST /extensions/:id/install` idempotente: restaura solamente el requisito
faltante, sin desactivar la extensión ni tocar `cartera` o pólizas existentes,
en lugar de exponer el error interno “El objeto no existe”.

Savia Assistant publica `savia_extension_insurance_portfolio` como una
herramienta de solo lectura. Comprueba primero el estado de la extensión y usa
la misma ruta agregada con autorización delegada; no crea ni actualiza pólizas.
El código está en `packages/insurance-portfolio-dashboard/` y se importa de
forma explícita desde API, Admin y MCP. Es un ejemplo de release, no un
paquete de terceros que se pueda cargar o subir.

### Pantallas React de una extensión

Una extensión puede aportar una pantalla React completa desde su propio
directorio `src/screens/`. En desarrollo local, Vite importa ese paquete del
workspace; guardar un cambio en la pantalla actualiza la aplicación local sin
construir ni subir un archivo. La contribución declara el `object` y `view`
del CRM que reemplaza, por lo que puede reutilizar una entrada normal del menú
izquierdo.

La primera pantalla de este tipo es
`packages/insurance-portfolio-dashboard/src/screens/policies.tsx`. Cuando
`insurance.portfolio-dashboard` está activa, la ruta normal de **Pólizas**
renderiza su dashboard, listado y formulario React propio. Al desactivar la
extensión, Savia deja de montar esa contribución y vuelve a la vista CRM
normal. El host entrega una función de petición asociada al dominio y la
sesión actual; la pantalla usa las operaciones CRM existentes para crear,
editar y eliminar registros con las mismas validaciones y versiones
optimistas. Nunca recibe D1 ni credenciales.

El autor genera un candidato de release con
`pnpm extension:pack insurance-portfolio-dashboard`. El comando produce
`dist/extensions/insurance.portfolio-dashboard-1.0.0.savia-extension.zip`,
incluye el manifiesto estático, los fuentes React y `release.json`, e informa
su SHA-256. Sirve para entregar y revisar exactamente el código que CI debe
aceptar; no se sube ni se ejecuta desde la UI.

En Workers, recibir un ZIP no puede ejecutar TypeScript directamente: CI debe
validar el manifiesto, ejecutar pruebas y tipos, construir el código, firmar
el artefacto y desplegar una versión nueva de Savia antes de que un tenant
pueda activarlo.

### Acceso desde el asistente y a colecciones

Las extensiones que quieren colaborar con Savia Assistant registran herramientas
MCP estáticas en el release bajo `savia_extension_`. El asistente solo entrega
al modelo las que tengan `annotations.readOnlyHint: true`; una herramienta de
extensión que escriba no es model-callable. Cualquier escritura sigue pasando
por `savia_prepare_command` y la confirmación explícita del usuario.

El handler de una extensión no recibe `Env`, D1, secretos, cabeceras ni un
selector de tenant. Recibe un cliente de API ligado a la autorización delegada
del usuario, comprueba que su extensión esté activa y luego usa las operaciones
de colecciones autorizadas por el host. Por ejemplo,
`savia_extension_insurance_portfolio` consulta el estado de
`insurance.portfolio-dashboard` y agrega la colección `polizas`; no accede a
la base de datos directamente.

No se implementó carga dinámica de módulos ni subida de `.tgz`. Si se necesita
ejecutar código de terceros, requerirá un producto posterior con artefactos
firmados, CI y un sandbox de capacidades separado del Worker principal.

## Ciclo de vida y actualizaciones

El manifiesto y la propiedad de cada objeto se guardan en D1. La instalación
es un lote atómico con controles de concurrencia; repetir la misma versión y
contenido no duplica objetos. Reutilizar una versión con contenido distinto
se rechaza. Tampoco se permiten retrocesos de versión.

Las actualizaciones admiten objetos nuevos y campos nuevos opcionales sin
unicidad. No eliminan objetos, no cambian campos existentes y no sobrescriben
personalizaciones detectadas. Los cambios incompatibles requieren una
migración específica mediante el mecanismo de esquemas de la plataforma;
no se ejecutan scripts de migración subidos en un paquete.

Desactivar mantiene los datos y el historial y retira las pantallas, el
acceso a sus registros y su API publicada. No se puede desactivar un paquete
del que dependa otro activo. Reactivar restaura la disponibilidad. No hay
desinstalación destructiva ni borrado automático de registros.

## Seguros existente

`0041_industry_solutions.sql` reconoce perfiles de agencia y colecciones
sectoriales existentes. Registra una instalación de compatibilidad sin
recrear pantallas ni reescribir datos. En la interfaz aparece como
**Configuración existente**; internamente utiliza versión `0.0.0`.

El paquete público `savia.insurance` crea seis colecciones locales para una
organización nueva, incluso sin perfil de agencia. La extensión
`insurance.quotes` aporta de manera opcional las conexiones y acciones de
cotización. La migración `0048_insurance_quotes_extension.sql` actualiza las
instalaciones de compatibilidad para que requieran esta extensión; no conserva
un runtime ni rutas `legacy`.

La actualización de una instalación existente detecta colisiones y cambios
incompatibles en lugar de reemplazar las personalizaciones. Su exportación
de compatibilidad puede no contener objetos: para instalar Seguros en una
organización nueva se utiliza **Descargar Seguros**, la plantilla del catálogo.

## Desarrollo

- Contrato: `packages/studio-shared/src/solution-package.ts`.
- Contrato y registro de extensiones: `packages/studio-shared/src/extension-package.ts`.
- API de colecciones para pantallas de extensiones:
  `packages/studio-shared/src/plugin-api.ts`.
- Instalador y estado: `packages/studio-server/src/solutions.ts` y `solution-state.ts`.
- Estado de extensiones por tenant: `packages/studio-server/src/extensions.ts` y
  `packages/db/migrations/0045_extensions.sql`.
- Conexiones y ejecuciones de extensiones: `packages/studio-server/src/extension-connections.ts`,
  `packages/studio-server/src/extension-actions.ts` y
  `packages/db/migrations/0047_extension_runtime.sql`.
- Requisitos y provisión segura de colecciones:
  `packages/studio-server/src/extension-object-requirements.ts`.
- Resúmenes limitados por el host: `packages/studio-server/src/extension-summaries.ts`.
- Extensiones del API: `apps/api/src/extensions`.
- Herramientas de extensiones para Assistant: `apps/mcp/src/extensions`.
- Catálogo first-party: `packages/release-catalog/`; es el único ensamblador
  que conoce los paquetes sectoriales.
- Paquete opcional de cotizaciones: `packages/insurance-quotes/`.
- UI de instalación: `apps/admin/src/features/studio-engine/extension-manager.tsx`.
- Registro de pantallas React: `apps/admin/src/features/studio-engine/extension-screens.tsx`.
- Fuente del paquete oficial: `solutions/insurance/manifest.json`.
- Catálogo compilado: `apps/api/src/solutions/catalog.ts`.

Tras cambiar el manifiesto oficial, ejecuta `node scripts/build-solution-catalog.mjs`.
La prueba de integración verifica que el catálogo y el JSON descargable coinciden.
`pnpm dev` aplica la migración local; el despliegue debe aplicar las migraciones
D1 antes de servir la nueva versión del API.

Las rutas se ofrecen bajo `/v1/studio/:tenantId/api/solutions` (alias heredado `/v1/dynamic-crm/...`) o
`/v1/data-domains/:domainId/api/solutions`: GET catálogo, POST `/preview`,
POST `/install`, GET `/:id/export` y PATCH `/:id` con `{ "enabled": false }`.
