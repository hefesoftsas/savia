# Clientes dinámicos, HubSpot y Scalar

Este recorrido usa objetos y registros del CRM sobre D1. No migra las tablas actuales de clientes/agencias ni sustituye las ejecuciones del cotizador. El primer modelo comercial cubre personas naturales y borradores de cotización.

## Preparación

Aplicar la migración `packages/db/migrations/0023_dynamic_crm_business.sql` mediante el procedimiento de migraciones del entorno después de `0022_dynamic_crm.sql`. La instalación agrega una tabla auxiliar de vínculos con HubSpot; no crea una tabla SQL por objeto comercial. Para el entorno de pruebas independiente, la migración equivalente es `apps/crm-poc/migrations/0005_business.sql`.

Acceder a Savia con administración de agencia o plataforma, abrir CRM y seleccionar una agencia. Abrir **Clientes, cotizaciones y API** y pulsar **Instalar Clientes y Cotizaciones**. Se instalan definiciones editables, versiones iniciales y auditoría; no registros ficticios. La instalación repetida conserva configuraciones compatibles. Una colisión con objetos incompatibles devuelve un error sin sobrescribirlos.

## Recorrido

1. Abrir Clientes desde la navegación CRM. Crear un registro con nombre completo y, para sincronizar, nombres, apellidos, correo o teléfono. Los campos adicionales se agregan en el diseñador existente.
2. Abrir **Consultar API**. Scalar muestra por separado listar, crear, consultar, actualizar y eliminar para cada objeto actual. Descargar el contrato con **Descargar OpenAPI**. Volver a consultar después de publicar un cambio de esquema genera una referencia actualizada.
3. Abrir la ficha del cliente y pulsar **Sincronizar con HubSpot**. Requiere una conexión HubSpot activa de esa agencia, ya configurada con Nango. La primera sincronización crea un contacto; las siguientes actualizan el identificador guardado. No busca ni adopta contactos externos por coincidencia de correo.
4. Pulsar **Crear cotización**. Se guarda un borrador y se abre su ficha, con la relación al cliente. La relación permite consultarlo desde la ficha y restringe eliminar clientes referenciados. No ejecuta aseguradoras.
5. Recargar y consultar el cliente, su estado de sincronización y el borrador para comprobar persistencia.

## Contrato

Base por agencia: `/v1/dynamic-crm/{agencyId}/api`.

- `GET /openapi.json`: OpenAPI 3.1 derivado de la metadata, privado y sin caché.
- `GET /docs`: Scalar con ese contrato y servidores absolutos para funcionar en iframe.
- `GET|POST /published/clientes`: listar/crear; se generan rutas equivalentes para todos los objetos.
- `GET|PATCH|DELETE /published/clientes/{id}`: consultar/editar/borrar lógicamente. PATCH requiere `_version`; DELETE requiere `?version=`. POST admite `Idempotency-Key`.
- `GET|POST /business/clientes/{id}/hubspot`: estado y sincronización explícita.
- `POST /business/clientes/{id}/quotations`: cuerpo `{}` o `{ "name": "Cotización", "plate": "TESTCAR" }`, con `Idempotency-Key` obligatorio. Reutilizar la clave y cuerpo recupera el mismo borrador incluso si el cliente cambia de nombre.

La referencia embebida hace las peticiones mediante el transporte autenticado del anfitrión. El iframe no recibe tokens. El puente valida su ventana de origen, agencia, ruta y cabeceras; las preferencias de Scalar viven solamente en memoria durante la apertura del documento. El endpoint y el contrato descargado conservan la autorización normal para consumidores externos.

## Alcance y límites

- Mapeo inicial HubSpot fijo: `first_name` → `firstName`, `last_name` → `lastName`, `email` y `phone`. `name` es el título local, no un nombre descompuesto automáticamente. El editor puede extender el objeto, pero los nuevos campos no se sincronizan automáticamente.
- El estado de sincronización pertenece a la conexión/cuenta concreta y al registro de la agencia. Otra cuenta HubSpot no reutiliza su identificador externo.
- Un resultado incierto o un proceso interrumpido bloquea nuevos envíos para evitar duplicar contactos. Este primer recorrido no incluye una pantalla de reconciliación: requiere comprobar el resultado en HubSpot y una recuperación operativa controlada. No hay sincronización inversa, cola automática, eliminación externa ni recuperación automática de conflictos.
- No convierte Agencias a objetos dinámicos, migra clientes históricos ni genera endpoints individuales para operaciones OpenAPI externas importadas. Esas son ampliaciones posteriores al recorrido aprobado.
- El cotizador real sigue en Savia Request. El objeto Cotizaciones de este recorrido guarda borradores y relaciones; no captura ofertas ni ejecuta proveedores.
- No se ha medido rendimiento con grandes volúmenes. Los índices del motor y el tamaño de los contratos requieren evaluación antes de una migración masiva.

## Verificación realizada

Pruebas con D1/R2 y adaptador externo simulado: configuración sin datos ficticios, versiones y publicación de esquemas, CRUD individual, unicidad/validación, idempotencia, permisos, aislamiento entre agencias, relación de cotización y estado HubSpot persistido. Las llamadas reales a HubSpot no se ejecutaron.

Pruebas de UI: instalación explícita, errores, sincronización, reintento de borrador, aislamiento de caché/transporte por agencia y puente de Scalar. Prueba visual en navegador con componentes reales y transporte de fixture: referencia individual de Clientes y petición GET con respuesta 200 visible en Scalar. La persistencia se verificó en las pruebas D1, no en ese fixture visual.
