# Bundle de Savia Request para Seguros

## Objetivo

El paquete `savia.insurance` debe entregar el cotizador de autos livianos como
una solución completa: los flows de Savia Request que necesita, la consulta de
placa y una comparación de las cotizaciones que se ejecutan en conjunto. El
paquete no almacena ni desplaza secretos de proveedores.

## Bundle incluido

El bundle se deriva de la colección versionada bajo
`06-Cotizaciones/Autos-livianos/` y contiene sus 18 flows con IDs fijos:

- 15 flows de cotización de Equidad, Liberty, Mapfre, Qualitas y SBS.
- `sura-autos-provider` como consulta de placa predeterminada.
- `equidad-vehicle-by-plate` como alternativa instalada pero desactivada por
  defecto hasta que exista una evidencia válida de su contrato.
- `liberty-get-oauth-token` como dependencia interna de los flows Liberty; no
  aparece como producto seleccionable.

La instalación es idempotente: asegura que las definiciones canónicas estén
disponibles en Savia Request y registra su versión de bundle, pero conserva las
variables del usuario y nunca modifica secretos. Los certificados PFX externos
no forman parte del bundle ni se leen durante la instalación.

## Límites y contratos

Se incorpora un adaptador privado, con allowlist de los IDs anteriores, entre
el gateway de conectores y Savia Request. Las pantallas y los clientes nunca
envían una ruta, colección o secreto arbitrario. Cada ejecución sigue creando
su propia auditoría en `extension_action_runs`; el adaptador conserva el
resultado normalizado o un error seguro por flow.

La configuración del paquete guarda qué productos están habilitados y qué
lookup usar. Las credenciales viven exclusivamente como variables secretas de
Savia Request. En modo real, una variable ausente produce un estado de
configuración claro para ese flow, sin impedir que los otros terminen. En modo
simulación, los flows usan las respuestas simuladas de Savia Request y no
requieren credenciales.

## Flujo de usuario

`Consultar placa` ejecuta el flow Sura con la placa normalizada y aplica los
campos de vehículo devueltos. La alternativa Equidad no se utiliza salvo que un
administrador la habilite explícitamente.

Una cotización selecciona inicialmente los 15 productos de cotización
habilitados y los ejecuta en paralelo. Las respuestas de ese lote se abren en
el explorador de resultados ya marcadas para comparar; fallos individuales se
presentan junto a los éxitos. El historial anterior sigue disponible, pero no
se mezcla automáticamente con la comparación del lote nuevo.

## Validación local

La primera entrega se valida sin llamadas reales:

1. Instalar o actualizar `savia.insurance` asegura el bundle local.
2. Ejecutar la consulta de placa Sura en simulación completa los campos del
   formulario.
3. Ejecutar la cotización simulada dispara todos los productos habilitados y
   abre la comparación del lote.
4. Las pruebas cubren allowlist, conservación de secretos, input mapping,
   fallos parciales y la comparación agrupada.
