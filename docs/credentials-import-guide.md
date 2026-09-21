# Guía de Importación de Credenciales de Aseguradoras (Bitwarden a Savia)

Esta guía explica cómo importar de manera segura, rápida e idempotente las credenciales reales de aseguradoras desde una exportación de Bitwarden tanto en el **entorno de desarrollo local** como en **producción**.

También cubre cómo mover secretos ya configurados entre ambientes (por ejemplo, de local a producción) exportando e importando un archivo JSON desde la UI de Savia Request.

---

## 0. Mover secretos entre ambientes desde la UI

En el menú lateral de Savia Request, la sección **Secretos** abre una pantalla dedicada que exporta e importa los secretos de todos los flows a la vez, sin usar la terminal. Requiere rol de administrador de plataforma.

1. En el ambiente origen, abre **Secretos** y pulsa **Exportar todos los secretos** para descargar un único archivo `savia-request-secretos-*.json` con todos los flows.
2. En el ambiente destino, abre **Secretos**, pulsa **Seleccionar archivo** y revisa el resumen (flows, valores con contenido y flows desconocidos que se omitirán).
3. Pulsa **Aplicar importación** y revisa el resultado por flow.
4. Elimina el archivo una vez completada la migración.

Reglas de la transferencia:

- El archivo contiene `{ version, exportedAt, flows: [{ flowId, variables: [{ key, value, secret }] }] }`.
- Los valores no vacíos del archivo ganan; los valores vacíos nunca sobrescriben lo ya guardado en el destino.
- Los flows del archivo que no existen en el destino se omiten y se reportan.
- Los archivos contienen secretos en texto plano: guárdalos en un lugar seguro, elimínalos después de usarlos y nunca los subas a Git.

---

## 1. Origen de las Credenciales

El equipo mantiene las credenciales autorizadas de aseguradoras en Bitwarden dentro de la organización Savia:

- **Colección / Ítem principal:** `Savia · Bruno · proveedores reales`
  - Contiene 53 campos con credenciales de Sura, Liberty, Mapfre, SBS Seguros, Equidad, Seguros Bolívar, Allianz, HDI, Zurich Expertia y Chubb.
  - En las notas contiene objetos JSON para proveedores REST (Chubb Copropiedades, etc.).
- **Ítem de infraestructura:** `Savia · Production · CRM_INTEGRATION_KEY`
  - Contiene el token secreto para la API y webhooks del CRM en producción.

> [!IMPORTANT]
> Las credenciales SBS deben venir del XML de sesión del export o de los campos
> `sbs_username` y `sbs_password` de Bitwarden. El importador no conserva
> valores de respaldo en el código: si faltan, las variables quedan vacías y
> no se debe ejecutar el flujo SBS hasta corregir el export.

---

## 2. Herramienta de Importación: `scripts/import-bitwarden-credentials.mjs`

La herramienta puede ejecutarse directamente mediante:

```bash
pnpm savia:credentials:import --bitwarden <ruta-al-export.json> [opciones]
```

### Opciones y Parámetros

| Bandera                        | Descripción                                                                                        | Por defecto                      |
| :----------------------------- | :------------------------------------------------------------------------------------------------- | :------------------------------- |
| `--bitwarden <path>`           | Ruta absoluta o relativa al archivo JSON exportado de Bitwarden. _(Obligatorio)_                   | —                                |
| `--target <local\|production>` | Entorno objetivo (`local` o `production`).                                                         | `local`                          |
| `--apply`                      | Aplica efectivamente los cambios a Savia Request. Sin esta bandera se ejecuta en modo **Dry-Run**. | `false`                          |
| `--audit`                      | Muestra un resumen detallado del mapeo de variables y estado de cada flow.                         | `false`                          |
| `--export-sql <archivo.sql>`   | Genera un script SQL con sentencias idempotentes para Cloudflare D1.                               | —                                |
| `--export-env <archivo.env>`   | Genera un archivo con las variables a nivel Cloudflare Worker (`CRM_INTEGRATION_KEY`).             | —                                |
| `--api-url <url>`              | URL base de Savia en producción para el modo `--target production`.                                | `https://savia.app.hefesoft.com` |
| `--token <token>`              | Token de sesión de Platform Administrator para el modo `--target production`.                      | —                                |
| `--port <puerto>`              | Puerto del worker local de Savia Request.                                                          | `8797`                           |

---

## 3. Uso en Desarrollo Local

Para hidratar tu entorno local inmediatamente:

1. Asegúrate de tener los servicios locales levantados (`pnpm dev`).
2. Ejecuta el comando con `--apply`:
   ```bash
   pnpm savia:credentials:import --bitwarden /ruta/a/bitwarden_org_export.json --target local --apply
   ```
3. El script se conectará al servicio interno `savia-request` (`http://127.0.0.1:8797`) y actualizará automáticamente las variables de los 22 flows de cotización y consulta.

---

## 4. Uso en Producción

Para el despliegue en producción existen dos mecanismos según las políticas de DevOps del equipo:

### Método A: Vía API Administrativa (Recomendado)

Savia expone una ruta proxy autenticada protegida con rol de Administrador de Plataforma (`requirePlatformAdministrator`):
`PUT /v1/savia-request/api/flows/:id/variables`

1. Obtén un token o cookie de sesión de Platform Administrator en producción.
2. Ejecuta:
   ```bash
   pnpm savia:credentials:import \
     --bitwarden /ruta/a/bitwarden_org_export.json \
     --target production \
     --api-url https://savia.app.hefesoft.com \
     --token "TU_TOKEN_DE_ADMINISTRADOR" \
     --apply
   ```
3. Las credenciales viajan cifradas por HTTPS directamente al servicio `savia-request` en Cloudflare Workers, donde se encriptan con AES-GCM usando la clave `ENCRYPTION_KEY` del worker y se guardan en la base D1 `savia-agencies`.

### Método B: Vía Cloudflare Wrangler CLI (Migración D1 y Secrets)

Si se desea ejecutar desde la consola de despliegue de Cloudflare o pipeline de CI/CD:

1. Genera el script SQL y las variables de entorno:

   ```bash
   pnpm savia:credentials:import \
     --bitwarden /ruta/a/bitwarden_org_export.json \
     --export-sql ./production-credentials.sql \
     --export-env .env.production.secrets
   ```

2. Aplica las variables en la base de datos D1 de producción:

   ```bash
   wrangler d1 execute savia-agencies --remote --file=./production-credentials.sql
   ```

3. Carga los secretos de nivel Worker en Cloudflare:

   ```bash
   wrangler secret put CRM_INTEGRATION_KEY < .env.production.secrets
   ```

4. Elimina los archivos temporales generados:
   ```bash
   rm -f ./production-credentials.sql .env.production.secrets
   ```

> [!CAUTION]
> **Nunca confirmes (commit) archivos de exportación de Bitwarden, `.sql` generados o archivos `.env.secrets` en Git.** Están expresamente protegidos por `.gitignore`.

---

## 5. Mapeo de Aseguradoras y Coberturas

- **Sura:** Utiliza `SAVIA_BRUNO_SURA_API_KEY` para cotización y búsqueda vehicular en vivo.
- **Liberty:** Utiliza credenciales OAuth (`SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME` y `PASSWORD`), solicita el token de sesión y cotiza los 4 planes (Básico, Básico PT, Full, Integral) contra la API de Liberty.
- **Mapfre:** Utiliza autenticación Basic y endpoints REST para cotizaciones de autos.
- **SBS Seguros:** Utiliza los parámetros de sesión SOAP y asigna las coberturas paramétricas (Base y Adicionales) para los productos 8 (RCE), 10 (Gold) y 11 (Plata).
- **Equidad & Qualitas:** Configura los consentimientos de ejecución (`ALLOW_NON_READ_ONLY`) y los cuerpos de petición Legacy provider/REST para los planes correspondientes.

## Legacy exporter configuration

The optional legacy exporter uses the `legacy-quotes` source and the
`SURREAL_LEGACY_QUOTES_URL`, `SURREAL_LEGACY_QUOTES_NAMESPACE`,
`SURREAL_LEGACY_QUOTES_DATABASE`, `SURREAL_LEGACY_QUOTES_USERNAME`, and
`SURREAL_LEGACY_QUOTES_PASSWORD` variables. Configure these names before running
a new legacy export. This does not change the production or preview D1 bindings.
