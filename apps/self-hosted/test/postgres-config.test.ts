import { inspect } from "node:util";
import { expect, it } from "vitest";
import { databaseConfiguration } from "../src/database-config";
it("defaults to SQLite and requires an explicit complete PostgreSQL configuration", () => {
  expect(databaseConfiguration({})).toEqual({ driver: "sqlite" });
  expect(() =>
    databaseConfiguration({ SAVIA_DATABASE_DRIVER: "unknown" }),
  ).toThrow(/driver/i);
  expect(() =>
    databaseConfiguration({ SAVIA_DATABASE_DRIVER: "postgres" }),
  ).toThrow(/URL/);
  expect(
    databaseConfiguration({
      SAVIA_DATABASE_DRIVER: "postgres",
      SAVIA_POSTGRES_URL: "postgresql://app:secret@postgres/savia",
    }),
  ).toMatchObject({ driver: "postgres", maxConnections: 5 });
});
it("rejects insecure remote TLS, pool overflow and credential-bearing errors", () => {
  const base = {
    SAVIA_DATABASE_DRIVER: "postgres",
    SAVIA_POSTGRES_URL: "postgresql://app:dummysecret@db.example.com/savia",
  };
  expect(() => databaseConfiguration(base)).toThrow(/TLS/);
  expect(
    databaseConfiguration({
      ...base,
      SAVIA_POSTGRES_URL: base.SAVIA_POSTGRES_URL + "?sslmode=verify-full",
    }),
  ).toMatchObject({ driver: "postgres" });
  expect(() =>
    databaseConfiguration({
      ...base,
      SAVIA_POSTGRES_URL: "postgresql://app:x@postgres/savia",
      SAVIA_POSTGRES_POOL_SIZE: "100",
    }),
  ).toThrow(/pool/i);
  expect(() =>
    databaseConfiguration({
      ...base,
      SAVIA_POSTGRES_URL: "postgresql://app:dummysecret@host:bad/db",
    }),
  ).toThrow(/URL/);
  try {
    databaseConfiguration({
      ...base,
      SAVIA_POSTGRES_URL: "postgresql://app:dummysecret@host:bad/db",
    });
    throw new Error("accepted invalid URL");
  } catch (error) {
    expect(inspect(error)).not.toContain("dummysecret");
  }
});
