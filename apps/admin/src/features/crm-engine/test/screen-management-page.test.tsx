// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Root from "../app";
import { setCrmRuntime } from "../runtime";
import { makeConfig } from "@savia/crm-shared/metadata";

afterEach(() => {
  cleanup();
  setCrmRuntime({ embedded: false });
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
  setCrmRuntime({
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

  const addSection = screen.getByRole("button", { name: "Agregar sección" });
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
  setCrmRuntime({
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

  render(
    <Root
      embedded
      search="object=clientes&view=screens&tab=screens"
    />,
  );

  const menuOrderTab = await screen.findByRole("tab", {
    name: "Orden del menú",
  });
  expect(
    screen.getByRole("tab", { name: "Pantallas" }),
  ).toHaveAttribute("aria-selected", "true");

  await user.click(menuOrderTab);
  expect(window.location.search).toBe(
    "?object=clientes&view=screens&tab=menu",
  );
});

it("returns direct screen removal to the screen settings tab", async () => {
  const user = userEvent.setup();
  setCrmRuntime({
    embedded: true,
    businessSetupEnabled: false,
    transport: async (path: string) =>
      Response.json({ data: path === "/api/objects" ? screens : {} }),
  });

  render(<Root embedded search="object=clientes&view=remove-screen" />);

  await user.click(await screen.findByRole("button", { name: "Cancelar" }));
  expect(
    await screen.findByRole("tab", { name: "Pantallas" }),
  ).toHaveAttribute("aria-selected", "true");
});
