import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

const unavailableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("No database access expected");
    },
  },
) as D1Database;
describe("independent API contracts", () => {
  it("publishes tenant CRM connections without legacy synchronization routes", async () => {
    const app = createApp(unavailableDb);
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const doc: any = await response.json();
    expect(doc.info.title).toBe("Savia Core API");
    expect(doc.paths["/v1/tenants"]).toBeDefined();
    expect(doc.paths["/v1/crm/connections"]).toBeDefined();
    expect(doc.paths["/v1/crm/sync-rules"]).toBeUndefined();
    expect(doc.paths["/v1/crm/customer-sync"]).toBeUndefined();
    expect(
      doc.paths["/v1/insurance-results/flows/{flowId}/runs"],
    ).toBeUndefined();
  });
  it("both services reject callers without a session or token", async () => {
    for (const [app, path] of [
      [
        createApp(unavailableDb, undefined, undefined, undefined, undefined, {
          fetch: async () => Response.json({ user: null }),
        }),
        "/v1/tenants",
      ],
      [createCoreAppForSync(unavailableDb), "/v1/crm/connections"],
    ] as const) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
    }
  });
});

function createCoreAppForSync(db: D1Database) {
  return createApp(db, undefined, undefined, undefined, undefined, {
    fetch: async () => Response.json({ user: null }),
  });
}
