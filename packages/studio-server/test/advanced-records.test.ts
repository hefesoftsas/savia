import { beforeAll, afterAll, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/index";
import {
  makeConfig,
  validateRecord,
  objectSchema,
} from "@savia/studio-shared/metadata";
let platform: Awaited<ReturnType<typeof getPlatformProxy<any>>>;
const request = (path: string, method = "GET", body?: unknown, headers = {}) =>
  app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
async function json(
  path: string,
  method = "GET",
  body?: unknown,
  headers = {},
) {
  const r = await request(path, method, body, headers),
    d: any = await r.json();
  expect(r.status, JSON.stringify(d)).toBeLessThan(300);
  return d;
}
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
  await json("/bootstrap", "POST");
});
afterAll(async () => platform?.dispose());
it("idempotency replays the same create, rejects key reuse and unique collisions", async () => {
  await json("/objects", "POST", {
    name: "unique_item",
    label: "Items",
    config: makeConfig({
      name: {
        type: "Textbox",
        label: "Nombre",
        required: true,
        config: { unique: true },
      },
      amount: { type: "Number", label: "Valor" },
    }),
  });
  const headers = { "Idempotency-Key": "retry-key-123" };
  const first = (
    await json("/records/unique_item", "POST", { name: "Alpha" }, headers)
  ).data;
  expect(
    (await json("/records/unique_item", "POST", { name: "Alpha" }, headers))
      .data.id,
  ).toBe(first.id);
  expect(
    (await request("/records/unique_item", "POST", { name: "Beta" }, headers))
      .status,
  ).toBe(409);
  expect(
    (await request("/records/unique_item", "POST", { name: " alpha " })).status,
  ).toBe(409);
  expect((await json("/records/unique_item")).total).toBe(1);
});
it("concurrent edits cannot overwrite one another; stale deletion cannot erase newer edits", async () => {
  const first = (await json("/records/unique_item")).data[0];
  const results = await Promise.all([
    request(`/records/unique_item/${first.id}`, "PATCH", {
      amount: 10,
      _version: first._version,
    }),
    request(`/records/unique_item/${first.id}`, "PATCH", {
      amount: 20,
      _version: first._version,
    }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await request(`/records/unique_item/${first.id}?version=1`, "DELETE"))
      .status,
  ).toBe(409);
  expect(
    (await request(`/records/unique_item/${first.id}`, "PATCH", { amount: 0 }))
      .status,
  ).toBe(428);
});
it("trash is recoverable and restore rechecks uniqueness", async () => {
  const r = (await json("/records/unique_item")).data[0];
  await json(`/records/unique_item/${r.id}?version=${r._version}`, "DELETE");
  expect((await json("/records/unique_item")).total).toBe(0);
  const trash = (await json("/records/unique_item?trash=true")).data[0];
  const collision = (
    await json("/records/unique_item", "POST", { name: "ALPHA" })
  ).data;
  expect(
    (
      await request(`/records/unique_item/${r.id}/restore`, "POST", {
        version: trash._version,
      })
    ).status,
  ).toBe(409);
  await json(`/records/unique_item/${collision.id}?version=1`, "DELETE");
  expect(
    (
      await json(`/records/unique_item/${r.id}/restore`, "POST", {
        version: trash._version,
      })
    ).data.name,
  ).toBe("Alpha");
});
it("previews rename, preserves data on publish and restores archived fields", async () => {
  const original = (
    await json("/objects", "POST", {
      name: "schema_item",
      label: "Schema",
      config: makeConfig({
        name: { type: "Textbox", label: "Nombre", required: true },
        legacy: { type: "Textbox", label: "Anterior" },
      }),
    })
  ).data;
  const r = (
    await json("/records/schema_item", "POST", {
      name: "Demo",
      legacy: "Valor conservado",
    })
  ).data;
  const next = {
    ...original,
    config: makeConfig({
      name: original.config.fields.name,
      renamed: { ...original.config.fields.legacy, label: "Nuevo" },
    }),
  };
  const migration = { rename: { legacy: "renamed" } };
  expect(
    (
      await json("/objects/schema_item/preview", "POST", {
        object: next,
        migration,
      })
    ).data,
  ).toMatchObject({ valid: true, total: 1, changed: 1 });
  const published = (
    await json("/objects/schema_item", "PUT", { ...next, migration })
  ).data;
  expect(published.version).toBe(2);
  expect((await json(`/records/schema_item/${r.id}`)).data.renamed).toBe(
    "Valor conservado",
  );
  await json("/objects/schema_item/restore", "POST", {
    version: 2,
    targetVersion: 1,
  });
  const restored = (await json(`/records/schema_item/${r.id}`)).data;
  expect(restored.legacy).toBe("Valor conservado");
  expect(restored.renamed).toBeUndefined();
});
it("combines numeric filters and groups across 1000 records with complete pagination", async () => {
  await json("/objects", "POST", {
    name: "volume",
    label: "Volumen",
    config: makeConfig({
      name: { type: "Textbox", label: "Nombre" },
      amount: { type: "Number", label: "Valor" },
      status: {
        type: "Dropdown",
        label: "Estado",
        options: [
          { value: "Open", label: "Open" },
          { value: "Won", label: "Won" },
        ],
      },
    }),
  });
  for (let offset = 0; offset < 1000; offset += 100)
    await platform.env.DB.batch(
      Array.from({ length: 100 }, (_, j) => {
        const n = offset + j;
        return platform.env.DB.prepare(
          "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
        ).bind(
          `volume-${String(n).padStart(4, "0")}`,
          "demo",
          "volume",
          JSON.stringify({
            name: `Registro ${n}`,
            amount: n,
            status: n % 2 ? "Won" : "Open",
          }),
        );
      }),
    );
  const filters = JSON.stringify({
    logic: "and",
    conditions: [
      { field: "amount", op: "gte", value: 800 },
      { field: "status", op: "eq", value: "Won" },
    ],
  });
  const started = performance.now();
  const result = await json(
    "/records/volume?" +
      new URLSearchParams({
        filters,
        sort: "amount",
        order: "DESC",
        perPage: "25",
        page: "2",
      }),
  );
  const elapsed = performance.now() - started;
  expect(result.total).toBe(100);
  expect(result.data[0].amount).toBe(949);
  expect(result.data).toHaveLength(25);
  const grouped = await json(
    "/records/volume/summary?" +
      new URLSearchParams({ group: "status", filters }),
  );
  expect(grouped.data).toEqual([{ value: "Won", count: 100, amount: 0 }]);
  console.log(
    `D1 local: filtro + orden + página sobre 1000 registros: ${elapsed.toFixed(1)} ms`,
  );
});
it("validates defaults, conditional requirements, formulas and field sections", () => {
  const o: any = {
    name: "rule_item",
    label: "Reglas",
    description: "",
    config: makeConfig({
      name: { type: "Textbox", label: "Nombre", defaultValue: "Nuevo" },
      qty: { type: "Number", label: "Cantidad", defaultValue: 2 },
      price: { type: "Number", label: "Precio" },
      total: {
        type: "Number",
        label: "Total",
        config: { formula: { op: "product", fields: ["qty", "price"] } },
      },
      reason: {
        type: "Textbox",
        label: "Motivo",
        config: { requiredWhen: { field: "price", op: "gt", value: 100 } },
      },
    }),
  };
  expect(validateRecord(o, { price: 50, total: 999 }).data).toMatchObject({
    name: "Nuevo",
    qty: 2,
    total: 100,
  });
  expect(validateRecord(o, { price: 101 }).errors.reason).toBeTruthy();
  o.config.fields.name.config = { section: "missing" };
  expect(objectSchema.safeParse(o).success).toBe(false);
});

it("persists wizard metadata, rejects invalid steps and still validates the whole record on the API", async () => {
  const example = JSON.parse(
    readFileSync("examples/wizard-object.json", "utf8"),
  );
  const created = (await json("/objects", "POST", example)).data;
  expect(created.config.studio.wizard.steps).toHaveLength(3);
  expect(
    (
      await request("/records/guided_request", "POST", {
        name: "Solo paso uno",
        kind: "Proyecto",
      })
    ).status,
  ).toBe(422);
  const record = (
    await json("/records/guided_request", "POST", {
      name: "Completa",
      kind: "Proyecto",
      email: "wizard@example.com",
      amount: 100,
    })
  ).data;
  expect(record.email).toBe("wizard@example.com");
  const invalid = structuredClone(created);
  invalid.config.fields.email.config.step = "missing";
  expect(
    (await request("/objects/guided_request", "PUT", invalid)).status,
  ).toBe(422);
  const metadata = (await json("/objects")).data.find(
    (o: any) => o.name === "guided_request",
  );
  expect(metadata.config.fields.email.config.step).toBe("contact");
  const history = (await json("/objects/guided_request/versions")).data;
  expect(history[0].config.studio.wizard.steps[2].id).toBe("terms");
});
