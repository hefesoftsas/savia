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

it("opts into native collection permissions when creating a personal key", async () => {
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
      if (path.endsWith("/tenants"))
        return Response.json({ tenants: [{ id: 1, name: "My workspace" }] });
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        const key = {
          id: "key-1",
          name: posted.name,
          prefix: "savia_pat_prefix",
          tenantId: 1,
          scopes: posted.scopes,
          createdAt: "2026-10-03",
          expiresAt: "2026-11-02",
          revokedAt: null,
          lastUsedAt: null,
        };
        return Response.json(
          { key, secret: "savia_pat_once" },
          { status: 201 },
        );
      }
      return Response.json({ keys: [] });
    },
  });

  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <PersonalApiKeysPanel api={api} />
    </StoreContextProvider>,
  );
  await screen.findByRole("option", { name: "My workspace" });
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

it("clears and disables collection permissions for the platform tenant", async () => {
  const user = userEvent.setup();
  const api = new ApiClient({
    baseUrl: "https://preview.test",
    tokenSource: {
      async getAccessToken() {
        return "jwt";
      },
    },
    fetcher: async (url) =>
      new URL(String(url)).pathname.endsWith("/tenants")
        ? Response.json({
            tenants: [
              { id: 1, name: "My workspace" },
              { id: 0, name: "Platform" },
            ],
          })
        : Response.json({ keys: [] }),
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <PersonalApiKeysPanel api={api} />
    </StoreContextProvider>,
  );
  await screen.findByRole("option", { name: "My workspace" });
  const read = screen
    .getByText("Read records")
    .closest("label")!
    .querySelector("input")!;
  await user.click(read);
  expect(read).toBeChecked();

  await user.selectOptions(screen.getByLabelText("Workspace"), "0");
  expect(read).not.toBeChecked();
  expect(read).toBeDisabled();
  expect(
    screen.getByText("Create records").closest("label")!.querySelector("input"),
  ).toBeDisabled();
});

it("clears collection permissions when a reload falls back to the platform tenant", async () => {
  const user = userEvent.setup();
  const makeApi = (eligibleTenants: { id: number; name: string }[]) =>
    new ApiClient({
      baseUrl: "https://preview.test",
      tokenSource: {
        async getAccessToken() {
          return "jwt";
        },
      },
      fetcher: async (url) =>
        new URL(String(url)).pathname.endsWith("/tenants")
          ? Response.json({ tenants: eligibleTenants })
          : Response.json({ keys: [] }),
    });
  const { rerender } = render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <PersonalApiKeysPanel
        api={makeApi([
          { id: 1, name: "My workspace" },
          { id: 0, name: "Platform" },
        ])}
      />
    </StoreContextProvider>,
  );
  await screen.findByRole("option", { name: "My workspace" });
  const read = screen
    .getByText("Read records")
    .closest("label")!
    .querySelector("input")!;
  await user.click(read);
  expect(read).toBeChecked();

  rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <PersonalApiKeysPanel api={makeApi([{ id: 0, name: "Platform" }])} />
    </StoreContextProvider>,
  );

  await screen.findByRole("option", { name: "Platform" });
  const platformRead = screen
    .getByText("Read records")
    .closest("label")!
    .querySelector("input")!;
  await waitFor(() => expect(platformRead).not.toBeChecked());
  expect(platformRead).toBeDisabled();
});

it("deletes a revoked key after confirmation", async () => {
  const user = userEvent.setup();
  let rows: any[] = [
    {
      id: "key-revoked",
      name: "Companion",
      prefix: "savia_pat_4353fb9e",
      tenantId: 1,
      scopes: ["recordings:read"],
      createdAt: "2026-10-03",
      expiresAt: "2027-03-01",
      revokedAt: "2026-10-05",
      lastUsedAt: null,
    },
  ];
  const deletions: string[] = [];
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
      if (init?.method === "DELETE") {
        deletions.push(path);
        rows = [];
        return new Response(null, { status: 204 });
      }
      return Response.json({ keys: rows });
    },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <PersonalApiKeysPanel api={api} />
    </StoreContextProvider>,
  );
  await screen.findByText("Revocada");
  await user.click(screen.getByRole("button", { name: "Eliminar Companion" }));
  expect(confirm).toHaveBeenCalled();
  expect(deletions).toHaveLength(0);
  expect(screen.getByText("Companion")).toBeTruthy();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Eliminar Companion" }));
  await waitFor(() => expect(deletions).toHaveLength(1));
  await waitFor(() => expect(screen.queryByText("Companion")).toBeNull());
});
