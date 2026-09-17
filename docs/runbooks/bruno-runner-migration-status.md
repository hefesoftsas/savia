# Estado de migración del Bruno Runner

Actualizado: 2026-09-04

## Operaciones publicadas y validadas

| Operación                                   | Bruno CLI       | Scalar | Efecto          |
| ------------------------------------------- | --------------- | ------ | --------------- |
| SBS RCE                                     | cadena completa | `200`  | Crea cotización |
| SBS Gold                                    | cadena completa | `200`  | Crea cotización |
| SBS Silver                                  | cadena completa | `200`  | Crea cotización |
| Sura, información por placa                 | `200`           | `200`  | Solo lectura    |
| Equidad, información por placa SOAP directo | `200`           | `200`  | Solo lectura    |
| Mapfre Para la Mujer                        | `200`           | `200`  | Crea cotización |
| Liberty Básico                              | `200`           | `200`  | Crea cotización |

Las cotizaciones SBS se exponen únicamente como flujos completos: el runner
gestiona sesión y pasos intermedios dentro de una ejecución temporal de Bruno.
Las consultas de placa son requests fijos y permitidos; no aceptan rutas ni
scripts arbitrarios de Bruno.

Mapfre se ejecuta como un único request directo permitido. El runner conserva
la plantilla técnica y credenciales en el servidor, pero reemplaza todos los
campos dinámicos de persona y vehículo con el payload de cada llamada; nunca
reutiliza los datos de una plantilla histórica.

Liberty Básico se ejecuta como una cadena permitida de token OAuth y
cotización. El token se mantiene únicamente durante esa ejecución y nunca se
devuelve por la API ni por MCP.

## Flujos con validación pendiente

| Proveedor o flujo           | Estado y bloqueo                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equidad, cotizaciones       | Solo hay trazas y plantillas vía Legacy provider; no existe validación directa vigente.                                                                                       |
| Qualitas                    | Se muestra en `GET /v1/provider-connectivity/operations`; no hay endpoint de cotización porque el presupuesto se agotó sin evidencia HTTP y los bodies históricos son opacos. |
| Liberty Integral, PT y Full | Se muestran en Scalar y MCP como operaciones experimentales bloqueadas; el presupuesto de Liberty quedó en `10/10` después de validar Básico.                                 |
| Sura, cotización            | La colección canónica solo contiene consulta de vehículo por placa; no existe un request directo de cotización que migrar.                                                    |

Los bodies locales de estos flujos contienen datos de referencia. No se
reutilizan como entradas de una API. Cada uno debe revalidarse de forma directa,
con un nuevo presupuesto de llamadas y un contrato que sustituya todos los
datos dinámicos del solicitante y del vehículo, antes de habilitarlo.
