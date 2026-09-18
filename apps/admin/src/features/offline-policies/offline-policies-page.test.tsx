import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { OfflinePoliciesPage } from "./offline-policies-page";

vi.mock("ra-core", () => ({
  useCanAccess: () => ({ canAccess: true, isPending: false }),
  useTranslate: () => (key: string, options?: { _?: string }) => options?._ ?? key,
}));

afterEach(cleanup);

function servicesWith(policies: unknown[] = []) {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/tenants") {
        return {
          data: [
            { id: 101, name: "Acme", kind: "commercial" },
            { id: 0, name: "Plataforma", kind: "platform" },
          ],
        };
      }
      return { data: policies };
    }),
    put: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => undefined),
  };
  return { apiClient, services: { apiClient } as unknown as AppServices };
}

describe("OfflinePoliciesPage", () => {
  it("lists commercial tenants and their policies", async () => {
    const { services } = servicesWith([
      {
        collection: "cotizaciones",
        enabled: true,
        refreshSeconds: 120,
        updatedAt: "2026-09-18T00:00:00.000Z",
      },
    ]);
    render(<OfflinePoliciesPage services={services} />);

    expect(
      await screen.findByRole("heading", { name: "Sin conexión por colección" }),
    ).toBeVisible();
    expect(await screen.findByText("cotizaciones")).toBeVisible();
    expect(screen.getByText("cada 120 s")).toBeVisible();
    // Platform tenant is not manageable here.
    expect(screen.queryByText("Plataforma")).not.toBeInTheDocument();
  });

  it("saves a policy with validation", async () => {
    const { apiClient, services } = servicesWith();
    const user = userEvent.setup();
    render(<OfflinePoliciesPage services={services} />);
    await screen.findByRole("heading", { name: "Sin conexión por colección" });

    await user.type(screen.getByLabelText("Colección"), "Clientes!");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(apiClient.put).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Colección"));
    await user.type(screen.getByLabelText("Colección"), "clientes");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith("/v1/offline/collections", {
        tenantId: 101,
        collection: "clientes",
        enabled: true,
        refreshSeconds: 300,
      });
    });
  });

  it("removes a policy", async () => {
    const { apiClient, services } = servicesWith([
      {
        collection: "polizas",
        enabled: false,
        refreshSeconds: 300,
        updatedAt: "2026-09-18T00:00:00.000Z",
      },
    ]);
    const user = userEvent.setup();
    render(<OfflinePoliciesPage services={services} />);
    await screen.findByText("polizas");

    await user.click(screen.getByRole("button", { name: "Eliminar polizas" }));
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/v1/offline/collections?tenantId=101&collection=polizas",
      );
    });
  });
});
