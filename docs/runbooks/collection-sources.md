# Fuentes y colecciones

## Arquitectura

El dominio agrupa pantallas y sus colecciones. La fuente describe cómo acceder a los datos. Una colección conectada declara campos y operaciones; el gateway selecciona su adaptador en el servidor. Las colecciones del registro de dominios existente se pueden conectar inicialmente para consulta. JSON:API permite operaciones remotas explícitamente habilitadas.

Los registros configurables locales siguen usando D1. Una colección conectada no copia automáticamente los datos del origen, ni agrega columnas a bases externas. Los campos del origen se describen para renderizar el formulario; no se crean propiedades externas mediante el diseñador. No hay sincronización bidireccional implícita. HubSpot sigue disponible mediante las capacidades genéricas del espacio de trabajo CRM.

## Diseño de referencia y procedencia

Implementación original de Savia. No se importó, copió ni añadió una dependencia de NocoBase. Se consultaron sus conceptos documentados de DataSource, Collection y Repository:

- https://docs.nocobase.com/data-sources/data-source-manager/
- https://docs.nocobase.com/data-sources/data-source-rest-api/
- https://docs.nocobase.com/data-sources/external/

Al revisar el origen el 2026-09-08, packages/core/data-source-manager/package.json declaraba Apache-2.0, mientras archivos consultados conservaban avisos AGPL/comerciales y LICENSE.txt incluía términos suplementarios. Por la restricción del usuario de reutilizar únicamente código Apache2 inequívoco, no se reutilizó código upstream. Esto registra la decisión técnica de procedencia, sin asumir que todos los archivos de core tienen idéntica licencia.

## Operación

Sources are scoped to the active tenant and the principal that created them. A different tenant cannot list, inspect, update, or delete a source, even when the principal ID matches; within a tenant, source listing and management also enforce creator ownership. Tenant administrators and platform administrators can use source-management routes only within the requested tenant, subject to those ownership checks. Bindings and collection catalogs are tenant-scoped. Credentials remain encrypted in the backend with the integrations key and are never returned in list responses.

Las conexiones JSON:API admiten únicamente destinos públicos HTTPS y recursos configurados, sin redirecciones. Las operaciones no habilitadas se rechazan también desde API. Los errores externos se normalizan sin revelar credenciales. La prueba de conector utiliza transporte controlado; configurar una fuente no envía escrituras.

## Uso y alcance actual

En CRM, selecciona Plataforma o un dominio independiente y abre Integraciones OpenAPI → Fuentes y colecciones. Se puede vincular una colección del catálogo existente, registrar una fuente JSON:API y declarar sus campos, relaciones y operaciones. El identificador de la pantalla se propone a partir de la colección o recurso y reserva el siguiente sufijo disponible; sigue siendo editable. La administración permite renovar o quitar el token, eliminar fuentes sin vínculos y desvincular pantallas sin borrar registros del origen.

Para una fuente JSON:API, el administrador indica la ruta fija del recurso y puede usar **Analizar recurso** antes de vincularlo. JSON:API no define un catálogo universal de recursos, por lo que la URL base no permite enumerarlos automáticamente. El análisis consulta exactamente una primera página de un registro, devuelve solo campos, relaciones, tipo y metadatos de paginación, y deja ese JSON editable. No devuelve valores de la muestra ni credenciales, no persiste la muestra y conserva los límites de HTTPS público, DNS, redirecciones, 10 segundos y 1 MB del adaptador remoto.

El diseñador de colecciones conectadas permite ordenar y mostrar campos y configurar columnas; no altera el esquema remoto. Para colecciones del catálogo, los campos se infieren de una muestra y el acceso es de consulta. Las colecciones locales conservan el diseñador completo. Otros motores de bases de datos requieren nuevos adaptadores. HubSpot sigue disponible mediante las capacidades genéricas del espacio de trabajo CRM; ya no sincroniza perfiles operativos de clientes.

## Verificación local 2026-09-08

- Migración 0026 aplicada en la copia local de vista previa.
- 60 pruebas API de fuentes, JSON:API, dominios y regresiones de agencias/clientes; 31 pruebas adicionales del servidor CRM independiente.
- 20 pruebas UI de fuentes/detalle/diseñador y 13 de navegación; TypeScript API/administrador sin errores.
- Compilación Vite correcta; advertencia por tamaño de algunos bundles.
- Navegador: colección Pólizas vinculada a policy-lifecycle/policies, listado y ficha consultados; diseño de dos columnas guardado y conservado tras recargar.
- Navegador conserva 90 agencias y 50.105 perfiles de clientes. No se realizaron escrituras a proveedores externos; JSON:API se verificó con transporte controlado.

## Reinicio local solicitado

El procedimiento local de vista previa del 2026-09-08 es histórico y depende de tablas y perfiles operativos que ya fueron retirados. No lo uses como una guía de migración. La vinculación de colecciones soportadas, análisis de recursos y configuración de columnas descritos arriba siguen vigentes.

Plataforma ya no instala automáticamente los objetos administrados al abrirse. Los adaptadores anteriores siguen disponibles cuando su metadata está instalada explícitamente. La pantalla inicial permite conectar una colección en un CRM vacío.

## Selective HubSpot screen installation

In **Sources and collections → Connected CRM · HubSpot**, select the screens you
need and choose **Install selected (N)**. Nothing is selected by default. **Select
all** includes only available screens that are not already installed; **Clear
selection** resets the choice. Unavailable screens show their access reason, and
existing screens show an installed badge. Return to this panel to add more screens
later without reinstalling the existing selection.

Installation creates the selected Savia screen definitions and connection bindings.
It does not copy all remote records or create, update, or delete records in HubSpot.
Associations to resources with no installed screen do not appear in Savia's related
screen views. Unselecting an installed screen is not an uninstall operation; use
its existing unlink action to remove the screen binding.

The backend validates the explicit resource list and availability before writing
metadata. Unknown, empty, or unavailable selections fail without partially
installing screens. The generated tenant OpenAPI document describes the selection
payload. Legacy callers that omit the selection retain the install-all behavior.
