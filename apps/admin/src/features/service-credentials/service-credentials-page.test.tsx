import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ServiceCredentialsPage } from "./service-credentials-page";

vi.mock("./crm-domain-credentials-section", () => ({
  CrmDomainCredentialsSection: ({
    globalCredentials,
  }: {
    globalCredentials?: React.ReactNode;
  }) => (
    <section aria-label="CRM credentials mock">{globalCredentials}</section>
  ),
}));

afterEach(cleanup);

function servicesWithSummary() {
  return {
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({
        global: {
          scope: "global",
          keyState: "configured",
          model: "deepseek/deepseek-v4-flash",
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
        agencies: [],
      }),
      models: vi.fn().mockResolvedValue([]),
      activeAgency: vi.fn().mockResolvedValue({
        agencies: [{ id: 101, name: "Agencia Norte" }],
      }),
      saveGlobal: vi.fn(),
      saveAgencyOverride: vi.fn(),
      clearAgencyOverride: vi.fn(),
    },
  } as unknown as AppServices;
}

describe("ServiceCredentialsPage", () => {
  it("shows global AI credentials inside the unified credentials screen", async () => {
    render(<ServiceCredentialsPage services={servicesWithSummary()} />);

    expect(
      await screen.findByRole("heading", { name: "Claves y servicios" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Ayuda sobre credenciales" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "OpenRouter" })).toBeVisible();
    expect(screen.getByLabelText("Clave OpenRouter")).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Por agencia/i })).toBeNull();
  });
});
