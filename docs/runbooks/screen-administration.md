# Administración por pantalla

Administration lists the domain screens using `studio.screen.hidden`. “Pantallas disponibles” are eligible for navigation; their actual presence in a member’s sidebar also depends on permissions and personal menu preferences. “Pantallas fuera del menú” remain accessible through authorized direct links. Hiding a screen does not change access permissions.

Tenant administrators can create and manage screens only within their authorized
tenant. Studio initializes its core schema through `/api/bootstrap`; opening
screen administration or creating a screen does not install optional business
packages or require their external collection service. Install those capabilities
through their explicit setup flow. A missing business service must not prevent
an empty tenant from creating its first screen.

Configurar abre `view=admin-screen&object=<nombre>` con opciones de esa pantalla: registros, campos y formulario, presentación de formularios y visibilidad, operaciones del API para colecciones enlazadas, relaciones en dominios de datos e historial. Los endpoints se configuran directamente en un panel lateral sin pasar por el listado global de fuentes.

Relaciones usa `screen-relations` y filtra conexiones y nodos por la pantalla seleccionada. Historial usa `screen-audit`; el API filtra `crm_audit.object_name` antes de aplicar el límite de resultados. Presentación usa `screen-settings` y entrega solo esa pantalla al gestor. El retorno mantiene el contexto de configuración.

Las herramientas generales permanecen separadas: nueva pantalla, organización, fuentes, integraciones/API, reportes y acciones, historial del dominio. Un dominio vacío ofrece crear la primera pantalla o conectar una fuente.

The form designer inherits the active workspace theme, including the unused
space below its canvas and panels. Its container uses the shared background
token so it remains consistent in both light and dark mode.

## Visibilidad en la barra lateral (Sidebar Visibility)

On narrow screens, each screen row places visibility and management controls
below its name and description. Plugin badges wrap with long titles, and touch
targets remain accessible without squeezing the screen name into a narrow column.

No todas las pantallas necesitan mostrarse en la barra lateral izquierda del CRM. Algunas pantallas se diseñan para ser invocadas exclusivamente desde otras páginas, enlaces contextuales o flujos de trabajo (por ejemplo, pantallas de detalle, asistentes o pantallas secundarias de extensiones).

- **Al crear una pantalla**: El modal de «Nueva pantalla» incluye la opción «Mostrar en la barra lateral» (activa por defecto). Si se desactiva, la pantalla se crea con `studio: { screen: { hidden: true } }`. Permanece accesible directamente por URL (`/crm?object=<nombre>`), deep link y mensajes de navegación entre componentes (`postMessage`).
- **Screen administration** groups screens into “Pantallas disponibles” and “Pantallas fuera del menú”. The domain visibility switch controls eligibility for the menu. Personal hidden-menu preferences and access permissions are separate; an eligible screen is not necessarily shown to every member.
- **En la configuración de la pantalla (`admin-screen`)**: La sección «Visibilidad en la barra lateral» incluye un interruptor directo para mostrar u ocultar la pantalla del menú sin alterar sus datos, campos ni configuraciones.

## Creación desde archivo Excel o CSV (Spreadsheet Generator)

Desde la barra de administración de pantallas o el diálogo de nueva pantalla se puede invocar «Desde Excel o CSV» para generar de forma asistida una colección y su pantalla:

- **Lectura e inferencia en el cliente**: Admite `.xlsx`, `.xls` y `.csv`. Analiza tipos (`Toggle`, `DateControl`, `Currency`, `Number`, `Dropdown`, `Email`, `Phone`, `Url`, `Textarea`, `Textbox`) y sanitiza cabeceras a identificadores válidos para D1.
- **Configuración de pantalla**: Permite definir sección de menú, icono Lucide, superficie (`drawer-long`, `modal`, etc.), distribución en columnas y activación opcional de vista Pipeline Kanban si se detectan etapas.
- **Matriz de campos e importación**: Ofrece una tabla interactiva para redefinir tipos, editar etiquetas y desmarcar columnas antes de crear el objeto e importar los registros iniciales.

Verificación: pruebas con nombres arbitrarios y pantallas ocultas, navegación contextual, relaciones, filtro de auditoría en D1, TypeScript y revisión visual en navegador.

## Addressable navigation tabs

- `/studio?tenantId=<tenantId>&view=operations&tab=workflows|automations|reports|tasks|import` opens the corresponding operations tab. Missing or invalid tabs fall back to `tasks`.
- `/studio?tenantId=<tenantId>&view=admin&tab=packages` opens the unified feature catalog (legacy alias); `tab=extensions` opens the same catalog; `tab=screens` opens screen administration. Missing or invalid tabs fall back to screens.
- `/my-integrations?tab=virtual-employees` opens AI employees; `tab=connections` opens personal accounts and connections. Missing or invalid tabs fall back to connections.

Tab changes preserve existing query parameters and create browser history entries. Back/forward navigation restores the selected tab. Domain screen visibility does not override permissions or a member’s personal menu settings.

## Tenant API tools

Open **Pantallas → Más herramientas → Integraciones y API** to access **Consultar API** and **Descargar OpenAPI** in the integrations tab. These tools use the selected tenant and no longer appear above every Studio screen.

## Unified feature activation

Screen administration has **Pantallas** and **Funcionalidades** tabs. Existing
`tab=packages` links remain an alias for the feature catalog. Applications and
independent plugins are listed together; a plugin required by an application is
not duplicated as a separate install action.

**Habilitar Cotizador** opens a read-only review of the required components and
screens. **Confirmar habilitación** prepares the dependencies and the application
in the selected tenant. A missing catalog dependency or a schema conflict blocks
activation. Failures preserve the review so users can retry; dependencies already
prepared may remain installed. Real provider connections must still be configured.

**Opciones avanzadas** contains JSON import. Exported application definitions can
be reused in another tenant without transferring records or credentials.

Practical uses supported by the current catalog:

- Enable **Seguros** to create clients, insurers, policies, payments, and claims.
- Enable **Cotizador** to prepare its plugin, step-by-step screen, and quote history.
- Export an application and import it into another tenant to reuse its definitions.

Successful application activation, installation, and enable/disable operations
invalidate the cached screen and extension catalogs before the UI refreshes.
The sidebar must show the backend's newly available screens immediately, without
requiring a reload or a tenant switch.

## Audit history

Expand an audit event to inspect its full identifier, timestamp, target record,
action, and stored detail payload. **Exportar CSV** exports all retained events in
the current tenant or screen scope. CSV output quotes fields and neutralizes
spreadsheet formulas. **Eliminar evento** removes one event; **Eliminar todos**
removes all events in the current scope, including those beyond the visible list.
Both deletion actions require confirmation and do not delete business records or
screens. Destructive audit operations require tenant management permissions.

## Permanent deletion and dependent screens

Tenant administrators can preview permanent deletion from screen administration.
Deletion previews always require a fresh backend response; they are not stored or
served from the browser metadata cache, including on retries or while offline.
The dialog loads the selected screen and recursively finds screens that reference
it, through relation fields or collection relations in the same tenant. References
from the selected screen to an independent parent do not include that parent.

The option to delete dependent screens and their data is **off by default**.
The preview lists each affected screen and its record count, including records
in the trash. Previews are limited to 100 affected screens; larger dependency sets
must be reduced before deletion. Selecting this option requires reviewing the expanded scope and
acknowledging record deletion. Source-backed and managed screens block deletion;
unlink or manage them through their own administration first.

Confirmation deletes the reviewed local screens, their records, relation links,
and associated local metadata atomically. A changed schema, dependency set, or
record count invalidates the preview: reload it and confirm the new scope. Cycles
are treated as one deletion set, with no partial deletion on failure. The tenant's
users, credentials, and unrelated screens are outside this operation. File metadata
is removed with records; physical blobs in object storage are not purged by this
operation.

The API reference for the preview and deletion options is generated in the tenant's
OpenAPI document. Both operations require tenant administration access.
