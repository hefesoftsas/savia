# ADR 0002 — Delegación de acciones del store a extensiones compiladas

- Estado: aceptada.
- Fecha: 2026-09-23.
- Continúa a: ADR 0001 (store de plugins por tenant con sandbox de UI).

## Contexto

El store v1 ejecuta UI sin backend propio. Pantallas reales como el
cotizador necesitan ejecutar lógica de servidor (flujos savia-request)
sin que cada tenant opere secretos ni servicios.

## Decisión

`store.json` acepta acciones `delegate`:

```json
{ "id": "quote", "kind": "delegate", "extension": "insurance.quotes", "action": "quote" }
```

El host, al recibir `POST /api/extensions/<store>/actions/<id>`:

1. Resuelve la entrada `delegate` del `store.json` del tenant.
2. Exige que la extensión destino esté **disponible en ese mismo
   tenant** (built-in o instalada y activa; si no, 409).
3. Reescribe el contexto a `{ extensionId: <destino>, ...mismo tenant,
   mismo principal }` y ejecuta la ruta compilada normal (schemas,
   conexiones, executor del release).
4. El conector propaga `x-savia-tenant` y `x-savia-actor`, alineado con
   el modelo tenant-scoped de savia-request: los runs caen en el scope
   del tenant con atribución de auditoría.

## Límites explícitos

- El destino debe existir en el registry compilado; no hay cadenas
  (un `delegate` nunca apunta a otro plugin del store).
- La simulación (`kind: simulation`) sigue disponible para UI y demos;
  por acción solo rige una clase (la simulación no es fallback
  silencioso del live).
- Los llamados directos a proveedores con credenciales del tenant
  siguen pendientes de conectores `http` declarativos.

## Consecuencias

- `custom.quotes-ui` ejecuta savia-request real sin backend propio ni
  secretos por tenant.
- El aislamiento se mantiene: el rewrite ocurre en el servidor sobre
  un destino validado; el tenant y el principal nunca cambian.
