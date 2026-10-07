import { createApp } from "../src/app";
import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { publicQuoteReportSchema } from "@savia/studio-shared/public-quote";
import { authenticationMiddleware } from "../src/auth/middleware";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import {
  publishQuoteReport,
  readPublicQuoteReport,
} from "../src/public-quotes/service";
import { registerPublicQuoteRoutes } from "../src/public-quotes/routes";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

const report = publicQuoteReportSchema.parse({
  version: 1,
  reference: "Q-2026-001",
  createdAt: "2026-10-07T12:00:00.000Z",
  proposals: [
    {
      id: "proposal-1",
      provider: "Example insurer",
      product: "Basic",
      state: "priced",
      premium: 125000,
      currency: "COP",
      facts: [
        { label: "Deductible", value: "Verified value", source: "provider" },
      ],
    },
  ],
});

async function tenant(id: number) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,?,?)",
  )
    .bind(id, `quote-${id}`, `Quote tenant ${id}`, "2026-10-07", "2026-10-07")
    .run();
}

it("publishes an opaque idempotent link and returns only the allowlisted quote report", async () => {
  await tenant(880091);
  const input = {
    tenantId: 880091,
    actionId: crypto.randomUUID(),
    quoteId: "quote-internal-1",
    createdBy: "principal-1",
    report,
    publicOrigin: "https://api.savia.test",
  };
  const first = await publishQuoteReport(env.DB, input);
  const repeated = await publishQuoteReport(env.DB, input);

  expect(first).toEqual(repeated);
  expect(
    Date.parse(first.expiresAt) - Date.parse(new Date().toISOString()),
  ).toBeGreaterThan(6.99 * 24 * 60 * 60 * 1000);
  expect(first.url).toMatch(
    /^https:\/\/api\.savia\.test\/public\/quotes\/[a-f0-9]{64}$/,
  );
  const published = await readPublicQuoteReport(
    env.DB,
    first.url.split("/").at(-1)!,
  );
  expect(published).toEqual({ report, expiresAt: first.expiresAt });
  expect(JSON.stringify(published)).not.toMatch(
    /contact|phone|email|quoteNumber|rawOutput/i,
  );
});

it("returns the same not-found result for unknown, expired, and revoked tokens", async () => {
  await tenant(880092);
  const published = await publishQuoteReport(env.DB, {
    tenantId: 880092,
    actionId: crypto.randomUUID(),
    quoteId: "quote-internal-2",
    createdBy: "principal-1",
    report,
    publicOrigin: "https://api.savia.test",
  });
  const token = published.url.split("/").at(-1)!;
  await env.DB.prepare("UPDATE public_quote_links SET revoked_at=? WHERE id=?")
    .bind(new Date().toISOString(), published.id)
    .run();

  expect(await readPublicQuoteReport(env.DB, token)).toBeNull();
  expect(await readPublicQuoteReport(env.DB, "a".repeat(64))).toBeNull();

  const expired = await publishQuoteReport(env.DB, {
    tenantId: 880092,
    actionId: crypto.randomUUID(),
    quoteId: "quote-internal-3",
    createdBy: "principal-1",
    report,
    publicOrigin: "https://api.savia.test",
  });
  await env.DB.prepare("UPDATE public_quote_links SET expires_at=? WHERE id=?")
    .bind("2000-01-01T00:00:00.000Z", expired.id)
    .run();
  expect(
    await readPublicQuoteReport(env.DB, expired.url.split("/").at(-1)!),
  ).toBeNull();
});

it("keeps tenant listing and revocation scoped to the authorized tenant", async () => {
  const app = new OpenAPIHono();
  app.use(
    "/api/tenants/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  registerPublicQuoteRoutes(app, env.DB);
  await tenant(880093);
  await tenant(880094);
  const link = await publishQuoteReport(env.DB, {
    tenantId: 880093,
    actionId: crypto.randomUUID(),
    quoteId: "quote-internal-4",
    createdBy: "principal-1",
    report,
    publicOrigin: "https://api.savia.test",
  });

  const listed = await app.request("/api/tenants/880093/quote-links");
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    items: [{ id: link.id, quoteId: "quote-internal-4" }],
  });
  const otherTenantList = await app.request("/api/tenants/880094/quote-links");
  expect(await otherTenantList.json()).toEqual({ items: [] });
  const crossTenantDelete = await app.request(
    `/api/tenants/880094/quote-links/${link.id}`,
    { method: "DELETE" },
  );
  expect(crossTenantDelete.status).toBe(404);
  const unauthenticatedApp = new OpenAPIHono();
  registerPublicQuoteRoutes(unauthenticatedApp, env.DB);
  const unauthenticatedDelete = await unauthenticatedApp.request(
    `/api/tenants/880093/quote-links/${link.id}`,
    { method: "DELETE" },
  );
  expect(unauthenticatedDelete.status).toBe(401);
  const deleted = await app.request(
    `/api/tenants/880093/quote-links/${link.id}`,
    { method: "DELETE" },
  );
  expect(deleted.status).toBe(204);
  expect(
    await readPublicQuoteReport(env.DB, link.url.split("/").at(-1)!),
  ).toBeNull();
  const publicApp = new OpenAPIHono();
  registerPublicQuoteRoutes(publicApp, env.DB);
  const revoked = await publicApp.request(
    `/api/public/quotes/${link.url.split("/").at(-1)!}`,
  );
  const unknown = await publicApp.request(
    `/api/public/quotes/${"a".repeat(64)}`,
  );
  expect(revoked.status).toBe(404);
  expect(await revoked.json()).toEqual(await unknown.json());
  expect(revoked.headers.get("cache-control")).toBe("no-store");
  expect(revoked.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(revoked.headers.get("referrer-policy")).toBe("no-referrer");
});

it("rejects unknown public-report fields instead of persisting private quote data", () => {
  const result = publicQuoteReportSchema.safeParse({
    ...report,
    customerEmail: "private@example.test",
  });
  expect(result.success).toBe(false);
});

it("wires authenticated administration and anonymous report reads into the complete API", async () => {
  await tenant(880095);
  const link = await publishQuoteReport(env.DB, {
    tenantId: 880095,
    actionId: crypto.randomUUID(),
    quoteId: "quote-shell",
    createdBy: "principal-1",
    report,
    publicOrigin: "https://api.savia.test",
  });
  const authenticated = createApp(
    env.DB,
    undefined,
    undefined,
    platformAdministratorAuthenticator(),
  );
  const listed = await authenticated.request("/api/tenants/880095/quote-links");
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({ items: [{ id: link.id }] });
  const anonymous = createApp(env.DB, undefined, undefined, {
    async authenticate() {
      return null;
    },
  });
  expect(
    (await anonymous.request("/api/tenants/880095/quote-links")).status,
  ).toBe(401);
  const publicResponse = await anonymous.request(
    `/api/public/quotes/${link.url.split("/").at(-1)}`,
  );
  expect(publicResponse.status).toBe(200);
  expect(await publicResponse.json()).toMatchObject({ report });
});
