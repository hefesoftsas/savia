import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicQuotePage } from "./public-quote-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const report = {
  version: 1 as const,
  reference: "COT-2026-1042",
  createdAt: "2026-10-07T12:00:00.000Z",
  proposals: [
    {
      id: "offer-a",
      provider: "Aseguradora Uno",
      product: "Protección familiar",
      state: "priced" as const,
      premium: 385000,
      currency: "COP" as const,
      facts: [
        {
          label: "Asistencia vial",
          value: "Incluida",
          source: "provider" as const,
        },
        {
          label: "Deducible",
          value: "$500.000",
          source: "saved_verified" as const,
        },
      ],
    },
    {
      id: "offer-b",
      provider: "Aseguradora Dos",
      product: "Plan esencial",
      state: "uncertain" as const,
      currency: "COP" as const,
    },
  ],
  analysis: {
    proposals: [
      { id: "offer-a", explanation: "Se ajusta a las prioridades indicadas." },
    ],
    suggestion: "Compara primero la asistencia y el deducible.",
    preferredProposalId: "offer-a",
    limitations: ["Una oferta todavía no tiene precio confirmado."],
  },
};

it("renders only the published report facts and analysis, with no catalog fallback", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      report,
      expiresAt: "2026-10-14T12:00:00.000Z",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<PublicQuotePage token={"a".repeat(64)} />);

  expect(
    await screen.findByRole("heading", { name: "Protección familiar" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/385/)).toBeInTheDocument();
  expect(screen.getByText("Asistencia vial")).toBeInTheDocument();
  expect(screen.getByText("Incluida")).toBeInTheDocument();
  expect(
    screen.getByText("Se ajusta a las prioridades indicadas."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Compara primero la asistencia y el deducible."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Una oferta todavía no tiene precio confirmado."),
  ).toBeInTheDocument();
  expect(screen.getByText("Resultado sin confirmar")).toBeInTheDocument();
  expect(
    screen.queryByText(/cobertura de vida|puntaje de protección/i),
  ).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`/api/public/quotes/${"a".repeat(64)}`),
    expect.objectContaining({ credentials: "omit", cache: "no-store" }),
  );
});

it("rejects report payloads containing unknown private fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        report: { ...report, applicant: { documentNumber: "123456" } },
        expiresAt: "2026-10-14T12:00:00.000Z",
      }),
    ),
  );
  render(<PublicQuotePage token={"c".repeat(64)} />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText(/123456|applicant/i)).not.toBeInTheDocument();
});

it("rejects malformed tokens without making a request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<PublicQuotePage token="bad-token" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("offers retry when the public link cannot be loaded", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(
      Response.json({ report, expiresAt: "2026-10-14T12:00:00.000Z" }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<PublicQuotePage token={"b".repeat(64)} />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /intentarlo de nuevo|try again/i }),
  );
  expect(await screen.findByText("COT-2026-1042")).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

it("renders verified proposals when analysis is absent", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        report: { ...report, analysis: undefined },
        expiresAt: "2026-10-14T12:00:00.000Z",
      }),
    ),
  );
  render(<PublicQuotePage token={"d".repeat(64)} />);
  expect(
    await screen.findByRole("heading", { name: "Protección familiar" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Orientación para comparar"),
  ).not.toBeInTheDocument();
});

it("does not expose malformed response errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("INTERNAL SERVER ERROR DETAILS", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  render(<PublicQuotePage token={"e".repeat(64)} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No se pudo cargar el resultado.",
  );
  expect(
    screen.queryByText("INTERNAL SERVER ERROR DETAILS"),
  ).not.toBeInTheDocument();
});
