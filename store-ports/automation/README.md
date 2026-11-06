# Port: Operación conectada fuera del release (`insurance.automation` 1.1.0)

Plugin solo-datos: los 5 bundles (`store.json`) los sirve el host en
`GET /api/workflow-bundles` al estar instalado, con el mismo gate de
disponibilidad que los compilados.

```bash
pnpm store:pack store-ports/automation
```

Regenerar bundles desde fuente: mismo procedimiento que
`store-ports/quotes-ui/README.md` describe para settings, importando
`bundles` de `packages/insurance-automation/src/bundles`.
