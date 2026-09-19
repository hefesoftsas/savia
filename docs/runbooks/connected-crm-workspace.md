# CRM conectado en Savia

## Uso

1. Conectar HubSpot en **Integraciones** y conceder sus permisos.
2. Abrir **Administrar páginas → Más herramientas → Fuentes de datos**.
3. En **CRM conectado · HubSpot**, instalar las pantallas disponibles.
4. Usar las pantallas del menú. **Relaciones** permite navegar, vincular y
   desvincular registros compatibles en HubSpot. **Abrir en HubSpot** abre el
   registro original. Archivar usa el archivo recuperable del proveedor.
5. Para cambiar un nombre: configurar la pantalla, **Presentación y menú**,
   editar el nombre y pulsar **Guardar nombre**. El identificador no cambia.

Se generan Contactos, Empresas, Oportunidades, Tickets, Productos, Partidas,
Cotizaciones CRM, Tareas CRM, Notas CRM, Reuniones CRM, Llamadas CRM y Correos CRM
según el acceso real. Las opciones de campos, procesos, etapas y responsables
proceden de HubSpot. Las fechas con hora se conservan con zona horaria.

La instalación se puede repetir: actualiza el contrato del proveedor y conserva
nombres y presentación personalizados. Una reconexión a la misma cuenta se
recupera repitiendo la instalación. Una cuenta distinta no reemplaza las
colecciones existentes silenciosamente.

## Datos y límites

Los registros permanecen en HubSpot. Savia guarda metadatos de pantalla y un
vínculo de servidor con el usuario, conexión y cuenta de origen. Cada operación
comprueba esos tres valores y los permisos vigentes; los clientes no pueden
modificar el contrato de campos ni las capacidades del proveedor.

La colección local Clientes se conserva. Sus mapeos de sincronización permiten
abrir el contacto o empresa equivalente y navegar sus asociaciones. Editar una
asociación desde esa ficha requiere abrir primero el registro CRM vinculado.

Las actividades son registros CRM: no se envían correos ni se inician llamadas.
Correos CRM es de consulta con los permisos actuales. Objetos personalizados no
se instalan sin sus permisos. Filtros avanzados y ordenación no se anuncian; la
consulta usa paginación del proveedor, con límite de 100 páginas y un límite
explícito de 5.000 asociaciones por grupo. Las limitaciones devuelven errores,
no aparentan resultados completos.

Los permisos desconocidos no habilitan escritura. La conexión de pruebas se
verificó contra los permisos concedidos del token en Nango y se guardó esa lista
en sus metadatos y en Savia, sin copiar credenciales a las pantallas.

## API y MCP

El gateway autenticado expone, bajo `/v1/data-domains/platform/api`:

- `GET /crm-workspace`, `POST /crm-workspace/install`.
- `GET /objects`, operaciones de registros en `/records/:object/:id`.
- Relaciones en `/record-links/:object/:id`.

El bot dispone de `savia_list_crm_collections`, `savia_list_crm_records`,
`savia_get_crm_record`, `savia_create_crm_record`, `savia_update_crm_record` y
`savia_get_crm_record_links`. Usan la autorización delegada del usuario; no hay
credenciales de HubSpot en MCP. Las herramientas verifican que la colección
está instalada y es de tipo CRM antes de operar.

## Verificación de pruebas

Se verificó en la cuenta `51969008`: instalación de 12 pantallas sin duplicados,
creación de contacto, empresa, oportunidad y nota sintéticos, edición de importe,
vinculación y desvinculación contacto–oportunidad y navegación en ambos sentidos.
También se verificaron la edición de fecha y hora y el archivado recuperable de
la nota sintética desde Savia.
Los registros de demostración llevan el nombre **Savia CRM QA** y el contacto
usa `savia-crm-qa-20260911@example.com`.

## Tenant-shared access

Installing HubSpot collections shares those collections with every active member
of the selected tenant. Requests use the installing owner's bound connection;
viewers do not need a personal HubSpot connection, and their personal connection
cannot redirect a shared collection to another account.

Members can list and read shared collections. Tenant administrators retain write
and installation access, subject to the provider's current scopes. Other local
collections, settings, source management, and schema changes remain protected.
Platform/custom domains remain restricted to platform administrators.

The server checks the tenant, binding scope, connection ID, account ID, and
connection status for every operation. Reconnecting requires the administrator
to reinstall against the same account. Disconnecting the source connection stops
access for the team. Audit records identify the actual caller and operation,
without recording credentials, search queries, or provider payloads.

Existing bindings without `accessScope: "tenant"` remain personal. Their owner
can explicitly share them by reinstalling; an operator may migrate a specifically
authorized tenant's existing bindings after verifying the owner and account.
Do not blanket-enable bindings in other tenants.
