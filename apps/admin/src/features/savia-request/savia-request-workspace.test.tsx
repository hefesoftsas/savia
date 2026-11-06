import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestWorkspace } from "./savia-request-workspace";
import type { RequestFlow, RequestRun } from "./types";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

const autos: RequestFlow = {
  id: "autos",
  name: "Autos",
  folderPath: "Cotizaciones",
  description: "Cotiza autos livianos.",
  input: { plate: "TESTCAR" },
  variables: [],
  versions: [],
  steps: [
    {
      id: "cotizar",
      name: "Cotizar auto",
      url: "https://provider.test/autos",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      bodyType: "json",
      pre: "",
      post: "",
    },
  ],
};

const run: RequestRun = {
  id: "run-1",
  flowId: "autos",
  mode: "mock",
  status: "success",
  createdAt: "2026-09-07T00:00:00Z",
  versionId: null,
  steps: [],
  result: { premiumTotal: 1200000, quoteNumber: "SIM-1" },
};

function renderWorkspace(flows: RequestFlow[] = [autos]) {
  let remainingFlows = [...flows];
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/flows")) {
      return remainingFlows.map(({ id, name, folderPath, steps }) => ({
        id,
        name,
        folderPath,
        steps,
      }));
    }
    if (path.endsWith("/folders")) return ["Cotizaciones"];
    if (
      path.endsWith("/flows/autos") &&
      remainingFlows.some(({ id }) => id === "autos")
    ) {
      return autos;
    }
    if (path.endsWith("/flows/autos/runs")) return [];
    const matched = remainingFlows.find((flow) =>
      path.endsWith(`/flows/${flow.id}`),
    );
    if (matched) return matched;
    if (path.endsWith("/runs")) return [];
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const put = vi.fn().mockResolvedValue({ ok: true });
  const post = vi.fn().mockResolvedValue(run);
  const remove = vi.fn(async (path: string) => {
    const id = path.split("/").at(-1);
    remainingFlows = remainingFlows.filter((flow) => flow.id !== id);
  });
  const services = {
    apiClient: { get, put, post, delete: remove, request: vi.fn() },
    requestResults: {
      read: vi.fn().mockRejectedValue(new Error("not normalized")),
    },
  } as unknown as AppServices;
  render(
    <MemoryRouter
      initialEntries={[`/savia-request?flow=${flows[0]?.id ?? "autos"}&step=0`]}
    >
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <SaviaRequestWorkspace />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
  return { post, put, remove };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestWorkspace", () => {
  it("saves the edited draft before running a simulation", async () => {
    const user = userEvent.setup();
    const { post, put } = renderWorkspace();

    await user.clear(await screen.findByLabelText("Nombre del flow"));
    await user.type(
      screen.getByLabelText("Nombre del flow"),
      "Autos actualizado",
    );
    await user.click(
      screen.getByRole("button", { name: "Ejecutar simulación" }),
    );

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/v1/savia-request/api/flows/autos",
        expect.objectContaining({ name: "Autos actualizado" }),
      ),
    );
    expect(post).toHaveBeenCalledWith(
      "/v1/savia-request/api/flows/autos/runs",
      { input: { plate: "TESTCAR" }, mode: "mock" },
    );
  });

  it("configures Basic Auth in the native headers editor", async () => {
    const user = userEvent.setup();
    const { put } = renderWorkspace();

    await user.click(
      await screen.findByRole("tab", { name: "Headers / Auth" }),
    );
    await user.selectOptions(screen.getByLabelText("Autenticación"), "basic");
    await user.type(screen.getByLabelText("Usuario (variable)"), "auth_user");
    await user.type(
      screen.getByLabelText("Contraseña (variable)"),
      "auth_password",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/v1/savia-request/api/flows/autos",
        expect.objectContaining({
          steps: [
            expect.objectContaining({
              auth: { username: "auth_user", password: "auth_password" },
            }),
          ],
        }),
      ),
    );
  });

  it("clears the editor after deleting the last flow", async () => {
    const user = userEvent.setup();
    const { remove } = renderWorkspace([autos]);

    await screen.findByRole("heading", { name: "Autos" });
    await user.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith("/v1/savia-request/api/flows/autos", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "No hay flows todavía" }),
    ).toBeVisible();
  });

  it("offers a first-flow action when the workspace has no flows", async () => {
    renderWorkspace([]);

    expect(
      await screen.findByRole("heading", { name: "No hay flows todavía" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Crear flow" })).toBeEnabled();
  });
});

it("defaults the DANE reference service to live without a failing simulation", async () => {
  const { post } = renderWorkspace([
    {
      ...autos,
      id: "dane-city-lookup",
      name: "DANE",
      input: { city: "Bogotá", department: "" },
    },
  ]);
  await screen.findByLabelText("Nombre del flow");
  await userEvent.click(screen.getByRole("button", { name: "Ejecutar real" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/v1/savia-request/api/flows/dane-city-lookup/runs",
      { mode: "live", input: { city: "Bogotá", department: "" } },
    ),
  );
});

it("shows the configured HTTP host instead of the source provider when a flow is repointed", async () => {
  const user = userEvent.setup();
  const repointed = {
    ...autos,
    id: "qa-echo",
    name: "QA Echo",
    provider: "DANE",
    steps: [
      {
        ...autos.steps[0]!,
        url: "https://postman-echo.com/post",
      },
    ],
  };
  renderWorkspace([repointed]);

  expect(
    await screen.findByRole("option", { name: "Real · postman-echo.com" }),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole("tab", { name: "Ejecutar" }));
  await user.selectOptions(
    screen.getAllByRole("combobox", { name: "Modo de ejecución" }).at(-1)!,
    "live",
  );
  expect(
    await screen.findByRole("option", {
      name: "postman-echo.com real · ejecuta requests",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Se enviarán estos datos a postman-echo.com sin reintentos.",
    ),
  ).toBeInTheDocument();
});

it("renders the dedicated secretos screen without selecting a flow", async () => {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/flows")) return [];
    if (path.endsWith("/folders")) return [];
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const services = {
    apiClient: {
      get,
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    },
    requestResults: {
      read: vi.fn().mockRejectedValue(new Error("not normalized")),
    },
  } as unknown as AppServices;
  render(
    <MemoryRouter initialEntries={["/savia-request?view=secretos"]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <SaviaRequestWorkspace />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByRole("heading", { name: "Secretos" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Exportar todos los secretos" }),
  ).toBeVisible();
});
