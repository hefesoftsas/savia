# ADR 0006 — Estado de la migración fuera del release

- Estado: aceptada (parcial: ver pendientes).
- Fecha: 2026-09-23.
- Continúa a: ADR 0005 (sombra con el mismo id).

## Lo migrado

23 de 24 plugins tienen port funcional en `store-ports/` con e2e:

- 17 workbench + `collections` (piloto) + `portfolio` (resumen y
  widget en cliente, MCP calculado en el worker) + `quotes-ui`
  (delegación savia-request) + 5 gateway (`http` declarativo con
  `allowConfiguredHost`) + `automation` (bundles como datos).
- Soporte del host: screens y widgets declarados, colecciones,
  bundles, settings, simulation/delegate/http, MCP read-only,
  cuotas y paridad Postgres.

## Pendiente

- **Retirada física del código compilado**: solo cuando ningún
  tenant lo use (la sombra lo hace seguro por tenant, sin flag day).
- **Revisión de seguridad externa**, CI con PG local, staging
  (fila D1 ~1 MB, live real) y render en Chrome.
- **R2** si D1 rechaza entradas grandes; **MCP de escritura** tras un
  flujo de confirmación explícita.
