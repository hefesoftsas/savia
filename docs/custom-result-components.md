# Componentes personalizados de resultados

En Campos y formulario → Ajustes → Resultados, selecciona React personalizado.
Editar React abre Monaco. El componente se exporta por defecto y recibe
`ResultsProps`. El panel Propiedades disponibles muestra el contexto y las rutas
de los campos configurados. Aplicar cambios actualiza el borrador; Publicar guarda
`resultLayout` y `resultReact` en los metadatos del backend.

```tsx
export default function Results({ rows, columns, disabled, load }: ResultsProps) {
  return <div>{rows.map(row => <article key={row.id}>
    <h2>{row.title}</h2>
    <p>{row.status}</p>
    <button disabled={disabled} onClick={() => load(row.id)}>Cargar datos</button>
  </article>)}</div>;
}
```

- `rows`: id, title, status, date, simulation, values, errors, response.
- `columns`: label, pointer, format. `row.values[i]` es el valor formateado de
  `columns[i]`. `response` conserva la respuesta y su estructura depende de la operación.
- `disabled`: impide cargar datos durante una ejecución o en la vista previa.
- `load(id)`: carga el formulario; no ejecuta una operación externa.
- `React`: global; también se admite importar desde `react`.

La vista previa utiliza datos de ejemplo. JSX/TSX se transpila en el iframe,
no en la ventana de Savia. React, ReactDOM y TypeScript se empaquetan localmente
mediante el plugin Vite; el runtime se carga bajo demanda. El iframe permite
scripts pero no acceso al origen de la aplicación, red ni importaciones externas.
Los mensajes de acciones se validan contra la ventana del iframe y los IDs de
resultados visibles. Los errores de sintaxis y renderizado se muestran dentro de
la superficie. Los archivos HTML y React se conservan independientemente al
cambiar de presentación.
