# ADR 0005 — Migración de plugins fuera del release con el mismo id

- Estado: aceptada.
- Fecha: 2026-09-23.
- Continúa a: ADR 0001 (store de plugins por tenant).

## Contexto

Los plugins sectoriales compilan dentro del release. Para sacarlos
sin romper tenants hay que permitir que el store publique bajo el
mismo id (`insurance.collections`) y que el host prefiera lo subido.

## Decisión

1. **Sin prefijo obligatorio**: el manifiesto del store acepta
   cualquier id válido. El aislamiento ya es total por tenant
   (instalaciones, secretos, dependencias y auditoría), así que un
   id solo afecta a su propio espacio. `custom.*` queda como
   convención para terceros.
2. **Sombra por tenant**: si el tenant subió un artefacto para un id,
   `resolveExtension`, `GET /extensions` e instalación usan el
   manifiesto del store; la copia compilada queda oculta para ese
   tenant (`shadowed: true`). Sin artefacto, todo sigue igual.
3. **Versiones continuas**: los ports versionan por encima del release
   (p. ej. 1.1.0 sobre 1.0.0) para que instalar migre; la comparación
   es semver, no lexicográfica. Re-subir la misma versión con distinto
   contenido se rechaza igual que antes.
4. **Pantallas declaradas**: `store.json` acepta `screens[]`
   (`object`, `view`, `hidden`) y el admin renderiza el iframe del
   store en la ruta normal al estar activo, con la misma precedencia.

## Consecuencias

- Migrar un tenant = subir ZIP → instalar → activar, sin cambiar ids
  ni tocar soluciones que dependen de ellos.
- La retirada del código compilado puede hacerse por plugin cuando
  ningún tenant lo use, sin flag day.
- Un admin solo puede romper su propio espacio subiendo un artefacto
  defectuoso bajo un id migrado; eliminarlo restaura lo compilado.
