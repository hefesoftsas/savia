import { I18nContextProvider } from "ra-core";
import type { ReactElement, ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicLinkManager } from "./public-link-manager";
afterEach(cleanup);
it("publishes an acknowledged snapshot, copies its public URL and revokes its link", async () => {
  const row = {
    id: "link-id",
    token: "token",
    path: "/public/forms/token",
    url: "https://public.savia.test/public/forms/token",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: row })))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );
  await screen.findByText(/Aún no hay enlaces/);
  expect(
    screen.getByRole("button", { name: "Publicar enlace" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/versión actual/));
  fireEvent.click(screen.getByRole("button", { name: "Publicar enlace" }));
  await screen.findByRole("button", { name: "Copiar enlace" });
  expect(request.mock.calls[0][0]).toBe(
    "/v1/public-forms?domainId=domain&objectName=people",
  );
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    domainId: "domain",
    objectName: "people",
    kind: "record",
    dailyLimit: 25,
  });
  fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      "https://public.savia.test/public/forms/token",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Revocar enlace" }));
  expect(await screen.findByText("Revocado")).toBeInTheDocument();
  expect(request.mock.calls[2]).toEqual([
    "/v1/public-forms/link-id",
    { method: "DELETE" },
  ]);
});
it("deletes a revoked link only after inline confirmation", async () => {
  const row = {
    id: "dead-link",
    token: "dead-token",
    path: "/public/forms/dead-token",
    url: "https://public.savia.test/public/forms/dead-token",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: "2026-09-20T00:00:00.000Z",
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );
  await screen.findByText("Revocado");
  expect(screen.getByRole("button", { name: "Revocar enlace" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar enlace" }));
  expect(
    screen.getByText("¿Eliminar este enlace y su historial de envíos?"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(
    screen.queryByText("¿Eliminar este enlace y su historial de envíos?"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar enlace" }));
  // The trigger is replaced by the inline confirmation: a single delete left.
  fireEvent.click(screen.getByRole("button", { name: "Eliminar enlace" }));
  expect(request.mock.calls[1]).toEqual([
    "/v1/public-forms/dead-link?hard=true",
    { method: "DELETE" },
  ]);
  await waitFor(() =>
    expect(screen.getByText("Enlace eliminado.")).toBeInTheDocument(),
  );
  expect(
    screen.queryByText("https://public.savia.test/public/forms/dead-token"),
  ).not.toBeInTheDocument();
});
it("explains missing captcha configuration when publishing is unavailable", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }));
  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );
  await screen.findByText(/Aún no hay enlaces/);
  fireEvent.click(screen.getByLabelText(/versión actual/));
  fireEvent.click(screen.getByRole("button", { name: "Publicar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "falta configurar",
  );
});
it("toggles the QR code and downloads it as SVG", async () => {
  const row = {
    id: "link-qr",
    token: "token-qr-123",
    path: "/public/forms/token-qr-123",
    url: "https://public.savia.test/public/forms/token-qr-123",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const createObjectURL = vi.fn().mockReturnValue("blob:qr-svg");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    render(
      <PublicLinkManager
        domainId="domain"
        objectName="people"
        kind="record"
        request={request}
      />,
    );
    const toggle = await screen.findByRole("button", { name: "Mostrar QR" });
    expect(
      screen.queryByRole("img", { name: "Código QR del enlace público" }),
    ).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(
      await screen.findByRole("img", {
        name: "Código QR del enlace público",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ocultar QR" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Descargar QR en SVG" }),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar QR" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: "Código QR del enlace público" }),
      ).not.toBeInTheDocument(),
    );
  } finally {
    clickSpy.mockRestore();
  }
});

it("shares the public URL when Web Share API is available", async () => {
  const row = {
    id: "share-link",
    token: "token-share",
    path: "/public/forms/token-share",
    url: "https://public.savia.test/public/forms/token-share",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })));
  const shareMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: shareMock,
  });

  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
      screenTitle="Personas"
    />,
  );

  const shareButton = await screen.findByRole("button", { name: "Compartir" });
  fireEvent.click(shareButton);

  await waitFor(() =>
    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://public.savia.test/public/forms/token-share",
        title: "Personas · Savia",
      }),
    ),
  );
});

it("creates a Savia short URL through the authenticated API", async () => {
  const row = {
    id: "short-link",
    token: "token-short",
    path: "/public/forms/token-short",
    url: "https://public.savia.test/public/forms/token-short",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { shortUrl: "https://public.savia.test/s/0123456789abcdef" },
        }),
      ),
    );

  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );

  const shortenButton = await screen.findByRole("button", {
    name: "Acortar URL",
  });
  fireEvent.click(shortenButton);

  await waitFor(() =>
    expect(
      screen.getByText("https://public.savia.test/s/0123456789abcdef"),
    ).toBeInTheDocument(),
  );
  expect(request.mock.calls[1]).toEqual([
    "/v1/public-forms/short-link/short-url",
    { method: "POST" },
  ]);
});

it("restores a published short URL when the link list reloads", async () => {
  const shortUrl = "https://public.savia.test/s/0123456789abcdef";
  const row = {
    id: "saved-short-link",
    token: "token-saved-short",
    path: "/public/forms/token-saved-short",
    url: "https://public.savia.test/public/forms/token-saved-short",
    shortUrl,
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })));

  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );

  expect(await screen.findByText(shortUrl)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Enlace corto" }),
  ).toBeDisabled();
});

it("renders the direct open link button and back button when provided", async () => {
  const row = {
    id: "open-link",
    token: "token-open",
    path: "/public/forms/token-open",
    url: "https://public.savia.test/public/forms/token-open",
    kind: "record",
    dailyLimit: 25,
    expiresAt: null,
    revokedAt: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [row] })));
  const onBack = vi.fn();

  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
      onBack={onBack}
    />,
  );

  const openLink = await screen.findByRole("link", { name: "Abrir enlace" });
  expect(openLink).toHaveAttribute(
    "href",
    "https://public.savia.test/public/forms/token-open",
  );
  expect(openLink).toHaveAttribute("target", "_blank");

  const backButton = screen.getByRole("button", {
    name: "Volver a la configuración",
  });
  fireEvent.click(backButton);
  expect(onBack).toHaveBeenCalledOnce();
});

it("applies expiration and limit presets in creation form", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));

  render(
    <PublicLinkManager
      domainId="domain"
      objectName="people"
      kind="record"
      request={request}
    />,
  );

  await screen.findByText(/Aún no hay enlaces/);

  // Click 10 submissions preset
  fireEvent.click(screen.getByRole("button", { name: "10" }));
  const limitInput = screen.getByLabelText(
    "Máximo de envíos al día",
  ) as HTMLInputElement;
  expect(limitInput.value).toBe("10");

  // Click 7 days preset
  fireEvent.click(screen.getByRole("button", { name: "7 días" }));
  const expiryInput = screen.getByLabelText(
    "Vence el (opcional)",
  ) as HTMLInputElement;
  expect(expiryInput.value).not.toBe("");

  // Click clear preset
  fireEvent.click(screen.getByRole("button", { name: "Sin vencimiento" }));
  expect(expiryInput.value).toBe("");
});

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "es",
        }}
      >
        {children}
      </I18nContextProvider>
    ),
  });
}
