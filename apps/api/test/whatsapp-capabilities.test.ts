import { expect, it, vi } from "vitest";
import { createEmployeeCapabilities } from "../src/assistant/capabilities";

it("does not expose personal or arbitrary data tools to an external contact", async () => {
  const employee = {
    id: "alice",
    agencyId: 7,
    status: "active",
    name: "Alice",
    handle: "alice",
    allowedCollections: ["*"],
    systemPrompt: "",
    model: null,
  } as any;
  const access = {
    tenantId: 7,
    connectionId: "connection",
    contact: "573001234567",
    generation: "g",
    audience: "external",
    principalId: null,
    profileId: "external",
    capabilities: ["insurance"],
  } as any;
  const read = vi.fn();
  const tools = createEmployeeCapabilities(employee, access, {
    read,
    prepare: vi.fn(),
  });
  expect(tools).toHaveProperty("savia_lookup_quote_vehicle");
  expect(tools).not.toHaveProperty("savia_list_studio_records");
  expect(tools).not.toHaveProperty("savia_search_personal_messages");
  expect(tools).not.toHaveProperty("savia_execute_command");
});
it("denies collection tools for employees without collection scope", async () => {
  const employee = {
    id: "support",
    allowedCollections: [],
    handle: "support",
  } as any;
  const tools = createEmployeeCapabilities(
    employee,
    { audience: "internal", principalId: "staff", capabilities: ["*"] } as any,
    { read: vi.fn(), prepare: vi.fn() },
  );
  expect(Object.keys(tools)).toHaveLength(0);
});
