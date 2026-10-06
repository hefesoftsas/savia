import type { ChannelMenu } from "./channel-contracts";
import type { NativeReply } from "./native";

export function isMainMenuCommand(text: string): boolean {
  return ["menu", "inicio"].includes(
    text
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
}

export function menuOptions(menu: ChannelMenu) {
  const pages = Math.max(1, Math.ceil(menu.tasks.length / 9));
  const page = Math.max(0, Math.min(menu.page, pages - 1));
  const options = menu.tasks
    .slice(page * 9, page * 9 + 9)
    .map((t, index) => ({
      id: `${menu.id}:${page * 9 + index}`,
      title: t.title,
      ...(t.description ? { description: t.description } : {}),
    }));
  if (pages > 1)
    options.push({
      id: `${menu.id}:page:${(page + 1) % pages}`,
      title: page + 1 === pages ? "Primeras opciones" : "Más opciones",
    });
  return options;
}

export function buildTaskMenu(
  menu: ChannelMenu,
  nativeLists: boolean,
): NativeReply | string {
  if (!menu.tasks.length)
    return "No hay tareas disponibles para tu número en este momento.";
  const text =
    "¿Qué deseas hacer? Escribe menú o inicio para volver aquí en cualquier momento.";
  const options = menuOptions(menu);
  return nativeLists
    ? { kind: "list", text, buttonLabel: "Elegir tarea", options }
    : `${text}\n\n${options.map((o, i) => `${i + 1}. ${o.title}`).join("\n")}\n\nResponde con el número de la opción.`;
}
