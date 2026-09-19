import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createExtensionRegistry } from "@savia/crm-shared/extension-package";
import { createCrmApp } from "../src/index";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

const extensionRegistry = createExtensionRegistry([
  {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "example.analytics",
      version: "1.0.0",
      label: "Analytics",
      description: "Tenant analytics",
      requires: [],
      apiVersion: 1,
    },
  },
  {
    builtIn: true,
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "example.built-in",
      version: "1.0.0",
      label: "Built-in extension",
      description: "Built-in compatibility",
      requires: [],
      apiVersion: 1,
    },
  },
  {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "example.portfolio",
      version: "1.0.0",
      label: "Portfolio",
      description: "Tenant portfolio summary",
      requires: ["example.built-in"],
      apiVersion: 1,
    },
  },
]);

const portfolioSummaryProviders = [
  {
    id: "example.portfolio",
    objectName: "polizas",
    summarize(records: readonly Record<string, unknown>[], asOf: string) {
      return { total: records.length, asOf };
    },
  },
];

const portfolioRequirement = {
  id: "example.portfolio",
  object: {
    name: "polizas",
    label: "Pólizas",
    description: "Vigencias y condiciones.",
    config: {
      version: 2,
      fields: {
        name: {
          type: "Textbox",
          label: "Póliza",
          labels: {},
          required: true,
        },
        inicio: { type: "DateControl", label: "Inicio", labels: {} },
        fin: { type: "DateControl", label: "Fin", labels: {} },
        prima: { type: "Number", label: "Prima", labels: {} },
        estado: {
          type: "Dropdown",
          label: "Estado",
          labels: {},
          options: [
            { label: "Vigente", value: "Vigente" },
            { label: "Vencida", value: "Vencida" },
            { label: "Cancelada", value: "Cancelada" },
          ],
        },
      },
      fieldOrder: ["name", "inicio", "fin", "prima", "estado"],
    },
  },
  requiredFields: {
    name: { types: ["Textbox"], required: true },
    inicio: { types: ["DateControl"] },
    fin: { types: ["DateControl"] },
    prima: { types: ["Number"] },
    estado: {
      types: ["Dropdown"],
      optionValues: ["Vigente", "Vencida", "Cancelada"],
    },
  },
} as const;

const solutionRequiringAnalytics = {
  format: "savia.solution",
  formatVersion: 1,
  id: "example.analytics-solution",
  version: "1.0.0",
  label: "Analytics solution",
  description: "Requires analytics code",
  requires: ["example.analytics"],
  objects: [],
};

function request(tenant: string, path: string, method = "GET", body?: unknown) {
  const app = createCrmApp(tenant, {
    seedObjects: [],
    extensionRegistry,
    extensionSummaryProviders: portfolioSummaryProviders,
    extensionObjectRequirements: [portfolioRequirement],
    solutionCatalog: [solutionRequiringAnalytics],
  } as any);
  return app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
}

async function json(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await request(tenant, path, method, body);
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  return JSON.parse(text) as any;
}

async function seedPortfolio(tenant: string) {
  await platform.env.DB.batch([
    platform.env.DB.prepare(
      "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES (?,?,?,?,?)",
    ).bind(
      tenant,
      "polizas",
      "Pólizas",
      "Vigencias y condiciones.",
      JSON.stringify(portfolioRequirement.object.config),
    ),
    ...[
      {
        id: `${tenant}-vigente-1`,
        data: { name: "POL-1", estado: "Vigente", prima: 1000 },
      },
      {
        id: `${tenant}-vigente-2`,
        data: { name: "POL-2", estado: "Activa", prima: "2500" },
      },
      {
        id: `${tenant}-vencida`,
        data: { name: "POL-3", estado: "Vencida", prima: 9000 },
      },
    ].map(({ id, data }) =>
      platform.env.DB.prepare(
        "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
      ).bind(id, tenant, "polizas", JSON.stringify(data)),
    ),
  ]);
}

async function seedObject(tenant: string, name: string, config: unknown) {
  await platform.env.DB.prepare(
    "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES (?,?,?,?,?)",
  )
    .bind(tenant, name, name, `${name} description`, JSON.stringify(config))
    .run();
}

async function storedObject(tenant: string, name: string) {
  return platform.env.DB.prepare(
    "SELECT name,label,description,config,version FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind(tenant, name)
    .first<{
      name: string;
      label: string;
      description: string;
      config: string;
      version: number;
    }>();
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((statement) => statement.trim()))
      await platform.env.DB.prepare(sql).run();
});

afterAll(async () => {
  await platform?.dispose();
});

describe("tenant extension installations", () => {
  it("provisions only a missing policy collection when the portfolio is installed", async () => {
    const tenant = "portfolio-provision";
    const carteraConfig = {
      version: 2,
      fields: {
        name: { type: "Textbox", label: "Nombre", labels: {} },
      },
      fieldOrder: ["name"],
    };
    await seedObject(tenant, "cartera", carteraConfig);

    await json(tenant, "/extensions/example.portfolio/install", "POST");

    expect(await storedObject(tenant, "cartera")).toMatchObject({
      name: "cartera",
      config: JSON.stringify(carteraConfig),
    });
    const policies = await storedObject(tenant, "polizas");
    expect(policies).toMatchObject({
      name: "polizas",
      label: "Pólizas",
      version: 1,
    });
    expect(JSON.parse(policies!.config)).toEqual(
      portfolioRequirement.object.config,
    );
    expect(
      await platform.env.DB.prepare(
        "SELECT version FROM crm_schema_versions WHERE tenant_id=? AND object_name=?",
      )
        .bind(tenant, "polizas")
        .first<{ version: number }>(),
    ).toEqual({ version: 1 });
  });

  it("preserves a compatible policy collection and its records", async () => {
    const tenant = "portfolio-compatible";
    await seedPortfolio(tenant);
    const before = await storedObject(tenant, "polizas");

    await json(tenant, "/extensions/example.portfolio/install", "POST");

    expect(await storedObject(tenant, "polizas")).toEqual(before);
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) as count FROM crm_records WHERE tenant_id=? AND object_name=?",
      )
        .bind(tenant, "polizas")
        .first<{ count: number }>(),
    ).toEqual({ count: 3 });
  });

  it("rejects an incompatible policy collection without installing the portfolio", async () => {
    const tenant = "portfolio-incompatible";
    await seedObject(tenant, "polizas", {
      version: 2,
      fields: {
        name: { type: "Textarea", label: "Póliza", labels: {} },
      },
      fieldOrder: ["name"],
    });

    const response = await request(
      tenant,
      "/extensions/example.portfolio/install",
      "POST",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "La colección polizas no cumple el contrato de la extensión.",
    });
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) as count FROM crm_extension_installations WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, "example.portfolio")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("provisions policy collections only in the installing tenant", async () => {
    await json(
      "portfolio-tenant-a",
      "/extensions/example.portfolio/install",
      "POST",
    );

    expect(await storedObject("portfolio-tenant-a", "polizas")).not.toBeNull();
    expect(await storedObject("portfolio-tenant-b", "polizas")).toBeNull();
  });

  it("reports a removed required collection without exposing the raw object error", async () => {
    const tenant = "portfolio-removed";
    await json(tenant, "/extensions/example.portfolio/install", "POST");
    await platform.env.DB.prepare(
      "DELETE FROM crm_objects WHERE tenant_id=? AND name=?",
    )
      .bind(tenant, "polizas")
      .run();

    const response = await request(
      tenant,
      "/extensions/example.portfolio/summary",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error:
        "Falta la colección polizas requerida por esta extensión. Reinstálala o revisa su configuración.",
    });
  });

  it("repairs a missing policy collection when an active portfolio is installed again", async () => {
    const tenant = "portfolio-repair";
    const carteraConfig = {
      version: 2,
      fields: {
        name: { type: "Textbox", label: "Nombre", labels: {} },
      },
      fieldOrder: ["name"],
    };
    await seedObject(tenant, "cartera", carteraConfig);
    await json(tenant, "/extensions/example.portfolio/install", "POST");
    await json(tenant, "/objects/polizas", "DELETE");

    await json(tenant, "/extensions/example.portfolio/install", "POST");

    expect(await storedObject(tenant, "cartera")).toMatchObject({
      config: JSON.stringify(carteraConfig),
    });
    expect(await storedObject(tenant, "polizas")).toMatchObject({
      name: "polizas",
      label: "Pólizas",
      version: 1,
    });
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) as count FROM crm_extension_installations WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, "example.portfolio")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("serves a provider summary only while the extension is active for its tenant", async () => {
    const tenant = "portfolio-summary";
    await seedPortfolio(tenant);

    expect(
      (await request(tenant, "/extensions/example.portfolio/summary")).status,
    ).toBe(404);

    await json(tenant, "/extensions/example.portfolio/install", "POST");
    const response = await request(
      tenant,
      "/extensions/example.portfolio/summary",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        total: 3,
        asOf: expect.any(String),
      },
    });
    expect(
      (
        await request(
          "portfolio-summary-other-tenant",
          "/extensions/example.portfolio/summary",
        )
      ).status,
    ).toBe(404);
  });

  it("does not leak extension activation to another tenant", async () => {
    await json("north", "/extensions/example.analytics/install", "POST");

    expect((await json("north", "/extensions")).data).toContainEqual(
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "example.analytics" }),
        installed: { enabled: true, version: "1.0.0" },
      }),
    );
    expect((await json("south", "/extensions")).data).toContainEqual(
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "example.analytics" }),
        installed: null,
      }),
    );
  });

  it("requires an active extension in the same tenant before installing a solution", async () => {
    expect(
      (
        await request(
          "before-activation",
          "/solutions/install",
          "POST",
          solutionRequiringAnalytics,
        )
      ).status,
    ).toBe(409);

    await json(
      "after-activation",
      "/extensions/example.analytics/install",
      "POST",
    );
    expect(
      (
        await request(
          "after-activation",
          "/solutions/install",
          "POST",
          solutionRequiringAnalytics,
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await request(
          "other-tenant",
          "/solutions/install",
          "POST",
          solutionRequiringAnalytics,
        )
      ).status,
    ).toBe(409);
  });

  it("blocks a disable while an active solution depends on the extension", async () => {
    await json("dependent", "/extensions/example.analytics/install", "POST");
    await json(
      "dependent",
      "/solutions/install",
      "POST",
      solutionRequiringAnalytics,
    );

    expect(
      (
        await request("dependent", "/extensions/example.analytics", "PATCH", {
          enabled: false,
        })
      ).status,
    ).toBe(409);
  });

  it("does not leave an enabled solution with a dependency disabled by a concurrent request", async () => {
    const tenant = "activation-race";
    await json(tenant, "/extensions/example.analytics/install", "POST");

    const [install, disable] = await Promise.all([
      request(tenant, "/solutions/install", "POST", solutionRequiringAnalytics),
      request(tenant, "/extensions/example.analytics", "PATCH", {
        enabled: false,
      }),
    ]);
    expect([install.status, disable.status].sort()).toEqual([200, 409]);

    const extensions = await json(tenant, "/extensions");
    const solutions = await json(tenant, "/solutions");
    const analytics = extensions.data.find(
      (entry: { manifest: { id: string } }) =>
        entry.manifest.id === "example.analytics",
    );
    const solution = solutions.data.find(
      (entry: { manifest: { id: string } }) =>
        entry.manifest.id === "example.analytics-solution",
    );
    expect(
      !(solution?.installed?.enabled && !analytics?.installed?.enabled),
    ).toBe(true);
  });
});
