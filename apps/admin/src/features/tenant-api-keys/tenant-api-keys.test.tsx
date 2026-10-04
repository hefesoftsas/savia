import { StoreContextProvider, memoryStore } from "ra-core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { TenantApiKeysPanel } from "./tenant-api-keys";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("creates a member key, reveals its secret once, and confirms revocation", async () => {
  const user = userEvent.setup();
  let rows: any[] = [];
  let posted: any;
  let deletions = 0;
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/members"))
        return Response.json({
          members: [
            {
              id: "member-1",
              displayName: "Alex Rivera",
              email: "alex@example.test",
            },
          ],
        });
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        rows = [
          {
            id: "key-1",
            name: posted.name,
            prefix: "savia_pat_abc",
            tenantId: 12,
            scopes: posted.scopes,
            createdAt: "2026-10-03T00:00:00Z",
            expiresAt: "2026-11-02T00:00:00Z",
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
        deletions += 1;
        rows[0].revokedAt = "2026-10-03T00:00:00Z";
        return new Response(null, { status: 204 });
      }
      return Response.json({ keys: rows });
    },
  });
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);

  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <TenantApiKeysPanel api={api} tenantId={12} />
    </StoreContextProvider>,
  );

  expect(screen.queryByLabelText("Nombre de la clave")).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Nueva clave" }));
  await screen.findByRole("option", {
    name: "Alex Rivera (alex@example.test)",
  });
  await user.type(
    screen.getByLabelText("Nombre de la clave"),
    "Discard this draft",
  );
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByLabelText("Nombre de la clave")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Nueva clave" }));
  expect(screen.getByLabelText("Nombre de la clave")).toHaveValue("");
  await user.type(
    screen.getByLabelText("Nombre de la clave"),
    "Companion de Alex",
  );
  await user.click(screen.getByRole("button", { name: "Crear clave" }));
  await screen.findByDisplayValue("savia_pat_once");
  expect(posted).toEqual({
    principalId: "member-1",
    name: "Companion de Alex",
    lifetimeDays: 30,
    scopes: ["recordings:read", "recordings:upload"],
  });

  await user.click(screen.getByRole("button", { name: "Ya guardé la clave" }));
  expect(screen.queryByDisplayValue("savia_pat_once")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Revocar Companion de Alex" }),
  );
  expect(confirm).toHaveBeenCalled();
  expect(deletions).toBe(0);
  await user.click(
    screen.getByRole("button", { name: "Revocar Companion de Alex" }),
  );
  await waitFor(() => expect(screen.getByText("Revocada")).toBeTruthy());
  expect(deletions).toBe(1);
});

it("clears a revealed secret when the tenant changes", async () => {
  const user = userEvent.setup();
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/members"))
        return Response.json({
          members: [
            { id: "m", displayName: "Alex", email: "alex@example.test" },
          ],
        });
      if (init?.method === "POST")
        return Response.json(
          {
            key: {
              id: "key",
              name: "Companion",
              prefix: "savia_pat_x",
              tenantId: Number(path.split("/")[3]),
              scopes: ["recordings:read"],
              createdAt: "2026-10-03T00:00:00Z",
              expiresAt: "2026-11-02T00:00:00Z",
              revokedAt: null,
              lastUsedAt: null,
            },
            secret: "savia_pat_tenant_secret",
          },
          { status: 201 },
        );
      return Response.json({ keys: [] });
    },
  });
  const { rerender } = render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={api} tenantId={12} />
    </StoreContextProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "New key" }));
  await screen.findByRole("option", { name: "Alex (alex@example.test)" });
  await user.type(screen.getByLabelText("Key name"), "Companion");
  await user.click(screen.getByRole("button", { name: "Create key" }));
  await screen.findByDisplayValue("savia_pat_tenant_secret");

  rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={api} tenantId={13} />
    </StoreContextProvider>,
  );
  expect(screen.queryByDisplayValue("savia_pat_tenant_secret")).toBeNull();
});

it("ignores a create response after the API client changes", async () => {
  const user = userEvent.setup();
  let finishCreate!: (response: Response) => void;
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/members"))
        return Response.json({
          members: [
            { id: "m", displayName: "Alex", email: "alex@example.test" },
          ],
        });
      if (init?.method === "POST")
        return new Promise<Response>((resolve) => {
          finishCreate = resolve;
        });
      return Response.json({ keys: [] });
    },
  });
  const nextApi = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "new-jwt";
      },
    },
    fetcher: async (url) =>
      new URL(String(url)).pathname.endsWith("/members")
        ? Response.json({
            members: [
              { id: "m", displayName: "Alex", email: "alex@example.test" },
            ],
          })
        : Response.json({ keys: [] }),
  });
  const { rerender } = render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={api} tenantId={12} />
    </StoreContextProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "New key" }));
  await screen.findByRole("option", { name: "Alex (alex@example.test)" });
  await user.type(screen.getByLabelText("Key name"), "Companion");
  await user.click(screen.getByRole("button", { name: "Create key" }));
  await waitFor(() => expect(finishCreate).toBeTypeOf("function"));

  rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={nextApi} tenantId={12} />
    </StoreContextProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "New key" }));
  await screen.findByRole("option", { name: "Alex (alex@example.test)" });
  await act(async () => {
    finishCreate(
      Response.json(
        {
          key: {
            id: "key-late",
            name: "Companion",
            prefix: "savia_pat_late",
            tenantId: 12,
            scopes: ["recordings:read"],
            createdAt: "2026-10-03T00:00:00Z",
            expiresAt: "2026-11-02T00:00:00Z",
            revokedAt: null,
            lastUsedAt: null,
          },
          secret: "savia_pat_stale_secret",
        },
        { status: 201 },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByDisplayValue("savia_pat_stale_secret")).toBeNull();
  expect(screen.queryByText("Companion")).toBeNull();
});

it("can retry after the key and member lists fail to load", async () => {
  const user = userEvent.setup();
  let firstListAttempt = true;
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/members"))
        return Response.json({
          members: [
            { id: "m", displayName: "Alex", email: "alex@example.test" },
          ],
        });
      if (firstListAttempt) {
        firstListAttempt = false;
        return Response.json(
          { error: { message: "Unavailable" } },
          { status: 503 },
        );
      }
      return Response.json({ keys: [] });
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={api} tenantId={12} />
    </StoreContextProvider>,
  );

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: "New key" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opts into native collection permissions when creating a member key", async () => {
  const user = userEvent.setup();
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
      if (path.endsWith("/members"))
        return Response.json({
          members: [
            { id: "member-1", displayName: "Alex", email: "alex@example.test" },
          ],
        });
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return Response.json(
          {
            key: {
              id: "key-1",
              name: posted.name,
              prefix: "savia_pat_key",
              tenantId: 12,
              scopes: posted.scopes,
              createdAt: "2026-10-03T00:00:00Z",
              expiresAt: "2026-11-02T00:00:00Z",
              revokedAt: null,
              lastUsedAt: null,
            },
            secret: "savia_pat_once",
          },
          { status: 201 },
        );
      }
      return Response.json({ keys: [] });
    },
  });

  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <TenantApiKeysPanel api={api} tenantId={12} />
    </StoreContextProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "New key" }));
  await screen.findByRole("option", { name: "Alex (alex@example.test)" });
  await user.type(screen.getByLabelText("Key name"), "Records integration");
  await user.click(screen.getByText("Read records").closest("label")!);
  await user.click(screen.getByText("Create records").closest("label")!);
  await user.click(screen.getByRole("button", { name: "Create key" }));
  await screen.findByDisplayValue("savia_pat_once");

  expect(posted.scopes).toEqual([
    "recordings:read",
    "recordings:upload",
    "records:read",
    "records:create",
  ]);
});
