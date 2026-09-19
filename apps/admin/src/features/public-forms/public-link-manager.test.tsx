import {
  cleanup,
  fireEvent,
  render,
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
