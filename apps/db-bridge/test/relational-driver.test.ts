import { expect, it } from "vitest";
import {
  createRelationalDriver,
  type SqlSession,
} from "../src/relational-driver";
import { databaseMutationSchema } from "@savia/crm-shared/database-sources";
const meta = {
  resource: "orders",
  kind: "table" as const,
  fields: [
    {
      name: "id",
      nativeType: "text",
      valueType: "string" as const,
      nullable: false,
      generated: true,
      writable: false,
      hasDefault: true,
    },
    {
      name: "name",
      nativeType: "text",
      valueType: "string" as const,
      nullable: false,
      generated: false,
      writable: true,
      hasDefault: false,
    },
  ],
  primaryKey: ["id"],
  uniqueKeys: [],
  sampled: false,
};
it("rolls back missing mutations and always releases the session", async () => {
  const events: string[] = [];
  const session: SqlSession = {
    query: async () => ({ rows: [], affected: 0 }),
    begin: async () => {
      events.push("begin");
    },
    commit: async () => {
      events.push("commit");
    },
    rollback: async () => {
      events.push("rollback");
    },
    release: async () => {
      events.push("release");
    },
  };
  const driver = createRelationalDriver({
    kind: "postgres",
    connect: async () => session,
    inspect: async () => meta,
    list: async () => [],
    close: async () => {},
  });
  const input = databaseMutationSchema.parse({
    connection: {
      kind: "postgres",
      host: "db",
      database: "erp",
      username: "writer",
    },
    resource: "orders",
    idColumn: "id",
    columns: ["id", "name"],
    operation: "delete",
    id: "missing",
  });
  await expect(driver.mutate(input)).rejects.toMatchObject({ status: 404 });
  expect(events).toEqual(["begin", "rollback", "release"]);
});
it("returns created records after default-generated identifiers", async () => {
  const events: string[] = [];
  const session: SqlSession = {
    query: async (text) =>
      text.startsWith("SELECT")
        ? { rows: [{ id: "123", name: "Acme" }], affected: 1 }
        : { rows: [{ __insertId: "123" }], affected: 1 },
    begin: async () => {
      events.push("begin");
    },
    commit: async () => {
      events.push("commit");
    },
    rollback: async () => {
      events.push("rollback");
    },
    release: async () => {
      events.push("release");
    },
  };
  const driver = createRelationalDriver({
    kind: "postgres",
    connect: async () => session,
    inspect: async () => meta,
    list: async () => [],
    close: async () => {},
  });
  const input = databaseMutationSchema.parse({
    connection: {
      kind: "postgres",
      host: "db",
      database: "erp",
      username: "writer",
    },
    resource: "orders",
    idColumn: "id",
    columns: ["id", "name"],
    operation: "create",
    values: { name: "Acme" },
  });
  expect((await driver.mutate(input)).data).toEqual({
    id: "123",
    name: "Acme",
  });
  expect(events).toEqual(["begin", "commit", "release"]);
});
