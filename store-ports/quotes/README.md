# Port: Cotizaciones fuera del release (`insurance.quotes` 1.3.1)

Las tres pantallas del cotizador con **ejecución nativa savia-request
del host** (`kind: savia-request`): no delega al release, así el
paquete compilado puede retirarse. Requiere el servicio savia-request
inyectado en el host (`saviaRequestService`).

```bash
pnpm store:pack store-ports/quotes
```

`store.json` declara la acción `quote` (21 flows no internos),
`settings.defaults` reales y las 3 pantallas. Las colecciones
(`cotizador`, …) las provee la solución `savia.insurance`.
El host entrega el objeto de la pantalla como tercer argumento de `render`:
`cotizador_por_pasos` abre el wizard, `cotizador` la cotización directa y
`administrar_seguros` la administración. En hosts previos a ese contrato,
el ZIP abre el wizard de forma predeterminada.
