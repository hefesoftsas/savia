// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./studio-test-render";
import ScreenManager from "../screen-manager";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const object: StudioObject = {
  name: "contacts",
  label: "Clientes HubSpot",
  description: "",
  version: 3,
  config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
};
it("renames only on explicit save and sends trimmed label with latest version", async () => {
  const saved = vi.fn();
  vi.mocked(api)
    .mockResolvedValueOnce({ data: [{ ...object, version: 4 }] })
    .mockResolvedValueOnce({
      data: { ...object, label: "Clientes", version: 5 },
    });
  render(<ScreenManager objects={[object]} onSaved={saved} />);
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "Nombre de pantalla Clientes HubSpot",
    }),
    { target: { value: "  Clientes  " } },
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar nombre de Clientes HubSpot" }),
  );
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Clientes", name: "contacts" }),
    ),
  );
  expect(api).toHaveBeenCalledWith("/objects/contacts/screen", "PATCH", {
    label: "Clientes",
    version: 4,
  });
});
it("rejects blank names and preserves the editable draft when saving fails", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ data: [object] })
    .mockRejectedValueOnce(new Error("Conflicto"));
  render(<ScreenManager objects={[object]} onSaved={vi.fn()} />);
  const input = screen.getByRole("textbox", {
    name: "Nombre de pantalla Clientes HubSpot",
  });
  fireEvent.change(input, { target: { value: "  " } });
  expect(
    (
      screen.getByRole("button", {
        name: "Guardar nombre de Clientes HubSpot",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(input, { target: { value: "Clientes" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar nombre de Clientes HubSpot" }),
  );
  await screen.findByRole("alert");
  expect((input as HTMLInputElement).value).toBe("Clientes");
});
it("shows the detail name save control as an icon with a tooltip", async () => {
  render(
    <ScreenManager
      objects={[object]}
      variant="detail"
      onSaved={vi.fn(async () => undefined)}
    />,
  );

  const saveButton = screen.getByRole("button", {
    name: "Guardar nombre de Clientes HubSpot",
  });
  expect(saveButton).not.toHaveTextContent("Guardar nombre");
  expect(saveButton.querySelector("svg")).not.toBeNull();

  fireEvent.focus(saveButton);
  expect(
    await screen.findByRole("tooltip", { name: "Guardar nombre" }),
  ).toBeVisible();
});
