// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import userEvent from "@testing-library/user-event";
import SolutionManager from "../solution-manager";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const manifest = {
  format: "savia.solution",
  formatVersion: 1,
  id: "insurance",
  version: "1.0.0",
  label: "Seguros",
  description: "Modelos de seguros",
  requires: [],
  objects: [],
};
const preview = {
  id: "insurance",
  version: "1.0.0",
  objects: [{ name: "clientes", label: "Clientes", action: "create" }],
  conflicts: [],
  canInstall: true,
};
function setup(installed: null | { enabled: boolean; version: string } = null) {
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === "/solutions") return { data: [{ manifest, installed }] };
    if (url === "/solutions/preview") return { data: preview };
    return { data: {} };
  });
  const changed = vi.fn();
  render(<SolutionManager onChanged={changed} />);
  return changed;
}
it("keeps package details and secondary actions in contextual tooltips", async () => {
  const user = userEvent.setup();
  setup();

  expect(await screen.findByText("Seguros")).toBeInTheDocument();
  expect(screen.queryByText("Modelos de seguros")).not.toBeInTheDocument();
  const details = screen.getByRole("button", {
    name: "Más información sobre Seguros",
  });
  await user.hover(details);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Modelos de seguros",
  );

  const download = screen.getByRole("button", { name: "Descargar Seguros" });
  expect(download).toHaveTextContent("");
  await user.hover(download);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Descargar Seguros",
  );
});
it("requires a preview and explicit installation, then refreshes objects", async () => {
  const changed = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Revisar Seguros" }),
  );
  await screen.findByText("Clientes");
  expect(api).not.toHaveBeenCalledWith(
    "/solutions/install",
    expect.anything(),
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Instalar paquete" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith("/solutions/install", "POST", manifest);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Paquete instalado",
  );
});
it("reviews and explicitly applies a newer catalog package", async () => {
  const nextManifest = { ...manifest, version: "1.1.0" };
  const nextPreview = {
    ...preview,
    version: "1.1.0",
    objects: [{ name: "cotizador", label: "Cotizador", action: "create" }],
  };
  vi.mocked(api).mockImplementation(async (url) => {
    if (url === "/solutions")
      return {
        data: [
          {
            manifest: nextManifest,
            installed: { enabled: true, version: "1.0.0" },
          },
        ],
      };
    if (url === "/solutions/preview") return { data: nextPreview };
    return { data: {} };
  });
  render(<SolutionManager onChanged={vi.fn()} />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Actualizar Seguros" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/solutions/preview",
      "POST",
      nextManifest,
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Actualizar paquete" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/solutions/install",
      "POST",
      nextManifest,
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Paquete actualizado",
  );
});
it("imports the actual JSON, blocks conflicting packages and clears stale previews after invalid input", async () => {
  setup();
  await screen.findByRole("button", { name: "Revisar Seguros" });
  vi.mocked(api).mockResolvedValueOnce({
    data: {
      ...preview,
      canInstall: false,
      conflicts: ["El objeto clientes pertenece a otro paquete"],
    },
  });
  const file = new File(["{}"], "paquete.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify(manifest),
  });
  fireEvent.change(screen.getByLabelText("Importar JSON"), {
    target: { files: [file] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "pertenece a otro paquete",
  );
  expect(
    screen.getByRole("button", { name: "Instalar paquete" }),
  ).toBeDisabled();
  expect(api).toHaveBeenCalledWith("/solutions/preview", "POST", manifest);
  const bad = new File(["bad"], "bad.json");
  Object.defineProperty(bad, "text", { value: async () => "bad" });
  await waitFor(() =>
    expect(screen.getByLabelText("Importar JSON")).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("Importar JSON"), {
    target: { files: [bad] },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("JSON válido"),
  );
  expect(screen.queryByRole("button", { name: "Instalar paquete" })).toBeNull();
});
it("rejects oversized uploads before reading or sending them", async () => {
  setup();
  await screen.findByRole("button", { name: "Revisar Seguros" });
  const text = vi.fn();
  const file = new File([], "large.json");
  Object.defineProperties(file, {
    size: { value: 2 * 1024 * 1024 + 1 },
    text: { value: text },
  });
  fireEvent.change(screen.getByLabelText("Importar JSON"), {
    target: { files: [file] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("supera 2 MB");
  expect(text).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
});
it.each([true, false])(
  "changes enabled=%s while explaining retained data",
  async (enabled) => {
    const user = userEvent.setup();
    const changed = setup({ enabled, version: "1.0.0" });
    await user.hover(
      await screen.findByRole("button", {
        name: "Qué ocurre al activar o desactivar Seguros",
      }),
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "conserva los datos",
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${enabled ? "Desactivar" : "Activar"} Seguros`,
      }),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/solutions/insurance", "PATCH", {
      enabled: !enabled,
    });
  },
);
it("keeps a failed installation review available for retry", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Revisar Seguros" }),
  );
  await screen.findByText("Clientes");
  vi.mocked(api).mockRejectedValueOnce(new Error("Permisos insuficientes"));
  fireEvent.click(screen.getByRole("button", { name: "Instalar paquete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Permisos insuficientes",
  );
  expect(
    screen.getByRole("button", { name: "Instalar paquete" }),
  ).not.toBeDisabled();
});
it.each([false, true])(
  "downloads the catalog manifest even when installed=%s",
  async (installed) => {
    const user = userEvent.setup();
    setup(installed ? { enabled: true, version: "0.0.0" } : null);
    const blobs: Blob[] = [];
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return "blob:test";
      });
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      await screen.findByRole("button", { name: "Descargar Seguros" });
      fireEvent.click(
        screen.getByRole("button", { name: "Descargar Seguros" }),
      );
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      expect(blobs[0].type).toBe("application/json");
      expect(api).toHaveBeenCalledTimes(1);
      if (installed) {
        await user.hover(
          screen.getByRole("button", { name: "Más información sobre Seguros" }),
        );
        expect(await screen.findByRole("tooltip")).toHaveTextContent(
          "Configuración existente",
        );
        expect(screen.queryByText(/0\.0\.0/)).toBeNull();
        vi.mocked(api).mockResolvedValueOnce({ ...manifest, version: "0.0.0" });
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "Exportar instalado Seguros" }),
          ).not.toBeDisabled(),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Exportar instalado Seguros" }),
        );
        await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
        expect(api).toHaveBeenCalledWith("/solutions/insurance/export");
      } else {
        expect(
          screen.queryByRole("button", { name: "Exportar instalado Seguros" }),
        ).toBeNull();
      }
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      click.mockRestore();
    }
  },
);
