# Integraciones personales de Google y Microsoft mediante Nango

## Qué activa esta guía

Esta integración es individual: cada principal de Savia conecta, consulta, reconecta y desconecta únicamente sus propias cuentas. Nunca se reutiliza una conexión CRM por agencia ni se exponen tokens OAuth al navegador, API pública, asistente o MCP.

Las seis configuraciones de Nango son independientes:

| Cuenta                | Variable de producción                   | Operaciones habilitadas                             |
| --------------------- | ---------------------------------------- | --------------------------------------------------- |
| Google Drive          | `NANGO_GOOGLE_DRIVE_INTEGRATION_ID`      | Buscar metadatos y guardar archivos de texto nuevos |
| Gmail                 | `NANGO_GMAIL_INTEGRATION_ID`             | Buscar metadatos y enviar correo confirmado         |
| Google Calendar       | `NANGO_GOOGLE_CALENDAR_INTEGRATION_ID`   | Consultar y crear eventos confirmados               |
| Outlook               | `NANGO_OUTLOOK_INTEGRATION_ID`           | Buscar correo, enviar y crear eventos confirmados   |
| OneDrive Personal     | `NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID` | Buscar metadatos y guardar archivos de texto nuevos |
| OneDrive for Business | `NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID` | Buscar metadatos y guardar archivos de texto nuevos |

También se necesitan `NANGO_BASE_URL`, `NANGO_CONNECT_URL` y `NANGO_API_KEY`. La API key necesita capacidad de Proxy en el entorno Nango; no se debe usar una key de usuario ni publicarla en Vite.

Para desarrollo local, agregue esas variables al archivo `infra/secrets/assistant-api.dev.env` y reinicie `pnpm dev`; el lanzador las pasa al Worker de la API. No se deben poner en `.env` del Admin.

## Configuración en Nango y proveedores

1. Cree una integración Nango distinta para cada fila, copie su **Unique Key** a la variable correspondiente y registre exactamente el callback que Nango muestra en la consola OAuth del proveedor.
2. En Connect, deje permitido solo el Unique Key de la tarjeta seleccionada. Savia vuelve a limitarlo al crear la sesión, por lo que una tarjeta nunca puede autorizar otra integración.
3. Configure scopes mínimos acordes a la función:
   - Drive: `drive.file` para archivos creados/seleccionados por la app. Añada un alcance de metadata de Drive solo si se aprueba la búsqueda fuera de esos archivos.
   - Gmail: `gmail.readonly` para búsqueda y `gmail.send` para envíos. Son permisos restringidos; complete verificación y, si aplica, la evaluación de seguridad de Google antes de abrir el uso público.
   - Google Calendar: lectura y creación de eventos en el calendario primario.
   - Microsoft Outlook: `Mail.Read`, `Mail.Send`, `Calendars.Read` y `Calendars.ReadWrite` delegados según lo activado.
   - OneDrive: permisos delegados de lectura/escritura para el drive del usuario; use la configuración de consumidor para Personal y la de Microsoft Entra para Business.
4. Mantenga separados los registros OAuth de Microsoft consumidor y Microsoft Entra. Ambos llegan a Graph, pero Nango conserva conexiones y consentimiento por proveedor.

El Worker crea cada Connect session con `end_user_id`, `end_user_email` y `end_user_display_name`. Al terminar Connect, solo adopta la conexión si estas etiquetas y `provider_config_key` corresponden exactamente con el principal y tarjeta solicitados. Una conexión sin esas condiciones debe volver a autorizarse; nunca se reclama una conexión ajena.

## Operación segura

- **Lecturas:** el asistente puede buscar nombres de archivos, metadatos de mensajes y próximos eventos solo en una conexión activa del mismo usuario. No se copian resultados a D1.
- **Mi día:** Google Calendar y Outlook se consultan de forma independiente. Si un proveedor no responde, los eventos del otro siguen visibles y Savia identifica qué calendario necesita sincronizarse de nuevo.
- **Escrituras:** enviar correo, crear evento y guardar un archivo de texto nuevo generan primero una confirmación visible. La confirmación expira a los cinco minutos, está ligada al principal y solo puede ejecutarse una vez.
- **Contenido sensible:** el cuerpo de correo o archivo de una confirmación se cifra con AES-GCM y queda ligado al principal y al id de acción. La auditoría persiste solamente proveedor, tipo, resultado, código seguro y fecha; no cuerpos, destinatarios, contenido ni tokens.
- **Archivos:** Drive crea con multipart; OneDrive usa creación de archivo con `conflictBehavior=fail` y una precondición. Si existe un nombre igual, falla: no hay sobrescritura, edición, eliminación ni compartición.

Si un proveedor devuelve un error de autorización o una conexión revocada, marque únicamente esa conexión como `reconnect_required`, muestre un error seguro y use **Reconectar** desde **Mis integraciones**. No copie respuestas completas ni cabeceras de Nango, Google o Microsoft en registros o mensajes.

## Checklist antes de activar

- [ ] Están configuradas las seis variables `NANGO_*_INTEGRATION_ID` necesarias para las tarjetas que se mostrarán.
- [ ] `NANGO_API_KEY` tiene permiso de Proxy y sigue siendo exclusivamente secreto de Worker.
- [ ] Cada callback OAuth coincide con el que muestra Nango.
- [ ] Se probaron Connect, reconexión, desconexión, una búsqueda y una acción confirmada con cuentas de prueba separadas para Personal y Business.
- [ ] La verificación de Google/Gmail y la política de datos están completas antes de permitir usuarios externos.
