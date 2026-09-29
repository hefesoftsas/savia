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
