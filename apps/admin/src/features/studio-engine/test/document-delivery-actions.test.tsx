// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "./locale-test-render";
import { DocumentDeliveryActions } from "../document-delivery-actions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const deliveryContext = {
  file: {
    id: "file-1",
    name: "proposal.pdf",
    mime: "application/pdf",
    size: 1200,
    version: 3,
  },
  connections: [
    {
      key: "outlook-connection-v1",
      provider: "outlook",
      status: "connected",
      externalAccountLabel: "alex@example.test",
    },
  ],
  history: [],
};

function renderActions() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DocumentDeliveryActions file={deliveryContext.file} />
    </QueryClientProvider>,
  );
}

it("reviews the Outlook message before sending and confirms only after explicit approval", async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/delivery"))
        return Response.json({ data: deliveryContext });
      if (path.endsWith("/delivery/prepare"))
        return Response.json({
          data: {
            confirmationId: "confirm-1",
            token: "one-use-token",
            expiresAt: "2026-10-01T12:05:00Z",
          },
        });
      if (path.endsWith("/delivery/confirm"))
        return Response.json({
          data: { action: "outlook", status: "succeeded" },
        });
      throw new Error(`Unexpected request: ${path} ${init?.method ?? "GET"}`);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  renderActions();

  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  expect(await screen.findByText(/alex@example\.test/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Para"), {
    target: { value: "one@example.test; two@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Mensaje"), {
    target: { value: "Please review the attached proposal." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));

  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/file/file-1/delivery/prepare",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    ),
  );
  const prepareBody = JSON.parse(
    String(
      fetcher.mock.calls.find(([path]) =>
        String(path).endsWith("/delivery/prepare"),
      )?.[1]?.body,
    ),
  );
  expect(prepareBody).toMatchObject({
    connectionKey: "outlook-connection-v1",
    to: ["one@example.test", "two@example.test"],
    version: 3,
  });
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/confirm"),
    ),
  ).toBe(false);

  expect(
    await screen.findByText(
      "Revisa los destinatarios y el mensaje antes de enviarlo.",
    ),
  ).toBeVisible();
  expect(screen.getByText("one@example.test, two@example.test")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar y enviar" }));

  expect((await screen.findAllByText("Outlook aceptó el envío.")).length).toBe(
    2,
  );
  expect(
    fetcher.mock.calls.some(
      ([path, init]) =>
        String(path).endsWith("/delivery/confirm") && init?.method === "POST",
    ),
  ).toBe(true);
});

it("surfaces prepare failures without making a confirm request", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/delivery"))
      return Response.json({ data: deliveryContext });
    if (path.endsWith("/delivery/prepare"))
      return Response.json(
        {
          error: {
            code: "OUTLOOK_NOT_CONNECTED",
            message: "Reconnect Outlook first.",
          },
        },
        { status: 409 },
      );
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  renderActions();

  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  fireEvent.change(await screen.findByLabelText("Para"), {
    target: { value: "one@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Mensaje"), {
    target: { value: "Please review the attached proposal." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Reconnect Outlook first.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/confirm"),
    ),
  ).toBe(false);
});

it("validates Outlook recipients, subject, and message locally before prepare", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/delivery"))
      return Response.json({ data: deliveryContext });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  renderActions();

  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  const review = await screen.findByRole("button", { name: "Revisar entrega" });
  await waitFor(() => expect(review).toBeEnabled());
  fireEvent.click(review);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Debes indicar al menos un destinatario.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/prepare"),
    ),
  ).toBe(false);

  fireEvent.change(screen.getByLabelText("Para"), {
    target: { value: "not-an-email" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Revisa las direcciones de correo.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/prepare"),
    ),
  ).toBe(false);

  fireEvent.change(screen.getByLabelText("Para"), {
    target: { value: "one@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Asunto"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Debes escribir un asunto.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/prepare"),
    ),
  ).toBe(false);

  fireEvent.change(screen.getByLabelText("Asunto"), {
    target: { value: "Proposal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Escribe un mensaje antes de continuar.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).endsWith("/delivery/prepare"),
    ),
  ).toBe(false);
});

it("preserves delivery success when history refresh fails and retries only the read", async () => {
  let confirmed = false;
  let recover = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/delivery")) {
      if (confirmed && !recover)
        return Response.json(
          { error: "Internal history failure" },
          { status: 500 },
        );
      return Response.json({ data: deliveryContext });
    }
    if (path.endsWith("/prepare"))
      return Response.json({
        data: {
          confirmationId: "confirm-1",
          token: "one-use-token",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      });
    if (path.endsWith("/confirm")) {
      confirmed = true;
      return Response.json({
        data: { action: "outlook", status: "succeeded" },
      });
    }
    throw new Error(path);
  });
  vi.stubGlobal("fetch", fetcher);
  renderActions();
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  fireEvent.change(await screen.findByLabelText("Para"), {
    target: { value: "one@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Mensaje"), {
    target: { value: "Please review." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrega" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirmar y enviar" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Actualizar historial",
  });
  expect(screen.getAllByText("Outlook aceptó el envío.")).toHaveLength(2);
  expect(
    screen.queryByText("Internal history failure"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Aún no hay entregas registradas."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Confirmar y enviar" }),
  ).not.toBeInTheDocument();
  recover = true;
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Actualizar historial" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    fetcher.mock.calls.filter(([path]) => String(path).endsWith("/confirm")),
  ).toHaveLength(1);
});
