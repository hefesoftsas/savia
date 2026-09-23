# Port: Cotizaciones UI para el store (`custom.quotes-ui`)

Pantalla directa del cotizador (`InsuranceQuoteWorkspaceScreen`) empaquetada
como plugin del store. La acción `quote` **delega** a `insurance.quotes`
del release, por lo que ejecuta flujos savia-request reales cuando esa
extensión está activa en el tenant.

## Archivos

- `savia-extension.json`: manifiesto (`id: custom.quotes-ui`, v1).
- `entry.tsx`: adaptador `render(el, savia)` que monta la pantalla real.
- `store.json`: delegación `{ id: "quote" → insurance.quotes/quote }`
  - `settings.defaults` reales del cotizador.

## Empaquetar

```bash
pnpm store:pack store-ports/quotes-ui
# dist/plugin-store/custom.quotes-ui-1.0.0.store.zip + SHA-256
```

Luego súbelo en **Administrar pantallas → Paquetes y extensiones →
Mis plugins**, instálalo y actívalo **junto con `insurance.quotes`**
del catálogo (la delegación exige tenerla activa; si no, la acción
responde 409). La pantalla **Ver** ejecuta el cotizador contra
savia-request a través del release.

## Refrescar `settings.defaults`

Los defaults se generaron desde `defaultInsurancePackageSettings`. Si
cambia `packages/insurance-quotes/src/configuration.ts`, regenéralos:

```bash
# desde apps/admin (resuelve react y workspace):
cat > .tmp-gen-defaults.ts <<'EOF'
import { defaultInsurancePackageSettings } from "../../packages/insurance-quotes/src/configuration";
process.stdout.write(JSON.stringify(defaultInsurancePackageSettings));
EOF
./node_modules/.bin/esbuild .tmp-gen-defaults.ts --bundle --platform=node \
  --format=cjs --outfile=/tmp/gen-defaults.cjs --log-level=error \
  && node /tmp/gen-defaults.cjs > /tmp/quotes-defaults.json
rm -f .tmp-gen-defaults.ts
# fusiona /tmp/quotes-defaults.json en store.json → settings.defaults
```

## Límites conocidos (v1)

- La UI es la pantalla directa (sin wizard/admin) y la ejecución la
  realiza el release vía delegación: sin `insurance.quotes` activa no
  hay cotización.
- Sin provisión de colecciones: el tenant necesita `clientes` /
  `cotizaciones_detalle` o el plugin muestra avisos.
  Ver `docs/plugin-store.md`.
