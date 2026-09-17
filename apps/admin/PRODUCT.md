# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Usuarios autenticados de agencias de seguros que consultan vehículos, solicitan
cotizaciones, comparan opciones y actualizan datos para sus clientes. Los
administradores de plataforma también pueden operar y consultar información
entre agencias.

## Product Purpose

Savia concentra la operación de agencias de seguros. El cotizador de autos
livianos reduce el trabajo de pedir cotizaciones a varias aseguradoras, y el
asistente permite consultar datos vigentes o preparar cambios para confirmar.

## Positioning

El cotizador persiste cada intención y oferta antes de ejecutar un proveedor.
El asistente usa el mismo catálogo MCP que la API de dominio y prepara cambios
que el mismo usuario debe confirmar explícitamente.

## Operating Context

El usuario trabaja dentro del panel administrativo, elige su agencia cuando
aplica, consulta una placa y completa datos de vehículo, tomador, conductor y
cobertura. Equidad es la fuente primaria de vehículo y Sura es el respaldo.
Las solicitudes se agrupan por agencia; las ofertas pueden quedar pendientes,
en progreso, exitosas o fallidas y se comparan cuando sus datos están
normalizados. La barra del asistente está disponible en todas las pantallas
autenticadas.

## Capabilities and Constraints

- Ocho aseguradoras están habilitadas para autos livianos: Allianz, Bolívar,
  Equidad, HDI, Liberty, Mapfre, SBS y Zurich.
- La aplicación web y la API manejan únicamente datos canónicos. Las
  plantillas y credenciales de proveedor permanecen en el gateway interno.
- No se emiten pólizas ni se realizan reintentos automáticos. Un reintento
  visible crea un intento nuevo.
- Todos los usuarios autenticados con membresía activa pueden usar el recurso
  dentro de su agencia; los administradores de plataforma tienen visibilidad
  global.
- Las lecturas del asistente se ejecutan de inmediato por FastMCP; los cambios
  quedan como propuestas de vigencia limitada y exigen confirmación explícita.
- El access token y las credenciales de OpenRouter permanecen fuera del
  almacenamiento persistente del navegador.

## Brand Commitments

Savia conserva el panel administrativo existente: voz directa y operativa,
interfaz clara de trabajo, temas configurables y componentes compartidos de
React Admin y shadcn.

## Evidence on Hand

Las respuestas, estados y datos normalizados se obtienen de la API de Savia.
No hay imágenes, resultados reales de aseguradoras ni credenciales que la
interfaz pueda fabricar o mostrar.

## Product Principles

- Guardar antes de ejecutar para que el asesor nunca pierda una solicitud.
- Hacer visible el estado de cada aseguradora y de la solicitud completa.
- Comparar solo lo que un proveedor respondió de forma inequívoca.
- Mantener la agencia y la información del cliente dentro de su alcance.
- Hacer visibles las consecuencias antes de ejecutar un cambio con asistencia.

## Accessibility & Inclusion

El asistente y el cotizador deben ser navegables por teclado, conservar foco
visible y adaptarse a pantallas móviles.
