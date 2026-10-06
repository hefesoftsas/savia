import { expect, it, vi } from "vitest";
import {
  createEmployeeCapabilities,
  whatsappOperationInstructionsForProducts,
} from "../src/assistant/capabilities";

it("returns a safe actionable read failure instead of throwing provider details", async () => {
  const employee = {
    id: "alice",
    agencyId: 7,
    status: "active",
    name: "Alice",
    handle: "alice",
    allowedCollections: ["cotizaciones", "cotizaciones_detalle"],
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
  const read = vi.fn(async () => {
    throw new Error(
      "Bearer private-token https://internal.invalid/provider timed out",
    );
  });
  const tools = createEmployeeCapabilities(employee, access, {
    read,
    prepare: vi.fn(),
  });

  const result = await tools.savia_lookup_quote_vehicle.execute!({
    plate: "TESTCAR",
  });
  expect(result).toMatchObject({
    isError: true,
    message: expect.stringMatching(/no se pudo completar|no fue posible/i),
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(JSON.stringify(result)).not.toContain("internal.invalid");
  expect(JSON.stringify(result)).toMatch(/contact.*directamente.*asesor/i);
  expect(JSON.stringify(result)).toMatch(/no invent|no verificado/i);
  expect(read).toHaveBeenCalledTimes(1);
});

it("limits insurance claims to the safely serialized enabled catalog", () => {
  const system = whatsappOperationInstructionsForProducts([
    { id: "sura-auto", label: 'Auto Integral "actual"' },
  ]);
  expect(system).toContain('"id":"sura-auto"');
  expect(system).toContain('"label":"Auto Integral \\"actual\\""');
  expect(system).toMatch(/only.*enabled products|enabled products.*only/i);
  expect(system).toMatch(/do not invent or suggest unsupported/i);
  expect(system).not.toMatch(/hogar|vida|salud/i);
});

it("does not expose quote tools or product claims when catalog preflight fails", () => {
  const employee = {
    id: "alice",
    agencyId: 7,
    status: "active",
    name: "Alice",
    handle: "alice",
    allowedCollections: ["cotizaciones", "cotizaciones_detalle"],
    systemPrompt: "",
    model: null,
  } as any;
  const unavailableAccess = {
    tenantId: 7,
    connectionId: "connection",
    contact: "573001234567",
    generation: "g",
    audience: "external",
    principalId: null,
    profileId: "external",
    capabilities: [],
  } as any;
  const tools = createEmployeeCapabilities(employee, unavailableAccess, {
    read: vi.fn(),
    prepare: vi.fn(),
  });

  expect(tools).not.toHaveProperty("savia_get_quote_form");
  expect(tools).not.toHaveProperty("savia_lookup_quote_vehicle");
  expect(whatsappOperationInstructionsForProducts(null)).toMatch(
    /availability could not be verified|no se pudo verificar/i,
  );
  expect(whatsappOperationInstructionsForProducts(null)).not.toMatch(
    /hogar|vida|salud/i,
  );
});
