// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { render } from "./studio-test-render";
import userEvent from "@testing-library/user-event";
import ScreenManager from "../screen-manager";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const object: StudioObject = {
  name: "contact",
  label: "Contactos",
  description: "",
  version: 3,
  config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
};
function mockApi(savedObject: StudioObject, putError?: Error) {
  vi.mocked(api).mockImplementation(async (url, method) => {
    if (url === "/objects" && (!method || method === "GET"))
      return { data: [savedObject] };
    if (putError) throw putError;
    return { data: savedObject };
  });
}
it("requires a deliberate removal and allows cancellation before persisting", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  mockApi(object);
  render(<ScreenManager objects={[object]} onSaved={saved} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar pantalla Contactos" }),
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(
    screen.queryByRole("button", { name: "Eliminar del menú" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar pantalla Contactos" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Eliminar del menú" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(
    "/objects/contact/screen",
    "PATCH",
    expect.objectContaining({
      version: 3,
      hidden: true,
    }),
  );
});
it("preserves removal when changing presentation and reports failures without claiming success", async () => {
  const hidden = {
    ...object,
    config: {
      ...object.config,
      studio: { screen: { hidden: true, createMode: "modal" as const } },
    },
  };
  mockApi(hidden, new Error("No se pudo guardar"));
  const saved = vi.fn();
  render(<ScreenManager objects={[hidden]} onSaved={saved} />);
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "Abrir Nuevo registro de Contactos en",
    }),
    { target: { value: "page" } },
  );
  await screen.findByRole("alert");
  expect(saved).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith(
    "/objects/contact/screen",
    "PATCH",
    expect.objectContaining({
      createMode: "page",
    }),
  );
  expect(
    (
      screen.getByRole("combobox", {
        name: "Abrir Nuevo registro de Contactos en",
      }) as HTMLSelectElement
    ).value,
  ).toBe("modal");
  mockApi(object);
  fireEvent.click(
    screen.getByRole("button", { name: "Recuperar pantalla Contactos" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalled());
});

it("opens removal confirmation directly from the navigation shortcut without removing data", () => {
  render(
    <ScreenManager
      objects={[object]}
      initialRemoval="contact"
      onSaved={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Eliminar del menú" }),
  ).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});

it("saves create and edit surfaces independently", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  mockApi({
    ...object,
    config: {
      ...object.config,
      studio: { screen: { createMode: "drawer-long", editMode: "page" } },
    },
  });
  render(<ScreenManager objects={[object]} onSaved={saved} />);
  expect(
    screen.getAllByRole("option", { name: "Panel lateral corto" }),
  ).toHaveLength(2);
  expect(
    screen.getAllByRole("option", { name: "Panel lateral largo" }),
  ).toHaveLength(2);
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "Abrir Nuevo registro de Contactos en",
    }),
    { target: { value: "drawer-long" } },
  );
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(
    "/objects/contact/screen",
    "PATCH",
    expect.objectContaining({
      createMode: "drawer-long",
    }),
  );
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "Abrir Editar registro de Contactos en",
    }),
    { target: { value: "page" } },
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/objects/contact/screen",
      "PATCH",
      expect.objectContaining({
        editMode: "page",
      }),
    ),
  );
});

it("saves a Lucide-only navigation icon for a screen", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  mockApi({
    ...object,
    config: {
      ...object.config,
      studio: { screen: { icon: "shield" } },
    },
  });
  render(<ScreenManager objects={[object]} onSaved={saved} />);
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: "Icono de Contactos en el menú" }),
  );
  expect(
    screen.getByText(
      "Elige un icono de interfaz para identificar esta pantalla en el menú.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Marcas" })).toBeNull();
  await user.type(screen.getByLabelText("Buscar icono"), "seguro");
  await user.click(screen.getByRole("option", { name: "Seguro" }));

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/objects/contact/screen",
      "PATCH",
      expect.objectContaining({ icon: "shield", version: 3 }),
    ),
  );
  expect(saved).toHaveBeenCalled();
});
