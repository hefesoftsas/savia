import { describe, expect, it } from "vitest";
import { createDbBridgeApp } from "../src/app";
import type { BridgeDriver } from "../src/driver";

const connection = {
  host: "pg.internal",
  port: 5432,
  database: "erp",
  username: "reader",
  password: "secret",
  schema: "public",
  ssl: true,
};

const driver: BridgeDriver = {
  async listTables() {
    return [
      { schema: "public", kind: "table", table: "orders", rowEstimate: 3 },
      {
        schema: "public",
        kind: "view",
        table: "open_orders",
        rowEstimate: null,
      },
    ];
  },
  async getColumns(_connection, table) {
    if (table !== "orders") {
      const error = new Error("missing");
      (error as { status?: number }).status = 404;
      throw error;
    }
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
      ],
      primaryKey: ["id"],
    };
  },
  async query(input) {
    if (input.operation === "read")
      return {
        data: { id: input.id!, total: 10 },
        page: 1,
        perPage: 1,
        hasNext: false,
      };
    return {
      data: [{ id: "a", total: 10 }],
      total: 1,
      page: input.page,
      perPage: input.perPage,
      hasNext: false,
    };
  },
};

const app = createDbBridgeApp({
  driver,
  sharedSecret: "bridge-secret",
  allowedHosts: "pg.internal",
});

const call = (path: string, body?: unknown, secret = "bridge-secret") =>
  app.request(`http://bridge${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("db-bridge", () => {
  it("expone salud sin auth", async () => {
    const response = await app.request("http://bridge/health");
    expect(response.status).toBe(200);
  });

  it("rechaza sin secreto o con secreto inválido", async () => {
    const missing = await app.request("http://bridge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(401);
    const wrong = await call("/query", {}, "otro");
    expect(wrong.status).toBe(401);
  });

  it("lista tablas del esquema", async () => {
    const response = await call("/introspect", { connection });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { tables: unknown[] };
    expect(payload.tables).toHaveLength(2);
  });

  it("describe columnas de una tabla", async () => {
    const response = await call("/introspect", { connection, table: "orders" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { primaryKey: string[] };
    expect(payload.primaryKey).toEqual(["id"]);
  });

  it("rechaza identificadores con inyección", async () => {
    const response = await call("/introspect", {
      connection,
      table: 'orders"; DROP TABLE orders; --',
    });
    expect(response.status).toBe(422);
  });

  it("rechaza hosts no permitidos", async () => {
    const response = await call("/introspect", {
      connection: { ...connection, host: "evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("ejecuta consultas list y read", async () => {
    const list = await call("/query", {
      connection,
      table: "orders",
      operation: "list",
      page: 1,
      perPage: 25,
    });
    expect(list.status).toBe(200);
    const read = await call("/query", {
      connection,
      table: "orders",
      operation: "read",
      id: "a",
    });
    expect(read.status).toBe(200);
  });

  it("propaga 404 del driver", async () => {
    const response = await call("/introspect", {
      connection,
      table: "missing",
    });
    expect(response.status).toBe(404);
  });
});
