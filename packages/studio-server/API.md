# API del motor Studio

Contratos HTTP del runtime Hono (`createStudioApp`). En Savia, estas rutas se montan bajo los prefijos autenticados de dominio de datos o Studio (`/v1/data-domains/*`, `/v1/dynamic-crm/*`); aquí se documentan con prefijo `/api` tal como las consumen los tests del paquete.

Prefijo `/api`, JSON salvo archivos/CSV. En modo de prueba local el tenant es `demo`. Error `{error:string}`; 422 validación, 404 inexistente, 409 conflicto, 428 falta versión. Listados `{data:[],total,page?,perPage?}`; recurso `{data:object}`.

| Método y ruta | Contrato principal |
|---|---|
| POST `/bootstrap` | Provisionamiento idempotente de la demo |
| GET/POST `/objects` | Listar/crear `{name,label,description?,config}` |
| POST `/objects/:name/preview` | `{object,migration:{rename?,drop?,coerce?}}`; validación e impacto sin escribir |
| PUT `/objects/:name` | Objeto completo con `version`, y `migration` opcional |
| GET `/objects/:name/versions` | Estructuras publicadas |
| POST `/objects/:name/restore` | `{version,targetVersion}`; crea una nueva versión |
| GET `/records/:object` | `page`, `perPage` 1–200, `q`, `sort`, `order`, `stage`, `filters`, `trash=true` |
| GET `/records/:object/summary` | `group` y filtros del listado; cuenta y suma del importe configurado |
| POST `/records/:object` | Campos dinámicos; encabezado opcional `Idempotency-Key` |
| GET/PATCH `/records/:object/:id` | PATCH recibe campos a cambiar + `_version` |
| DELETE `/records/:object/:id?version=N` | Borrado lógico |
| POST `/records/:object/:id/restore` | `{version}` |
| POST `/records/:object/bulk` | `{action:update\|delete\|restore,records:[{id,version}],data?}`; máximo 200, resultados por registro |
| GET/POST `/views/:object` | Crear `{name,config:{q,stage,filters,columns,sort,group,mode,perPage}}` |
| DELETE `/views/:object/:id` | Eliminar vista |
| GET `/record-detail/:object/:id` | Registro, relaciones entrantes/salientes; `page` |
| GET `/record-activity/:object/:id` | Timeline paginado de notas y auditoría |
| POST `/record-notes/:object/:id` | `{body,kind:note\|call\|meeting\|email}` |
| DELETE `/record-notes/:id` | `{version}` |
| GET/POST `/files/:object/:recordId` | Listar/subir; POST multipart con campo `file` |
| GET `/file/:id/download` | Descargar adjunto |
| DELETE `/file/:id` | Borrar adjunto con `{version}` |
| POST `/import/:object/preview` | `{csv,mapping,duplicateField?,duplicatePolicy?}` |
| POST `/import/:object/commit` | Mismo payload con `importId` de previsualización |
| GET `/export/:object` | CSV completo de registros activos |
| GET/POST `/tasks` | Filtros `object,record,status,page`; creación `{object_name,record_id,title,owner,due_at}` |
| PATCH/DELETE `/tasks/:id` | Edición completa + `version`; borrado `{version}` |
| GET/POST `/automations` | Reglas de cambio de campo a tarea |
| PATCH/DELETE `/automations/:id` | Edición/borrado versionado |
| GET `/automation-runs` | Historial paginado |
| POST `/automation-runs/:id/retry` | Reintenta la ejecución fallida |
| GET `/reports` | Agregados por etapa/responsable y conversión |
| GET `/audit` | Últimas 100 mutaciones |
| GET `/health` | Disponibilidad D1 y versión del API |

Filtros: JSON `{logic:"and"|"or",conditions:[{field,op,value?}]}`, máximo 20. Operadores `eq,ne,gt,gte,lt,lte,contains,startsWith,empty,in`. Números/booleanos se envían con su tipo JSON. Los nombres de campo se validan contra metadata; los valores se parametrizan.

Integraciones: contratos detallados y ejemplos en [INTEGRATIONS.md](INTEGRATIONS.md). El contrato Orval `openapi.json` mantiene la generación de metadata; este documento describe las rutas operativas adicionales.
