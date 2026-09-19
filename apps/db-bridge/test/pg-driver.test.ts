import { describe, expect, it } from "vitest";
import { bridgeQuerySchema } from "@savia/crm-shared/sql-sources";
import { buildListQuery, buildReadQuery } from "../src/pg-driver";

const connection = {
  host: "pg.internal",
  port: 5432,
  database: "erp",
  username: "reader",
  password: "secret",
  schema: "public",
  ssl: true,
};

const base = {
  connection,
  table: "orders",
  operation: "list",
  page: 2,
  perPage: 25,
} as const;

describe("pg-driver query builders", () => {
  it("construye lecturas por PK parametrizadas", () => {
    const input = bridgeQuerySchema.parse({
      ...base,
      operation: "read",
      id: "a1",
      idColumn: "id",
    });
    const built = buildReadQuery(input);
    expect(built.text).toBe(
      'SELECT "id" FROM "public"."orders" WHERE "id" = $1 LIMIT 2',
    );
    expect(built.params).toEqual(["a1"]);
  });

  it("parametriza filtros y pagina con límite+1", () => {
    const input = bridgeQuerySchema.parse({
      ...base,
      columns: ["id", "customer"],
      filters: [
        { field: "customer", op: "eq", value: "Acme" },
        { field: "total", op: "eq", value: null },
      ],
      sort: "total",
      order: "ASC",
    });
    const built = buildListQuery(input);
    expect(built.text).toContain('"customer" = $1');
    expect(built.text).toContain('"total" IS NULL');
    expect(built.text).toContain('ORDER BY "total" ASC, "id" ASC');
    expect(built.text).toContain("LIMIT $2 OFFSET $3");
    expect(built.params).toEqual(["Acme", 26, 25]);
    expect(built.text).not.toContain("Acme");
  });

  it("escapa comodines LIKE en búsquedas", () => {
    const input = bridgeQuerySchema.parse({
      ...base,
      search: "100%_x\\y",
      searchColumns: ["customer"],
    });
    const built = buildListQuery(input);
    expect(built.params[0]).toBe("%100\\%\\_x\\\\y%");
    expect(built.text).toContain("::text ILIKE $1 ESCAPE '\\'");
  });

  it("usa la PK como orden estable por defecto", () => {
    const input = bridgeQuerySchema.parse({ ...base });
    const built = buildListQuery(input);
    expect(built.text).toContain('ORDER BY "id" DESC');
    expect(built.text).not.toContain('"id" DESC, ');
  });
});

it.each(["Acme", "", true, false, 0, 1.5, null])("preserves scalar %j", async (value) => {
  const { serializeValue } = await import("../src/pg-driver");
  expect(serializeValue(value)).toBe(value);
});
it("preserves bigint precision and rejects nonfinite numbers", async () => {
  const { serializeValue } = await import("../src/pg-driver");
  expect(serializeValue(9007199254740993n)).toBe("9007199254740993");
  expect(serializeValue(NaN)).toBeNull();
  expect(serializeValue(Infinity)).toBeNull();
});
