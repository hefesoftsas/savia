# Ejemplo de plugin: Cartera de pólizas

`@savia/insurance-portfolio-dashboard` es el ejemplo de referencia para una
extensión TypeScript de Savia. Demuestra una pantalla React propia, acceso
tipado a colecciones, provisión de una colección requerida y una consulta de
solo lectura para Savia Assistant.

No es un ZIP ejecutable por cualquier tenant. Savia incorpora el código en un
release validado; el administrador del tenant únicamente instala o activa la
extensión disponible en ese release.

## Qué hace

Al activarse, la extensión reemplaza la vista normal de la colección
**Pólizas** con una pantalla React que muestra métricas, lista pólizas y permite
crearlas, editarlas o eliminarlas. Si la colección no existe, la instalación
la crea; si ya existe y cumple el contrato, la conserva sin modificar sus
registros ni campos adicionales.

## Mapa de archivos

| Archivo                    | Responsabilidad                                                     |
| -------------------------- | ------------------------------------------------------------------- |
| `savia-extension.json`     | Identidad, versión y dependencias del artefacto de release.         |
| `src/manifest.ts`          | Manifiesto tipado que consumen API, Admin y MCP.                    |
| `src/admin.ts`             | Declara qué pantalla reemplaza la extensión: `polizas` / `records`. |
| `src/screens/policies.tsx` | La única UI React del ejemplo.                                      |
| `src/policy-object.ts`     | Contrato y provisión idempotente de la colección `polizas`.         |
| `src/summary.ts`           | Regla pura para calcular pólizas vigentes, vencimientos y prima.    |
| `src/mcp.ts`               | Herramienta de solo lectura para Savia Assistant.                   |

La API que usa una pantalla no vive en el plugin. La proporciona el host en
[`packages/crm-shared/src/plugin-api.ts`](../crm-shared/src/plugin-api.ts), de
modo que todos los plugins comparten las mismas reglas de tenant, permisos,
paginación y control de versión.

## La pantalla React

Savia inyecta un objeto `savia` ya limitado al tenant, usuario y extensión que
están abiertos. El plugin no construye URLs ni recibe D1, tokens, credenciales
ni identificadores de tenant.

```tsx
async function loadPolicies(savia: PluginApi) {
  const polizas = savia.collections.collection<Poliza>("polizas");

  const page = await polizas.list({ page: 1, perPage: 25 });
  await polizas.create({ name: "POL-001", estado: "Vigente" });
  await polizas.update(id, changes, { version });
  await polizas.remove(id, { version });
}
```

La API disponible es deliberadamente pequeña:

```ts
const available = await savia.collections.list(); // Colecciones expuestas aquí.
const schema = await polizas.describe(); // Campos y configuración.
const record = await polizas.get(id);
const page = await polizas.list({ page, perPage, sort, order });
await polizas.create(input);
await polizas.update(id, input, { version });
await polizas.remove(id, { version });

const summary = await savia.services.get("summary");
```

`services.get()` solo puede resolver servicios de la extensión dueña de la
pantalla. Es útil para lógica de negocio que debe calcularse en servidor, como
el resumen de cartera, sin exponer un endpoint o ruta al código de la UI.

## Crear otro plugin basado en este ejemplo

1. Copia el directorio y cambia el `id`, `label`, `version` y `requires` en
   `savia-extension.json` y `src/manifest.ts`.
2. Declara una contribución en `src/admin.ts`: colección, vista y componente.
3. Implementa una pantalla en `src/screens/` que reciba `{ savia }`.
4. Usa `savia.collections.list()` y `describe()` antes de depender de una
   colección no creada por tu extensión.
5. Si necesitas una colección propia, declara un requisito idempotente en
   `src/<collection>-object.ts` y regístralo en el catálogo del API.
6. Si necesitas una operación de negocio calculada en servidor, declárala en
   el catálogo del API y consúmela con `savia.services.get("nombre")`.
7. Añade una herramienta MCP solo si el asistente necesita esa capacidad; debe
   validar que la extensión esté activa y respetar los permisos delegados.

El registro de pantallas actuales es explícito y confiable en
`apps/admin/src/features/crm-engine/extension-screens.tsx`. Añadir una entrada
allí forma parte de publicar una nueva extensión de primera parte.

## Desarrollo y verificación

Vite importa la pantalla directamente desde el workspace: al guardar
`src/screens/policies.tsx`, la aplicación local se actualiza sin construir ni
subir un archivo.

```bash
pnpm --filter @savia/insurance-portfolio-dashboard test
pnpm --filter @savia/insurance-portfolio-dashboard typecheck
pnpm extension:pack insurance-portfolio-dashboard
```

El último comando genera un candidato `.savia-extension.zip` en
`dist/extensions/`. Antes de distribuirlo, CI debe validar pruebas, tipos,
manifiesto y contenido; el ZIP no concede ejecución dinámica ni instalación
de código arbitrario.

## Límites intencionales

- Solo las colecciones expuestas en el tenant y al usuario actual están
  disponibles mediante `savia.collections`.
- El plugin no puede saltarse permisos, seleccionar otro tenant ni acceder a
  almacenamiento del host.
- La API inicial cubre descubrimiento de esquema y CRUD versionado. Filtros
  avanzados, relaciones, agregaciones genéricas y acciones masivas se añaden
  al SDK solo cuando un caso real lo requiera.
- El administrador del tenant controla si la extensión está activa; las
  pantallas ordinarias siguen usando la visibilidad y el menú nativos de
  Savia.
