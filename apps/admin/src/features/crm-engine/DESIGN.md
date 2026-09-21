---
name: Savia CRM Studio
description: Un espacio comercial claro con captura guiada y revisión editable.
colors:
  primary: "#285841"
  background: "#ffffff"
  foreground: "#26382e"
  canvas: "#f9faf7"
  border: "#e1e6df"
  input: "#dce2da"
  muted: "#f2f4ee"
  muted-foreground: "#69736b"
  accent: "#edf2e9"
  ring: "#72947e"
  conversation-surface: "#fbfcf9"
  conversation-ink: "#244431"
  conversation-soft: "#5c6e61"
  shadow-ink: "rgb(15 50 65)"
  neutral-shadow: "rgba(0, 0, 0, 0.12)"
  sage-line: "#cfd8ce"
  sage-strong: "#8a968d"
  sage-ink: "#556258"
  sage-deep: "#49544c"
  sage-night: "#3b4d41"
  success-surface: "#f0fdf4"
  success-ink: "#166534"
  success-border: "#bbf7d0"
  info-surface: "#eff6ff"
  info-ink: "#1e40af"
  info-border: "#bfdbfe"
  warning-surface: "#fff4ce"
  warning-ink: "#8a6900"
  warning-strong: "#b45309"
  warning-accent: "#fbbf24"
  danger-ink: "#be0037"
  danger-strong: "#a00020"
  olive-line: "#8c906d"
  olive-ink: "#817249"
  olive-strong: "#937c44"
  olive-deep: "#7d672f"
  lilac-surface: "#f5f3f8"
  lilac-mid: "#8a6d88"
  lilac-ink: "#775874"
  graphite-bright: "#666666"
  graphite-mid: "#595963"
  graphite-zinc: "#52525b"
  graphite-rule: "#d4d4d4"
  graphite-ink: "#20212a"
  graphite-night: "#1e1e1e"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-1px"
  question:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(25px, 3vw, 36px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-0.3px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
  scale:
    micro: "10px"
    caption: "11px"
    dense: "13px"
    body-lg: "15px"
    ui: "16px"
    ui-lg: "17px"
    subtitle: "19px"
    section: "20px"
    section-lg: "21px"
    answer: "22px"
    display-sm: "24px"
    metric: "26px"
    metric-lg: "27px"
    question-mobile: "28px"
    display-lg: "30px"
rounded:
  hairline: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  2xl: "12px"
  tile: "14px"
  sheet: "20px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "36px"
  input:
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "4px 12px"
  conversation-input:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  conversation-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "12px 22px"
  opportunity-card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "15px"
---

# Design System: Savia CRM Studio

## Overview

**Creative North Star: "Espacio de trabajo claro"**

Savia CRM Studio conserva el modo Operate: componentes shadcn y shadcn-admin-kit, tipografía sans del sistema, verde bosque para acciones, fondos cálidos y bordes sutiles. La navegación lateral compacta, la cabecera editorial, las tablas legibles y el pipeline horizontal sostienen el trabajo comercial en español. Los estados de persistencia y la identificación de datos de demostración forman parte de la interfaz.

La captura de una pregunta por pantalla amplía este mismo lenguaje. Una pregunta dominante, un control amplio y una acción principal organizan la atención; el contexto del objeto y el progreso quedan en segundo plano. La revisión conserva las respuestas visibles y editables antes del guardado. Esta variante local, inspirada en la interacción de Typeform, convive con los formularios agrupados por paso y con el diseñador a ancho completo.

**Key Characteristics:**

- Bosque y salvia sobre superficies claras y cálidas.
- Densidad compacta para operar; mayor espacio para responder.
- Progreso discreto, corrección explícita y persistencia visible.
- Componentes compartidos con estados de teclado y adaptación móvil.

## Colors

La paleta combina un acento verde bosque con neutros cálidos matizados de salvia; los tokens del frontmatter son normativos.

### Primary

- **Verde bosque** (`primary`): acción principal, confirmación y avance del progreso; también identifica los controles seleccionados de la captura.
- **Salvia de interacción** (`accent`, `ring`): fondos de hover de controles compartidos y foco visible.

### Neutral

- **Lienzo cálido** (`canvas`) y **superficie blanca** (`background`): distinguen el espacio de trabajo de sus contenedores y controles.
- **Tinta vegetal** (`foreground`) y **texto secundario** (`muted-foreground`): establecen jerarquía sin introducir otra familia cromática.
- **Superficie tenue** (`muted`), **borde suave** (`border`) y **borde de campo** (`input`): separan contenido y controles con líneas finas.
- **Papel de captura** (`conversation-surface`), **tinta de captura** (`conversation-ink`) y **apoyo de captura** (`conversation-soft`): variante local compartida por preguntas, instrucciones y revisión.

Las etapas del pipeline mantienen sus matices semánticos suaves. Los errores usan rojo terroso y texto explicativo. Estas diferencias de estado no sustituyen el verde de las acciones principales.

**The Estado explícito Rule.** La selección de una respuesta combina fondo, borde y marca de verificación; el error combina color y mensaje legible.

## Typography

**Display Font / Body Font:** sans del sistema, con la pila registrada en el frontmatter. **Label/Mono Font:** la misma sans para etiquetas; monospace del sistema para código y operaciones técnicas existentes.

La cabecera del CRM aporta jerarquía editorial a una superficie compacta. La captura amplía la pregunta y la respuesta, mientras reserva tamaños menores para sección, contador y ayudas.

### Hierarchy

- **Headline:** título de página; en pantallas menores se reduce según el espacio de la cabecera.
- **Question:** pregunta activa y título de revisión; texto equilibrado, con salto de palabras largas. En el breakpoint móvil de captura se fija en (28px).
- **Title:** encabezados de bloques del CRM.
- **Body:** párrafos generales. Las instrucciones de captura aumentan a (15px), con interlínea (1.65) y longitud máxima (55ch); en móvil vuelven a (14px).
- **Label:** etiquetas de campos y contexto de captura. Las respuestas de revisión son mayores (16px) y conservan los saltos de línea.

Además de los roles nombrados, la superficie compacta del Studio usa la rampa densa del frontmatter (`scale`): 10px para micro-etiquetas y contadores, 11px para leyendas de tabla y chips, 13px para texto denso de diseñador y listas, y 15–17px para títulos intermedios. Los pasos 19–30px quedan reservados a métricas, cabeceras de resultado y preguntas móviles. Ninguna superficie nueva debe introducir tamaños fuera de esta rampa; 8px y 9px se elevaron a 10px como suelo de legibilidad.

**The Pregunta dominante Rule.** En la captura conversacional, el encabezado de la pregunta tiene mayor jerarquía que el nombre del objeto, la sección y el contador.

## Layout

El CRM conserva navegación lateral fija (246px), cabecera horizontal y contenido flexible. La barra lateral se estrecha en el breakpoint intermedio (1100px) y se abre como panel con fondo superpuesto en móvil (760px). Las tablas y el pipeline mantienen desplazamiento horizontal; las herramientas y acciones se reorganizan en varias líneas cuando es necesario. En pantallas amplias (1500px) aumenta el espacio del contenido.

La dirección anterior describía formularios en panel lateral. La implementación actual abre la creación y edición en un diálogo; se documenta esta materialización conservando la navegación y el diseñador existentes. El diálogo conversacional y la vista previa comparten un límite de ancho (940px); el cuerpo de preguntas se centra en una columna más estrecha (670px). El contador precede una barra de progreso fina (3px), seguida por pregunta, ayuda, control y acciones. El espaciado usa los intervalos recurrentes del frontmatter sin exigir una retícula rígida a todas las superficies.

En móvil de captura (600px), el diálogo ocupa el viewport completo, elimina sus esquinas exteriores y permite desplazamiento vertical. El cuerpo usa márgenes interiores amplios, la acción principal llena su contenedor, los controles admiten etiquetas multilínea y las pistas de teclado se ocultan. El editor de pasos pasa de dos columnas a una en ese mismo breakpoint.

## Elevation & Depth

La profundidad se apoya principalmente en fondos tonales, bordes finos y espacio. Las tarjetas del pipeline conservan una sombra leve; controles compartidos y diálogos mantienen la elevación propia de shadcn. Los campos y opciones conversacionales suprimen su sombra exterior: la selección se refuerza con un trazo interior.

### Shadow Vocabulary

- **Tarjeta de oportunidad:** `0 2px 5px #36452d09`, separación leve dentro del pipeline.
- **Segmento activo:** `0 1px 3px #26382e10`, distingue el selector activo de su bandeja tonal.
- **Lista emergente:** `0 5px 20px #26382e15`, separa opciones del contenido de fondo.

## Shapes

Esquinas suavemente redondeadas en controles y tarjetas, bordes finos y figuras circulares para avatares e indicadores. La escala completa del frontmatter (`hairline` 2px para correcciones `calc(var(--radius) - 2px)`, sm 4 / md 6 / lg 8 para controles, xl 10 / 2xl 12 para tarjetas y paneles, tile 14 y sheet 20 para superficies amplias, pill 999px para chips, barras de progreso e indicadores) es la única fuente de radios; los valores 3, 5, 7 y 9px se normalizaron a los pasos pares de esta escala. La escala compartida convive con los radios heredados de shadcn; sus controles medianos resuelven el radio base menos dos píxeles. La captura repite esquinas de la escala grande en campos, opciones y acción principal; las marcas numéricas y la etiqueta opcional usan la escala pequeña. El contenedor móvil de captura llega a los bordes del viewport sin radio exterior.

Los colores del frontmatter más allá de la paleta base son tokens normativos de estado: superficies y bordes de éxito, info y aviso, tintes olivo y lila para categorías de configuración, la escala salve de acentos secundarios, la escala grafito para texto técnico y ejemplos de resultado, y `shadow-ink`/`neutral-shadow` para sombras y veladuras.

## Components

### Buttons

Controles reconocibles de shadcn: acción primaria verde con texto blanco, alternativa delineada y acciones ghost. Hover tonal, foco visible, estado deshabilitado y agrupación con iconos mantienen su comportamiento compartido. Las transiciones de fondo y texto duran (160ms).

En captura, la acción principal tiene altura mínima (48px), texto mayor y padding propio; Atrás conserva menor peso visual. El rótulo refleja el siguiente destino: Continuar, Revisar respuestas, Volver a la revisión o guardar. Durante el guardado se muestra Guardando… con indicador de actividad.

### Chips

Las etapas comerciales usan etiquetas de fondo tenue, texto contrastado y punto del mismo color. Los indicadores de demostración siguen siendo visibles. En captura, Opcional es una etiqueta discreta junto a la sección; no sustituye las instrucciones del campo.

### Cards / Containers

Tarjetas blancas de oportunidad sobre columnas salvia, esquinas suaves y sombra leve. Las tablas usan borde y separadores de fila. El diseñador mantiene su superficie amplia y sus controles de configuración; la captura reduce el número de elementos simultáneos dentro de su propio contenedor.

### Inputs / Fields

El CRM utiliza los campos compartidos de shadcn y sus variantes de formulario. La captura amplía los campos de texto con altura mínima (60px), tamaño de respuesta (22px) y superficie blanca; los textos multilínea admiten redimensionado vertical. En móvil, los inputs directos bajan a una altura mínima (56px) y tamaño (20px). Los campos de relación conservan búsqueda y selección propias.

El foco de los campos de captura combina borde verde y contorno de dos píxeles separado del control. Los errores aparecen junto al campo. Una selección simple sin relación se presenta como opciones anchas con índice, etiqueta y marca visible al seleccionar; admite flechas, Inicio y Fin sin avanzar automáticamente.

### Navigation

La navegación lateral usa iconos de trazo, etiquetas compactas y un fondo salvia más fuerte para la sección activa. Los tabs subrayan la vista seleccionada. En móvil, el menú lateral se abre desde la cabecera. El avance conversacional usa contador y barra; los formularios agrupados mantienen su navegación de pasos.

### Captura y revisión

**The Revisión antes de guardar Rule.** La captura conversacional presenta una pregunta editable a la vez y termina en una revisión agrupada por sección. Cada respuesta editable tiene una acción Cambiar; la corrección vuelve a la revisión. El guardado ocurre desde esa revisión.

Las respuestas vacías se identifican como Sin completar. Las relaciones muestran sus nombres, las opciones sus etiquetas y los importes su formato local. Los campos calculados o de solo lectura se muestran en el resumen sin acción de cambio. Ante validación fallida se vuelve a la respuesta que necesita atención; los fallos de guardado mantienen el contexto y muestran el mensaje. El CRM cierra el diálogo y muestra confirmación tras guardar; la vista previa puede mostrar la confirmación dentro del componente.

El foco acompaña la pregunta o el control activo. Enter continúa en texto simple; en texto multilínea se reserva Ctrl/⌘ + Enter. La llegada de una pregunta desplaza suavemente el contenido (240ms) y el progreso cambia con (280ms); ambos efectos se desactivan con preferencia de movimiento reducido.

## Do's and Don'ts

### Do:

- **Do** conservar componentes shadcn, verde bosque y fondos cálidos al extender el CRM.
- **Do** reservar la mayor jerarquía de la captura para la pregunta y su control.
- **Do** mantener progreso, selección, errores y confirmación de guardado explícitos.
- **Do** ofrecer corrección desde la revisión antes de guardar las respuestas juntas.
- **Do** conservar foco visible, navegación por teclado y adaptación a movimiento reducido.

### Don't:

- **Don't** extender la densidad amplia de la captura a todas las tablas y herramientas del CRM.
- **Don't** eliminar la presentación de campos agrupados por paso al usar la variante conversacional.
- **Don't** comunicar selección o error únicamente con color.
- **Don't** usar una confirmación de guardado para representar un simple avance de pregunta.
