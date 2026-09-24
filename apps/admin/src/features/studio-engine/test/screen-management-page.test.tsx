// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
import userEvent from "@testing-library/user-event";
import Root from "../app";
import { setStudioRuntime } from "../runtime";
import { makeConfig } from "@savia/studio-shared/metadata";

afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
  window.history.replaceState(null, "", "/");
});

const screens = [
  {
    name: "clientes",
    label: "Clientes",
    description: "",
    version: 1,
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  },
];

it("separates menu ordering from screen settings and keeps section creation compact", async () => {
  const user = userEvent.setup();
  const transport = vi.fn(async (path: string) => {
    if (path === "/api/objects") return Response.json({ data: screens });
    return Response.json({ data: {} });
  });
  setStudioRuntime({
    embedded: true,
    businessSetupEnabled: false,
    transport,
  });

  render(<Root embedded search="object=clientes&view=screens" />);

  const menuOrderTab = await screen.findByRole("tab", {
    name: "Orden del menú",
  });
  const screensTab = screen.getByRole("tab", { name: "Pantallas" });
  expect(menuOrderTab).toHaveAttribute("aria-selected", "true");
  expect(
    screen.queryByRole("columnheader", { name: "Pantalla" }),
  ).not.toBeInTheDocument();

  const addSection = await screen.findByRole("button", {
    name: "Agregar sección",
  });
  expect(addSection).toHaveTextContent("");
  await user.hover(addSection);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Agregar sección",
  );

  await user.click(screensTab);
  expect(screensTab).toHaveAttribute("aria-selected", "true");
  expect(
    await screen.findByRole("columnheader", { name: "Pantalla" }),
  ).toBeVisible();
});

it("keeps the selected management tab in the URL", async () => {
  const user = userEvent.setup();
  setStudioRuntime({
    embedded: true,
    businessSetupEnabled: false,
    transport: async (path: string) =>
      Response.json({ data: path === "/api/objects" ? screens : {} }),
  });
  window.history.replaceState(
    null,
    "",
    "/?object=clientes&view=screens&tab=screens",
  );

  render(<Root embedded search="object=clientes&view=screens&tab=screens" />);

  const menuOrderTab = await screen.findByRole("tab", {
    name: "Orden del menú",
  });
  expect(screen.getByRole("tab", { name: "Pantallas" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await user.click(menuOrderTab);
  expect(window.location.search).toBe("?object=clientes&view=screens&tab=menu");
});

it("returns direct screen removal to the screen settings tab", async () => {
  const user = userEvent.setup();
  setStudioRuntime({
    embedded: true,
    businessSetupEnabled: false,
    transport: async (path: string) =>
      Response.json({ data: path === "/api/objects" ? screens : {} }),
  });

  render(<Root embedded search="object=clientes&view=remove-screen" />);

  await user.click(await screen.findByRole("button", { name: "Cancelar" }));
  expect(await screen.findByRole("tab", { name: "Pantallas" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it.each([
  ["operations", "reports", "Reportes"],
  ["operations", "workflows", "Flujos de trabajo"],
  ["operations", "automations", "Automatizaciones"],
  ["operations", "import", "Importar y exportar"],
  ["operations", "tasks", "Seguimiento"],
  ["admin", "packages", "Paquetes y extensiones"],
])(
  "opens %s deep links on %s and preserves context when changing tabs",
  async (view, tab, label) => {
    const user = userEvent.setup();
    setStudioRuntime({
      embedded: true,
      businessSetupEnabled: false,
      transport: async (path: string) =>
        Response.json({ data: path === "/api/objects" ? screens : [] }),
    });
    const initialSearch = `domain=demo&object=clientes&view=${view}&tab=${tab}`;
    const { rerender } = render(<Root embedded search={initialSearch} />);
    const selectedTab = await screen.findByRole(
      view === "admin" ? "tab" : "button",
      { name: label },
    );
    expect(selectedTab).toHaveAttribute(
      view === "admin" ? "aria-selected" : "aria-current",
      view === "admin" ? "true" : "page",
    );
    await user.click(
      screen.getByRole(view === "admin" ? "tab" : "button", {
        name: view === "admin" ? "Pantallas" : "Seguimiento",
      }),
    );
    const params = new URLSearchParams(window.location.search);
    expect(params.get("domain")).toBe("demo");
    expect(params.get("tab")).toBe(view === "admin" ? "screens" : "tasks");
    rerender(<Root embedded search={params.toString()} />);
    rerender(<Root embedded search={initialSearch} />);
    expect(
      await screen.findByRole(view === "admin" ? "tab" : "button", {
        name: label,
      }),
    ).toHaveAttribute(
      view === "admin" ? "aria-selected" : "aria-current",
      view === "admin" ? "true" : "page",
    );
  },
);

it.each([
  ["operations&tab=workflows", "Trabajo y resultados", "Flujos de trabajo"],
  ["operations&tab=reports", "Trabajo y resultados", "Reportes"],
  ["integrations", "De API a herramienta.", null],
  ["audit", "Historial de cambios", null],
])("opens domain tool %s without any screens", async (view, heading, tab) => {
  setStudioRuntime({
    embedded: true,
    businessSetupEnabled: false,
    transport: async () => Response.json({ data: [] }),
  });
  render(<Root embedded search={`domain=empty&view=${view}`} />);
  expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  if (tab)
    expect(screen.getByRole("button", { name: tab })).toHaveAttribute(
      "aria-current",
      "page",
    );
  expect(
    screen.queryByRole("region", { name: "Administrar pantallas" }),
  ).not.toBeInTheDocument();
});
