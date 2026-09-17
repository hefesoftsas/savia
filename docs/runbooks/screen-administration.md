# Administración por pantalla

Administrar abre la lista de pantallas activas del dominio, usando `studio.screen.hidden`, igual que la navegación del CRM. No contiene nombres de pantallas fijos. Las ocultas se recuperan desde Organizar pantallas.

Configurar abre `view=admin-screen&object=<nombre>` con opciones de esa pantalla: registros, campos y formulario, presentación de formularios y visibilidad, operaciones del API para colecciones enlazadas, relaciones en dominios de datos e historial. Los endpoints se configuran directamente en un panel lateral sin pasar por el listado global de fuentes.

Relaciones usa `screen-relations` y filtra conexiones y nodos por la pantalla seleccionada. Historial usa `screen-audit`; el API filtra `crm_audit.object_name` antes de aplicar el límite de resultados. Presentación usa `screen-settings` y entrega solo esa pantalla al gestor. El retorno mantiene el contexto de configuración.

Las herramientas generales permanecen separadas: nueva pantalla, organización, fuentes, integraciones/API, reportes y acciones, historial del dominio. Un dominio vacío ofrece crear la primera pantalla o conectar una fuente.

Verificación: pruebas con nombres arbitrarios y pantallas ocultas, navegación contextual, relaciones, filtro de auditoría en D1, TypeScript y revisión visual en navegador.
