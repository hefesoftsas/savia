# Estudio por dominios de datos

El CRM ya no necesita una agencia para abrir el diseñador. Un dominio agrupa objetos, registros, pantallas, versiones, archivos e integraciones. La persistencia sigue en D1/R2; los objetos configurables no requieren una tabla SQL nueva por pantalla.

## Uso

1. Abre CRM y selecciona un **Dominio de datos**.
2. **Plataforma → Agencias** contiene la gestión operativa de agencias. El diseñador permite agregar campos y cambiar etiquetas/distribución, conservando los campos operativos obligatorios.
3. **Crear dominio** agrega un espacio independiente (por ejemplo, proyectos o inventario). **Crear objeto** agrega una entidad y abre el diseñador.
4. **Gestionar pantallas** configura presentación; **Diseñador de formularios** publica campos; **Integraciones OpenAPI** guarda contratos y permite importar esquemas/ejecutar operaciones y guardar resultados con un mapeo en el dominio.
5. **API del dominio** muestra Scalar y permite descargar el contrato OpenAPI generado con endpoints individuales por objeto.

## Contrato y permisos

- GET/POST `/v1/data-domains`: catálogo autorizado y creación de dominios independientes.
- `/v1/data-domains/:id/api/*`: CRUD, diseñador, OpenAPI/Scalar e integraciones del dominio.
- `/v1/dynamic-crm/:agencyId/api/*`: compatible con espacios existentes. No se trasladan sus datos.
- `domain:platform` y `domain:<id>` son ámbitos internos; el cliente nunca puede elegir un tenant arbitrario.
- Los dominios nuevos y Plataforma requieren administrador de plataforma. Los administradores de agencia mantienen acceso únicamente a sus espacios autorizados. No hay todavía roles configurables por dominio independiente.
- Integraciones/credenciales/ejecuciones se aíslan por dominio en las tablas existentes; ningún secreto se guarda en almacenamiento del navegador.

## Agencias administradas

El adaptador reutiliza la validación y conversión del dominio operativo. Una transacción guarda la agencia, su propiedad operativa, campos personalizados, unicidad y auditoría. La identidad numérica se asigna en el servidor. La versión del esquema, registro y fuente se verifica al actualizar. Las creaciones soportan Idempotency-Key.

Los campos operativos protegidos no admiten eliminación, cambio de tipo/obligatoriedad, fórmulas, relaciones ni unicidad adicional. Los cambios hechos mediante la API operativa se reflejan al leer sin reemplazar los campos personalizados. El catálogo incorpora las agencias existentes; no las duplica.

La eliminación/restauración masiva, importación y restauración de esquema de Agencias se rechazan explícitamente. Para cambios de esquema se publica una nueva versión. Las escrituras de integraciones y automatizaciones del dominio Plataforma están bloqueadas porque el motor genérico podría omitir el adaptador; utiliza dominios independientes para esas integraciones. El conector especializado de HubSpot y los borradores de cotización siguen disponibles en los espacios de agencia existentes; no se convierten automáticamente en sincronización bidireccional universal.

## Despliegue

Aplicar `0024_data_domains.sql` después de las migraciones existentes y desplegar API + administrador juntos. En esta sesión se aplicó únicamente a la vista previa local, no a producción. No requiere migrar los registros del CRM de agencias.

## Clientes operativos migrados

Plataforma → Clientes consulta los perfiles operativos (`customer_clientagency.id`), sin hidratar decenas de miles de registros en cada petición. La copia local conserva 90 agencias, 48.745 clientes y 50.105 perfiles vinculados a agencias. La diferencia corresponde a clientes con varias agencias. El procedimiento reproducible y sus respaldos están en `local-domain-preview-migration.md`.

El adaptador admite personas naturales y jurídicas, creación, edición parcial, eliminación permanente sujeta a relaciones, búsqueda, filtros, paginación y campos personalizados. Los valores personalizados se guardan en `managed_customer_extensions`, separados de los IDs de Agencias. El formulario permite conservar vacíos históricos al editar otros campos. Los perfiles con ambas clases de persona conservan sus filas; la representación prioriza persona natural y no convierte silenciosamente el tipo. Las filas duplicadas históricas no duplican la paginación.

El botón **Sincronizar CRM** utiliza la conexión HubSpot activa de la agencia del perfil y conserva los vínculos externos existentes. Puede ejecutarse individualmente o sobre hasta 100 clientes seleccionados. Usa el servicio existente de contactos/empresas/representantes. Los endpoints individuales y por selección aparecen en OpenAPI/Scalar. La acción manual sigue disponible. Si el usuario activa una regla de sincronización automática para la agencia en Integraciones, guardar un perfil de cliente también encola su envío a HubSpot; véase [operación de la cola automática](crm-auto-sync.md). Los campos personalizados nuevos no adquieren automáticamente un mapeo a HubSpot.

La exportación de Clientes admite hasta 10.000 filas por consulta. Importación CSV, papelera/restauración y las actividades/tareas/archivos genéricos no se ofrecen para este objeto administrado. La migración conserva referencias históricas a documentos; no copia los archivos de almacenamiento de objetos. Los objetos independientes mantienen sus funcionalidades genéricas.

Aplicar también `0025_managed_customers.sql` antes de desplegar esta ampliación.

### Selectores de colecciones en formularios conectados

En **Configurar vista → Formulario → Selectores desde colecciones**, cada campo escalar editable puede asociarse a una colección registrada del catálogo de dominios. Se configuran el campo del documento que se guarda (`id`, `attributes.code`, etc.) y la etiqueta visible. La configuración se persiste con el diseño y conserva el contrato del API: un ID numérico continúa siendo numérico.

Los clientes conectados incorporan automáticamente Agencia (`agency-network/agency-profiles`) y los tipos de identificación del cliente y representante (`reference-values/identification-types`). Los catálogos se consultan desde el backend, con páginas de 50 opciones y búsqueda sobre las opciones cargadas. Las escrituras de colecciones de dominio validan las selecciones modificadas; los valores históricos sin catálogo se conservan al editar otros campos. El catálogo de identificación usa códigos como `cc`, no su etiqueta `C.C.`.

Este selector consume colecciones registradas de dominio; no acepta URLs arbitrarias ni ejecuta OpenAPI externos. La configuración de fuentes externas permanece en Fuentes y colecciones.

Los campos con valores finitos (`enum`/literales) se deducen también del esquema de entrada del comando, incluidas sus variantes y valores predeterminados. `source` se genera como **Origen**, con **Directo** (`direct`) y **Prospecto** (`prospect`); el valor inicial es `direct`. Los enlaces existentes se actualizan con la versión 6 del contrato de escritura. Verificado en navegador y con 15 pruebas de generación y colecciones.
