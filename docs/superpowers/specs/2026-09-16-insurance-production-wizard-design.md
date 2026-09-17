# Cotizador de Seguros equivalente al flujo de producción

## Objetivo

Restaurar dentro del paquete opcional `savia.insurance` el cotizador de autos livianos de producción, sin recuperar dependencias de Savia Request ni acoplar conceptos de Seguros al núcleo de Savia.

Habrá un único asistente canónico de tres pasos. Las entradas **Cotizador** y **Cotizador por pasos** abren ese mismo flujo para impedir que existan dos formularios, validaciones o resultados que se desalineen.

La referencia de producción se consultó sólo en lectura. No se cambiará, probará ni llamará a proveedores desde producción. El trabajo será local y no hará push.

## Comportamiento que se recupera

1. Encabezado, subtítulo “Cotiza auto liviano en tres pasos”, modo compacto y botón **Actualizar resultados** con tooltip.
2. Pestañas **Preparar cotización** y **Resultados**, con contador cuando existan ejecuciones.
3. Selector desplegable con el resumen “Cotizar con N productos”.
4. Navegación accesible de tres pasos: **Vehículo**, **Solicitante y conductor**, y **Contacto y cotización**.
5. Consulta de placa explícita y validación de cada paso antes de avanzar.
6. Ejecución sólo al completar el tercer paso; un fallo de un producto no elimina las respuestas correctas de otros productos.

El formulario canónico contiene los campos del cotizador histórico:

```ts
type AutoLightQuoteInput = {
  vehicle: {
    plate: string; fasecoldaCode: string; productionYear: number;
    isNew: boolean; circulationCity: string; accessoriesValue: number;
    declaredValue: number;
  };
  applicant: {
    documentType: string; documentNumber: string; firstName: string;
    surname: string; secondSurname?: string; gender: string; birthDate: string;
    city: string; address: string; phone: string; email: string;
  };
};
```

Los valores iniciales son CC, vehículo nuevo No y accesorios 0. La placa se normaliza a mayúsculas; año y montos se validan; correo y campos obligatorios se corrigen en el paso correspondiente. Cambiar placa limpia los datos que provengan de una consulta anterior.

## Diseño y límites de paquetes

Las pantallas del paquete se separan en `quote-wizard.tsx` (estado, pasos, productos y ejecución), `quote-input.ts` (tipos y validación), `quote-results.tsx` (resultados) y `quote-screens.tsx` (carga y composición). `cotizador` y `cotizador_por_pasos` delegan en el mismo componente y no usan `/savia-request`.

La interfaz usa navegación, formularios y errores semánticos. La información secundaria como el significado de Actualizar resultados y del modo Real se muestra mediante tooltips, en vez de añadir texto persistente.

El catálogo del paquete conserva Autos Producto 8, Autos Gold y Autos Plata. Cada producto define internamente proveedor y `operationId`; el tenant sólo decide visibilidad, orden y conexión. No puede introducir IDs de operación, endpoints ni plantillas arbitrarias.

**Administrar Seguros** permite activar las dos entradas, activar y ordenar productos, asociarlos a resúmenes de conexión, configurar la consulta de placa y crear, actualizar o retirar conexiones por sus campos declarados. Los secretos se mandan al host una sola vez y nunca se vuelven a renderizar.

La configuración mantiene su versión y aislamiento por `(tenantId, extensionId)`. Actualizar el paquete conserva las preferencias existentes.

## Ejecución, simulación e historial

La pantalla ejecuta `insurance.quotes/quote` con el formulario canónico, el producto y su conexión a través de `savia.actions.execute`. La consulta de placa usa esa misma acción con `sura-vehicle-by-plate`, y sólo aplica una respuesta que coincida con la placa vigente.

El selector de modo conserva la semántica de producción: **Real** es inicial y sólo llama un proveedor después de una configuración explícita; cambiar a Real desde Simulación exige confirmación. **Simulación** ejecuta una respuesta determinista del paquete, la audita y la etiqueta, sin HTTP externo ni credenciales de proveedor.

Cada respuesta muestra estado, prima, referencia, coberturas y detalle técnico saneado. Regresar a Preparar cotización conserva el formulario y no crea un registro comercial en `cotizaciones`.

Para que Actualizar resultados funcione igual que en producción, el runtime incorpora el listado genérico y aislado de ejecuciones propias:

```ts
type PluginExtensionActionRun = {
  runId: string;
  actionId: string;
  connectionId: string;
  status: "pending" | "succeeded" | "failed" | "expired";
  output: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

actions.list(options?: { limit?: number }): Promise<PluginExtensionActionRun[]>;
```

La ruta filtra siempre por tenant y extensión. Devuelve sólo salida ya saneada y metadatos: nunca credenciales ni entrada del formulario. Resultados se recarga al abrir su pestaña, al pulsar Actualizar y mientras haya pendientes.

## Seguridad y verificación

- El núcleo sólo aprende a listar ejecuciones de una extensión; no conoce vehículos, aseguradoras ni cotizaciones.
- Credenciales cifradas y respuestas saneadas siguen usando el almacenamiento actual. La simulación no lee secretos ni realiza red.
- No se migran registros de Savia Request ni se duplican pantallas de una sola página. Las rutas `cotizador`, `cotizador_por_pasos` y `administrar_seguros` se preservan.
- Las pruebas cubren validación de formulario, pasos, productos, resultados parciales, refresco, simulación, aislamiento de ejecuciones y ausencia de secretos. Sólo usan APIs y `fetch` simulados.
- La comprobación visual será local y cubre tres pasos, resultados, estado sin conexión y administración. No se configurará ni invocará proveedor real.

## Revisión propia

- Cubre las diferencias observadas: tres pasos, productos, modo, resultados y actualización de historial.
- Mantiene todo el dominio de Seguros dentro del paquete; el cambio de núcleo es genérico y queda acotado a la extensión solicitante.
- El Cotizador directo reutiliza el mismo componente y la administración conserva las opciones por tenant ya existentes.
- La prueba local será determinista y no tocará credenciales, producción ni sistemas externos.
