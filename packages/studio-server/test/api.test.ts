import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import app, { createStudioApp } from "../src/index";
import { makeConfig } from "@savia/studio-shared/metadata";
import { exampleOpenApi } from "@savia/studio-shared/seed";
let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
const request = (
  path: string,
  method = "GET",
  data?: unknown,
  headers?: Record<string, string>,
) =>
  app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    },
    platform.env,
  );
async function json(path: string, method = "GET", data?: unknown) {
  const res = await request(path, method, data);
  const body: any = await res.json();
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body;
}
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const migration of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${migration}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
  await json("/bootstrap", "POST");
});
afterAll(async () => {
  await platform?.dispose();
});
describe("Hono + real isolated D1", () => {
  it("seeds idempotently and ignores tenant IDs supplied by clients", async () => {
    await json("/bootstrap", "POST");
    expect((await json("/objects")).data).toHaveLength(5);
    await platform.env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
    )
      .bind(
        "other",
        "private",
        "Private",
        JSON.stringify(
          makeConfig({ name: { type: "Textbox", label: "Name" } }),
        ),
      )
      .run();
    const result: any = await (
      await request("/objects", "GET", undefined, { "X-Tenant-Id": "other" })
    ).json();
    expect(result.data.some((o: any) => o.name === "private")).toBe(false);
    expect((await request("/records/private")).status).toBe(404);
  });
  it("creates unknown object and complete CRUD with numeric ordering and pagination", async () => {
    await json("/objects", "POST", {
      name: "vehicle",
      label: "Vehículos",
      config: makeConfig({
        name: { type: "Textbox", label: "Placa", required: true },
        price: { type: "Number", label: "Precio" },
      }),
    });
    const first = (
      await json("/records/vehicle", "POST", { name: "TESTONE", price: 100 })
    ).data;
    const second = (
      await json("/records/vehicle", "POST", { name: "TESTTWO", price: 9 })
    ).data;
    expect(
      (await request("/records/vehicle", "POST", { price: "bad" })).status,
    ).toBe(422);
    expect(
      (await json("/records/vehicle?sort=price&order=ASC&perPage=1")).data[0]
        .id,
    ).toBe(second.id);
    expect((await json("/records/vehicle?q=TESTONE")).total).toBe(1);
    await json(`/records/vehicle/${first.id}`, "PATCH", {
      price: 250,
      _version: first._version,
    });
    expect((await json(`/records/vehicle/${first.id}`)).data.price).toBe(250);
    await json(`/records/vehicle/${first.id}?version=2`, "DELETE");
    expect((await request(`/records/vehicle/${first.id}`)).status).toBe(404);
  });
  it("persists form changes and rejects changes that invalidate existing data", async () => {
    const before = (await json("/objects")).data.find(
      (o: any) => o.name === "vehicle",
    );
    const updated = {
      ...before,
      config: makeConfig({
        ...before.config.fields,
        color: { type: "Textbox", label: "Color" },
      }),
    };
    await json("/objects/vehicle", "PUT", updated);
    expect(
      (await json("/objects")).data.find((o: any) => o.name === "vehicle")
        .config.fields.color.label,
    ).toBe("Color");
    updated.version = 2;
    updated.config.fields.color.required = true;
    expect((await request("/objects/vehicle", "PUT", updated)).status).toBe(
      409,
    );
  });
  it("validates relations and blocks dangling references on deletion", async () => {
    expect(
      (
        await request("/records/contact", "POST", {
          name: "Test",
          email: "test@example.com",
          account: "missing",
        })
      ).status,
    ).toBe(422);
    expect(
      (await request("/records/account/a1?version=1", "DELETE")).status,
    ).toBe(409);
  });
  it("persists pipeline stages and saved views", async () => {
    await json("/records/opportunity/o1", "PATCH", {
      stage: "Ganada",
      _version: 1,
    });
    expect(
      (await json("/records/opportunity?stage=Ganada")).data.some(
        (r: any) => r.id === "o1",
      ),
    ).toBe(true);
    await json("/views/opportunity", "POST", {
      name: "Ganadas",
      config: {
        q: "",
        stage: "Ganada",
        columnOrder: ["amount", "name"],
        columnAliases: { name: "Oportunidad" },
      },
    });
    const savedView = (await json("/views/opportunity")).data[0];
    expect(savedView.name).toBe("Ganadas");
    expect(savedView.config).toMatchObject({
      columnOrder: ["amount", "name"],
      columnAliases: { name: "Oportunidad" },
    });
  });
  it("persists the default table configuration separately from named views", async () => {
    await json("/views/opportunity/default", "PUT", {
      config: {
        columns: ["name", "stage"],
        columnOrder: ["stage", "name"],
        columnAliases: { name: "Oportunidad" },
      },
    });
    const views = await json("/views/opportunity");
    expect(views.data.map((view: any) => view.name)).not.toContain(
      "Configuración predeterminada",
    );
    expect(views.default).toEqual({
      config: {
        columns: ["name", "stage"],
        columnOrder: ["stage", "name"],
        columnAliases: { name: "Oportunidad" },
      },
    });
  });
  it("imports OpenAPI into a new dynamic resource and executes local HTTP action", async () => {
    const integration = (
      await json("/integrations", "POST", { document: exampleOpenApi })
    ).data;
    await json(`/integrations/${integration.id}/import`, "POST", {
      schema: "Quote",
      name: "quote",
    });
    const result = (
      await json("/records/quote", "POST", {
        name: "Proyecto",
        seats: 5,
        plan: "Profesional",
      })
    ).data;
    expect(result.seats).toBe(5);
    const quote = await json("/demo/quotes", "POST", {
      name: "Proyecto",
      email: "test@example.com",
      seats: 5,
      plan: "Profesional",
    });
    expect(quote.monthlyTotal).toBe(445000);
    expect(quote.demo).toBe(true);
    expect(
      (await json("/audit")).data.some(
        (r: any) => r.action === "integration.executed",
      ),
    ).toBe(true);
  });
  it("rejects invalid names and arbitrary sort expressions", async () => {
    expect(
      (
        await request(
          "/records/opportunity?sort=" +
            encodeURIComponent("name'); DROP TABLE studio_records; --"),
        )
      ).status,
    ).toBe(400);
  });
});

it("persists screen removal and creation mode without removing records, then restores navigation", async () => {
  let object = (
    await json("/objects", "POST", {
      name: "screen_test",
      label: "Pantalla de prueba",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  const record = (
    await json("/records/screen_test", "POST", { name: "Dato conservado" })
  ).data;
  const original = object;
  object = (
    await json("/objects/screen_test", "PUT", {
      ...object,
      config: {
        ...object.config,
        studio: { screen: { hidden: true, createMode: "page" } },
      },
    })
  ).data;
  const persisted = (await json("/objects")).data.find(
    (o: any) => o.name === "screen_test",
  );
  expect(persisted.config.studio.screen).toEqual({
    hidden: true,
    createMode: "page",
  });
  expect((await json(`/records/screen_test/${record.id}`)).data.name).toBe(
    "Dato conservado",
  );
  expect((await request("/objects/screen_test", "PUT", original)).status).toBe(
    409,
  );
  object = (
    await json("/objects/screen_test", "PUT", {
      ...object,
      config: {
        ...object.config,
        studio: { screen: { hidden: false, createMode: "modal" } },
      },
    })
  ).data;
  expect(object.config.studio.screen).toEqual({
    hidden: false,
    createMode: "modal",
  });
});

it("patches screen metadata without publishing the full schema", async () => {
  const created = (
    await json("/objects", "POST", {
      name: "screen_patch",
      label: "Pantalla parche",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  const patched = (
    await json(`/objects/${created.name}/screen`, "PATCH", {
      hidden: true,
      createMode: "page",
      version: created.version ?? 1,
    })
  ).data;
  expect(patched.config.studio.screen).toEqual({
    hidden: true,
    createMode: "page",
  });
  await json(`/objects/${created.name}`, "DELETE");
});

it("persists a page's sidebar section and Lucide icon", async () => {
  const created = (
    await json("/objects", "POST", {
      name: "screen_navigation",
      label: "Configuración",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  const patched = (
    await json(`/objects/${created.name}/screen`, "PATCH", {
      section: "administration",
      icon: "settings-2",
      version: created.version ?? 1,
    })
  ).data;

  expect(patched.config.studio.screen).toMatchObject({
    section: "administration",
    icon: "settings-2",
  });
  await json(`/objects/${created.name}`, "DELETE");
});

it("persists menu layout with empty sections and skips stale screen names", async () => {
  const created = (
    await json("/objects", "POST", {
      name: "layout_a",
      label: "Layout A",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  const layout = (
    await json("/objects/reorder", "PUT", {
      layout: {
        version: 1,
        blocks: [
          {
            kind: "section",
            id: "menu_sales",
            label: "Nueva sección",
            screens: [],
          },
          {
            kind: "ungrouped",
            screens: [created.name, "missing_screen"],
          },
        ],
      },
    })
  ).data;
  expect(layout.blocks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "section",
        label: "Nueva sección",
        screens: [],
      }),
    ]),
  );
  const persisted = (await json("/objects")).data.find(
    (item: any) => item.name === created.name,
  );
  expect(persisted.config.studio.screen.order).toBe(0);
  await json(`/objects/${created.name}`, "DELETE");
});

it("reorders screens and deletes empty local screens permanently", async () => {
  const created = (
    await json("/objects", "POST", {
      name: "order_a",
      label: "Orden A",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  const second = (
    await json("/objects", "POST", {
      name: "order_b",
      label: "Orden B",
      description: "",
      config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
    })
  ).data;
  await json("/objects/reorder", "PUT", { names: [second.name, created.name] });
  const ordered = (await json("/objects")).data;
  const first = ordered.find((item: any) => item.name === second.name);
  const last = ordered.find((item: any) => item.name === created.name);
  expect(first.config.studio.screen.order).toBe(0);
  expect(last.config.studio.screen.order).toBe(1);
  expect(
    ordered.findIndex((item: any) => item.name === second.name),
  ).toBeLessThan(ordered.findIndex((item: any) => item.name === created.name));
  expect((await request(`/objects/${created.name}`, "DELETE")).status).toBe(
    200,
  );
  expect(
    (await json("/objects")).data.some(
      (item: any) => item.name === created.name,
    ),
  ).toBe(false);
  await json(`/objects/${second.name}`, "DELETE");
});

it("deletes local screens with records when deleteRecords is true", async () => {
  const created = (
    await json("/objects", "POST", {
      name: "with_data",
      label: "Con datos",
      description: "",
      config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    })
  ).data;
  await json(`/records/${created.name}`, "POST", { name: "Registro 1" });
  await json(`/records/${created.name}`, "POST", { name: "Registro 2" });
  const blocked = await request(`/objects/${created.name}`, "DELETE");
  expect(blocked.status).toBe(409);
  const deleted = await request(`/objects/${created.name}`, "DELETE", {
    deleteRecords: true,
  });
  expect(deleted.status).toBe(200);
  expect((await deleted.json()).data.deletedRecords).toBe(2);
  expect(
    (await json("/objects")).data.some(
      (item: any) => item.name === created.name,
    ),
  ).toBe(false);
});

it("reads native counts and pages in one D1 batch with matching filters and pagination", async () => {
  await json("/objects", "POST", {
    name: "page_batch",
    label: "Page batch",
    config: makeConfig({
      name: { type: "Textbox", label: "Name" },
      amount: { type: "Number", label: "Amount" },
    }),
  });
  const records = [];
  for (const amount of [5, 10, 20, 99])
    records.push(
      (
        await json("/records/page_batch", "POST", {
          name: `Item ${amount}`,
          amount,
        })
      ).data,
    );
  await json(`/records/page_batch/${records[3].id}?version=1`, "DELETE");
  const db = platform.env.DB;
  const batch = vi.fn((statements: D1PreparedStatement[]) =>
    db.batch(statements),
  );
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === "batch") return batch;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const list = async (query: string) => {
    const response = await app.request(
      `http://localhost/api/records/page_batch?${query}`,
      {},
      { ...platform.env, DB: wrapped },
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      data: { id: string; amount: number }[];
      total: number;
      page: number;
      perPage: number;
    }>;
  };
  const second = await list("sort=amount&order=ASC&page=2&perPage=2");
  expect(second).toMatchObject({
    total: 3,
    page: 2,
    perPage: 2,
    data: [{ id: records[2].id, amount: 20 }],
  });
  expect(await list("sort=amount&order=ASC&page=8&perPage=2")).toMatchObject({
    total: 3,
    data: [],
  });
  expect(await list("trash=true&perPage=1")).toMatchObject({
    total: 1,
    data: [{ id: records[3].id }],
  });
  expect(await list("q=Item%2010&perPage=1")).toMatchObject({
    total: 1,
    data: [{ id: records[1].id }],
  });
  expect(batch).toHaveBeenCalledTimes(4);
  for (const [statements] of batch.mock.calls)
    expect(statements).toHaveLength(2);
});

it("returns up to 200 domain audit events in stable date order", async () => {
  const domainApp = createStudioApp("domain:platform");
  for (let start = 0; start < 201; start += 100) {
    await platform.env.DB.batch(
      Array.from({ length: Math.min(100, 201 - start) }, (_, offset) => {
        const id = `audit-fixture-${String(start + offset).padStart(3, "0")}`;
        return platform.env.DB.prepare(
          "INSERT INTO studio_audit(id,tenant_id,action,object_name,detail,created_at) VALUES (?,'domain:platform','object.updated','audit_fixture','{}','2026-09-24T12:00:00.000Z')",
        ).bind(id);
      }),
    );
  }
  const response = await domainApp.request(
    "http://localhost/api/audit?object=audit_fixture",
    {},
    platform.env,
  );
  expect(response.status).toBe(200);
  const history = ((await response.json()) as any).data;
  expect(history).toHaveLength(200);
  expect(history[0].id).toBe("audit-fixture-200");
  expect(history.at(-1).id).toBe("audit-fixture-001");

  await platform.env.DB.batch(
    Array.from({ length: 101 }, (_, i) =>
      platform.env.DB.prepare(
        "INSERT INTO studio_audit(id,tenant_id,action,object_name,detail,created_at) VALUES (?,'demo','object.updated','agency_audit_fixture','{}','2026-09-24T12:00:00.000Z')",
      ).bind(`agency-audit-fixture-${i}`),
    ),
  );
  expect((await json("/audit?object=agency_audit_fixture")).data).toHaveLength(
    100,
  );
});
