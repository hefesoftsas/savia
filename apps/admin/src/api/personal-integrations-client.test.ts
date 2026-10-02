import { expect, it, vi } from "vitest";
import { PersonalIntegrationsClient } from "./personal-integrations-client";

it("bypasses the short-lived connection cache on realtime refresh", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [{ id: "old", attributes: { status: "connected" } }],
    })
    .mockResolvedValueOnce({ data: [] });
  const client = new PersonalIntegrationsClient({ get } as never);
  expect(await client.listConnections()).toHaveLength(1);
  expect(await client.listConnections()).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(1);
  expect(await client.listConnections(true)).toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it("does not reuse connection requests across authenticated identities", async () => {
  let resolveFirst!: (value: {
    data: Array<{ id: string; attributes: never }>;
  }) => void;
  const get = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ data: [] });
  const client = new PersonalIntegrationsClient({ get } as never);
  const first = client.listConnections();

  window.dispatchEvent(new Event("savia:identity-changed"));
  await expect(client.listConnections()).resolves.toEqual([]);
  resolveFirst({
    data: [
      {
        id: "old-user",
        attributes: {
          provider: "google_calendar",
          status: "connected",
        } as never,
      },
    ],
  });
  await first;

  await expect(client.listConnections()).resolves.toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it("requests an issue preview without retaining the returned metadata", async () => {
  const preview = {
    provider: "linear" as const,
    url: "https://linear.app/acme/issue/ENG-7",
    identifier: "ENG-7",
    title: "Fix the dashboard",
    status: "Todo",
    assignee: null,
  };
  const post = vi.fn().mockResolvedValue({ data: preview });
  const client = new PersonalIntegrationsClient({ post } as never);

  await expect(client.previewIssue(preview.url)).resolves.toEqual(preview);
  expect(post).toHaveBeenCalledWith("/v1/personal-integrations/issue-preview", {
    url: preview.url,
  });
});

it("invalidates cached connections and notifies Pages after a successful connection", async () => {
  const connection = {
    id: "jira-1",
    attributes: {
      provider: "jira",
      status: "connected",
      externalAccountLabel: "acme",
      scopes: [],
      lastValidatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValue({
      data: [connection],
    });
  const post = vi.fn().mockResolvedValue({ data: connection });
  const client = new PersonalIntegrationsClient({ get, post } as never);
  const changed = vi.fn();
  window.addEventListener("savia:personal-integrations-changed", changed);

  await client.listConnections();
  await client.complete("jira", "nango-connection-1");

  expect(changed).toHaveBeenCalledTimes(1);
  await expect(client.listConnections()).resolves.toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(2);
  window.removeEventListener("savia:personal-integrations-changed", changed);
});

it("invalidates cached connections and notifies Pages after disconnect", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          id: "linear-1",
          attributes: { provider: "linear", status: "connected" },
        },
      ],
    })
    .mockResolvedValue({ data: [] });
  const remove = vi.fn().mockResolvedValue(undefined);
  const client = new PersonalIntegrationsClient({
    get,
    delete: remove,
  } as never);
  const changed = vi.fn();
  window.addEventListener("savia:personal-integrations-changed", changed);

  await client.listConnections();
  await client.disconnect("linear");

  expect(changed).toHaveBeenCalledTimes(1);
  await expect(client.listConnections()).resolves.toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
  window.removeEventListener("savia:personal-integrations-changed", changed);
});
