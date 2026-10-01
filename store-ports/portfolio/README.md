# Port: Cartera de pólizas fuera del release (`insurance.portfolio-dashboard` 1.1.4)

La pantalla real de Pólizas con el **resumen calculado en cliente**
(`summarizeInsurancePortfolio` es un reductor puro): pagina `polizas`
(hasta 50 páginas de 200) y agrega localmente. Sin backend ni MCP.

No portado (requiere slots del host aún inexistentes): widgets de
Mi Día y herramienta MCP `savia_extension_insurance_portfolio`.

```bash
pnpm store:pack store-ports/portfolio
```

## Screen styles

The portfolio screen imports its shared stylesheet from
`packages/insurance-portfolio-dashboard/src/screens/policies.css`. The packer
embeds it in `dist/plugin.js` and installs it inside the sandboxed iframe.
The screen must not depend on the Admin application's CSS: iframe styles are
isolated. The shared stylesheet supplies layout, controls, keyboard focus,
table scrolling, and narrow-screen rules using the theme tokens from the host.

Verify the executable artifact with:

```bash
node --test scripts/store-ports.test.mjs
pnpm --filter @savia/insurance-portfolio-dashboard test
```
