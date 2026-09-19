# Provider connectivity: pruebas desde Scalar

Fecha: 2026-09-03
Ambiente: local (`http://127.0.0.1:8787`)
Agencia: 10
Autorización: token OAuth con membresía activa en la agencia 10.

## Resumen

- 24 endpoints probados desde Scalar.
- 2 respondieron correctamente (`200`).
- 13 respondieron `503 EXTERNAL_PROVIDER_UNAVAILABLE`: no existe una configuración de ese proveedor para la agencia.
- 9 respondieron `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` con razón `response`: la API alcanzó el gateway, pero el proveedor remoto rechazó o no completó la solicitud.

Las pruebas POST usaron `agencyId: 10` y datos de prueba mínimos. La consulta
de vehículo utilizó una matrícula autorizada proporcionada en tiempo de
ejecución; no se registra ni expone ese valor, credenciales o cuerpos de
respuesta de proveedores.

## Resultados

| Método | Operación | Resultado | Estado |
| --- | --- | --- | --- |
| GET | `/v1/provider-connectivity/operations` | `200 OK` | Funciona |
| POST | `google-oauth-authorize` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `meta-oauth-authorize` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `caldav-gateway-resource` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `graph-message-read` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `power-bi-link-probe` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `currency-eur-read` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `party-cloudflare-read` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `agente-motor-pdf` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `allianz-autos-quote` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `axa-autos-quote-soap` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `bolivar-legacy-cities` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `bolivar-legacy-liquidate` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `bolivar-legacy-quote` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `chubb-copro-quote` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `chubb-pyme-quote` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `equidad-vehicle-by-plate` | `200 OK` (resultado del proveedor: `200`) | Funciona |
| POST | `equidad-v2-quote-soap` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `hdi-autos-quote-soap` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `liberty-autos-quote` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `liberty-autos-token` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `mapfre-autos-quote` | `502 EXTERNAL_PROVIDER_UPSTREAM_ERROR` (`response`) | Falla en proveedor |
| POST | `quote-runtime-quote` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |
| POST | `remote-comparative-pdf` | `503 EXTERNAL_PROVIDER_UNAVAILABLE` | No configurado |

## Lectura operativa

Los `503` se resuelven agregando y validando la configuración del proveedor para la agencia 10. Los `502` no son fallos de autorización ni de Scalar: la solicitud llega al gateway y falla al comunicarse con el proveedor. Para investigarlos se debe revisar, por proveedor, el endpoint, la plantilla del request y las credenciales requeridas, sin registrar secretos en la API pública.
