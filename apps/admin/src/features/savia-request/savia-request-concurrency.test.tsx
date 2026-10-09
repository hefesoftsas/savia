import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
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
import { rotateSessionScope } from "@/auth/session-scope";

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
  const {
    error,
    flow,
    flows,
    folders,
    reloadFlow,
    refreshNavigation,
    saveDraft,
    updateDraft,
  } = useSaviaRequestWorkspace();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="flow-name">{flow?.name ?? "sin flow"}</p>
      <p data-testid="flows-count">{flows.length}</p>
      <p data-testid="folders-count">{folders.length}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => void reloadFlow()}>
        reload
      </button>
      <button type="button" onClick={() => void saveDraft()}>
        save
      </button>
      <button type="button" onClick={() => void refreshNavigation()}>
        pending navigation
      </button>
      <button
        type="button"
        onClick={() => flow && updateDraft({ ...flow, name: "Local draft" })}
      >
        dirty
      </button>
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
  it("clears protected flow state on a 403 and keeps the read retryable", async () => {
    let detailCalls = 0;
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) return [autosSummary];
      if (path.endsWith("/folders")) return ["Cotizaciones"];
      if (path.endsWith("/flows/autos")) {
        detailCalls += 1;
        if (detailCalls > 1)
          throw new ApiClientError(403, "forbidden", "Denied");
        return autos;
      }
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "reload" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow");
    expect(screen.getByTestId("flows-count")).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "reload" })).toBeEnabled();
  });

  it("retains the current flow after a transient reload failure", async () => {
    let detailCalls = 0;
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) return [autosSummary];
      if (path.endsWith("/folders")) return ["Cotizaciones"];
      if (path.endsWith("/flows/autos")) {
        detailCalls += 1;
        if (detailCalls > 1) throw new Error("Temporary network failure");
        return autos;
      }
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "dirty" }));
    await user.click(screen.getByRole("button", { name: "reload" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary network failure",
    );
    expect(screen.getByTestId("flow-name")).toHaveTextContent("Local draft");
    expect(screen.getByTestId("flows-count")).toHaveTextContent("1");
  });

  it("keeps a dirty draft after a write-only 403", async () => {
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) return [autosSummary];
      if (path.endsWith("/folders")) return ["Cotizaciones"];
      if (path.endsWith("/flows/autos")) return autos;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const put = vi.fn(async () => {
      throw new ApiClientError(403, "forbidden", "Write denied");
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={servicesWith({ get, put })}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("flow-name")).toHaveTextContent("Autos");
    await user.click(screen.getByRole("button", { name: "dirty" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Write denied");
    expect(screen.getByTestId("flow-name")).toHaveTextContent("Local draft");
    expect(screen.getByTestId("flows-count")).toHaveTextContent("1");
  });

  it("does not restore navigation after a denied read", async () => {
    const pendingFlows = deferred<FlowSummary[]>();
    const pendingFolders = deferred<string[]>();
    let flowCalls = 0;
    let folderCalls = 0;
    let detailCalls = 0;
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) {
        flowCalls += 1;
        return flowCalls === 1 ? [autosSummary] : pendingFlows.promise;
      }
      if (path.endsWith("/folders")) {
        folderCalls += 1;
        return folderCalls === 1 ? ["Cotizaciones"] : pendingFolders.promise;
      }
      if (path.endsWith("/flows/autos")) {
        detailCalls += 1;
        if (detailCalls > 1)
          throw new ApiClientError(403, "forbidden", "Denied");
        return autos;
      }
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const user = userEvent.setup();
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
    await user.click(
      screen.getByRole("button", { name: "pending navigation" }),
    );
    await waitFor(() => {
      expect(flowCalls).toBe(2);
      expect(folderCalls).toBe(2);
    });
    await user.click(screen.getByRole("button", { name: "reload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.getByTestId("flows-count")).toHaveTextContent("0");

    pendingFlows.resolve([autosSummary]);
    pendingFolders.resolve(["Stale folder"]);
    await waitFor(() =>
      expect(screen.getByTestId("flows-count")).toHaveTextContent("0"),
    );
    expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow");
  });

  it("ignores old-scope navigation responses after a tenant switch", async () => {
    const pendingFlows = deferred<FlowSummary[]>();
    const pendingFolders = deferred<string[]>();
    let flowCalls = 0;
    let folderCalls = 0;
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (raw.includes("tenant=tenant%3A99")) {
        if (path.endsWith("/flows")) return [];
        if (path.endsWith("/folders")) return [];
      }
      if (path.endsWith("/flows")) {
        flowCalls += 1;
        return flowCalls === 1 ? [autosSummary] : pendingFlows.promise;
      }
      if (path.endsWith("/folders")) {
        folderCalls += 1;
        return folderCalls === 1
          ? ["Old tenant folder"]
          : pendingFolders.promise;
      }
      if (path.endsWith("/flows/autos")) return autos;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const services = servicesWith({ get });
    const user = userEvent.setup();
    const renderTree = () => (
      <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
        <AppServicesProvider services={services}>
          <SaviaRequestProvider>
            <Probe />
          </SaviaRequestProvider>
        </AppServicesProvider>
      </MemoryRouter>
    );
    const { rerender } = render(renderTree());

    expect(await screen.findByTestId("flow-name")).toHaveTextContent("Autos");
    await user.click(
      screen.getByRole("button", { name: "pending navigation" }),
    );
    await waitFor(() => {
      expect(flowCalls).toBe(2);
      expect(folderCalls).toBe(2);
    });

    scopeState.scope = "tenant:99";
    rerender(renderTree());
    await waitFor(() => {
      expect(screen.getByTestId("flows-count")).toHaveTextContent("0");
      expect(screen.getByTestId("folders-count")).toHaveTextContent("0");
    });
    pendingFlows.resolve([autosSummary]);
    pendingFolders.resolve(["Stale old tenant folder"]);
    await waitFor(() => {
      expect(screen.getByTestId("flows-count")).toHaveTextContent("0");
      expect(screen.getByTestId("folders-count")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow");
  });

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

    scopeState.scope = "tenant:99";
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

  it("ignores pending detail after principal rotation", async () => {
    const oldDetail = deferred<RequestFlow>();
    let flowListCalls = 0;
    const getIdentity = vi
      .fn()
      .mockResolvedValueOnce({ id: "old-principal" })
      .mockResolvedValueOnce({ id: "new-principal" });
    const get = vi.fn(async (raw: string) => {
      const path = raw.split("?")[0];
      if (path.endsWith("/flows")) {
        flowListCalls += 1;
        return flowListCalls === 1 ? [autosSummary] : [];
      }
      if (path.endsWith("/folders")) return ["Cotizaciones"];
      if (path.endsWith("/flows/autos")) return oldDetail.promise;
      throw new Error(`Ruta inesperada: ${raw}`);
    });
    const services = {
      ...servicesWith({ get }),
      authSession: { getIdentity },
    } as unknown as AppServices;
    render(
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
    rotateSessionScope("principal-change");
    await waitFor(() => expect(flowListCalls).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow"),
    );

    oldDetail.resolve(autos);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("flow-name")).toHaveTextContent("sin flow");
    expect(getIdentity).toHaveBeenCalledTimes(2);
  });
});
