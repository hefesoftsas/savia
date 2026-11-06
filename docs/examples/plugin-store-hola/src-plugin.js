/**
 * Ejemplo mínimo de plugin del store (sin build: este archivo YA es
 * dist/plugin.js, cópialo a dist/ y comprímelo con el manifiesto).
 *
 * Contrato:
 * - Debe exportar `render(element, savia)`.
 * - `savia.collections.list()` → colecciones visibles del tenant y usuario.
 * - `savia.collections.collection(name)` → { list, get, create, update,
 *   remove, describe } con los mismos permisos que el usuario actual.
 * - Prohibido: fetch/XMLHttpRequest/WebSocket directos, eval, require,
 *   imports externos, localStorage, acceso a D1/tokens/otros tenants.
 *   El host rechaza el ZIP si detecta estos patrones.
 */

export async function render(el, savia) {
  el.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Hola plugin";
  const status = document.createElement("p");
  status.textContent = "Cargando colecciones…";
  const list = document.createElement("ul");
  el.append(title, status, list);

  try {
    const collections = await savia.collections.list();
    status.textContent =
      collections.length === 0
        ? "Este espacio aún no tiene colecciones."
        : `Colecciones visibles: ${collections.length}`;
    for (const collection of collections.slice(0, 20)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${collection.label ?? collection.name} (${collection.name})`;
      button.addEventListener("click", async () => {
        const api = savia.collections.collection(collection.name);
        const page = await api.list({ page: 1, perPage: 5 });
        status.textContent =
          `«${collection.name}»: ${page.total} registro(s), ` +
          `mostrando ${page.data.length}. Revisa la consola para el detalle.`;
        console.log(`[${collection.name}]`, page.data);
      });
      item.append(button);
      list.append(item);
    }
  } catch (error) {
    status.textContent = `No se pudo cargar: ${error?.message ?? error}`;
  }
}
