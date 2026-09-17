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

function app() {
  return createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
}

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

it("lists optional extension contributions supplied by the release catalog", async () => {
  const response = await app().request(
    "/v1/data-domains/platform/api/extensions",
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(
    body.data.map(
      (extension: { manifest: { id: string } }) => extension.manifest.id,
    ),
  ).toEqual(["insurance.portfolio-dashboard", "insurance.quotes"]);
});

it("returns default settings for the installed insurance quotes extension", async () => {
  const api = app();
  const base = "/v1/data-domains/platform/api";
  const install = await api.request(
    `${base}/extensions/insurance.quotes/install`,
    { method: "POST" },
  );
  expect(install.status, await install.clone().text()).toBe(200);

  const settings = await api.request(
    `${base}/extensions/insurance.quotes/settings`,
  );
  expect(settings.status, await settings.clone().text()).toBe(200);
  const settingsData = (await settings.json()).data;
  expect(settingsData).toMatchObject({
    version: 0,
    value: {
      quotePages: { direct: true, wizard: true },
      vehicleLookup: { enabled: true },
    },
  });
  expect(settingsData.value.products).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "sbs-producto-8", enabled: true }),
      expect.objectContaining({
        id: "equidad-basico-quote",
        enabled: true,
      }),
      expect.objectContaining({ id: "liberty-basico-quote", enabled: true }),
      expect.objectContaining({
        id: "previsora-clasica-quote",
        enabled: true,
      }),
    ]),
  );
});

it("rejects an extension that is not supplied by the release catalog", async () => {
  const api = app();
  const base = "/v1/data-domains/platform/api";
  expect(
    (await api.request(`${base}/extensions/inventory.sync/summary`)).status,
  ).toBe(404);
});
