# Desacople de Seguros como solución low-code opcional

## Objetivo

Convertir Seguros en una solución oficial opcional, completa y aislada. Un
tenant que no la instale debe operar Savia sin rutas, pantallas, datos,
vocabulario ni procesos de Seguros. Un tenant que la instale debe conservar
colecciones, cotización con proveedores y presentación de resultados.

El trabajo parte de un entorno de pruebas. Se permite descartar el estado local
generado de D1/R2 y recrear semillas; no habrá migración de datos, compatibilidad
con rutas antiguas ni modificación de entornos remotos.

## Decisiones

- Seguros permanece dentro del mismo release de Savia como solución first-party,
  no como servicio externo independiente.
- La solución conserva los conectores de cotización en esta fase. No se limitará
  a crear colecciones declarativas.
- El núcleo usa solamente términos de plataforma: tenant, extensión, acción,
  conexión, ejecución y resultado. No conoce agencia, aseguradora, póliza,
  cotización ni siniestro.
- Las extensiones son código confiable incluido en el release. No se habilita
  carga dinámica de JavaScript de terceros ni acceso directo de extensiones a
  D1, R2, `Env` o secretos.

## Límites

### Núcleo low-code

`apps/api`, `apps/admin`, `apps/mcp`, los contratos compartidos y el runtime de
conectores poseerán la autenticación, autorización, tenants, colecciones,
pantallas, ciclo de vida de soluciones/extensiones y contratos genéricos de
acciones externas. El núcleo resolverá el tenant y las capacidades antes de
delegar, y no importará módulos específicos de Seguros.

El runtime expondrá un contrato de acción con `extensionId`, `actionId`,
`connectionId` y una entrada validada por la extensión. Sus respuestas tendrán
estados genéricos: pendiente, exitosa, fallida y expirada. Los errores públicos
serán de validación, autorización, configuración, disponibilidad externa o
tiempo de espera; nunca incluirán secretos ni detalles de transporte del
proveedor.

El actual gateway de proveedores se convertirá en un gateway interno y genérico
de conectores. Ejecutará una acción ya autorizada y buscará su adaptador en un
registro de release; no tendrá rutas, tipos ni nombres de aseguradoras.

### Catálogo de release

Un catálogo de release, separado de los paquetes base de la plataforma,
describirá las contribuciones first-party disponibles: manifiestos de solución,
manifiestos de extensión, acciones, adaptadores de conectores, pantallas React y
herramientas MCP de solo lectura. Los hosts consumirán ese catálogo mediante
interfaces genéricas. Una prueba de frontera permitirá que el catálogo nombre
Seguros, pero impedirá importaciones de Seguros desde los hosts del núcleo.

### Solución Seguros

`savia.insurance` declarará Clientes, Aseguradoras, Cotizaciones, Pólizas,
Pagos y Siniestros mediante el contrato de soluciones existente. Requerirá la
extensión `insurance.quotes`, que aportará:

- formularios de conexión por proveedor;
- acciones de cotización y sus esquemas de entrada y salida;
- adaptadores para cada aseguradora;
- normalización y pantalla de resultados;
- ninguna acción MCP de escritura: la cotización se inicia desde una sesión de
  usuario autorizada en la interfaz.

La extensión de cartera de pólizas dejará de depender de `insurance.legacy` y
pasará a depender de los requisitos de objetos que realmente necesite. Su
resumen MCP de solo lectura se registrará mediante el catálogo genérico.

## Datos y seguridad

El núcleo persistirá conexiones y ejecuciones con modelos neutrales:

- `extension_connections`: `tenant_id`, `extension_id`, `connector_id`, estado y
  configuración cifrada.
- `extension_action_runs`: `tenant_id`, `extension_id`, `action_id`,
  `connection_id`, entrada y salida sanitizadas, estado, código público de error
  y marcas de tiempo.

Las credenciales solo se descifran dentro del gateway genérico para una ejecución
autorizada. La API no vuelve a enviar los valores guardados al navegador. La
extensión recibe una capacidad acotada del host, no una base de datos, un secreto
ni un selector de tenant libre.

## Flujo de producto

1. Un administrador instala `savia.insurance` desde Paquetes de soluciones.
2. El instalador crea las colecciones y habilita `insurance.quotes`; no crea
   proveedores ni credenciales predeterminadas.
3. El administrador configura una conexión, por ejemplo una aseguradora y ramo.
   La extensión define el formulario; el host guarda la configuración cifrada
   para ese tenant y esa extensión.
4. El usuario crea una cotización e invoca la acción aportada por la extensión.
5. El host valida sesión, membresía, permisos e instalación, y delega la
   ejecución al gateway genérico.
6. El adaptador de Seguros llama al proveedor, normaliza la respuesta y el host
   guarda la ejecución. La extensión presenta el resultado sin que el núcleo
   interprete su contenido.
7. Si la solución o extensión se desactiva, solo desaparecen sus acciones,
   pantallas y acceso a sus registros; los demás módulos del tenant continúan
   funcionando.

## Migración de código y estado local

La clasificación inicial determinará qué módulos de `apps/legacy-api` son
genéricos y deben reubicarse en API o paquetes compartidos, y cuáles pertenecen
exclusivamente a Seguros. No se eliminará ese directorio por nombre: se retirará
únicamente cuando no conserve consumidores genéricos.

El código de resultados de seguro, rutas `/v1/insurance-results`, clientes de
Admin, proxy `/legacy-api`, dependencia `insurance.legacy` y referencias de
agencia que solo existan por Seguros se sustituirán por los contratos de
extensión. Los procesos genéricos conservarán sus nombres de plataforma y sus
propias pruebas.

Al llegar al corte, se recreará exclusivamente el estado local generado de
Savia y se aplicarán las semillas nuevas. No se borrarán secretos locales,
fuentes PostgreSQL ni archivos del repositorio. La operación no forma parte de
este diseño ni se ejecuta sin estar incluida explícitamente en el plan aprobado.

## Verificación

La implementación debe demostrar, con pruebas unitarias, de contrato y de
frontera, que:

- el núcleo compila y se inicia sin Seguros instalado ni rutas específicas;
- un tenant nuevo puede instalar la solución, configurar un proveedor de prueba,
  cotizar y ver un resultado normalizado;
- errores de proveedor no revelan configuración ni credenciales;
- desactivar la solución bloquea únicamente sus capacidades;
- Admin, API, MCP y gateway genérico no importan módulos de Seguros fuera del
  catálogo de release;
- el núcleo y la solución tienen typecheck y pruebas ejecutables de manera
  independiente.

La verificación visual local cubrirá el estado sin solución, instalación,
configuración de conexión, ejecución exitosa y estado desactivado.

## Fuera de alcance

- migrar datos o mantener compatibilidad con endpoints legados;
- desplegar a remoto o hacer push;
- permitir extensiones de terceros sin revisión, firma y sandbox;
- cambiar el modelo de pertenencia tenant–usuario ya aprobado.
