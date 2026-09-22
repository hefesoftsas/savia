# My Day widgets

Owner: Platform UI team. Reviewed: 2026-09-22.

Mi día es un tablero único que combina la agenda personal con widgets:
representaciones visuales rápidas de las colecciones del usuario (resúmenes,
gráficas, acciones, elementos). Cada widget enlaza a su pantalla completa;
nunca la reemplaza. Todo el tablero se guarda automáticamente y se puede
reordenar arrastrando.

## Tipos

| Tipo                      | Contenido                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `agenda`                  | Eventos de hoy (Google Calendar + Outlook) con enlaces directos.                   |
| `quick_task`              | Formulario compacto para bloquear tiempo en los calendarios conectados.            |
| `summary`                 | Total de registros + conteo por estado + suma opcional.                            |
| `items`                   | Últimos N registros (título, estado, fecha).                                       |
| `chart`                   | Barras por estado (conteo + suma opcional, sin librerías).                         |
| `actions`                 | Vencidos, hoy y próximos 7 días según campo de fecha.                              |
| `plugin:<extension>:<id>` | Vista diseñada por un plugin (ej. `plugin:insurance.portfolio-dashboard:summary`). |

Los widgets de sistema (`agenda`, `quick_task`) no pertenecen a ningún
dominio ni colección: se agregan desde la pestaña Agenda del diálogo y se
pueden quitar y volver a agregar en cualquier momento. Los usuarios nuevos
empiezan con `{ agenda, quick_task }` por defecto.

Los widgets de plugin solo aparecen en el diálogo si su colección coincide
y la extensión está activa en ese dominio; si se desactiva después, la
tarjeta pide activarla en lugar de fallar.

## Agregar un widget

Mi día → Mi tablero → Agregar widget:

1. Pestaña Colección: elige dominio y colección. Solo aparecen colecciones
   visibles y autorizadas para tu usuario (pantallas ocultas y páginas de
   solicitud quedan excluidas).
2. Elige tipo (Resumen, Elementos, Gráfica o Acciones). El widget
   auto-detecta campo de estado (primera lista `Dropdown`, preferencia a
   `estado`), campo de monto (`Number`/`Currency`) y campo de fecha. Puedes
   ajustarlos.
3. Pestaña Agenda: restaura la agenda del día o la creación rápida de
   tareas si las quitaste del tablero.
4. Guardar persiste en `PUT /v1/user-preferences/my-day-widgets`.

Límites: 12 widgets por usuario, 10 elementos visibles por widget. El
orden se cambia arrastrando desde el asa de cada tarjeta (con alternativa
de teclado y menú ⋯ mover antes/después para accesibilidad).

Los avisos sobre carga, guardado y cambios del tablero se pueden cerrar con
el botón «Cerrar aviso».

## Datos y permisos

- El layout (`{ version: 1, widgets: [...] }`) es personal y privado por
  `principal_id` (tabla `user_my_day_widgets`). Validación con zod en
  `packages/crm-shared/src/my-day-widgets.ts`, compartida por API y admin.
- Cada widget lee con la API existente del dominio:
  `GET {apiBasePath}/api/records/{collection}?page&perPage&sort&order`
  (total + página), `GET .../records/{collection}/summary?group=&amountField=`
  (conteo por estado, con control de acceso del servidor) y la misma lista
  ordenada por fecha para acciones (comparación por día de calendario).
- Visibilidad no es autorización: si la colección deja de estar autorizada,
  el widget muestra estado no disponible en lugar de filtrar datos.
- Sin ejecución dinámica: los widgets built-in son código del release. Los
  plugins contribuyen React propio vía `releaseCatalog.extensionWidgets`
  (`plugin:<extension>:<id>`), renderizado por el host con el mismo `savia`
  limitado que las pantallas de extensión (colecciones, servicios propios,
  `access.effective()`). Los errores del widget quedan contenidos en su
  tarjeta.

## Archivos

| Área         | Archivos                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato     | `packages/crm-shared/src/my-day-widgets.ts`                                                                                                                                  |
| Persistencia | migración `0060`, `user-preferences/{contracts,repository}.ts`, rutas `user-preferences.ts`                                                                                  |
| Admin        | `apps/admin/src/features/my-day-widgets/` (`data`, `summarize`, `widgets`, `agenda-widget`, `add-widget-dialog`, `section`), `my-day-page.tsx`, `user-preferences-client.ts` |
| Plugins      | `packages/release-catalog/src/index.ts` (`ExtensionWidgetContribution`), ejemplo `packages/insurance-portfolio-dashboard/src/widgets.tsx`                                    |

## Crear un widget de plugin

1. Copia el patrón de `insurance-portfolio-dashboard/src/widgets.tsx`:
   componente `({ savia, widget })` + entrada `{ id, extensionId,
collection, title: { es, en?, pt? }, Widget }`.
2. Expón el arreglo desde el `admin.ts` del plugin y regístralo en
   `releaseCatalog.extensionWidgets`.
3. Usa `savia.collections` y `savia.services.get()` como en una pantalla;
   el host resuelve permisos y muestra la tarjeta con el pie estándar.

## Fases siguientes

- Más contribuidores (renovaciones, cobranzas).
