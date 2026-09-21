import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import {
  SaviaRequestProvider,
  useSaviaRequestWorkspace,
} from "./savia-request-provider";
import type { RequestFlow } from "./types";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

const autos: RequestFlow = {
  id: "autos",
  name: "Autos",
  description: "Cotiza autos.",
  input: {},
  variables: [],
  versions: [],
  steps: [
    {
      id: "crear-sesion",
      name: "Crear sesión",
      url: "https://provider.test/session",
      method: "POST",
      headers: {},
      body: "{}",
      pre: "",
      post: "",
    },
    {
      id: "cotizar",
      name: "Cotizar",
      url: "https://provider.test/quote",
      method: "POST",
      headers: {},
      body: "{}",
      pre: "",
      post: "",
    },
  ],
};

const hogar: RequestFlow = {
  ...autos,
  id: "hogar",
  name: "Hogar",
  steps: [{ ...autos.steps[0], id: "cotizar-hogar", name: "Cotizar hogar" }],
};

function WorkspaceProbe() {
  const { flow, stepIndex, selectFlow, openSecrets, updateDraft, view } =
    useSaviaRequestWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="active-flow">{flow?.name ?? "sin flow"}</p>
      <p data-testid="active-view">{view}</p>
      <p data-testid="active-step">{stepIndex}</p>
      <p data-testid="selection-url">{location.pathname + location.search}</p>
      <button
        onClick={() =>
          flow ? updateDraft({ ...flow, name: "Autos editado" }) : undefined
        }
        type="button"
      >
        Editar autos
      </button>
      <button onClick={() => void selectFlow("hogar")} type="button">
        Seleccionar hogar
      </button>
      <button onClick={openSecrets} type="button">
        Abrir secretos
      </button>
      <button
        onClick={() => navigate("/savia-request?flow=hogar&step=0")}
        type="button"
      >
        Navegar hogar directamente
      </button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/flows")) {
      return [
        { id: autos.id, name: autos.name, steps: autos.steps },
        { id: hogar.id, name: hogar.name, steps: hogar.steps },
      ];
    }
    if (path.endsWith("/folders")) return ["Cotizaciones"];
    if (path.endsWith("/flows/autos")) return autos;
    if (path.endsWith("/flows/hogar")) return hogar;
    throw new Error(`Ruta inesperada: ${path}`);
  });
  const put = vi.fn().mockResolvedValue({ ok: true });
  const services = {
    apiClient: { get, put, post: vi.fn(), delete: vi.fn(), request: vi.fn() },
  } as unknown as AppServices;

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <WorkspaceProbe />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
  return { get, put };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestProvider", () => {
  it("restores the requested flow and step from the Savia Request URL", async () => {
    renderProvider("/savia-request?flow=autos&step=1");

    expect(await screen.findByTestId("active-flow")).toHaveTextContent("Autos");
    expect(screen.getByTestId("active-step")).toHaveTextContent("1");
  });

  it("saves a dirty flow before switching to another selection", async () => {
    const user = userEvent.setup();
    const { put } = renderProvider("/savia-request?flow=autos&step=0");

    await screen.findByText("Autos");
    await user.click(screen.getByRole("button", { name: "Editar autos" }));
    await user.click(screen.getByRole("button", { name: "Seleccionar hogar" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/v1/savia-request/api/flows/autos",
        expect.objectContaining({ name: "Autos editado" }),
      ),
    );
    expect(await screen.findByTestId("active-flow")).toHaveTextContent("Hogar");
    expect(screen.getByTestId("selection-url")).toHaveTextContent(
      "/savia-request?flow=hogar&step=0",
    );
  });

  it("saves a dirty flow before loading a selection from the URL", async () => {
    const user = userEvent.setup();
    const { put } = renderProvider("/savia-request?flow=autos&step=0");

    await screen.findByText("Autos");
    await user.click(screen.getByRole("button", { name: "Editar autos" }));
    await user.click(
      screen.getByRole("button", { name: "Navegar hogar directamente" }),
    );

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/v1/savia-request/api/flows/autos",
        expect.objectContaining({ name: "Autos editado" }),
      ),
    );
    expect(await screen.findByTestId("active-flow")).toHaveTextContent("Hogar");
  });

  it("keeps the secretos view without selecting a flow", async () => {
    const { get } = renderProvider("/savia-request?view=secretos");

    expect(await screen.findByTestId("active-view")).toHaveTextContent(
      "secretos",
    );
    expect(screen.getByTestId("active-flow")).toHaveTextContent("sin flow");
    expect(screen.getByTestId("selection-url")).toHaveTextContent(
      "/savia-request?view=secretos",
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining("/flows")),
    );
    expect(get).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/flows\/(autos|hogar)$/),
    );
  });

  it("opens the secretos view keeping the in-progress draft", async () => {
    const user = userEvent.setup();
    renderProvider("/savia-request?flow=autos&step=0");

    await screen.findByText("Autos");
    await user.click(screen.getByRole("button", { name: "Editar autos" }));
    await user.click(screen.getByRole("button", { name: "Abrir secretos" }));

    expect(await screen.findByTestId("active-view")).toHaveTextContent(
      "secretos",
    );
    expect(screen.getByTestId("selection-url")).toHaveTextContent(
      "/savia-request?view=secretos",
    );
    expect(screen.getByTestId("active-flow")).toHaveTextContent(
      "Autos editado",
    );
  });
});
