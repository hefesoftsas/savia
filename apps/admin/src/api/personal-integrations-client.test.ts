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
