# Sincronización automática de clientes con HubSpot

## Activación y alcance

Aplicar las migraciones hasta `0042_tenant_crm_sync.sql`. En **Integraciones → Sincronización automática**, seleccionar un tenant y activar HubSpot. La conexión pertenece al usuario y la regla fija su tenant, conexión y cuenta externa. Tener una cuenta conectada no activa exportaciones por sí solo. La API recibe `tenantId` y devuelve `tenantId`, `tenantName` y el catálogo `tenants`. La regla puede configurarse sin perfil de agencia ni paquete de seguros. La migración conserva IDs, estados, trabajos y vínculos existentes.

Se propagan altas y modificaciones de los perfiles operativos de clientes (`customer-portfolio/customer-profiles`), incluidos los cambios realizados desde pantallas y comandos MCP. Los clientes naturales se convierten en contactos; los jurídicos en empresas con su representante. Este adaptador de clientes sigue requiriendo el paquete de seguros activo para procesar sus datos; configurar una regla por tenant no añade sincronización de colecciones arbitrarias. No hay backfill, eliminación remota, sincronización inversa ni mapeo automático de campos personalizados o de cualquier colección independiente.

Los campos normalizados del cliente son autoritativos para esta sincronización: quitar un teléfono o dirección local también limpia ese campo remoto. La sincronización manual anterior conserva su comportamiento.

## Permisos y conexión

La conexión OAuth necesita `oauth`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.companies.read` y `crm.objects.companies.write`. Conservar además los permisos usados por otras funcionalidades existentes. Agregar un permiso requiere actualizar la aplicación OAuth y la configuración de Nango, y reconectar para obtener el consentimiento actualizado. Un `403 MISSING_SCOPES` no se corrige reintentando el mismo envío.

La API vuelve a validar la identidad activa, acceso al tenant y cuenta conectada antes de ejecutar cada trabajo. Cambiar de cuenta bloquea el trabajo anterior; sus IDs externos nunca se reutilizan en otra cuenta. Los secretos siguen exclusivamente en el backend/Nango.

## Cola y recuperación

Los triggers registran revisiones en la misma transacción que los datos de negocio. El procesador consolida revisiones, conserva IDs remotos y evita dos ejecuciones concurrentes del mismo trabajo.

- **Pendiente / Procesando / Sincronizado:** progreso normal. Guardar en Savia confirma persistencia local; no garantiza que HubSpot haya terminado.
- **Falló:** el error sigue visible. Fallos transitorios usan backoff y como máximo cinco intentos; datos inválidos o permisos faltantes requieren corrección y reintento explícito. Un nuevo cambio de datos puede volver a encolar un fallo conocido.
- **Bloqueado:** cambió la cuenta, se revocó acceso, desapareció el origen o se desconoce el resultado remoto. `REMOTE_OUTCOME_UNKNOWN` no admite reintento ciego: hay que reconciliar el resultado y el mapping antes de una recuperación operativa.
- **Pausa:** impide nuevos trabajos. Uno ya en ejecución puede terminar, pero se descarta su seguimiento pendiente. Reactivar no envía cambios hechos durante la pausa; un cambio posterior vuelve a encolar el registro.

Nunca convertir masivamente trabajos bloqueados en pendientes. La consulta por correo/nombre no equivale a una clave idempotente del proveedor. Si un create puede haber llegado a HubSpot, debe comprobarse su resultado antes de cualquier recuperación.

## Ejecución

El Worker procesa un trabajo después de escrituras exitosas y hasta cinco por evento programado. La configuración incluye cron cada minuto. `pnpm dev` inicia Wrangler con `--test-scheduled` y un runner local que llama a `127.0.0.1:8787/__scheduled` cada minuto, sin solapar ticks. La cola persiste en D1 y no depende de tener el navegador abierto.

API: `GET/POST /v1/crm/sync-rules`, `PATCH /v1/crm/sync-rules/{id}`, `GET /v1/crm/sync-jobs?customerId=…` y `POST /v1/crm/sync-jobs/{id}/retry`. Las lecturas son privadas del usuario configurador y sin caché.

MCP: `savia_get_crm_sync_status` consulta el estado, opcionalmente por cliente. Las escrituras siguen los comandos existentes `create-customer-profile` y `update-customer-profile` con preparación y confirmación.

## Prueba real del 11 de septiembre de 2026

Cuenta conectada: HubSpot `51969008`. Agencia sintética: `2`, **Savia Prueba Sync HubSpot**. Regla: `ae958d9e-2cf0-4b62-9e9b-0d8c5b7d7154`.

Los clientes sintéticos se crearon mediante el bot y su confirmación MCP. El dominio de correo `.test` fue rechazado por HubSpot, por lo que el contacto usa `savia-sync-natural-20260911@example.com`.

Se detectó y corrigió una incompatibilidad real de `redirect: "error"` en Workerd. El proxy usa `manual`, no sigue redirecciones con credenciales. Durante HMR quedó una ejecución sintética interrumpida antes del envío; se recuperó exclusivamente ese trabajo, después de comprobar ausencia de mappings y cero coincidencias remotas. No existe recuperación automática de ese tipo en producción.

La prueba de empresa detectó `403 MISSING_SCOPES`: falta `crm.objects.companies.write`. La clave de Nango disponible recibe 403 al consultar la configuración de permisos y no se modificó esa configuración; requiere intervención del administrador de integración antes de completar esa parte de la prueba.

Contacto verificado: **247951049777**, [abrir en HubSpot](https://app.hubspot.com/contacts/51969008/record/0-1/247951049777). Después de actualizar desde el bot, la lectura remota devolvió `firstname=Savia Sync Actualizado`, `phone=0000000001` y el mismo ID; D1 registró revisión 6/sincronizada 6. La búsqueda por el correo sintético devolvió una única coincidencia. `savia_get_crm_sync_status(customerId=1)` fue invocado por el asistente real y devolvió `synced` y el enlace correcto.

## Validación del código

Las pruebas específicas cubren: opt-in sin backfill; transacción y rollback; exclusión de workers; coalescencia de revisiones; permisos revocados; cambio de cuenta; reintentos transitorios; resultados de create desconocidos; natural y jurídico; limpieza de campos; pausas incluso durante envíos; cliente/UI; MCP y scheduler local. Hay una regresión ejecutada en Workerd para construir la petición Nango sin seguir redirecciones.

El typecheck de MCP pasa. El typecheck global de API sigue encontrando errores existentes en `apps/crm-poc` (tipos `navigation.order` y referencias DOM en código compartido con Worker), ajenos a los archivos de esta funcionalidad. El test anterior `managed-customer-sync` también contiene una expectativa de propiedad por agencia que no coincide con la resolución por usuario ya existente; no se alteró para ocultar ese fallo.

Resultado final de comprobaciones: 72 pruebas API específicas, 9 UI/cliente CRM, 15 MCP y 5 scheduler/dev local aprobadas (101 total). Bundle Vite de producción compilado. El scheduler local ejecutó el handler después de aplicar la columna independiente `lease_started_at`, que permite detectar un worker interrumpido aunque el registro continúe recibiendo cambios.

### Enlaces al registro de origen

Las pantallas de la colección `customer-portfolio/customer-profiles` y los clientes administrados reciben `_crmLinks` al listar o consultar registros. La tabla los muestra bajo el nombre; la ficha y la edición los muestran en la cabecera. El resolver usa los mappings de sincronización automática, consulta por lotes y exige propietario, permisos vigentes y la conexión/cuenta original. Pausar una regla conserva el enlace; cambiar de cuenta o desconectarla lo oculta. Un registro sin mapping remoto no muestra enlace. Actualmente se resuelven contactos y empresas de HubSpot; nuevos proveedores requieren su propio constructor de URL validado.

Verificación local: contacto `247951049777` visible con el mismo enlace en tabla, ficha y edición de Clientes HubSpot. Empresa aún sin mapping: sin enlace. Pruebas focalizadas: 19 de sincronización y 4 de interfaz aprobadas; build de admin aprobado. El typecheck de API conserva los errores previos en navegación y tipos DOM compartidos.
