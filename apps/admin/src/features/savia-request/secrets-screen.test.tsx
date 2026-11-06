import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SecretsScreen } from "./secrets-screen";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

function renderSecretsScreen() {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/flows"))
      return [
        { id: "autos", name: "Autos", folderPath: "Cotizaciones", steps: [] },
        { id: "hogar", name: "Hogar", folderPath: "Cotizaciones", steps: [] },
      ];
    if (path.endsWith("/folders")) return ["Cotizaciones"];
    if (path.endsWith("/variables/export"))
      return {
        version: 1,
        exportedAt: "2026-09-20T00:00:00.000Z",
        flows: [
          {
            flowId: "autos",
            variables: [
              { key: "api_token", value: "super-secreto", secret: true },
              {
                key: "endpoint",
                value: "https://provider.test",
                secret: false,
              },
            ],
          },
          {
            flowId: "hogar",
            variables: [{ key: "hogar_key", value: "guardado", secret: true }],
          },
        ],
      };
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/variables/import"))
      return {
        results: [
          {
            flowId: "autos",
            applied: 1,
            skipped: 1,
            status: "updated",
          },
          {
            flowId: "desconocido",
            applied: 0,
            skipped: 0,
            status: "unknown",
          },
        ],
      };
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const services = {
    apiClient: {
      get,
      put: vi.fn(),
      post,
      delete: vi.fn(),
      request: vi.fn(),
    },
    requestResults: { read: vi.fn() },
  } as unknown as AppServices;
  render(
    <MemoryRouter initialEntries={["/savia-request?view=secretos"]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <SecretsScreen />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
  return { get, post };
}

function mockDownload() {
  const blobs: Blob[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:mock";
    }),
    revokeObjectURL: vi.fn(),
  });
  return {
    blobs,
    restore() {
      click.mockRestore();
      Object.assign(URL, {
        createObjectURL: originalCreate,
        revokeObjectURL: originalRevoke,
      });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SecretsScreen", () => {
  it("exports every flow with a single request", async () => {
    const { get } = renderSecretsScreen();
    const user = userEvent.setup();
    const download = mockDownload();
    try {
      await user.click(
        await screen.findByRole("button", {
          name: "Exportar todos los secretos",
        }),
      );
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith(
          "/v1/savia-request/api/variables/export",
        ),
      );
      await waitFor(() => expect(download.blobs).toHaveLength(1));
      expect(JSON.parse(await download.blobs[0]!.text())).toEqual({
        version: 1,
        exportedAt: "2026-09-20T00:00:00.000Z",
        flows: [
          {
            flowId: "autos",
            variables: [
              { key: "api_token", value: "super-secreto", secret: true },
              {
                key: "endpoint",
                value: "https://provider.test",
                secret: false,
              },
            ],
          },
          {
            flowId: "hogar",
            variables: [{ key: "hogar_key", value: "guardado", secret: true }],
          },
        ],
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
        /2 flow\(s\) exportados/,
      );
    } finally {
      download.restore();
    }
  });

  it("previews an import file and applies it with a single request", async () => {
    const { post } = renderSecretsScreen();
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Archivo de secretos"),
      new File(
        [
          JSON.stringify({
            version: 1,
            exportedAt: "2026-09-20T00:00:00.000Z",
            flows: [
              {
                flowId: "autos",
                variables: [
                  { key: "api_token", value: "importado", secret: true },
                  { key: "endpoint", value: "", secret: false },
                ],
              },
              {
                flowId: "desconocido",
                variables: [{ key: "x", value: "y", secret: false }],
              },
            ],
          }),
        ],
        "secretos.json",
        { type: "application/json" },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Revisa antes de aplicar" }),
    ).toBeVisible();
    expect(screen.getByText("Desconocido · se omitirá")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Aplicar importación" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/v1/savia-request/api/variables/import",
        expect.objectContaining({
          flows: expect.arrayContaining([
            expect.objectContaining({ flowId: "autos" }),
          ]),
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Resultado" }),
    ).toBeVisible();
    expect(await screen.findByRole("status")).toHaveTextContent(
      /1 valor\(es\) en 1 flow/,
    );
    expect(screen.getByText("Omitido · no existe aquí")).toBeVisible();
  });

  it("rejects invalid import files with an actionable message", async () => {
    renderSecretsScreen();
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Archivo de secretos"),
      new File(["no-json"], "secretos.json", { type: "application/json" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no es un JSON válido/,
    );
  });
});
