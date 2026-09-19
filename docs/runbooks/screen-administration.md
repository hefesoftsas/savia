# Administración por pantalla

Administration lists the domain screens using `studio.screen.hidden`. “Pantallas disponibles” are eligible for navigation; their actual presence in a member’s sidebar also depends on permissions and personal menu preferences. “Pantallas fuera del menú” remain accessible through authorized direct links. Hiding a screen does not change access permissions.

Configurar abre `view=admin-screen&object=<nombre>` con opciones de esa pantalla: registros, campos y formulario, presentación de formularios y visibilidad, operaciones del API para colecciones enlazadas, relaciones en dominios de datos e historial. Los endpoints se configuran directamente en un panel lateral sin pasar por el listado global de fuentes.

Relaciones usa `screen-relations` y filtra conexiones y nodos por la pantalla seleccionada. Historial usa `screen-audit`; el API filtra `crm_audit.object_name` antes de aplicar el límite de resultados. Presentación usa `screen-settings` y entrega solo esa pantalla al gestor. El retorno mantiene el contexto de configuración.

Las herramientas generales permanecen separadas: nueva pantalla, organización, fuentes, integraciones/API, reportes y acciones, historial del dominio. Un dominio vacío ofrece crear la primera pantalla o conectar una fuente.

## Visibilidad en la barra lateral (Sidebar Visibility)

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

- `/crm?domain=<domain>&view=operations&tab=workflows|automations|reports|tasks|import` opens the corresponding operations tab. Missing or invalid tabs fall back to `tasks`.
- `/crm?domain=<domain>&view=admin&tab=packages` opens packages and extensions; `tab=screens` opens screen administration. Missing or invalid tabs fall back to screens.
- `/my-integrations?tab=virtual-employees` opens AI employees; `tab=connections` opens personal accounts and connections. Missing or invalid tabs fall back to connections.

Tab changes preserve existing query parameters and create browser history entries. Back/forward navigation restores the selected tab. Domain screen visibility does not override permissions or a member’s personal menu settings.
