# Endpoints por operación de colección

En CRM → Administrar → Datos → Fuentes y colecciones, cada colección enlazada tiene el botón **Operaciones**. El panel precarga Listar, Consultar, Crear, Editar y Eliminar. Seleccionar **Sin configurar** y guardar deshabilita esa acción en la UI y el backend.

**Detectar endpoints desde OpenAPI** acepta documentos OpenAPI 3.0/3.1 en JSON o YAML. Analiza métodos, rutas, operationId y esquemas de respuesta para proponer candidatos; no ejecuta endpoints ni habilita escrituras. Los comandos POST que incluyen update/delete se clasifican correctamente; los comandos ambiguos quedan sin sugerencia. Los parámetros de identificador de ruta se normalizan a `{id}`. No se admiten rutas con varios parámetros de ruta.

Las colecciones internas muestran únicamente los endpoints del contrato registrado para su colección. Se permite deshabilitar acciones y editar el mapa de campos de entrada. Se conserva la normalización de respuestas del adaptador y la actualización parcial de datos. Las fuentes externas permiten seleccionar candidatos o configurar una ruta manual, relativa a la URL de la fuente. Mantienen secretos en backend, HTTPS público, comprobación DNS, límite de respuesta, timeout y bloqueo de redirecciones.

Mapeos avanzados para fuentes externas:

- `format`: `json` o `jsonapi`.
- `requestFields`: campo CRM → parámetro del cuerpo; admite rutas de objeto con puntos. Un mapa vacío conserva los campos.
- `dataPointer`: JSON Pointer que localiza el registro o lista (`/data`, `/items` o raíz vacía).
- `idPointer`: identificador dentro de cada registro JSON, por ejemplo `/id` o `/key`.
- `responseFields`: campo CRM → JSON Pointer dentro de cada registro (en JSON:API: `/attributes/name`). Un mapa vacío conserva los campos que el adaptador y la colección permiten.
- `idBodyField`: parámetro de identificador para comandos JSON sin `{id}` en la ruta. Predeterminado `id`.
- `pageParameter`, `sizeParameter`, `searchParameter`: nombres de los parámetros de consulta. La paginación es por número de página y tamaño; no implementa cursores ni offset remoto.
- `totalPointer`: ruta al total de registros para respuestas JSON. JSON:API conserva la configuración del total y los enlaces de su fuente.

Guardar comprueba versión, campos conocidos y pertenencia al contrato. Se persiste en `crm_collection_bindings.config.operations`, actualiza las capacidades del objeto y registra auditoría. No altera registros del negocio. Los permisos de acceso al dominio siguen aplicándose.

API disponible en Scalar: GET/PUT `/api/collection-bindings/{name}/operations`, POST `/api/collection-bindings/{name}/operations/infer`. La inferencia recibe `{document}`; guardar recibe `{version,operations}` con las cinco acciones, cada una endpoint o null.

Verificación: pruebas de inferencia, selección y deshabilitación en UI; D1 para capacidades, versión y rechazo de endpoints ajenos; adaptador remoto para POST de actualización, mapas JSON, búsqueda y paginación; guardado de Clientes en navegador y comprobación de persistencia.

## Operaciones internas registradas

El selector también permite **Configurar endpoint manualmente** para dominios internos. La ruta y el método se validan contra las operaciones compatibles registradas; escribir una URL no crea una operación nueva. Los comandos pueden declarar `descriptor.collectionBinding` (colección, acción y paths de campos). El catálogo los descubre, propone el mapeo y agrega los campos requeridos al guardar. La asociación se publica en OpenAPI mediante `x-savia-collection` y `x-savia-operation`.

Países dispone del comando existente `POST /v1/geographic-catalog/commands/register-country`, que recibe `id`, `name` y `code`. Su mapeo en el CRM es `input_id → id`, `label → name`, `code → code`. No se habilitan edición ni eliminación porque no hay comandos registrados para esas acciones. El registro de prueba se creó únicamente en D1 de pruebas.
