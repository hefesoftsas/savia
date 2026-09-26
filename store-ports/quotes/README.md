# Quote wizard store plugin (`insurance.quotes` 2.0.3)

The ZIP contributes one screen, `cotizador_por_pasos`. Its wizard includes an
inline configuration tab, so installing it does not add separate direct-quote
or administration screens. The quote action uses the host's native Savia
Request service (`kind: savia-request`) and keeps the provider flows needed by
the wizard. It does not install an insurance management solution.

```bash
pnpm store:pack store-ports/quotes
```

The plugin declares the two hidden quote-history collections, including the
optional result snapshot and duration fields. Installation preserves existing
fields and custom layouts, and adds missing optional fields with a schema version
update. Required or conditionally required additions need an explicit migration. On older schemas, the wizard saves the core result
fields and reports when detailed snapshots cannot be stored.

Install the separate `savia.insurance-quoter` solution for the wizard object. The optional
`savia.insurance-management` solution adds customers, insurers, policies,
payments, and claims independently.
