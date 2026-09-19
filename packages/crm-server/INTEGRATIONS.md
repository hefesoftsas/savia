# Integraciones operativas

En la pantalla Integraciones: cargar ejemplo → importar contrato → guardar conexión demo → abrir operación → autorizar escritura → ejecutar. El cotizador demo usa una solicitud Hono local y registra cada ejecución en D1. Las respuestas correctas se pueden mapear a campos del CRM mediante rutas JSON Pointer y guardar con idempotencia.

Los contratos se importan desde JSON/YAML, archivo o URL HTTPS pública (máximo 1 MB). Las conexiones externas requieren URL base explícita; las URLs `servers` del documento no activan conexiones. Bearer y API key en cabecera se cifran con AES-GCM y datos asociados al tenant/integración. `INTEGRATION_KEY` debe tener al menos 32 caracteres; no se devuelve al navegador. Cambiar esta clave exige volver a guardar las credenciales.

## Compatibilidad

- OpenAPI 3.0 y 3.1; referencias `#/` locales.
- Objetos con propiedades y `allOf`; campos anidados, arrays y uniones `oneOf`/`anyOf` se editan como JSON validado. Identificadores de campos CRM en minúsculas, números y guion bajo.
- Tipos, required, enum/const, propiedades adicionales, límites de números/texto/arrays/objetos y unicidad de arrays. Patrones deliberadamente simples; email, fecha, fecha/hora y URI. Keywords fuera del subconjunto se rechazan.
- Parámetros escalares path/query/header y arrays de query con form/explode. Cabeceras de transporte y cookies bloqueadas. Cuerpos y respuestas JSON.
- Sin OAuth, multipart, cookies, referencias remotas, esquemas cíclicos, discriminación visual de uniones ni todos los keywords de JSON Schema.
- La importación crea campos con validación individual. Reglas entre propiedades de un esquema compuesto no se transforman automáticamente en reglas CRM; las operaciones HTTP sí validan el cuerpo compuesto completo.

## Ejecución y recuperación

Cada ejecución registra estado, HTTP, intentos, duración y respuesta redactada. No se almacenan el cuerpo enviado ni las cabeceras de credenciales en el historial. Máximo 10 segundos por intento y 1 MB de respuesta. Redirecciones desactivadas.

GET permite hasta dos intentos ante error de transporte o HTTP 502/503/504. Una escritura solo reintenta si existe clave de idempotencia y el usuario declaró que el proveedor garantiza esa cabecera. Se reserva la clave local antes de llamar; la repetición del mismo payload devuelve la respuesta anterior, y un payload distinto produce 409. Una escritura con error de transporte tiene estado desconocido: revisar el proveedor antes de crear una nueva solicitud. Una caída del proceso puede dejar una reserva en curso; tampoco se repite automáticamente.

Se rechazan IPs literales, HTTP, credenciales en URL, puertos distintos de 443, hosts internos y DNS con respuestas privadas/reservadas. La comprobación DNS ocurre antes de llamar al host y no fija la dirección de la conexión HTTP. Por eso no constituye una protección completa frente a DNS rebinding: una instalación expuesta necesitaría un proxy de salida que fije y verifique la dirección conectada. Esta aplicación permanece limitada a localhost por el alcance acordado.

## Verificación

`test/integrations.test.ts` y `test/integrations-api.test.ts` cubren importación compuesta/anidada, validaciones, URLs/DNS privados, cifrado, límites de respuesta y flujos reales con D1 aislado. El transporte externo y DNS se simulan; no se ejecutaron solicitudes a proveedores reales. La demostración local sí atraviesa las rutas de ejecución, logs, idempotencia y creación de registros.
