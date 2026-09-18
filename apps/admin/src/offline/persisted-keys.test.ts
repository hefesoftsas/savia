import { describe, expect, it } from "vitest";
import { shouldPersistQueryKey } from "./persisted-keys";

describe("shouldPersistQueryKey", () => {
  it("persists React Admin reads for safe resources", () => {
    expect(
      shouldPersistQueryKey([
        "users",
        "getList",
        { pagination: { page: 1, perPage: 20 } },
      ]),
    ).toBe(true);
    expect(shouldPersistQueryKey(["users", "getOne", { id: "p-1" }])).toBe(
      true,
    );
    expect(shouldPersistQueryKey(["tenants", "getList", {}])).toBe(true);
    expect(shouldPersistQueryKey(["tenants", "getOne", { id: 101 }])).toBe(
      true,
    );
  });

  it("persists CRM studio metadata reads", () => {    expect(shouldPersistQueryKey(["business-setup", "agency:101"])).toBe(true);
    expect(
      shouldPersistQueryKey([
        "collection-relations",
        "/api",
        "agency:101",
      ]),
    ).toBe(true);
    expect(shouldPersistQueryKey(["collection-catalog", "agency:101"])).toBe(
      true,
    );
    expect(shouldPersistQueryKey(["views", "clientes"])).toBe(true);
    expect(shouldPersistQueryKey(["objects"])).toBe(true);
  });

  it("persists opted-in customer lists but never record details", () => {
    expect(
      shouldPersistQueryKey(["pipeline", "cotizaciones", { page: 1 }]),
    ).toBe(true);
    expect(
      shouldPersistQueryKey(["pipeline", "cotizaciones_detalle", {}]),
    ).toBe(true);
    expect(shouldPersistQueryKey(["summary", "cotizaciones", {}])).toBe(true);
    expect(shouldPersistQueryKey(["pipeline", "clientes", {}])).toBe(false);
    expect(shouldPersistQueryKey(["summary", "clientes", {}])).toBe(false);
    expect(
      shouldPersistQueryKey(["record-detail", "cotizaciones", "r-1"]),
    ).toBe(false);
    expect(shouldPersistQueryKey(["record-files", "cotizaciones"])).toBe(false);
  });

  it("never persists credentials-adjacent reads", () => {
    expect(shouldPersistQueryKey(["integrations"])).toBe(false);
    expect(shouldPersistQueryKey(["integration-runs", "abc"])).toBe(false);
    expect(shouldPersistQueryKey(["geocoding-settings"])).toBe(false);
    expect(shouldPersistQueryKey(["collection-sources", "agency:101"])).toBe(
      false,
    );
  });

  it("never persists customer records or live data", () => {
    expect(shouldPersistQueryKey(["record-detail", "r-1"])).toBe(false);
    expect(shouldPersistQueryKey(["record-links"])).toBe(false);
    expect(shouldPersistQueryKey(["managed-customer"])).toBe(false);
    expect(shouldPersistQueryKey(["plate", "XXX-000"])).toBe(false);
    expect(shouldPersistQueryKey(["vehicle", "XXX-000"])).toBe(false);
    expect(shouldPersistQueryKey(["operational-tasks"])).toBe(false);
    expect(shouldPersistQueryKey(["record-activity"])).toBe(false);
    expect(shouldPersistQueryKey(["savia-request"])).toBe(false);
    expect(shouldPersistQueryKey(["my-day"])).toBe(false);
    expect(shouldPersistQueryKey(["dashboard"])).toBe(false);
  });
  it("never persists session, account, password or assistant keys", () => {
    expect(shouldPersistQueryKey(["me"])).toBe(false);
    expect(shouldPersistQueryKey(["auth", "session"])).toBe(false);
    expect(shouldPersistQueryKey(["account"])).toBe(false);
    expect(shouldPersistQueryKey(["password-reset"])).toBe(false);
    expect(shouldPersistQueryKey(["assistant", "threads"])).toBe(false);
    expect(shouldPersistQueryKey(["sessions"])).toBe(false);
    expect(shouldPersistQueryKey(["savia-request"])).toBe(false);
  });

  it("defaults unknown and malformed keys to not persisted", () => {
    expect(shouldPersistQueryKey(["geocoding-settings"])).toBe(false);
    expect(shouldPersistQueryKey(["operational-tasks"])).toBe(false);
    expect(shouldPersistQueryKey(["/api/objects"])).toBe(false);
    expect(shouldPersistQueryKey([])).toBe(false);
    expect(shouldPersistQueryKey(undefined)).toBe(false);
    expect(shouldPersistQueryKey("users")).toBe(false);
    expect(shouldPersistQueryKey([42])).toBe(false);
  });
});
