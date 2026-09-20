import userEvent from "@testing-library/user-event";
import { cleanup, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
import { afterEach, expect, it, vi } from "vitest";
import { makeConfig } from "@savia/crm-shared/metadata";
import ScreenMenuReorder from "../screen-menu-reorder";

afterEach(cleanup);

it("uses a compact icon-only action to add a menu section", async () => {
  const user = userEvent.setup();
  render(
    <ScreenMenuReorder
      objects={[
        {
          name: "cotizador",
          label: "Cotizador",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
      ]}
      onMenuLayoutChange={vi.fn(async () => undefined)}
    />,
  );

  const addSection = screen.getByRole("button", { name: "Agregar sección" });
  expect(addSection.textContent).toBe("");
  expect(addSection.querySelector(".lucide-plus")).not.toBeNull();
  await user.hover(addSection);
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "Agregar sección",
  );
});

it("filters the pages shown in the menu without persisting a menu change", async () => {
  const user = userEvent.setup();
  const onMenuLayoutChange = vi.fn(async () => undefined);
  render(
    <ScreenMenuReorder
      objects={[
        {
          name: "clientes",
          label: "Clientes",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
        {
          name: "cotizador",
          label: "Cotizador por pasos",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
      ]}
      menuLayout={{
        version: 1,
        blocks: [{ kind: "ungrouped", screens: ["cotizador", "clientes"] }],
      }}
      onMenuLayoutChange={onMenuLayoutChange}
    />,
  );

  await user.type(
    screen.getByRole("searchbox", { name: "Filtrar páginas" }),
    "clientes",
  );

  expect(screen.getByText("Clientes")).toBeInTheDocument();
  expect(screen.queryByText("Cotizador por pasos")).not.toBeInTheDocument();
  expect(onMenuLayoutChange).not.toHaveBeenCalled();
});

it("persists an alphabetical order while preserving menu sections", async () => {
  const user = userEvent.setup();
  const onMenuLayoutChange = vi.fn(async () => undefined);
  render(
    <ScreenMenuReorder
      objects={[
        {
          name: "zeta",
          label: "Zeta",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
        {
          name: "alfa",
          label: "Alfa",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
        {
          name: "beta",
          label: "Beta",
          description: "",
          config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
        },
      ]}
      menuLayout={{
        version: 1,
        blocks: [
          { kind: "ungrouped", screens: ["zeta", "alfa"] },
          {
            kind: "section",
            id: "ventas",
            label: "Ventas",
            screens: ["beta"],
          },
        ],
      }}
      onMenuLayoutChange={onMenuLayoutChange}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Ordenar páginas de A a Z" }),
  );

  expect(onMenuLayoutChange).toHaveBeenCalledWith({
    version: 1,
    blocks: [
      { kind: "ungrouped", screens: ["alfa", "zeta"] },
      {
        kind: "section",
        id: "ventas",
        label: "Ventas",
        screens: ["beta"],
      },
    ],
  });
});
