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

El gateway autenticado expone, bajo `/v1/studio/0/api`:

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

## Salesforce, Zoho CRM, and Pipedrive

Savia also supports provider-qualified connected workspaces for Salesforce, Zoho
CRM, and Pipedrive. Each provider has separate Contacts, Companies, and Deals
collections; Salesforce maps companies to Accounts and deals to Opportunities,
Zoho uses Contacts/Accounts/Deals, and Pipedrive uses Persons/Organizations/Deals.
Native field names are translated to stable Studio identifiers: for example,
Salesforce `FirstName` appears as `firstname`, and Zoho `First_Name` appears as
`first_name`. Writes restore the original native field name. Ambiguous mappings
are rejected instead of silently targeting a different field.

Installed collection names are prefixed with `salesforce_`, `zoho_`, or
`pipedrive_`. The existing HubSpot collection names and routes remain compatible.

The API exposes discovery at `/api/crm-workspace/:provider` and installation at
`/api/crm-workspace/:provider/install` under the authenticated Studio gateway.
Installation requires an explicit body such as
`{"resources":["contacts","companies","deals"]}`. Members read tenant-shared
collections using the installing owner's connection; administrators manage
records subject to current provider permissions. Reinstallation refreshes field
metadata while preserving screen labels. Replacing the bound provider account
requires administrator review and does not silently redirect a collection.

Operations use native provider APIs. CRM records are not replicated into Savia.
The adapter discovers field metadata and rejects unsupported operations. Remote
schema editing, bulk import/export, and remote deletion are not enabled for the
three new providers. The MCP Studio tools and their legacy CRM aliases access
installed collections through the same authenticated gateway.

### Nango configuration

Set these values in the API runtime (or the self-hosted environment):

| Variable                          | Value                                                                 |
| --------------------------------- | --------------------------------------------------------------------- |
| `NANGO_BASE_URL`                  | The Nango API origin, for example `https://nango.cloud.hefesoft.com`  |
| `NANGO_CONNECT_URL`               | Optional public Nango Connect origin; defaults to the API origin      |
| `NANGO_API_KEY`                   | Nango secret API key for the intended environment, stored as a secret |
| `NANGO_SALESFORCE_INTEGRATION_ID` | Exact Salesforce integration key configured in Nango                  |
| `NANGO_ZOHO_INTEGRATION_ID`       | Exact Zoho CRM integration key configured in Nango                    |
| `NANGO_PIPEDRIVE_INTEGRATION_ID`  | Exact Pipedrive integration key configured in Nango                   |

`NANGO_HUBSPOT_INTEGRATION_ID` continues to configure HubSpot independently.
Missing configuration leaves that provider unavailable; it must not disable the
other configured providers. An integration key is not necessarily the provider
name. Copy the exact key from the intended Nango environment.

The dashboard URL `https://nango.cloud.hefesoft.com/prod/integrations` is a browser
page, not an API base URL. Use its origin for `NANGO_BASE_URL`, with the API key
for the production environment. Do not put dashboard paths or credentials in
source code, screen metadata, or chat messages.

Configure each OAuth application and its callback URL in Nango, grant only the
required CRM scopes, then connect the account from Savia's Integrations page.
Salesforce instance routing and Zoho region routing belong to the trusted Nango
connection configuration. Savia does not accept arbitrary provider hosts from
record requests. After connecting, open Sources, select that provider, and
install the available screens.

### Verification and deployment

Unit and contract fixtures verify code behavior without creating provider
accounts. They do not prove a production account is connected. Before reporting
activation, verify the Nango integration key, OAuth grant, account identity,
resource discovery, and record reads against the intended account. Test writes
only with authorized test records. Document live verification separately from
local test results.

The implementation environment initially blocked the supplied Nango host at its
outbound proxy and had no Nango secret configured. Deployment must supply the
runtime variables above and allow outbound access to the Nango host. A proxy
403 is an environment access issue and does not establish that Nango rejected
an API credential.

Zoho screens select at most 50 fields per resource, retaining the title and all
required fields before optional fields. Installation records a schema warning
when optional fields are omitted. Schemas with more than 50 required fields
are rejected. Pipedrive schemas spanning multiple metadata pages are rejected
explicitly until metadata pagination is supported. Pipedrive search results
are hydrated from their record endpoints to expose complete field values;
this requires additional provider requests. First and last name metadata are
read-only in Pipedrive screens; edit the full name there instead.

### One CRM connection per organization

An organization may have only one non-disconnected CRM connection across all
providers and owners. Connecting Salesforce while another member has connected
HubSpot is rejected with HTTP 409 (`CRM_ORGANIZATION_CONNECTION_EXISTS`). A
pending, failed, or reconnect-required connection continues to reserve the slot;
the owner can reconnect it or explicitly disconnect it before changing CRM.
Different organizations remain independent, including when the same user owns
both connections. Provider policy exposes only the occupied provider, never
another owner's account identifiers or credentials. Account ownership permissions
remain unchanged; this policy does not give other members disconnect authority.

The server checks the policy before starting OAuth and before completing it.
A partial unique database index on `tenant_id WHERE disconnected_at IS NULL`
prevents concurrent completions or direct inserts from creating two active
connections. OAuth sessions opened while the slot was empty may still finish
at Nango; a losing completion is not activated in Savia. A failed or cancelled
OAuth attempt never replaces the active CRM or silently deletes credentials.
Workspace discovery and installed collection access resolve connections within
the selected organization; they cannot borrow a connection from another one.
Requests that omit `agencyId` use the default authorized organization, so
clients should send the selected organization explicitly.

Apply migration `0027_crm_organization_connection.sql` in SQLite/D1 and native
PostgreSQL before deploying the updated application. It does not delete data or
choose which CRM to retain. If existing organizations have multiple live rows,
the migration fails and must be retried after their owners explicitly disconnect
the unwanted connections. Detect affected organizations before rollout:

```sql
SELECT tenant_id, COUNT(*) AS active_connections
FROM tenant_crm_connections
WHERE disconnected_at IS NULL
GROUP BY tenant_id
HAVING COUNT(*) > 1;
```

The migration also makes each active `(nango_integration_id,
nango_connection_id)` pair unique. Reusing one Nango connection across
organizations returns HTTP 409 (`CRM_CONNECTION_ALREADY_ASSIGNED`); create a
separate OAuth connection for each organization. This prevents a disconnect in
one organization from revoking another organization's credential. Before rollout,
check existing shared references as well, and explicitly resolve any duplicates:

```sql
SELECT nango_integration_id, nango_connection_id, COUNT(*) AS references_count
FROM tenant_crm_connections
WHERE disconnected_at IS NULL
GROUP BY nango_integration_id, nango_connection_id
HAVING COUNT(*) > 1;
```
