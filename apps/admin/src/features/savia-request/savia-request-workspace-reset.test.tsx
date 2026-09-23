import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { SaviaRequestProvider } from "./savia-request-provider";
import { SaviaRequestWorkspace } from "./savia-request-workspace";
import type { RequestFlow } from "./types";

vi.mock("ra-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ra-core")>()),
  useCanAccess: () => ({ canAccess: true, isPending: false }),
  usePermissions: () => ({
    permissions: {
      canManageIdentity: false,
      memberships: [{ agencyId: 101, role: "agency_admin" }],
    },
  }),
}));

vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => ({
    isDedicated: true,
    slug: "acme",
    name: "Acme",
    kind: "commercial",
    id: 101,
    monogram: "A",
    isPlatformAdmin: false,
    isLoading: false,
  }),
  formatSlugToDisplayName: (slug: string) => slug,
}));

const autos: RequestFlow = {
  id: "autos",
  name: "Autos",
  folderPath: "Cotizaciones",
  customized: true,
  description: "Cotiza autos livianos.",
  input: {},
  variables: [
    {
      key: "endpoint",
      value: "https://a.test",
      secret: false,
      overridden: true,
    },
  ],
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

function renderScopedWorkspace() {
  const get = vi.fn(async (rawPath: string) => {
    const path = rawPath.split("?")[0];
    if (path.endsWith("/flows")) {
      return [
        {
          id: autos.id,
          name: autos.name,
          folderPath: autos.folderPath,
          customized: true,
          steps: autos.steps,
        },
      ];
    }
    if (path.endsWith("/folders")) return ["Cotizaciones"];
    if (path.endsWith("/flows/autos")) return autos;
    if (path.endsWith("/flows/autos/runs")) return [];
    if (path.endsWith("/runs")) return [];
    throw new Error(`Ruta inesperada: ${rawPath}`);
  });
  const post = vi.fn(async (path: string) => {
    if (path.includes("/reset")) return { ok: true, reverted: true };
    return {};
  });
  const request = vi.fn().mockResolvedValue({ ok: true, reverted: true });
  const services = {
    apiClient: {
      get,
      put: vi.fn().mockResolvedValue({ ok: true }),
      post,
      delete: vi.fn(),
      request,
    },
    requestResults: { read: vi.fn() },
  } as unknown as AppServices;

  render(
    <MemoryRouter initialEntries={["/savia-request?flow=autos&step=0"]}>
      <AppServicesProvider services={services}>
        <SaviaRequestProvider>
          <SaviaRequestWorkspace />
        </SaviaRequestProvider>
      </AppServicesProvider>
    </MemoryRouter>,
  );
  return { get, post, request };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaviaRequestWorkspace tenant reset", () => {
  it("shows the customized badge and resets the flow after confirmation", async () => {
    const user = userEvent.setup();
    const { post } = renderScopedWorkspace();

    expect(await screen.findByText("Personalizado")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(await screen.findByText("Restablecer flow")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining("/api/flows/autos/reset?tenant=agency%3A101"),
      ),
    );
    expect(
      await screen.findByText("Flow restablecido a valores de plataforma."),
    ).toBeVisible();
  });

  it("resets a single overridden variable from the variables tab", async () => {
    const user = userEvent.setup();
    const { request } = renderScopedWorkspace();

    await screen.findByRole("heading", { name: "Autos" });
    await user.click(screen.getByRole("tab", { name: "Variables" }));
    await user.click(
      await screen.findByRole("button", { name: "Restablecer endpoint" }),
    );

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/flows/autos/variables/endpoint?tenant=agency%3A101",
        ),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await screen.findByText("«endpoint» volvió al valor de plataforma."),
    ).toBeVisible();
  });
});
