import { expect, it } from "vitest";
import {
  buildDatabaseRead,
  buildDatabaseMutation,
  validateMutation,
} from "../src/database-sql";
import {
  databaseReadSchema,
  databaseMutationSchema,
  type ResourceMetadata,
} from "@savia/studio-shared/database-sources";
const fields = ["id", "name"].map((name) => ({
  name,
  nativeType: "text",
  valueType: "string" as const,
  nullable: false,
  generated: false,
  writable: true,
  hasDefault: false,
}));
const meta: ResourceMetadata = {
  resource: "orders",
  kind: "table",
  fields,
  primaryKey: ["id"],
  uniqueKeys: [],
  sampled: false,
};
it.each(["postgres", "mysql", "mssql"] as const)(
  "parameterizes %s mutations and isolates identifiers",
  (kind) => {
    const input = databaseMutationSchema.parse({
      connection: {
        kind,
        host: "db.internal",
        database: "erp",
        username: "writer",
      },
      resource: "orders",
      columns: ["id", "name"],
      idColumn: "id",
      operation: "update",
      id: "1",
      values: { name: "x'; DELETE FROM orders; --" },
    });
    const built = buildDatabaseMutation(input, meta);
    expect(built.text).not.toContain("DELETE FROM orders");
    expect(built.params).toContain("x'; DELETE FROM orders; --");
    expect(built.params).toContain("1");
  },
);
it("rejects generated fields, views, and incomplete composite keys", () => {
  const input = databaseMutationSchema.parse({
    connection: {
      kind: "postgres",
      host: "db",
      database: "erp",
      username: "writer",
    },
    resource: "orders",
    columns: ["id", "name"],
    idColumn: "id",
    operation: "update",
    id: "1",
    values: { name: "new" },
  });
  expect(() => validateMutation(input, { ...meta, kind: "view" })).toThrow();
  expect(() =>
    validateMutation(input, {
      ...meta,
      fields: fields.map((f) => ({ ...f, generated: f.name === "name" })),
    }),
  ).toThrow();
  expect(() =>
    validateMutation(input, { ...meta, primaryKey: ["id", "name"] }),
  ).toThrow();
  expect(() =>
    validateMutation(
      databaseMutationSchema.parse({ ...input, values: { id: "2" } }),
      meta,
    ),
  ).toThrow();
});
it.each(["postgres", "mysql", "mssql"] as const)(
  "uses stable %s pagination and null predicates",
  (kind) => {
    const input = databaseReadSchema.parse({
      connection: { kind, host: "db", database: "erp", username: "reader" },
      resource: "orders",
      columns: ["id", "name"],
      idColumn: "id",
      operation: "list",
      sort: "name",
      filters: [{ field: "name", op: "eq", value: null }],
    });
    const built = buildDatabaseRead(input, meta);
    expect(built.text).toContain("IS NULL");
    expect(built.text).toMatch(/ORDER BY .*name.*DESC, .*id.*DESC/);
    expect(built.params).toContain(26);
  },
);

it("maps SQL Server native conflict numbers without leaking driver errors", async () => {
  const { databaseError } = await import("../src/database-errors");
  expect(
    databaseError(
      { code: "EREQUEST", number: 2627, message: "private server details" },
      true,
    ),
  ).toMatchObject({ status: 409, code: "DATABASE_CONFLICT" });
});
