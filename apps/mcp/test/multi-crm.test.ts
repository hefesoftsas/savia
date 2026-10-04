import { expect, it } from "vitest";
import { SaviaApiClient } from "../src/savia-api";
it.each(["hubspot", "salesforce", "zoho", "pipedrive"])(
  "uses installed %s collections through the delegated Studio gateway",
  async (provider) => {
    const calls: Request[] = [];
    const client = new SaviaApiClient(
      "https://api.test",
      "delegated-token",
      async (input, init) => {
        const request = new Request(input, init);
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path === "/v1/assistant/active-tenant")
          return Response.json({ tenants: [] });
        if (path.endsWith("/objects"))
          return Response.json({
            data: [
              {
                name: `${provider}_contacts`,
                config: {
                  studio: { collection: { kind: "crm", sourceId: provider } },
                },
              },
            ],
          });
        if (path.endsWith(`/records/${provider}_contacts`))
          return Response.json({ data: [{ id: "123", name: "Ada" }] });
        return Response.json({ error: "Forbidden" }, { status: 403 });
      },
    );
    expect(await client.listStudioRecords(`${provider}_contacts`)).toEqual({
      data: [{ id: "123", name: "Ada" }],
    });
    const recordRequest = calls.find((request) =>
      new URL(request.url).pathname.includes("/records/"),
    );
    expect(recordRequest?.headers.get("authorization")).toBe(
      "Bearer delegated-token",
    );
    expect(recordRequest?.url).toContain(
      `/v1/studio/0/api/records/${provider}_contacts`,
    );
    await expect(
      client.listStudioRecords(`${provider}_uninstalled`),
    ).rejects.toThrow("not an installed Studio collection");
    await expect(
      client.getStudioRecord(`${provider}_contacts`, "denied"),
    ).rejects.toThrow();
  },
);
