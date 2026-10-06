import type { WhatsappInboundInput } from "./inbound-contracts";
import type { ContactAccess, EmployeeSession } from "./channel-contracts";
import type { NativeReply } from "./native";
import { WhatsappChannelRepository } from "./channel-repository";
import { buildTaskMenu, isMainMenuCommand, menuOptions } from "./task-menu";

type Routed =
  | { kind: "reply"; reply: NativeReply | string }
  | { kind: "employee"; session: EmployeeSession; text: string };
export async function routeEmployeeInput(
  access: ContactAccess,
  input: WhatsappInboundInput,
  repository: WhatsappChannelRepository,
  nativeLists = false,
): Promise<Routed> {
  const show = async (page = 0): Promise<Routed> => ({
    kind: "reply",
    reply: buildTaskMenu(await repository.issueMenu(access, page), nativeLists),
  });
  if (isMainMenuCommand(input.text)) {
    await repository.returnToMenu(access);
    return show();
  }
  let session = await repository.getSession(access);
  if (session) return { kind: "employee", session, text: input.text };
  const menu = await repository.menu(access);
  let option = input.native?.kind === "choice" ? input.native.id : undefined;
  if (!option && menu && /^\d{1,2}$/.test(input.text.trim()))
    option = menuOptions(menu)[Number(input.text.trim()) - 1]?.id;
  if (option) {
    if (!menu || !menuOptions(menu).some((o) => o.id === option)) return show();
    const parts = option.split(":");
    if (parts[1] === "page") return show(Number(parts[2]));
    const task = menu.tasks[Number(parts[1])];
    session = task
      ? await repository.selectTask(access, task.id, menu.id)
      : null;
    if (!session) return show();
    const buffered = await repository.takeBuffer(access);
    return {
      kind: "employee",
      session,
      text:
        buffered ?? "Presenta brevemente cómo puedes ayudarme con esta tarea.",
    };
  }
  const tasks = await repository.listTasks(access);
  if (tasks.length === 1 && !menu) {
    const issued = await repository.issueMenu(access);
    session = await repository.selectTask(access, tasks[0].id, issued.id);
    if (session) return { kind: "employee", session, text: input.text };
  }
  if (!menu && input.native?.kind !== "choice")
    await repository.buffer(access, input.text);
  return show();
}
