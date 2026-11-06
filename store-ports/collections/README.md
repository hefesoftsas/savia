# Port: Cartera fuera del release (`insurance.collections` 1.1.0)

Migración piloto: la misma pantalla y colección del release,
empaquetadas como plugin del store **con el mismo id**. El host da
precedencia a lo subido por el tenant sobre lo compilado.

- `entry.tsx`: monta `CollectionsScreen` real.
- `store.json`: requisito de `insurance_receivables` + pantalla
  `records` (generado desde `src/object.ts`, no a mano).

## Empaquetar y migrar un tenant

```bash
pnpm store:pack store-ports/collections
# Subir en Mis plugins → Instalar (migra 1.0.0 → 1.1.0) → Activar.
# La ruta de Cartera renderiza el iframe del store en lugar de la
# pantalla compilada. Desactivar vuelve a la vista CRM normal.
```

## Refrescar

Si cambia `packages/insurance-collections/src/object.ts`, regenera
`store.json → collections` con el mismo procedimiento que
`store-ports/quotes-ui/README.md` describe para settings.
