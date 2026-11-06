# ADR 0001 — Store de plugins por tenant con sandbox de UI

- Estado: aceptada.
- Fecha: 2026-09-23.
- Contexto: los plugins compilaban dentro del release; los tenants
  pedían subir los suyos (ZIP) y activarlos por espacio. Workers no
  puede ejecutar TS subido sin compilar, y ejecutar JS de terceros en
  el Worker principal rompería el modelo de extensiones confiables.

## Decisión

- Solo plugins de UI + declarativos en v1: ZIP con
  `savia-extension.json` (`id: custom.*`) y `dist/plugin.js` ESM
  precompilado y autocontenido (512 KB / ZIP 6 MB).
- Ejecución en `iframe sandbox="allow-scripts"` con origen opaco;
  la única E/S es `postMessage` → API del host con la sesión del
  usuario. Validación estática en subida (sin `eval`, `fetch`,
  imports remotos, storage ni bindings).
- Estado por tenant reutilizando `crm_extension_installations`;
  artefactos en `plugin_store_artifacts` (clave por tenant).
  Sin backend propio ni hooks/migraciones de terceros.

## Consecuencias

- Un XSS dentro del iframe no alcanza tokens ni otros tenants; el
  daño máximo es actuar con los permisos del usuario que lo abrió.
- El catálogo compilado y sus garantías no cambian; el store es
  aditivo y privado por tenant.
- Backend aislado (Workers for Platforms u otro) queda como
  trabajo futuro explícito, no como deuda oculta.
