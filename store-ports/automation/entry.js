/**
 * Plugin solo-datos: no aporta pantalla. Los bundles de `store.json`
 * aparecen en el catálogo de automatizaciones al instalarse.
 */
export function render(el) {
  el.textContent = "";
  const note = document.createElement("p");
  note.textContent =
    "Operación conectada: plantillas disponibles en Automatizaciones.";
  el.append(note);
}
