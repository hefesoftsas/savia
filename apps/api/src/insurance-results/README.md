# Resultados estándar de seguros · v1

Esta capa vive en la API de Savia. El motor y las respuestas originales de Savia request siguen disponibles con su contrato anterior. Los adaptadores son funciones puras en `normalize.ts`: no ejecutan requests, no escriben datos y no reintentan operaciones.

## Uso

- `POST /v1/insurance-results/flows/{flowId}/runs`: recibe `{ mode: "mock" | "live", input: Record<string,string>, versionId?: UUID }`. Sin versión ejecuta el borrador; con versión ejecuta esa publicación. Una única ejecución, con el mismo input del MVP. **live puede crear una cotización**.
- `GET /v1/insurance-results/flows/{flowId}/runs/{runId}`: normaliza una ejecución guardada, sin contactar al proveedor. No tiene el límite de las últimas 20 ejecuciones del historial de la UI. Usa la definición publicada si existe; para ejecuciones de borrador utiliza la definición actual del flow.

Los endpoints figuran en el Scalar/OpenAPI principal, sección **Insurance results**. Conservan autenticación de Savia, MFA y scopes OAuth (`savia.api.read` / `savia.api.write`), además de exigir administrador de plataforma. No amplían los permisos a otras agencias o usuarios.

En el frontend se pueden consumir con `services.insuranceResults.execute(flowId, input)` y `services.insuranceResults.read(flowId, runId)`. El cliente devuelve también los errores estándar del servidor, incluidos 401/403/502; no reintenta peticiones. Los fallos de red sin respuesta HTTP siguen siendo excepciones de transporte.

```ts
const result = await services.insuranceResults.read(flowId, runId);
if (result.type === "quote") {
  // Misma estructura para una oferta de SBS o varias ofertas de Legacy provider.
  renderOffers(result.data.offers);
}
if (result.type === "vehicle_lookup") {
  renderVehicle(result.data.vehicle);
}
renderErrors(result.errors);
renderWarnings(result.warnings);
```

## Contrato

`schemaVersion`, `type`, `status`, `data`, `errors`, `warnings` y `metadata` siempre existen. El esquema Zod/OpenAPI y el tipo TypeScript `InsuranceResult` se definen en `contracts.ts` y se reutilizan desde el cliente.

| type           | data                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| vehicle_lookup | `{ vehicle: Vehicle \| null }`                                         |
| quote          | `{ offers: Offer[] }`                                                  |
| authentication | `{ authenticated: boolean \| null }`; nunca contiene tokens            |
| request        | `{ result: null }`, hasta definir su adaptador específico              |
| unknown        | `null`, usado cuando el error ocurre antes de identificar la operación |

Estados: `success`, `partial`, `no_result`, `error`, `pending`. `metadata.simulated` distingue simulación de ejecución real. Un HTTP 200 no basta para afirmar éxito de negocio. Una ejecución fallida devuelve un error seguro; una respuesta Legacy provider explícita con primas cero y HTTP 200 se considera ausencia de ofertas, incluso si el hook rechazó la respuesta por ese motivo. Una forma desconocida nunca se convierte silenciosamente en “sin resultados”.

- Importes: números no negativos; moneda explícita (`COP` para Sura y Legacy provider de Colombia; SBS usa la moneda del resultado). Los textos numéricos con punto decimal se convierten sin redondearlos. Separadores ambiguos como `1,234` producen aviso y se conservan como metadatos.
- Identificadores, placas, Fasecolda, motores y chasis: texto, conservando ceros iniciales. El `modelo` de Sura representa el año, no una marca o línea inventada.
- Campos no entregados: `null`. Coberturas/deducibles `null` significa desconocidos; documentos `[]` significa que no se entregaron enlaces utilizables. No se fabrican referencias, productos ni documentos.
- Particularidades: `metadata.providerFields` y `offers[].metadata.providerFields`. Los campos secretos se excluyen; se trabaja con las respuestas que el motor ya redactó. Para SBS se conserva allí la estructura adicional del proveedor; la respuesta original completa permanece en el historial, referenciada por `runId`.

## Adaptadores iniciales

- SBS productos 8, 9, 10 y 11: `premiumTotal` → `offers[].premium.total`, `quoteNumber` → `reference`. Una oferta por resultado.
- Sura consulta de placa: `placa`, `modelo`, `fasecolda`, `motor`, `chasis` y valores asegurados.
- Legacy provider (Allianz, Solidaria y los cuatro flows Equidad): prioriza `offerItems`, incluyendo prima neta, impuestos y descripción del deducible. Si no hay items, interpreta las columnas `PrimaOpcion1..4`. No concatena ambos formatos ni duplica ofertas.
- Liberty cotización: datos económicos, referencia de simulación, producto, amparos y deducibles.
- Mapfre: una oferta por propuesta, importes y coberturas.
- Qualitas: una oferta por movimiento aceptado, primas, paquete, coberturas y deducibles. Los movimientos rechazados no se presentan como ofertas.
- Liberty autenticación: confirma que el token fue obtenido, pero no lo devuelve.

Equidad por placa queda pendiente de una respuesta válida o contrato verificable: no hay una ejecución guardada y la dirección WSDL configurada respondió HTTP 404. Devuelve `vehicle: null`, estado `partial` y `NORMALIZATION_PENDING` mientras no exista evidencia para mapear los campos.

Los demás flows sin adaptador reciben el mismo contrato, con su tipo de operación y aviso `NORMALIZATION_PENDING` mientras no exista un mapeo respaldado por su respuesta. Sus campos quedan en `metadata.providerFields.unmapped`; el frontend no debe presentarlos como una cotización normalizada. Añadir un adaptador no requiere modificar el MVP ni el contrato del frontend.

## Verificación

Pruebas de contratos, redacción, dinero ambiguo, múltiples ofertas, formatos desconocidos, permisos, errores uniformes, versionado y lectura histórica. Además se reprocesaron seis ejecuciones reales guardadas: SBS 8/9/10, Sura, Allianz y Solidaria. Todas validaron el esquema; Allianz y Solidaria conservaron sus tres ofertas cada una. No se hicieron nuevas llamadas a aseguradoras.

La UI de Savia request incluye el panel **Resultado estándar**, ofertas, consulta de placa, avisos y JSON con metadata. Lee el run existente a través del cliente autenticado; no vuelve a ejecutar la operación. Mantiene debajo la respuesta original y las trazas del MVP.

También se reprocesaron ocho respuestas directas archivadas: cuatro Liberty, una Mapfre (dos propuestas) y tres Qualitas. Todas validaron el contrato. Las pruebas cubren ofertas múltiples, importes ambiguos, movimientos rechazados y respuestas fuera de orden en la interfaz.
