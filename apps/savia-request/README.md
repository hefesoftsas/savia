# Savia request integrado

El MVP de `insurer-flow-lab` se incorpora completo en Savia. El menú **Savia request** y `/#/savia-request` requieren administrador de plataforma. `/#/savia-request/docs` abre su Scalar independiente, con los ejemplos guardados y una operación por flow.

El editor se monta de forma nativa dentro de `apps/admin`: comparte su sidebar, la paleta Savia y la sesión del administrador. Usa `ApiClient`, que obtiene el token actual y lo envía únicamente a la API de Savia. La API aplica su autenticación habitual (sesión/MFA u OAuth con scopes de lectura/escritura), verifica `platform_admin` en cada llamada y accede al Worker privado mediante `SAVIA_REQUEST`. Las cookies y tokens de Savia no se reenvían al motor ni a los proveedores.

Los endpoints del editor conservan sus payloads y respuestas bajo `/v1/savia-request/api/*`; la ejecución de versiones está en `/v1/savia-request/v1/flows/:id/runs`. El motor, hooks aislados, variables cifradas, árbol, duplicación, confirmaciones de borrado, historial y modos mock/live son los del MVP. El espacio es compartido por administradores de plataforma, igual que el espacio único del MVP.

Las pantallas anteriores `/auto-light-quotes/*` y `/provider-credentials` redirigen a Savia request. La API ya no registra las antiguas rutas de cotización, conectividad ni credenciales de proveedores, y no consume su antigua cola. Las tablas históricas y las pruebas aisladas de los componentes anteriores se conservan; esos componentes no se montan en producción.

## Desarrollo local

Desde la raíz: `pnpm install` y `pnpm dev`. El administrador usa el puerto 5173 o el siguiente disponible. La API está en 8787 y el motor privado en 8797. Se ejecuta todo localmente; no requiere desplegar en Cloudflare.

Para copiar una instalación existente del MVP a un destino todavía vacío:

```sh
python3 apps/savia-request/scripts/import-local-mvp.py /ruta/insurer-flow-lab
```

El script toma una instantánea SQLite consistente y copia la configuración de cifrado. Conserva inputs, carpetas, variables, versiones e historial sin llamadas a proveedores. Se niega a sobrescribir un destino existente. Los archivos privados quedan fuera de Git. En este entorno ya se realizó la copia: 21 flows visibles, 33 incluyendo eliminados, 165 variables, una versión y 50 ejecuciones.

## Despliegue

La configuración de producción añade el Worker privado `savia-request`, su binding `LOADER`, el binding de la API y la migración `0020_savia_request.sql`. El workflow utiliza el secreto `SAVIA_REQUEST_ENCRYPTION_KEY` como `ENCRYPTION_KEY` del Worker. No hay ruta pública, workers.dev ni URL de preview del motor.

Los datos locales no se publican con el código. Antes de trasladarlos a producción debe transferirse la instantánea privada y configurarse la misma clave para sus variables cifradas (o recifrarlas con la clave del destino). El 6 de septiembre de 2026 se desplegó el motor privado y se transfirió la instantánea al D1 existente: 33 flows (21 visibles), 165 variables, una versión, 54 ejecuciones y cuatro carpetas. La clave correspondiente se configuró en el Worker y como secreto de despliegue de GitHub. La migración SQL crea tablas sin borrar registros anteriores.

## Verificación

Las pruebas `apps/api/test/savia-request*.test.ts` cubren acceso anónimo y por roles a todas las rutas, aislamiento del token de Savia, propagación de errores, CRUD, variables cifradas, publicación, historial y ejecución simulada con hooks reales. Las pruebas del administrador cubren el menú, el redireccionamiento y el rechazo de acceso sin rol. Scalar y su CSS se empaquetan en la compilación del administrador.
