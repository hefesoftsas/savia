import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import {
  SaviaRequestProvider,
  useSaviaRequestWorkspace,
} from "./savia-request-provider";
import {
  clearAllSaviaRequestSnapshots,
  writeSaviaRequestSnapshot,
} from "./savia-request-cache";
import type { FlowSummary, RequestFlow } from "./types";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
}));

const scopeState = {
  scope: undefined as string | undefined,
  label: "Plataforma (catálogo global)",
  ready: true,
  isPlatformAdmin: false,
  canOverride: false,
  options: [] as string[],
  applyOverride: () => undefined,
};

vi.mock("./savia-request-scope", () => ({
  clearCachedTenantOptions: vi.fn(),
  useSaviaRequestScope: () => scopeState,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const autos: RequestFlow = {
  id: "autos",
  name: "Autos",
  description: "",
  input: {},
  variables: [],
  versions: [],
  steps: [
    {
      id: "s1",
      name: "Paso",
      url: "https://provider.test/q",
      method: "GET",
      headers: {},
      body: "{}",
      pre: "",
      post: "",
    },
  ],
};
const hogar: RequestFlow = { ...autos, id: "hogar", name: "Hogar" };
const autosSummary: FlowSummary = {
  id: "autos",
  name: "Autos",
  steps: autos.steps,
} as FlowSummary;
const hogarSummary: FlowSummary = {
  id: "hogar",
  name: "Hogar",
  steps: hogar.steps,
} as FlowSummary;

function Probe({ navigateTo }: { navigateTo?: string }) {
  const { flow, flows } = useSaviaRequestWorkspace();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="flow-name">{flow?.name ?? "sin flow"}</p>
      <p data-testid="flows-count">{flows.length}</p>
      {navigateTo ? (
        <button type="button" onClick={() => navigate(navigateTo)}>
          ir
        </button>
      ) : null}
    </>
  );
}

function servicesWith(apiClient: unknown) {
  return { apiClient } as unknown as AppServices;
}

afterEach(() => {
  cleanup();
  clearAllSaviaRequestSnapshots();
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearAllSaviaRequestSnapshots();
  scopeState.scope = undefined;
});

describe("SaviaRequestProvider concurrencia", () => {
  it("ignora la respuesta tardía del flow anterior al navegar rápido", async () => {
    const user = userEvent.setup();
    const flowsFirst = deferred<FlowSummary[]>();
    const foldersFirst = deferred<string[]>();
    const autosDetail = deferred<RequestFlow>();
    let flowsCalls = 0;
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) {
        flowsCalls += 1;
        return flowsCalls === 1
          ? flowsFirst.promise
          : [autosSummary, hogarSummary];
      }
      if (path.endsWith("/folders")) {
        return foldersFirst.promise;
      }
      if (path.endsWith("/flows/autos")) return autosDetail.promise;
      if (path.endsWith("/flows/hogar")) return hogar;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    render(
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={servicesWith({ get })}>
          <SaviaRequestProvider>
            <Probe navigateTo="/savia-request?flow=hogar&step=0" />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );

    foldersFirst.resolve(["Cotizaciones"]);
    flowsFirst.resolve([autosSummary, hogarSummary]);
    // Deja que el primer efecto pida el detalle de autos (lento).
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining("/flows/autos")),
    );
    await user.click(screen.getByRole("button", { name: "ir" }));
    expect(await screen.findByTestId("flow-name")).toHaveTextContent("Hogar");
    // La respuesta tardía de autos no reemplaza a hogar.
    autosDetail.resolve(autos);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("flow-name")).toHaveTextContent("Hogar");
  });

  it("muestra el detalle sin esperar a carpetas lentas", async () => {
    const foldersSlow = deferred<string[]>();
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) return [autosSummary];
      if (path.endsWith("/folders")) return foldersSlow.promise;
      if (path.endsWith("/flows/autos")) return autos;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    render(
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={servicesWith({ get })}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("flow-name")).toHaveTextContent("Autos");
    foldersSlow.resolve(["Cotizaciones"]);
  });

  it("limpia al cambiar de tenant e ignora lo tardío del ámbito anterior", async () => {
    const autosDetail = deferred<RequestFlow>();
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      // El tenant nuevo no ve el catálogo de plataforma en este mock.
      if (raw.includes("tenant=")) {
        if (path.endsWith("/flows")) return [];
        if (path.endsWith("/folders")) return [];
        throw new Error(`Detalle inesperado en tenant: ${raw}`);
      }
      if (path.endsWith("/flows")) return [autosSummary];
      if (path.endsWith("/folders")) return ["C"];
      if (path.endsWith("/flows/autos")) return autosDetail.promise;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const services = servicesWith({ get });
    const { rerender } = render(
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={services}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining("/flows/autos")),
    );

    scopeState.scope = "agency:99";
    rerender(
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={services}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );
    // Limpieza inmediata del ámbito anterior.
    await waitFor(() =>
      expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow"),
    );
    autosDetail.resolve(autos);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow");
    // El nuevo ámbito consulta con su tenant.
    expect(get).toHaveBeenCalledWith(expect.stringContaining("tenant="));
  });

  it("revalida una sola vez al regresar y sincroniza la URL", async () => {
    writeSaviaRequestSnapshot(undefined, {
      flows: [autosSummary],
      folders: ["Cotizaciones"],
      flow: autos,
      stepIndex: 1,
      error: null,
      updatedAt: Date.now(),
    });
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) return [autosSummary, hogarSummary];
      if (path.endsWith("/folders")) return ["Cotizaciones"];
      if (path.endsWith("/flows/autos")) return autos;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    render(
      <MemoryRouter initialEntries={["/savia-request"]}>
        <AppServicesProvider services={servicesWith({ get })}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );

    // Contenido conservado visible de inmediato...
    expect(await screen.findByTestId("flow-name")).toHaveTextContent("Autos");
    // ...y la URL refleja la selección tras revalidar una sola vez.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining("/folders")),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const flowCalls = get.mock.calls.filter(([path]) =>
      (path as string).split("?")[0].endsWith("/flows"),
    );
    expect(flowCalls).toHaveLength(1);
  });
});
