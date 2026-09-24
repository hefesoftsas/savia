import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

let counter = 995000;
async function tenant() {
  const id = ++counter,
    slug = "purge-" + id,
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, slug, "Purge agency", now, now)
    .run();
  return id;
}

describe("tenant deletion purges Savia Request overlays", () => {
  it("purges both tenant scopes after deleting the record", async () => {
    const id = await tenant();
    const fetch = vi.fn(async () => Response.json({ tenant: "x", purged: {} }));
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
      saviaRequestService: { fetch } as SaviaRequestService,
    });

    const response = await app.request(`https://api.test/v1/tenants/${id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(204);
    expect(
      await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
        .bind(id)
        .first(),
    ).toBe(null);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.map(([request]) => [request.method, request.url]),
    ).toEqual([
      [
        "DELETE",
        `https://savia-request.internal/api/admin/tenants/agency:${id}`,
      ],
      [
        "DELETE",
        `https://savia-request.internal/api/admin/tenants/tenant:${id}`,
      ],
    ]);
  });

  it("still deletes the tenant when the purge fails", async () => {
    const id = await tenant();
    const errors: unknown[] = [];
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
    try {
      const app = createTestApp({
        auth: platformAdministratorAuthenticator(),
        documents: env.DOCUMENTS,
        saviaRequestService: {
          fetch: () => Promise.reject(new Error("worker caído")),
        },
      });
      const response = await app.request(`https://api.test/v1/tenants/${id}`, {
        method: "DELETE",
      });
      expect(response.status, await response.clone().text()).toBe(204);
      expect(
        await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
          .bind(id)
          .first(),
      ).toBe(null);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("deletes without purge when the service is unavailable", async () => {
    const id = await tenant();
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    const response = await app.request(`https://api.test/v1/tenants/${id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(204);
  });
});
