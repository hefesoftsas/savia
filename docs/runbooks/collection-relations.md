# Relaciones entre colecciones

## Modelo

Relaciones definidas por dominio en `crm_collection_relations`; asociaciones locales en `crm_record_links`. Migración0027 aplica claves foráneas, cascada de metadata y trigger de cardinalidad concurrente. Las relaciones locales no modifican tablas operativas ni APIs externas. La eliminación local de un registro quita sus asociaciones; un destino externo inexistente aparece como registro no disponible y se puede desvincular. Eliminar una definición elimina únicamente sus vínculos, nunca las entidades.

La relación nativa se descubre cuando el dominio contiene colecciones conectadas a `agency-network/agency-profiles` y `customer-portfolio/customer-profiles`. Agencia tiene muchos perfiles; un perfil pertenece a una agencia. La persona puede tener varios perfiles (1.134 personas en la copia local tienen varias agencias). Su asociación se consulta en `customer_clientagency`; no se recrea ni se permite alterarla por el gestor de relaciones locales.

## Uso

CRM → Administrar → Datos → Relaciones entre colecciones. El mapa React Flow (MIT) permite conectar nodos para preparar el formulario; también hay selectores accesibles. Crear relación guarda la definición con etiquetas en ambas direcciones y cardinalidad uno a uno, uno a muchos o muchos a muchos. No se admiten autorrelaciones en esta versión.

En la vista de relaciones de una entidad, «Agregar entidad» incorpora al mapa otra colección existente del dominio, aunque todavía no tenga relaciones. Los nodos se pueden mover y el mapa se ajusta al incorporar entidades. Esta selección y las posiciones duran mientras la pantalla permanece abierta; guardar una relación persiste su definición en el backend. Agregar una entidad al mapa no crea colecciones ni vínculos entre registros. «Quitar del mapa» retira el nodo y sus conexiones visuales, conserva las definiciones guardadas en la lista y permite agregarlo otra vez.

En las entidades locales editables, «Crear campo» publica un campo de texto, número o sí/no con control de versión. El nuevo campo aparece expandido en el mapa y en los selectores de mapeo. La opción «Valores únicos» permite usarlo en el lado uno; la conexión compara valores existentes, no los copia. Los errores de publicación conservan el borrador y no agregan campos ficticios al mapa.

Para fuentes conectadas, el formulario propone asociación manual por ID y deshabilita la coincidencia entre campos, que solo admiten las colecciones locales. Las conexiones nativas muestran sus campos físicos incluso cuando no forman parte de los campos editables.

En el diseñador de relaciones manuales, «Campo del formulario de origen/destino» vincula un campo existente a la definición (`config.collectionRelation`). El mapa conecta ese campo. El formulario lo representa en su posición original mediante un desplegable de búsqueda cerrado por defecto; permite una selección en el lado uno y varias en el lado muchos. No añade una sección de listados separada. Los IDs seleccionados se guardan en el campo (texto o lista según cardinalidad) y se actualizan los vínculos. Los reintentos conservan el ID y la versión más reciente del registro.

En una ficha, Registros relacionados muestra los enlaces y su procedencia; se puede navegar a la ficha destino. Las relaciones locales ofrecen un selector paginado y acciones Vincular/Desvincular. Los nombres visibles de campos siguen siendo independientes de los identificadores técnicos. Clientes expone displayName desde su agregado de dominio para usar nombres legibles en las referencias.

## API

Bajo `/v1/data-domains/{domain}/api`, requiere administración de plataforma:

- GET/POST `/collection-relations`
- DELETE `/collection-relations/{relationId}`
- GET `/record-links/{object}/{id}?page=1&perPage=20`
- POST/DELETE `/record-links/{object}/{id}/{relationId}` con `{ "targetId": "..." }`

Los contratos aparecen en OpenAPI/Scalar del dominio. Cada referencia se resuelve a través del gateway de colecciones y exige capacidad de lectura. Credenciales y persistencia permanecen en backend.

## Verificación local

Migración aplicada solo en vista previa8807. Se conectó Clientes sin copiar registros; Agencias conserva sus etiquetas. Verificadas navegación cliente3 → agencia1 → clientes paginados; creación de definición local muchos a muchos, vínculo agencia1/cliente3, navegación inversa y desvinculación. La definición temporal se elimina al terminar la prueba.

38 pruebas API de dominios/fuentes/relaciones y agregados, 7 pruebas UI de relaciones/fichas, TypeScript API/admin y build Vite pasaron. Build advierte sobre bundles grandes existentes. No se escribieron datos en HubSpot ni en otros proveedores. No se reutilizó código de NocoBase.

## Campos de relación y edición

Migraciones0028/0029 agregan sourceField/targetField, campos de presentación y versión. El mapa muestra los campos y conecta handles exactos. Editar relación guarda mediante PUT con control de versión; los nombres técnicos de campos y los nombres visibles son distintos. sourceDisplayField controla cómo se ve un origen desde el destino; targetDisplayField controla cómo se ve un destino desde el origen. Automático conserva el nombre inferido del registro; ID es una elección explícita.

`storage=fields` compara campos escalares compatibles en colecciones locales de CRM, consulta JSON de D1 con paginación y calcula referencias en ambos sentidos. Cambiar valores en los registros cambia las coincidencias. Los campos del lado uno deben ser únicos; se avisan conflictos de cardinalidad presentes en datos. Las relaciones por campos son de consulta desde el panel; se cambian editando los campos del registro. `storage=local` conserva vínculos manuales por ID y no permite cambiar mapeo mientras existan asociaciones. El trigger también bloquea inserciones manuales concurrentes después de convertir una relación a campos.

Las fuentes conectadas no admiten consultas arbitrarias por campo en esta versión. La relación nativa Agencias.id → Clientes.agency_id se mantiene basada en customer_clientagency; nombres y campos de presentación son editables y persistidos en overrides de backend. No modifica la clave foránea del origen. No hay soporte nuevo para colecciones intermedias arbitrarias; muchos-a-muchos local usa coincidencia de campos o asociaciones manuales.

Verificado en vista previa: el perfil3 expone ID de agencia1; se guardaron los campos de nombre de agencia/cliente para presentación y el título Agencia. Las etiquetas previas se conservaron. Pruebas de actualización de mapeo local, coincidencias bidireccionales, conflicto de versión, campos incompatibles, referencias nativas y estrechamiento de cardinalidad pasaron. Se actualizó la expectativa del inventario de tablas a262 incluyendo las nuevas tablas de CRM.
