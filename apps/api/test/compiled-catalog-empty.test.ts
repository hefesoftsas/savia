import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([left], [right]) => left.localeCompare(right));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
});

it("does not expose compiled plugins through the extension API", async () => {
  const app = createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
  const base = "/v1/data-domains/platform/api";
  const list = await app.request(`${base}/extensions`);
  expect(list.status).toBe(200);
  expect((await list.json()).data).toEqual([]);

  const install = await app.request(
    `${base}/extensions/insurance.quotes/install`,
    { method: "POST" },
  );
  expect(install.status).toBe(404);
});
