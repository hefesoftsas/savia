# ADR 0004 — Plugins del store visibles al asistente

- Estado: aceptada.
- Fecha: 2026-09-23.
- Continúa a: ADR 0003 (conectores `http`).

## Contexto

Las herramientas del asistente se registran estáticas desde el
release. Exponer acciones de plugins subidos por tenants exige
registro dinámico por tenant y descripciones redactadas por terceros
(vector de inyección de prompts hacia el modelo).

## Decisión

1. **Sin registro dinámico**: dos herramientas estáticas,
   `savia_store_catalog` (lista plugins activos y acciones de
   lectura) y `savia_store_execute` (ejecuta una de ellas), ambas con
   `readOnlyHint: true`.
2. **Solo lectura declarada**: `store.json` admite `mcp: { label,
summary }` únicamente en `simulation` y `http` GET. Escrituras
   (POST, delegación) no se exponen.
3. **Texto saneado en dos capas**: la subida rechaza instrucciones
   (`ignore previous instructions`, `system:`, sintaxis de enlaces…),
   topes (100/300) y caracteres de control; al servir se vuelve a
   sanear, se trunca y se prefija `[<plugin>/<acción>]`. El modelo
   nunca recibe esquemas de input del plugin (input fijo
   `record<string, unknown>`).
4. **Resolución por tenant y petición**: el catálogo y la ejecución
   usan el cliente delegado de la sesión; `execute` vuelve a buscar la
   acción en el catálogo antes de llamar, así un `pluginId/actionId`
   arbitrario no ejecuta nada fuera de lo listado.

## Consecuencias

- Añadir un plugin no cambia el arranque del worker MCP.
- Una descripción maliciosa que pase la subida queda marcada con
  origen y sin formato ejecutable; el riesgo residual es el de
  cualquier dato del tenant visible al modelo.
- Las escrituras de plugins del store siguen fuera del asistente
  hasta un flujo de confirmación explícita.
