# Port: Cartera de pólizas fuera del release (`insurance.portfolio-dashboard` 1.1.0)

La pantalla real de Pólizas con el **resumen calculado en cliente**
(`summarizeInsurancePortfolio` es un reductor puro): pagina `polizas`
(hasta 50 páginas de 200) y agrega localmente. Sin backend ni MCP.

No portado (requiere slots del host aún inexistentes): widgets de
Mi Día y herramienta MCP `savia_extension_insurance_portfolio`.

```bash
pnpm store:pack store-ports/portfolio
```
