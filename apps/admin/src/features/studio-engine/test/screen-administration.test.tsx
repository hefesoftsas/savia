// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { render } from "./studio-test-render";
import { setStudioRuntime } from "../runtime";
import ScreenAdministration from "../screen-administration";
import { makeConfig } from "@savia/studio-shared/metadata";
vi.mock("../collection-operations-panel", () => ({
  default: ({ name }: any) => <div>Operaciones para {name}</div>,
}));
afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});
vi.mock("../../public-forms/public-link-manager", () => ({
  PublicLinkManager: ({ objectName }: { objectName: string }) => (
    <div>Public links for {objectName}</div>
  ),
}));
const objects = ["Proyectos", "Inventario", "Oculta"].map((label, i) => ({
  name: "screen_" + i,
  label,
  description: "",
  config: {
    ...makeConfig({ title: { type: "Textbox" as const, label: "Título" } }),
    studio: { screen: { hidden: i === 2 } },
  },
}));
it("lists active screens dynamically and opens the selected screen configuration", () => {
  const navigate = vi.fn();
  const onVisibilityChange = vi.fn(async () => undefined);
  const onMenuLayoutChange = vi.fn(async () => undefined);
  const onDeletePermanent = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={onDeletePermanent}
    />,
  );
  expect(
    screen.getAllByRole("button", { name: "Configurar Proyectos" }).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("Pantallas fuera del menú")).toBeInTheDocument();
  expect(screen.getByText("Oculta")).toBeInTheDocument();
  expect(screen.queryByText("Agencias")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Configurar Inventario" })[0]!,
  );
  expect(navigate).toHaveBeenCalledWith("screen_1", "admin-screen");
});
it("filters active and inactive screens without persisting a menu change", () => {
  const onMenuLayoutChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Filtrar pantallas" }),
    {
      target: { value: "oculta" },
    },
  );

  expect(screen.getByText("Oculta")).toBeInTheDocument();
  expect(screen.queryByText("Proyectos")).not.toBeInTheDocument();
  expect(screen.queryByText("Inventario")).not.toBeInTheDocument();
  expect(onMenuLayoutChange).not.toHaveBeenCalled();
});
it("persists an alphabetical active menu order while retaining sections", async () => {
  const onMenuLayoutChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      menuLayout={{
        version: 1,
        blocks: [
          { kind: "ungrouped", screens: ["screen_0", "screen_1"] },
          { kind: "section", id: "extras", label: "Extras", screens: [] },
        ],
      }}
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Ordenar pantallas de A a Z" }),
  );

  await vi.waitFor(() =>
    expect(onMenuLayoutChange).toHaveBeenCalledWith({
      version: 1,
      blocks: [
        { kind: "ungrouped", screens: ["screen_1", "screen_0"] },
        { kind: "section", id: "extras", label: "Extras", screens: [] },
      ],
    }),
  );
});
it("confirms before removing an active screen from the menu", async () => {
  const navigate = vi.fn();
  const onVisibilityChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar pantalla Proyectos" }),
  );
  expect(
    screen.getByText(
      "¿Eliminar «Proyectos» del menú? Los registros se conservarán.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar del menú" }));
  await vi.waitFor(() =>
    expect(onVisibilityChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Proyectos" }),
      true,
    ),
  );
});
it("recovers an inactive screen from the list", async () => {
  const onVisibilityChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Recuperar pantalla Oculta" }),
  );
  await vi.waitFor(() =>
    expect(onVisibilityChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oculta" }),
      false,
    ),
  );
});
it("keeps tools scoped to the screen and hides endpoint configuration for local collections", () => {
  const navigate = vi.fn();
  const onVisibilityChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_1"
      detail
      domainTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );
  expect(screen.getByRole("heading", { name: "Inventario" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Pantallas disponibles/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Operaciones del API/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Relaciones de Inventario" }),
  );
  expect(navigate).toHaveBeenCalledWith("screen_1", "screen-relations");
  fireEvent.click(
    screen.getByRole("button", { name: "Historial de cambios de Inventario" }),
  );
  expect(navigate).toHaveBeenLastCalledWith("screen_1", "screen-audit");
});
it("opens screen configuration when clicking the row body", () => {
  const navigate = vi.fn();
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={navigate}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.click(screen.getByText("Inventario"));
  expect(navigate).toHaveBeenCalledWith("screen_1", "admin-screen");
});
it("reorders active screens after drag and drop", async () => {
  const onMenuLayoutChange = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.dragStart(
    screen.getByRole("button", { name: "Reordenar Inventario" }),
    {
      dataTransfer: { setData: vi.fn(), effectAllowed: "move" },
    },
  );
  const target = screen
    .getAllByRole("button", { name: "Configurar Proyectos" })[0]
    ?.closest("article");
  expect(target).toBeTruthy();
  fireEvent.drop(target!, {
    dataTransfer: { getData: () => "screen_1" },
    preventDefault: vi.fn(),
  });
  await vi.waitFor(() =>
    expect(onMenuLayoutChange).toHaveBeenCalledWith({
      version: 1,
      blocks: [{ kind: "ungrouped", screens: ["screen_1", "screen_0"] }],
    }),
  );
});
it("confirms permanent deletion for inactive screens", async () => {
  const onDeletePermanent = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Eliminar permanentemente Oculta",
    }),
  );
  expect(
    screen.getByRole("dialog", { name: "Eliminar pantalla permanentemente" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar permanentemente" }),
  );
  await vi.waitFor(() =>
    expect(onDeletePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oculta" }),
      { deleteRecords: false },
    ),
  );
});
it("requires acknowledging record deletion when a screen has data", async () => {
  const onDeletePermanent = vi.fn(async () => undefined);
  const withRecords = objects.map((item) =>
    item.label === "Oculta" ? { ...item, count: 3 } : item,
  );
  render(
    <ScreenAdministration
      objects={withRecords}
      selected="screen_0"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Eliminar permanentemente Oculta",
    }),
  );
  const confirm = screen.getByRole("button", {
    name: "Eliminar permanentemente",
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Entiendo que también se eliminarán 3 registros/,
    }),
  );
  fireEvent.click(confirm);
  await vi.waitFor(() =>
    expect(onDeletePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oculta", count: 3 }),
      { deleteRecords: true },
    ),
  );
});

it("loads public link management only when requested in screen configuration", async () => {
  setStudioRuntime({
    embedded: true,
    domainId: "sales",
    publicFormTransport: vi.fn(),
  });
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn()}
      onMenuLayoutChange={vi.fn()}
      onDeletePermanent={vi.fn()}
    />,
  );
  expect(
    screen.queryByText("Public links for screen_0"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enlaces públicos" }));
  expect(
    await screen.findByText("Public links for screen_0"),
  ).toBeInTheDocument();
});
