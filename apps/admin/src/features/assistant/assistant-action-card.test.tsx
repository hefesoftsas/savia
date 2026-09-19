import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "./assistant-context";
import { AssistantActionCard } from "./assistant-bar";

const action = {
  actionId: "pending-17",
  domain: "agencies",
  command: "update",
  expiresAt: "2026-09-02T12:05:00.000Z",
  input: { displayName: "Savia Norte", isActive: true },
  requiresConfirmation: true as const,
};

describe("AssistantActionCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("executes a prepared change only after the user confirms it", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ state: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const services = {
      authSession: { getAccessToken: vi.fn().mockResolvedValue("token-17") },
    } as unknown as AppServices;
    const user = userEvent.setup();

    render(
      <AppServicesProvider services={services}>
        <AssistantActionCard action={action} />
      </AppServicesProvider>,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText("displayName")).toBeVisible();
    expect(screen.getByText("Savia Norte")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirmar cambio" }));

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/api/assistant/actions/pending-17/confirm"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Cambio ejecutado.")).toBeVisible();
  });

  it("renders friendly CRM action title and flattens data fields", () => {
    const services = {
      authSession: { getAccessToken: vi.fn() },
    } as unknown as AppServices;

    const crmAction = {
      actionId: "crm-1",
      domain: "cartera",
      command: "create-record",
      expiresAt: "2026-09-02T12:05:00.000Z",
      input: {
        collection: "cartera",
        data: { name: "juancho", number_1: 10000000 },
      },
      requiresConfirmation: true as const,
    };

    render(
      <AppServicesProvider services={services}>
        <AssistantActionCard action={crmAction} />
      </AppServicesProvider>,
    );

    expect(screen.getByText('Crear registro en "cartera"')).toBeVisible();
    expect(screen.getByText("collection")).toBeVisible();
    expect(screen.getByText("name")).toBeVisible();
    expect(screen.getByText("juancho")).toBeVisible();
    expect(screen.getByText("number_1")).toBeVisible();
    expect(screen.getByText("10000000")).toBeVisible();
  });
});

it("shows the saved quotation link and evidence-based comparison after confirmation", async () => {
  const quoteResult = {
    quoteId: "q1",
    reference: "COT-1",
    url: "/#/crm?domain=platform&object=cotizador_por_pasos&quote=q1",
    failedOffers: 1,
    unpricedOffers: 0,
    pricedOffers: 1,
    lowestPremium: 1000,
    lowestPriceOffers: [
      { provider: "Liberty", product: "Liberty Full", premium: 1000 },
    ],
    tiedOfferCount: 1,
    recommendation: "Faltan coberturas y deducibles para elegir.",
    persistenceWarnings: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url, init) =>
      Promise.resolve(
        Response.json(
          init?.method === "POST"
            ? {
                state: "completed",
                result: {
                  content: [
                    { type: "text", text: JSON.stringify(quoteResult) },
                  ],
                },
              }
            : { state: "pending" },
        ),
      ),
    ),
  );
  const services = {
    authSession: { getAccessToken: vi.fn().mockResolvedValue("token") },
  } as unknown as AppServices;
  render(
    <AppServicesProvider services={services}>
      <AssistantActionCard
        action={{
          ...action,
          domain: "insurance",
          command: "quote-auto",
          input: { vehicle: { plate: "TESTCAR" } },
        }}
      />
    </AppServicesProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Confirmar y cotizar" }),
  );
  expect(
    await screen.findByRole("link", {
      name: "Ver cotización y comparar ofertas",
    }),
  ).toHaveAttribute("href", quoteResult.url);
  expect(
    screen.getByText("Faltan coberturas y deducibles para elegir."),
  ).toBeVisible();
  vi.unstubAllGlobals();
});

it.each(["failed", "expired"])(
  "recovers a %s quote without presenting it as cancelled or offering replay",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json({ state: status })),
        ),
    );
    const services = {
      authSession: { getAccessToken: vi.fn().mockResolvedValue("token") },
    } as unknown as AppServices;
    render(
      <AppServicesProvider services={services}>
        <AssistantActionCard
          action={{ ...action, domain: "insurance", command: "quote-auto" }}
        />
      </AppServicesProvider>,
    );
    expect(
      await screen.findByText(
        status === "failed"
          ? /La cotización no pudo completarse/
          : /La confirmación venció/,
      ),
    ).toBeVisible();
    expect(screen.queryByText("Cambio cancelado.")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirmar y cotizar" }),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  },
);

it("formats quote values for people rather than exposing raw booleans and amounts", async () => {
  const { formatQuoteField } = await import("./assistant-quote-result");
  expect(formatQuoteField(false, "vehicle.isNew")).toBe("No");
  expect(formatQuoteField("M", "applicant.gender")).toBe("Masculino");
  expect(formatQuoteField("1984-08-26", "applicant.birthDate")).toBe(
    "26/08/1984",
  );
  expect(formatQuoteField(16000000, "vehicle.declaredValue")).toContain(
    "16.000.000",
  );
});
