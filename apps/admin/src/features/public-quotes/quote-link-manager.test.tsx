import { I18nContextProvider } from "ra-core";
import {
  cleanup,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuoteLinkManager } from "./quote-link-manager";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T13:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const row = {
  id: "quote-link-1",
  quoteId: "quote-42",
  url: "https://savia.example/public/quotes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  createdAt: "2026-10-01T12:00:00.000Z",
  expiresAt: "2026-10-08T12:00:00.000Z",
  revokedAt: null,
};

it("lists, opens, copies, and marks a quote link revoked only after the API acknowledges it", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ items: [row] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      Response.json({
        items: [{ ...row, revokedAt: "2026-10-07T12:00:00.000Z" }],
      }),
    );
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<QuoteLinkManager tenantId={7} request={request} />);

  fireEvent.click(screen.getByText("Shared quote results"));
  expect(
    await screen.findByRole("link", { name: /open quote link/i }),
  ).toHaveAttribute("href", row.url);
  expect(screen.getByText(/expires/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /copy quote link/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(row.url));
  fireEvent.click(screen.getByRole("button", { name: /revoke link/i }));

  expect((await screen.findAllByText("Revoked")).length).toBeGreaterThanOrEqual(
    1,
  );
  expect(request.mock.calls).toEqual([
    ["/api/tenants/7/quote-links"],
    ["/api/tenants/7/quote-links/quote-link-1", { method: "DELETE" }],
    ["/api/tenants/7/quote-links"],
  ]);
});

it("does not mark a quote link revoked when the delete request fails", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ items: [row] }))
    .mockResolvedValueOnce(new Response("{}", { status: 500 }));
  render(<QuoteLinkManager tenantId={7} request={request} />);
  fireEvent.click(screen.getByText("Shared quote results"));
  expect(
    await screen.findByRole("button", { name: /revoke link/i }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /revoke link/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not be revoked/i,
  );
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /revoke link/i })).toBeEnabled();
  expect(request).toHaveBeenCalledTimes(2);
});

function render(ui: ReactElement) {
  return renderUi(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "en",
        }}
      >
        {children}
      </I18nContextProvider>
    ),
  });
}

it("does not make an unrecognized URL clickable", async () => {
  const request = vi.fn().mockResolvedValueOnce(
    Response.json({
      items: [{ ...row, url: "https://elsewhere.example/private" }],
    }),
  );
  render(<QuoteLinkManager tenantId={7} request={request} />);
  fireEvent.click(screen.getByText("Shared quote results"));
  expect(await screen.findByText("Active")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /open quote link/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /copy quote link/i }),
  ).not.toBeInTheDocument();
});
