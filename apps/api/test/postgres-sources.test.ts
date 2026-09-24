import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { SqlBridgeError } from "../src/studio/sql-bridge";
import type { SqlBridgeClient } from "../src/studio/sql-bridge";
import type {
  BridgeQuery,
  BridgeQueryResult,
} from "@savia/studio-shared/sql-sources";
import { createCollectionSourceApp } from "../src/studio/collection-sources";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});

const tenant = "domain:pg_test";
const KEY = "collection-source-test-key-at-least-32-characters";

type Row = Record<string, string | number | boolean | null>;
const ORDERS: Row[] = [
  {
    id: "a1",
    customer: "Acme",
    total: 100,
    placed_at: "2026-01-01T00:00:00.000Z",
    internal_note: "x1",
  },
  {
    id: "b2",
    customer: "Globex",
    total: 250,
    placed_at: "2026-02-01T00:00:00.000Z",
    internal_note: "x2",
  },
  {
    id: "c3",
    customer: "Acme",
    total: 50,
    placed_at: "2026-03-01T00:00:00.000Z",
    internal_note: "x3",
  },
];

const seen: BridgeQuery[] = [];

const bridge: SqlBridgeClient = {
  async listTables() {
    return [
      { schema: "public", table: "orders", kind: "table", rowEstimate: 3 },
      { schema: "public", table: "nopk", kind: "table", rowEstimate: 1 },
    ];
  },
  async getColumns(_connection, table) {
    if (table === "orders")
      return {
        schema: "public",
        table: "orders",
        kind: "table",
        columns: [
          {
            name: "id",
            pgType: "uuid",
            nullable: false,
            isPrimaryKey: true,
            isUnique: true,
            defaultValue: null,
          },
          {
            name: "customer",
            pgType: "text",
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: null,
          },
          {
            name: "total",
            pgType: "numeric",
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: null,
          },
          {
            name: "placed_at",
            pgType: "timestamptz",
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: null,
          },
          {
            name: "internal_note",
            pgType: "text",
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: null,
          },
        ],
        primaryKey: ["id"],
      };
    if (table === "nopk")
      return {
        schema: "public",
        table: "nopk",
        kind: "table",
        columns: [
          {
            name: "name",
            pgType: "text",
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: null,
          },
        ],
        primaryKey: [],
      };
    throw new SqlBridgeError(
      "SQL_NOT_FOUND",
      "No encontrado en la base externa.",
      404,
    );
  },
  async query(input: BridgeQuery): Promise<BridgeQueryResult> {
    seen.push(input);
    if (input.operation === "read") {
      const row = ORDERS.find(
        (candidate) => String(candidate[input.idColumn ?? "id"]) === input.id,
      );
      if (!row)
        throw new SqlBridgeError(
          "SQL_NOT_FOUND",
          "No encontrado en la base externa.",
          404,
        );
      return {
        data: project(row, input.columns),
        page: 1,
        perPage: 1,
        hasNext: false,
      };
    }
    let rows = [...ORDERS];
    for (const filter of input.filters)
      rows = rows.filter((row) => row[filter.field] === filter.value);
    if (input.search && input.searchColumns.length) {
      const needle = input.search.toLowerCase();
      rows = rows.filter((row) =>
        input.searchColumns.some((column) =>
          String(row[column] ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      );
    }
    const sort = input.sort ?? "id";
    rows.sort((left, right) => {
      const compared = String(left[sort] ?? "").localeCompare(
        String(right[sort] ?? ""),
      );
      return input.order === "ASC" ? compared : -compared;
    });
    const start = (input.page - 1) * input.perPage;
    const page = rows
      .slice(start, start + input.perPage)
      .map((row) => project(row, input.columns));
    return {
      data: page,
      total: rows.length,
      page: input.page,
      perPage: input.perPage,
      hasNext: start + input.perPage < rows.length,
    };
  },
};

function project(row: Row, columns?: string[]): Row {
  if (!columns) return { ...row };
  return Object.fromEntries(
    columns.map((column) => [column, row[column] ?? null]),
  );
}

const app = createCollectionSourceApp(
  env.DB,
  env.DOCUMENTS,
  tenant,
  "test-pg-owner",
  KEY,
  undefined,
  undefined,
  bridge,
);
const appWithoutBridge = createCollectionSourceApp(
  env.DB,
  env.DOCUMENTS,
  tenant,
  "test-pg-owner",
  KEY,
);

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`http://localhost/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const SOURCE = {
  id: "erp",
  label: "ERP Postgres",
  kind: "postgres",
  host: "pg.internal",
  database: "erp",
  username: "reader",
  password: "s3cret",
  schema: "public",
} as const;

async function createSource(payload: unknown = SOURCE) {
  const response = await call("sources", "POST", payload);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as any;
}

async function inspectedFields() {
  const inspected = await call("sources/erp/inspect", "POST", {
    resource: "orders",
  });
  expect(inspected.status, await inspected.clone().text()).toBe(200);
  return ((await inspected.json()) as any).data.fields as Record<
    string,
    unknown
  >;
}

async function bindOrders(name = "ordenes_pg") {
  const fields = await inspectedFields();
  delete (fields as Record<string, unknown>).internal_note;
  const bound = await call("collection-bindings", "POST", {
    name,
    label: "Órdenes PG",
    sourceId: "erp",
    resource: "orders",
    fields,
  });
  expect(bound.status, await bound.clone().text()).toBe(201);
  return (await bound.json()) as any;
}

it("crea fuentes postgres sin exponer la contraseña", async () => {
  const created = await createSource();
  expect(created.data.kind).toBe("postgres");
  expect(created.data.hasPassword).toBe(true);
  expect(JSON.stringify(created.data)).not.toContain("s3cret");

  const listed = (await (await call("sources")).json()) as any;
  const row = listed.data.find((entry: any) => entry.id === "erp");
  expect(row.hasPassword).toBe(true);
  expect(JSON.stringify(row)).not.toContain("s3cret");

  const duplicated = await call("sources", "POST", SOURCE);
  expect(duplicated.status).toBe(409);
  expect(
    (
      await call("sources", "POST", {
        ...SOURCE,
        id: "erp2",
        host: "no válido!!",
      })
    ).status,
  ).toBe(422);
});

it("rota la contraseña y rechaza el secreto del otro tipo", async () => {
  const renamed = await call("sources/erp", "PUT", { password: "nueva" });
  expect(renamed.status, await renamed.clone().text()).toBe(200);
  expect((await call("sources/erp", "PUT", { token: "x" })).status).toBe(422);
});

it("inspecciona tablas y columnas con mapeo de tipos", async () => {
  const tables = await call("sources/erp/inspect", "POST", {});
  expect(tables.status, await tables.clone().text()).toBe(200);
  expect(((await tables.json()) as any).data.tables).toHaveLength(2);

  const columns = await call("sources/erp/inspect", "POST", {
    resource: "orders",
  });
  const data = ((await columns.json()) as any).data;
  expect(data.primaryKey).toEqual(["id"]);
  expect(data.fields.total.type).toBe("Number");
  expect(data.fields.placed_at.type).toBe("DateControl");
  expect(data.fields.customer.type).toBe("Textbox");

  expect(
    (
      await call("sources/erp/inspect", "POST", {
        resource: 'orders"; DROP TABLE orders; --',
      })
    ).status,
  ).toBe(422);
  expect(
    (await call("sources/erp/inspect", "POST", { resource: "missing" })).status,
  ).toBe(404);
});

it("responde 503 sin puente configurado", async () => {
  const response = await appWithoutBridge.request(
    "http://localhost/api/sources/erp/inspect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "orders" }),
    },
  );
  expect(response.status).toBe(503);
});

it("enlaza tablas con PK única y fija solo-lectura", async () => {
  const bound = await bindOrders();
  expect(bound.data.config.studio.collection).toMatchObject({
    kind: "postgres",
    sourceId: "erp",
    resource: "orders",
    idColumn: "id",
  });
  expect(bound.data.config.studio.capabilities).toMatchObject({
    list: true,
    read: true,
    create: false,
    update: false,
    delete: false,
    schema: false,
    customFields: false,
  });

  const fields = await inspectedFields();
  expect(
    (
      await call("collection-bindings", "POST", {
        name: "sin_pk",
        label: "Sin PK",
        sourceId: "erp",
        resource: "orders",
        fields: { customer: fields.customer, total: fields.total },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("collection-bindings", "POST", {
        name: "col_falsa",
        label: "Falsa",
        sourceId: "erp",
        resource: "orders",
        fields: {
          ...fields,
          inventada: { label: "Inventada", type: "Textbox" },
        },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("collection-bindings", "POST", {
        name: "tabla_nopk",
        label: "Sin PK",
        sourceId: "erp",
        resource: "nopk",
        fields: { name: { label: "Nombre", type: "Textbox" } },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("collection-bindings", "POST", {
        name: "con_escritura",
        label: "Escritura",
        sourceId: "erp",
        resource: "orders",
        fields,
        capabilities: { create: true },
      })
    ).status,
  ).toBe(422);
});

it("lista y lee registros proyectando solo campos declarados", async () => {
  const listed = await call("records/ordenes_pg?perPage=2");
  expect(listed.status, await listed.clone().text()).toBe(200);
  const page = (await listed.json()) as any;
  expect(page.total).toBe(3);
  expect(page.data).toHaveLength(2);
  expect(page.pageInfo.hasNextPage).toBe(true);
  expect(page.data[0].id).toBe("c3");
  expect(page.data[0].internal_note).toBeUndefined();

  const detail = await call("record-detail/ordenes_pg/c3");
  expect(detail.status).toBe(200);
  expect(((await detail.json()) as any).data.record.customer).toBe("Acme");
  expect((await call("records/ordenes_pg/zzz")).status).toBe(404);
});

it("rechaza escrituras, operaciones custom y papelera", async () => {
  expect((await call("records/ordenes_pg", "POST", {})).status).toBe(405);
  expect((await call("records/ordenes_pg/a1", "PATCH", {})).status).toBe(405);
  expect((await call("records/ordenes_pg/a1", "DELETE")).status).toBe(405);
  expect((await call("records/ordenes_pg?trash=true")).status).toBe(422);
  expect((await call("records/ordenes_pg?perPage=101")).status).toBe(422);
  const operations = await call(
    "collection-bindings/ordenes_pg/operations",
    "PUT",
    {
      version: 1,
      operations: {
        list: null,
        read: null,
        create: null,
        update: null,
        delete: null,
      },
    },
  );
  expect(operations.status).toBe(405);
});

it("traslada filtros, orden y búsqueda al puente", async () => {
  seen.length = 0;
  const filtered = await call(
    `records/ordenes_pg?filters=${encodeURIComponent(JSON.stringify({ logic: "and", conditions: [{ field: "customer", op: "eq", value: "Acme" }] }))}&sort=total&order=ASC`,
  );
  expect(filtered.status, await filtered.clone().text()).toBe(200);
  expect(((await filtered.json()) as any).total).toBe(2);
  expect(seen.at(-1)).toMatchObject({
    table: "orders",
    operation: "list",
    sort: "total",
    order: "ASC",
    filters: [{ field: "customer", op: "eq", value: "Acme" }],
  });

  const searched = await call("records/ordenes_pg?q=globex");
  expect(searched.status).toBe(200);
  expect(seen.at(-1)?.search).toBe("globex");
  expect(seen.at(-1)?.searchColumns).toContain("customer");
  expect(seen.at(-1)?.searchColumns).not.toContain("total");

  expect(
    (
      await call(
        `records/ordenes_pg?filters=${encodeURIComponent(JSON.stringify({ logic: "and", conditions: [{ field: "customer", op: "contains", value: "Ac" }] }))}`,
      )
    ).status,
  ).toBe(422);
  expect((await call("records/ordenes_pg?sort=inventado")).status).toBe(422);
  expect((await call("records/ordenes_pg?sort=customer;DROP")).status).not.toBe(
    200,
  );
});
