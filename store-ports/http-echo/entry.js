/**
 * Demo de conector http: ejecuta la acción `eco` contra la conexión
 * configurada y muestra la respuesta redactada.
 */
export async function render(el, savia) {
  el.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Eco HTTP";
  const status = document.createElement("p");
  status.textContent = "Listo.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Probar eco";
  const out = document.createElement("pre");
  button.addEventListener("click", async () => {
    status.textContent = "Llamando…";
    try {
      const connections = await savia.connections.list();
      const first = connections[0];
      if (!first) {
        status.textContent = "Configura primero la conexión demo.";
        return;
      }
      const result = await savia.actions.execute("eco", {
        connectionId: first.connectionId,
        input: { mensaje: "hola" },
      });
      out.textContent = JSON.stringify(result.output, null, 2);
      status.textContent = "OK.";
    } catch (error) {
      status.textContent = `Error: ${error?.message ?? error}`;
    }
  });
  el.append(title, status, button, out);
}
