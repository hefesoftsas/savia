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
const loadDeletionPreview = async (target: {
  name: string;
  label: string;
  count?: number;
}) => ({
  root: target.name,
  screens: [
    {
      name: target.name,
      label: target.label,
      recordCount: target.count ?? 0,
      blockedReason: null,
    },
  ],
  totalRecords: target.count ?? 0,
  token: "test-preview-token",
});
const loadPreviewWithDependents = async (target: {
  name: string;
  label: string;
}) => ({
  root: target.name,
  screens: [
    {
      name: target.name,
      label: target.label,
      recordCount: 2,
      blockedReason: null,
    },
    {
      name: "screen_lines",
      label: "Líneas de pedido",
      recordCount: 7,
      blockedReason: null,
    },
  ],
  totalRecords: 9,
  token: "cascade-preview-token",
});
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
      tenantTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
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
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={navigate}
      onVisibilityChange={onVisibilityChange}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={navigate}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={onMenuLayoutChange}
      onDeletePermanent={vi.fn(async () => undefined)}
      onLoadDeletionPreview={loadDeletionPreview}
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
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadDeletionPreview}
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
  const confirm = screen.getByRole("button", {
    name: "Eliminar permanentemente",
  });
  await vi.waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await vi.waitFor(() =>
    expect(onDeletePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oculta" }),
      {
        deleteRecords: false,
        deleteRelated: false,
        deletionToken: "test-preview-token",
      },
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
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadDeletionPreview}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Eliminar permanentemente Oculta",
    }),
  );
  await screen.findByText(
    "Pantalla seleccionada y pantallas dependientes detectadas:",
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
      {
        deleteRecords: true,
        deleteRelated: false,
        deletionToken: "test-preview-token",
      },
    ),
  );
});

it("previews dependent screens, keeps cascade off by default, and requires a fresh acknowledgement when scope changes", async () => {
  const onDeletePermanent = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadPreviewWithDependents}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar permanentemente Oculta" }),
  );
  await screen.findByText(
    "Pantalla seleccionada y pantallas dependientes detectadas:",
  );
  expect(screen.getByText("Líneas de pedido")).toBeInTheDocument();
  expect(screen.getByText("screen_lines")).toBeInTheDocument();
  expect(screen.getByText("7 registros")).toBeInTheDocument();
  const cascade = screen.getByRole("checkbox", {
    name: "Eliminar también las pantallas dependientes y sus datos",
  });
  expect(cascade).not.toBeChecked();
  const confirm = screen.getByRole("button", {
    name: "Eliminar permanentemente",
  });
  expect(confirm).toBeDisabled();

  const acknowledgement = screen.getByRole("checkbox", {
    name: /Entiendo que también se eliminarán 2 registros/,
  });
  fireEvent.click(acknowledgement);
  expect(acknowledgement).toBeChecked();
  fireEvent.click(cascade);
  expect(acknowledgement).not.toBeChecked();
  expect(confirm).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Entiendo que también se eliminarán 9 registros/,
    }),
  );
  await vi.waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await vi.waitFor(() =>
    expect(onDeletePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oculta" }),
      {
        deleteRecords: true,
        deleteRelated: true,
        deletionToken: "cascade-preview-token",
      },
    ),
  );
});

it("blocks a cascade with protected dependent screens but keeps the preview visible", async () => {
  const loadBlockedPreview = async (target: {
    name: string;
    label: string;
  }) => ({
    root: target.name,
    screens: [
      {
        name: target.name,
        label: target.label,
        recordCount: 0,
        blockedReason: null,
      },
      {
        name: "protected_extension",
        label: "Extensión protegida",
        recordCount: 0,
        blockedReason: "external screen",
      },
    ],
    totalRecords: 0,
    token: "blocked-preview-token",
  });
  const onDeletePermanent = vi.fn(async () => undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadBlockedPreview}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar permanentemente Oculta" }),
  );
  await screen.findByText("Extensión protegida");
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Eliminar también las pantallas dependientes y sus datos",
    }),
  );
  expect(screen.getByText("external screen")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Eliminar permanentemente" }),
  ).toBeDisabled();
  expect(onDeletePermanent).not.toHaveBeenCalled();
});

it("refreshes a failed deletion preview and requires confirmation again", async () => {
  let previewCalls = 0;
  const loadChangingPreview = async (target: {
    name: string;
    label: string;
  }) => {
    previewCalls += 1;
    return {
      root: target.name,
      screens: [
        {
          name: target.name,
          label: target.label,
          recordCount: 1,
          blockedReason: null,
        },
      ],
      totalRecords: 1,
      token: `preview-${previewCalls}`,
    };
  };
  const onDeletePermanent = vi
    .fn<(...args: any[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error("stale deletion token"))
    .mockResolvedValue(undefined);
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail={false}
      tenantTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={onDeletePermanent}
      onLoadDeletionPreview={loadChangingPreview}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar permanentemente Oculta" }),
  );
  await screen.findByText(
    "Pantalla seleccionada y pantallas dependientes detectadas:",
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Entiendo que también se eliminarán 1 registro/,
    }),
  );
  const confirm = screen.getByRole("button", {
    name: "Eliminar permanentemente",
  });
  await vi.waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await vi.waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "stale deletion token",
    ),
  );
  await vi.waitFor(() => expect(previewCalls).toBe(2));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(confirm).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Entiendo que también se eliminarán 1 registro/,
    }),
  );
  await vi.waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await vi.waitFor(() => expect(onDeletePermanent).toHaveBeenCalledTimes(2));
});

it("navigates to public link management when selected in screen configuration", async () => {
  const navigate = vi.fn();
  setStudioRuntime({
    embedded: true,
    tenantId: "sales",
    publicFormTransport: vi.fn(),
  });
  render(
    <ScreenAdministration
      objects={objects}
      selected="screen_0"
      detail
      tenantTools
      onNavigate={navigate}
      onVisibilityChange={vi.fn()}
      onMenuLayoutChange={vi.fn()}
      onDeletePermanent={vi.fn()}
      onLoadDeletionPreview={loadDeletionPreview}
    />,
  );
  const linkOption = screen.getByRole("button", {
    name: "Enlace público de Proyectos",
  });
  expect(linkOption).toBeInTheDocument();
  fireEvent.click(linkOption);
  expect(navigate).toHaveBeenCalledWith("screen_0", "screen-public-link");
});
