import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import {
  clearCachedTenantOptions,
  useTenantOptions,
} from "./savia-request-scope";

function Probe() {
  const tenants = useTenantOptions(true);
  return (
    <p data-testid="tenants">
      {tenants.status}:{tenants.options.map((option) => option.name).join(",")}
    </p>
  );
}

afterEach(() => {
  cleanup();
  clearCachedTenantOptions();
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearCachedTenantOptions();
});

describe("useTenantOptions caché en memoria", () => {
  it("no repite /v1/tenants al entrar y salir con la misma sesión", async () => {
    const get = vi.fn(async () => ({
      data: [
        { id: 101, name: "Norte", kind: "commercial" },
        { id: 7, name: "Plataforma", kind: "platform" },
      ],
    }));
    const services = { apiClient: { get } } as unknown as AppServices;
    const tree = (
      <AppServicesProvider services={services}>
        <Probe />
      </AppServicesProvider>
    );
    const first = render(tree);
    expect(await screen.findByTestId("tenants")).toHaveTextContent(
      "ready:Norte",
    );
    expect(get).toHaveBeenCalledTimes(1);
    first.unmount();
    // Salir y volver a entrar: reutiliza lo conservado sin refetch.
    render(tree);
    expect(await screen.findByTestId("tenants")).toHaveTextContent(
      "ready:Norte",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("vuelve a consultar si cambia el cliente (nueva sesión)", async () => {
    const firstGet = vi.fn(async () => ({ data: [] }));
    const firstServices = {
      apiClient: { get: firstGet },
    } as unknown as AppServices;
    const first = render(
      <AppServicesProvider services={firstServices}>
        <Probe />
      </AppServicesProvider>,
    );
    expect(await screen.findByTestId("tenants")).toHaveTextContent("ready:");
    expect(firstGet).toHaveBeenCalledTimes(1);
    first.unmount();

    const secondGet = vi.fn(async () => ({ data: [] }));
    const secondServices = {
      apiClient: { get: secondGet },
    } as unknown as AppServices;
    render(
      <AppServicesProvider services={secondServices}>
        <Probe />
      </AppServicesProvider>,
    );
    expect(await screen.findByTestId("tenants")).toHaveTextContent("ready:");
    expect(secondGet).toHaveBeenCalledTimes(1);
  });
});
