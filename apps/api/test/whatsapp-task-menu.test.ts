import { expect, it } from "vitest";
import { isMainMenuCommand, buildTaskMenu } from "../src/whatsapp/task-menu";

it("recognizes complete navigation commands without intercepting normal sentences", () => {
  expect(isMainMenuCommand(" MENÚ ")).toBe(true);
  expect(isMainMenuCommand("Inicio")).toBe(true);
  expect(isMainMenuCommand("quiero consultar el menu de seguros")).toBe(false);
});
it("paginates task labels within Meta limits without exposing employee names", () => {
  const tasks = Array.from({ length: 21 }, (_, i) => ({
    id: `task-${i}`,
    employeeId: `employee-${i}`,
    title: `Consultar ${i}`,
    description: "Purpose",
    order: i,
    audiences: ["external"] as const,
  }));
  const first = buildTaskMenu(
    { id: "menu-token", tasks: tasks as any, page: 0 },
    true,
  );
  expect(first).toMatchObject({ kind: "list", buttonLabel: "Elegir tarea" });
  expect((first as any).options).toHaveLength(10);
  expect(JSON.stringify(first)).not.toContain("employee-");
  expect(
    buildTaskMenu({ id: "menu-token", tasks: tasks as any, page: 2 }, false),
  ).toContain("Consultar 20");
});
