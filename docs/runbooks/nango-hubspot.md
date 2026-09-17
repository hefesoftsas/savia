# Operación: Nango + HubSpot para CRM de agencias

## Alcance y propiedad

- Una conexión pertenece a una agencia. Sólo un `agency_admin` con membresía
  activa puede crearla, reconectarla o desconectarla.
- Savia guarda el estado, la cuenta externa visible y auditoría mínima. Nango
  guarda y renueva las credenciales OAuth; HubSpot nunca entrega su contraseña
  al API ni al frontend de Savia.
- El primer proveedor habilitado es HubSpot. Salesforce, Zoho CRM y Pipedrive
  se muestran como futuras integraciones, sin autorización ni acceso a datos.

## Preparación de Nango

1. Confirma que el dashboard y el Connect UI de la instalación autohospedada
   cargan correctamente antes de configurar proveedores. Si el dashboard falla
   al iniciar Stripe con una clave pública vacía, corrige la configuración de
   despliegue de Nango o desactiva esa inicialización según la versión instalada;
   no intentes crear la integración desde una interfaz incompleta.
2. En Nango, crea o revisa la configuración de proveedor HubSpot. Conserva la
   `integration id`/`provider config key`: debe coincidir exactamente con
   `NANGO_HUBSPOT_INTEGRATION_ID` de Savia.
3. Copia en la aplicación OAuth de HubSpot el callback que Nango muestra para
   esa configuración. No se debe inventar ni apuntar el callback al frontend de
   Savia.
4. Solicita únicamente estos permisos para esta primera versión:

   - `oauth`
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
   - `crm.objects.deals.read`

   El permiso `oauth` también cubre la validación de detalles de cuenta que usa
   Savia. Añade permisos nuevos sólo al habilitar operaciones que los necesiten.

5. Configura en el entorno del Worker los valores de Nango, sin añadirlos al
   repositorio, a `wrangler.jsonc` ni a variables `VITE_*`:

   ```text
   NANGO_BASE_URL=https://<host-api-nango>
   NANGO_CONNECT_URL=https://<host-connect-nango>
   NANGO_HUBSPOT_INTEGRATION_ID=<provider-config-key-de-Nango>
   NANGO_API_KEY=<secreto-de-servidor-de-Nango>
   ```

   Usa `wrangler secret put NANGO_API_KEY` para la clave de servidor. No copies
   claves, contraseñas, refresh tokens ni secretos OAuth en esta guía, tickets,
   logs o archivos locales versionados.

## Flujo de conexión para una agencia

1. Un usuario con rol `agency_admin` abre `#/crm-connections` y selecciona su
   agencia si pertenece a más de una.
2. Al elegir **Conectar HubSpot**, Savia crea una sesión breve de Nango para esa
   agencia. El navegador recibe sólo el token temporal de Connect y las URLs
   públicas de Nango; no recibe la API key de Nango.
3. Nango abre el consentimiento de HubSpot. El usuario inicia sesión y aprueba
   los permisos allí.
4. Nango devuelve un identificador opaco de conexión. Savia lo verifica contra
   la organización `agency:<id>`, valida el acceso a HubSpot y persiste sólo
   metadatos seguros.
5. Para desconectar, usa la misma pantalla. Savia borra la conexión en Nango y
   marca el vínculo local como desconectado.

## Cambio de permisos para sincronizar clientes

La sincronización de clientes naturales crea o actualiza contactos. Para
clientes de tipo jurídico también crea o actualiza la empresa y relaciona su
representante legal; por eso requiere `crm.objects.companies.write`.

Después de añadir ese permiso en la integración de Nango y en la aplicación
OAuth de HubSpot, cada agencia que ya esté conectada debe usar **Reconectar
HubSpot** y aprobar el consentimiento actualizado. Una conexión existente no
obtiene permisos nuevos de forma retroactiva. No ejecutes una sincronización de
clientes jurídicos hasta que la reconexión termine como **Conectado**.

## Verificación después del despliegue

1. Inicia sesión como un `agency_admin` con membresía activa y conecta una
   cuenta de prueba de HubSpot.
2. Confirma que la fila de HubSpot muestra **Conectado** y una cuenta externa
   identificable, sin exponer tokens ni secretos.
3. Con el access token de Savia, prueba `GET /v1/crm/contacts?agencyId=<id>` y
   `GET /v1/crm/companies?agencyId=<id>`. La respuesta debe contener sólo el
   modelo normalizado de Savia.
4. Prueba una solicitud con una agencia distinta y confirma `403`; prueba antes
   de conectar y confirma `409` sin datos de HubSpot.
5. Desconecta la cuenta y confirma que una consulta posterior vuelve a `409`.
6. Con una agencia reconectada, sincroniza primero un cliente natural de prueba
   y después un cliente jurídico de prueba. Comprueba que cada resultado abre
   únicamente el enlace de CRM devuelto por Savia y que ningún secreto aparece
   en la interfaz, solicitudes o registros.

## Diagnóstico seguro

- `CRM_UNAVAILABLE`: revisa presencia y coincidencia de las cuatro variables
  de Nango sin imprimir sus valores.
- `RECONNECT_REQUIRED`: el token de HubSpot fue rechazado o revocado. Pide al
  administrador de agencia que use **Reconectar HubSpot**; no intentes reparar
  el vínculo con un token pegado manualmente.
- `NANGO_REQUEST_FAILED`: revisa estado, DNS/TLS y logs protegidos de Nango.
  Nunca copies el cuerpo de la respuesta del proveedor al log o al usuario.
- Dashboard de Nango inutilizable: repara primero su configuración de
  despliegue. La carga del Connect UI y la creación de la configuración de
  proveedor deben probarse antes de invitar a un usuario final al consentimiento.
