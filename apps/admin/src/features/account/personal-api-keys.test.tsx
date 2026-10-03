import { StoreContextProvider, memoryStore } from "ra-core";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, it, expect, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { PersonalApiKeysPanel } from "./personal-api-keys";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("creates the restricted preset, reveals once and revokes through the API", async () => {
  const user = userEvent.setup();
  let rows: any[] = [];
  let posted: any;
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/tenants"))
        return Response.json({ tenants: [{ id: 1, name: "My workspace" }] });
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        rows = [
          {
            id: "key-1",
            name: posted.name,
            prefix: "savia_pat_prefix",
            tenantId: 1,
            scopes: posted.scopes,
            createdAt: "2026-10-03",
            expiresAt: "2026-11-02",
            revokedAt: null,
            lastUsedAt: null,
          },
        ];
        return Response.json(
          { key: rows[0], secret: "savia_pat_once" },
          { status: 201 },
        );
      }
      if (init?.method === "DELETE") {
        rows[0].revokedAt = "2026-10-03";
        return new Response(null, { status: 204 });
      }
      return Response.json({ keys: rows });
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <PersonalApiKeysPanel api={api} />
    </StoreContextProvider>,
  );
  await screen.findByRole("option", { name: "My workspace" });
  await user.type(screen.getByLabelText("Nombre de la clave"), "Companion");
  await user.click(screen.getByRole("button", { name: "Crear clave" }));
  await screen.findByDisplayValue("savia_pat_once");
  expect(posted).toEqual({
    name: "Companion",
    tenantId: 1,
    lifetimeDays: 30,
    scopes: ["recordings:read", "recordings:upload"],
  });
  await user.click(screen.getByRole("button", { name: "Ya guardé la clave" }));
  expect(screen.queryByDisplayValue("savia_pat_once")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Revocar Companion" }));
  await waitFor(() => expect(screen.getByText("Revocada")).toBeTruthy());
});
it("shows an actionable loading failure without a secret", async () => {
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return null;
      },
    },
    fetcher: async () =>
      Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <PersonalApiKeysPanel api={api} />
    </StoreContextProvider>,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByLabelText("Nueva clave")).toBeNull();
});
