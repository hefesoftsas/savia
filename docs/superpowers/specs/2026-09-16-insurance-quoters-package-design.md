# Cotizadores y administración dentro del paquete Seguros

## Objetivo

Completar la solución opcional `savia.insurance` para que su instalación deje
disponibles dos experiencias de cotización y una pantalla administrativa del
propio paquete:

- **Cotizador**, con el formulario completo en una sola pantalla.
- **Cotizador por pasos**, con el mismo formulario dividido en Vehículo,
  Solicitante y conductor, y Contacto y cotización.
- **Administrar Seguros**, para que un administrador del tenant active las
  pantallas, habilite productos y gestione las conexiones necesarias.

El núcleo de Savia seguirá sin vocabulario, reglas ni contratos de Seguros.
SBS y Sura son proveedores iniciales del paquete, no conceptos del núcleo ni
condiciones fijas de sus pantallas.

Este trabajo se hace solo en el entorno local de pruebas. No incluye push,
despliegue remoto, migración de datos heredados ni llamadas reales durante la
verificación.

## Alcance confirmado

La primera versión del catálogo del paquete incluirá tres productos de autos
livianos que ya tienen contratos de proveedor en el repositorio:

| Producto visible | Operación inicial | Flujo |
| --- | --- | --- |
| Autos Producto 8 | `sbs-product-8-quote` | Crear sesión, dos coberturas, cotizar y cerrar. |
| Autos Gold | `sbs-product-10-quote` | Crear sesión, siete coberturas, cotizar y cerrar. |
| Autos Plata | `sbs-product-11-quote` | Crear sesión, siete coberturas, cotizar y cerrar. |

La consulta de placa será una capacidad de vehículo del paquete y usará la
operación inicial `sura-vehicle-by-plate` cuando el tenant tenga una conexión
adecuada. Su resultado solamente rellena los campos del vehículo si la placa
de respuesta coincide con la que escribió el usuario.

## Decisiones

- Los cotizadores se implementan como pantallas React aportadas por la
  extensión `insurance.quotes`, no como configuraciones de Savia Request ni
  como pantallas genéricas del CRM.
- Las dos pantallas comparten el mismo contrato de formulario, validación,
  consulta de placa, selección de productos, ejecución y presentación de
  resultados. Solo cambia la composición: formulario largo frente a asistente
  de tres pasos.
- El paquete tendrá una configuración versionada y aislada por tenant. Sus
  valores predeterminados viven en la extensión; una instalación no crea
  secretos ni invoca proveedores.
- La configuración permitirá habilitar cada pantalla y cada producto, ordenar
  productos y asociarlos a conexiones existentes. El administrador no escribe
  IDs arbitrarios de acciones ni operaciones de proveedor: solo puede elegir
  entradas del catálogo conocido por la extensión.
- La ejecución técnica siempre se audita mediante `extension_action_runs`, con
  entrada y salida saneadas. No se crearán automáticamente registros de la
  colección de negocio `cotizaciones`: una respuesta de integración no es por
  sí misma una cotización comercial y no debe generar duplicados.
- Una actualización de paquete conserva la configuración ya guardada. Los
  productos nuevos llegan inactivos, por lo que un administrador debe
  habilitarlos expresamente.

## Arquitectura

### Paquete y navegación

El manifiesto de `savia.insurance` declarará las rutas necesarias para
`cotizador`, `cotizador_por_pasos` y `administrar_seguros`. El catálogo de
release registrará contribuciones de pantalla de `insurance.quotes` para sus
vistas principales. La capa actual de pantallas de extensiones seguirá
mostrándolas únicamente cuando la extensión requerida esté disponible para el
tenant.

Instalar la solución crea sus objetos/rutas y habilita su extensión; no crea
una conexión. Desactivar la solución oculta los cotizadores y su administración
sin borrar configuraciones, conexiones, ejecuciones ni colecciones de
Seguros. Un tenant que no instale el paquete no verá esas entradas ni podrá
usar sus acciones.

### Capacidades genéricas de la plataforma

`PluginApi` se ampliará con capacidades genéricas y acotadas para la extensión
que posee la pantalla:

- `settings.get` y `settings.replace` para una configuración validada y
  aislada por `(tenant, extension)`;
- `connections.list`, `connections.replace` y `connections.remove` para las
  conexiones de esa extensión;
- `actions.execute(actionId, { connectionId, input })` para ejecutar una
  acción ya declarada por la extensión.

El host resolverá el tenant, la sesión y los permisos antes de ejecutar estas
capacidades. La ruta de administración solo permitirá cambios a administradores
del tenant; una acción de cotización conservará los permisos de uso de la
pantalla. Ninguna capacidad permite que la pantalla seleccione otro tenant,
descifre una conexión o lea valores secretos.

El almacenamiento genérico de configuración de extensiones contendrá JSON
validado, versión y marcas de auditoría. Las conexiones permanecen en
`extension_connections`, cifradas y con sus secretos fuera de las respuestas
al navegador. Las ejecuciones siguen en `extension_action_runs` y mantienen su
saneamiento actual.

### Configuración de Seguros por tenant

La extensión definirá un esquema de configuración y valores predeterminados:

```text
quotePages: { direct: boolean, wizard: boolean }
vehicleLookup: { enabled: boolean, connectionId?: string }
products: [{ id, label, connectionId?, enabled, rank }]
```

Los `id` de producto corresponden a definiciones internas y versionadas de la
extensión. Cada definición conoce su proveedor, la operación inicial y los
campos requeridos. La configuración solo contiene visibilidad, orden y una
referencia a conexión; no contiene credenciales ni solicitudes SOAP/HTTP.

**Administrar Seguros** mostrará el estado de las dos experiencias, la consulta
de placa, los productos del catálogo y las conexiones disponibles. Permitirá
crear o actualizar conexiones mediante el formulario declarado por el conector
de la extensión. Los secretos introducidos se envían una vez al host cifrado y
nunca se muestran después de guardarse.

Si no existe una conexión compatible o no hay productos habilitados, las
pantallas de cotización seguirán disponibles pero mostrarán un estado claro que
dirige al administrador a la configuración correspondiente.

## Flujo de cotización

1. La pantalla carga la configuración de su tenant y las conexiones resumidas.
   Solo presenta los productos activos que tengan una conexión asignada.
2. El usuario introduce la placa y, de forma explícita, solicita la consulta.
   La pantalla ejecuta la acción de consulta por el host y aplica únicamente
   campos seguros de un vehículo cuya placa coincida.
3. El usuario completa los datos requeridos y elige uno o varios productos.
   Una modificación de placa elimina datos de vehículo recuperados para evitar
   reutilizar información de otro automóvil.
4. Por cada producto elegido, la extensión envía el formulario canónico al
   host mediante `actions.execute`. El host valida la instalación, la acción,
   la conexión y la entrada; registra la ejecución; descifra la conexión solo
   para el gateway; y delega al adaptador incluido en el release.
5. La extensión normaliza y presenta cada resultado. Una falla de producto no
   borra los resultados exitosos de los demás productos. La respuesta técnica
   se muestra como tal y queda auditada; no inserta de manera implícita un
   registro comercial en `cotizaciones`.

El Cotizador aplica este flujo después de un único formulario. El Cotizador
por pasos conserva exactamente los mismos datos y reglas, pero valida el paso
actual antes de avanzar y solo permite ejecutar en el tercer paso.

## Adaptadores de proveedor

`ProviderExecutor` conservará el formulario canónico de autos livianos y se
generalizará para secuencias de sesión, coberturas y cierre. Las definiciones
de Producto 8, Gold y Plata se derivarán de los archivos Bruno versionados, no
de credenciales, respuestas guardadas ni contratos inventados.

El adaptador de Producto 8 seguirá su flujo de cuatro operaciones. Gold y
Plata incorporarán sus nueve operaciones: crear sesión, agregar siete
coberturas en orden y cotizar/cerrar. El ID de sesión se extraerá de la
respuesta saneada y se mantendrá sólo durante esa ejecución. Un fallo al crear
la sesión, extraer el ID o completar un paso terminará ese producto de forma
controlada; no se intentará repetir automáticamente una escritura externa.

Las acciones y conectores permanecen declarados en el manifiesto de la
extensión. El runtime genérico solo valida que la conexión pertenezca al
conector que la acción requiere; no interpreta aseguradoras, coberturas,
vehículos ni respuestas del proveedor.

## Errores, privacidad y auditoría

- La UI valida campos obligatorios antes de ejecutar y muestra mensajes de
  corrección por campo o por paso.
- La falta de configuración produce una guía administrativa, no un intento de
  llamada externa.
- Los errores públicos de red, proveedor y configuración no incluyen URLs,
  tokens, contraseñas, XML completo ni detalles internos de transporte.
- Las credenciales no se almacenan en navegador, `localStorage`, historial de
  formularios ni resultados de UI.
- Las entradas y salidas de cada ejecución se someten al saneamiento existente
  antes de persistirse en el historial técnico del tenant.
- Las pruebas no llaman proveedores reales. Usarán `fetch` y ejecutores
  simulados para representar respuestas correctas, parciales y fallidas.

## Migración y compatibilidad

El historial de pantallas de Savia Request y el antiguo workspace de autos
livianos se usa sólo como fuente de los campos, pasos y contratos. Las nuevas
pantallas no dependerán de rutas `/savia-request`, de `insurance-results` ni de
APIs legadas.

Se incrementará la versión de la solución y de la extensión. La instalación
local existente se actualizará mediante el flujo normal de paquete: conservará
sus objetos actuales y añadirá las tres rutas/pantallas. No se migrarán ni se
fabricarán registros comerciales históricos.

## Verificación

La implementación debe cubrir como mínimo:

1. El contrato de configuración: valores predeterminados, validación, lectura,
   actualización, aislamiento entre tenants y restricción de administración.
2. `PluginApi`: rutas y formas de datos de configuración, conexiones y acciones
   sin exposición de valores secretos.
3. El ciclo de vida del paquete: instalación, actualización, desactivación y
   ausencia de pantallas/capacidades si el tenant no tiene Seguros.
4. El formulario compartido: normalización de placa, limpieza de datos
   recuperados, validación de cada paso, productos inactivos y errores
   parciales sin pérdida de resultados válidos.
5. Los adaptadores de Producto 8, Gold y Plata con respuestas simuladas:
   orden de pasos, propagación de sesión, errores y saneamiento.
6. La interfaz administrativa: cambios de visibilidad, orden, producto y
   conexión; y confirmación de que los secretos introducidos no se renderizan.
7. Typecheck, suites afectadas y una comprobación visual local de instalación,
   configuración, ambas pantallas y estado sin conexión. Ninguna prueba visual
   ni automatizada disparará una cotización real.

## Fuera de alcance

- Enviar llamadas a proveedores reales o publicar cambios.
- Crear automáticamente registros comerciales de `cotizaciones` desde una
  ejecución técnica.
- Migrar datos, ejecuciones o rutas del sistema retirado.
- Permitir que un tenant cree operaciones de proveedor arbitrarias desde la UI.
- Convertir Seguros en una capacidad del núcleo o modificar soluciones que no
  pertenecen a este paquete.
