import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import { makeConfig } from "@savia/crm-shared/metadata";
import { createPublicQuoteAdapter } from "../src/public-forms/quote-adapter";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
);
const tenant = "public-quote-test";
const object = {
  name: "cotizador",
  label: "Quotes",
  description: "",
  config: makeConfig({
    extension_surface: { type: "Textbox", label: "Extension", hidden: true },
  }),
};
const values = {
  vehicle_plate: "abc123",
  vehicle_fasecoldaCode: "12345678",
  vehicle_productionYear: "2023",
  vehicle_isNew: false,
  vehicle_circulationCity: "11001",
  vehicle_accessoriesValue: "0",
  vehicle_declaredValue: "50000000",
  applicant_documentType: "CC",
  applicant_documentNumber: "123456789",
  applicant_firstName: "Ada",
  applicant_surname: "Example",
  applicant_secondSurname: "",
  applicant_gender: "F",
  applicant_birthDate: "1990-01-01",
  applicant_city: "11001",
  applicant_address: "Example 123",
  applicant_phone: "3001234567",
  applicant_email: "ada@example.test",
};
let settings: any;
beforeAll(async () => {
  for (const [, sql] of migrations.sort(([a], [b]) => a.localeCompare(b)))
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await env.DB.prepare(
    "INSERT INTO crm_extension_installations(tenant_id,id,version,manifest) VALUES (?,'insurance.quotes','1.2.0','{}')",
  )
    .bind(tenant)
    .run();
  settings = {
    quotePages: { direct: true, wizard: true },
    vehicleLookup: { enabled: false, flowId: "sura-autos-provider" },
    clientMapping: {
      collection: "clientes",
      matchField: "documento",
      fieldMap: {},
    },
    products: [
      { id: "sbs-producto-8", label: "Admin label", enabled: true, rank: 1 },
    ],
  };
  await env.DB.prepare(
    "INSERT INTO extension_settings(tenant_id,extension_id,value,version,updated_at,updated_by_principal_id,created_at,created_by_principal_id) VALUES (?,'insurance.quotes',?,1,'now','admin','now','admin')",
  )
    .bind(tenant, JSON.stringify(settings))
    .run();
});
it("freezes only quote products and validates public inputs before executing a fixed server-owned action", async () => {
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: {
      type: "quote",
      data: {
        premiumTotal: 12345,
        quoteNumber: "customer-secret",
        credentials: { password: "secret" },
        customer: values,
      },
    },
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const published = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  expect(published.fields.some((f) => f.name === "vehicle_plate")).toBe(true);
  expect(
    published.fields.some((f) =>
      /connection|mode|flow|lookup|operation/i.test(f.name),
    ),
  ).toBe(false);
  await expect(
    adapter.validate({
      snapshot: published.snapshot,
      values: { ...values, mode: "mock" },
    }),
  ).rejects.toThrow();
  const validated = await adapter.validate({
    snapshot: published.snapshot,
    values,
  });
  const result = await adapter.execute({
    db: env.DB,
    tenant,
    domainId: "test",
    objectName: object.name,
    submissionId: "server-submission",
    snapshot: published.snapshot,
    values: validated,
    returnResult: true,
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]).toMatchObject([
    {
      tenantId: tenant,
      principalId: "public-form:server-submission",
      extensionId: "insurance.quotes",
      actionId: "quote",
      connectionId: "simulation",
    },
    {
      mode: "live",
      flowId: "sbs-producto-8",
      quoteInput: {
        vehicle: { plate: ["ABC", "123"].join(""), productionYear: 2023 },
      },
    },
  ]);
  expect(result).toMatchObject({
    quotes: [{ insurer: "SBS", premiumTotal: 12345, currency: "COP" }],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /customer-secret|credentials|password|Ada|documentNumber|runId|flowId/,
  );
});
it("fails closed for a different tenant, disabled extension, changed policy, and invalid visitor data", async () => {
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: {},
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  await expect(
    adapter.validate({
      snapshot,
      values: { ...values, applicant_birthDate: "2020-99-99" },
    }),
  ).rejects.toThrow();
  await expect(
    adapter.execute({
      db: env.DB,
      tenant: "other",
      domainId: "test",
      objectName: object.name,
      submissionId: "id",
      snapshot,
      values,
      returnResult: true,
    }),
  ).rejects.toThrow();
  await env.DB.prepare(
    "UPDATE crm_extension_installations SET enabled=0 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await expect(
    adapter.publish({ db: env.DB, tenant, domainId: "test", object }),
  ).rejects.toThrow();
  await env.DB.prepare(
    "UPDATE crm_extension_installations SET enabled=1 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await env.DB.prepare(
    "UPDATE extension_settings SET version=2 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await expect(
    adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "id",
      snapshot,
      values,
      returnResult: true,
    }),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("suppresses results when disabled and never returns provider failure details", async () => {
  const success = vi.fn(async () => ({
    status: "succeeded" as const,
    output: {
      type: "quote",
      data: {
        premiumTotal: 1500,
        coverages: { rce: true, customerDocument: "secret" },
      },
    },
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute: success } });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  expect(
    await adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "ack-only",
      snapshot,
      values,
      returnResult: false,
    }),
  ).toBeUndefined();
  const failed = createPublicQuoteAdapter({
    executor: {
      execute: async () => {
        throw new Error("password=provider-secret customer=12345");
      },
    },
  });
  await expect(
    failed.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "provider-failed",
      snapshot,
      values,
      returnResult: true,
    }),
  ).rejects.toThrow("No se pudo completar la cotización");
  const row = await env.DB.prepare(
    "SELECT output,error_code FROM extension_action_runs WHERE tenant_id=? AND principal_id=?",
  )
    .bind(tenant, "public-form:provider-failed")
    .first();
  expect(JSON.stringify(row)).not.toMatch(/provider-secret|12345/);
});
it("refuses lookup flows or forged private policy and executes no provider for bad values", async () => {
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: {},
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const forged = {
    ...(snapshot as object),
    products: [{ flowId: "sura-autos-provider" }],
  };
  await expect(
    adapter.validate({ snapshot: forged, values }),
  ).rejects.toThrow();
  for (const bad of [
    { ...values, vehicle_declaredValue: 0 },
    { ...values, applicant_email: "bad" },
    { ...values, vehicle_isNew: "false" },
    { ...values, applicant_firstName: { $ref: "secret" } },
    { ...values, connectionId: "another-tenant" },
  ])
    await expect(
      adapter.execute({
        db: env.DB,
        tenant,
        domainId: "test",
        objectName: object.name,
        submissionId: "bad-values",
        snapshot,
        values: bad,
        returnResult: true,
      }),
    ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("describes the public insurance quote renderer", async () => {
  const adapter = createPublicQuoteAdapter({
    executor: {
      execute: async () => ({ status: "succeeded" as const, output: {} }),
    },
  });
  const wizardObject = { ...object, name: "cotizador_por_pasos" };
  const wizardPublished = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object: wizardObject,
  });
  const wizardPresentation = await adapter.presentation!({
    objectName: "cotizador_por_pasos",
    snapshot: wizardPublished.snapshot,
  });
  expect(wizardPresentation).toEqual({
    renderer: "insurance-quote-wizard",
    entry: "wizard",
    products: [{ flowId: "sbs-producto-8", label: expect.any(String) }],
  });
  expect(wizardPresentation.products[0].label).toMatch(/SBS/);

  const directPublished = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const directPresentation = await adapter.presentation!({
    objectName: "cotizador",
    snapshot: directPublished.snapshot,
  });
  expect(directPresentation.entry).toBe("direct");
  expect(directPresentation.renderer).toBe("insurance-quote-wizard");

  // Product order follows the frozen policy, not current mutable settings.
  const frozenBase = directPublished.snapshot as Record<string, unknown>;
  const orderedSnapshot = {
    ...frozenBase,
    products: [{ flowId: "sbs-producto-10" }, { flowId: "sbs-producto-8" }],
  };
  const ordered = await adapter.presentation!({
    objectName: "cotizador",
    snapshot: orderedSnapshot,
  });
  expect(ordered.products.map((p) => p.flowId)).toEqual([
    "sbs-producto-10",
    "sbs-producto-8",
  ]);
  expect(
    ordered.products.every(
      (p) => typeof p.label === "string" && p.label.length > 0,
    ),
  ).toBe(true);

  // An invalid/unknown flow ID is rejected by the existing policy parser.
  await expect(
    adapter.presentation!({
      objectName: "cotizador",
      snapshot: { ...frozenBase, products: [{ flowId: "unknown-flow" }] },
    }),
  ).rejects.toThrow();
  await expect(
    adapter.presentation!({
      objectName: "cotizador",
      snapshot: {
        ...frozenBase,
        products: [{ flowId: "sura-autos-provider" }],
      },
    }),
  ).rejects.toThrow();

  // Forged client labels never change the server policy.
  const forgedSnapshot = {
    ...frozenBase,
    products: [{ flowId: "sbs-producto-8", label: "Forged label" }],
  };
  const forged = await adapter.presentation!({
    objectName: "cotizador",
    snapshot: forgedSnapshot,
  }).catch(() => undefined);
  // Strict policy rejects extra keys, or labels are ignored in favor of the trusted catalog.
  if (forged) expect(forged.products[0].label).not.toBe("Forged label");
});
it("scopes provider run receipts to the published policy, not a visitor-chosen UUID shared by other forms", async () => {
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: { type: "quote", data: { premiumTotal: 1200 } },
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const first = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const second = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  for (const { snapshot } of [first, second])
    await adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "same-visitor-uuid",
      snapshot,
      values,
      returnResult: false,
    });
  expect(execute).toHaveBeenCalledTimes(2);
});

async function enableVehicleLookup(enabled: boolean) {
  const row = await env.DB.prepare(
    "SELECT value FROM extension_settings WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(tenant)
    .first<{ value: string }>();
  const value = JSON.parse(row!.value);
  value.vehicleLookup = { enabled, flowId: "sura-autos-provider" };
  await env.DB.prepare(
    "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(JSON.stringify(value), tenant)
    .run();
}

it("looks up vehicle data with the fixed trusted flow and projects only safe fields", async () => {
  await enableVehicleLookup(true);
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: {
      type: "vehicle_lookup",
      data: {
        vehicle: {
          plate: "TESTCAR",
          fasecoldaCode: "12345678",
          productionYear: 2023,
          declaredValue: 50000000,
          accessoriesValue: 0,
          ownerDocument: "secret",
          credentials: { password: "secret" },
        },
      },
    },
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const found = await adapter.lookupVehicle!({
    db: env.DB,
    tenant,
    domainId: "test",
    objectName: object.name,
    snapshot,
    plate: "testcar",
  });
  expect(found).toEqual({
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2023,
    declaredValue: 50000000,
    accessoriesValue: 0,
  });
  expect(JSON.stringify(found)).not.toMatch(/secret|password|owner/);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]).toMatchObject([
    {
      tenantId: tenant,
      principalId: "public-form:vehicle-lookup",
      extensionId: "insurance.quotes",
      actionId: "quote",
    },
    {
      mode: "live",
      flowId: "sura-autos-provider",
      quoteInput: { vehicle: { plate: "TESTCAR" } },
    },
  ]);
  const runs = await env.DB.prepare(
    "SELECT count(*) n FROM extension_action_runs WHERE tenant_id=? AND principal_id='public-form:vehicle-lookup'",
  )
    .bind(tenant)
    .first<{ n: number }>();
  expect(runs?.n).toBeGreaterThan(0);
});

it("fails the public lookup closed for bad plates, missing vehicles, provider errors, and disabled lookup", async () => {
  await enableVehicleLookup(true);
  const execute = vi.fn(async () => ({
    status: "succeeded" as const,
    output: { type: "vehicle_lookup", data: {} },
  }));
  const adapter = createPublicQuoteAdapter({ executor: { execute } });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const input = {
    db: env.DB,
    tenant,
    domainId: "test",
    objectName: object.name,
    snapshot,
    plate: "TESTCAR",
  };
  await expect(
    adapter.lookupVehicle!({ ...input, plate: "!!" }),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  await expect(adapter.lookupVehicle!(input)).rejects.toThrow(
    "No se encontraron datos para esa placa.",
  );
  const failing = createPublicQuoteAdapter({
    executor: {
      execute: async () => {
        throw new Error("password=provider-secret");
      },
    },
  });
  await expect(failing.lookupVehicle!(input)).rejects.toThrow(
    "No se pudo consultar la placa.",
  );
  await enableVehicleLookup(false);
  await expect(adapter.lookupVehicle!(input)).rejects.toThrow();
  await enableVehicleLookup(true);
});

it("simulates providers locally without touching the executor", async () => {
  await enableVehicleLookup(true);
  const execute = vi.fn(async () => {
    throw new Error("must not be called");
  });
  const adapter = createPublicQuoteAdapter({
    executor: { execute },
    mockProviders: true,
  });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant,
    domainId: "test",
    object,
  });
  const base = {
    db: env.DB,
    tenant,
    domainId: "test",
    objectName: object.name,
    snapshot,
  };
  expect(await adapter.lookupVehicle!({ ...base, plate: "testcar" })).toEqual({
    plate: "TESTCAR",
    fasecoldaCode: "00000000",
    productionYear: 2024,
    declaredValue: 50000000,
    accessoriesValue: 0,
  });
  expect(await adapter.lookupVehicle!({ ...base, plate: "TESTBUS" })).toEqual({
    plate: "TESTBUS",
    fasecoldaCode: "00000000",
    productionYear: 2024,
    declaredValue: 50000000,
    accessoriesValue: 0,
  });
  const result = (await adapter.execute({
    ...base,
    submissionId: "mock-submission",
    values,
    returnResult: true,
  })) as any;
  expect(result.quotes).toHaveLength(1);
  expect(result.quotes[0]).toMatchObject({
    insurer: "SBS",
    currency: "COP",
  });
  expect(result.unavailable).toBe(0);
  expect(
    await adapter.execute({
      ...base,
      submissionId: "mock-ack",
      values,
      returnResult: false,
    }),
  ).toBeUndefined();
  await expect(
    adapter.execute({
      ...base,
      submissionId: "mock-bad",
      values: { ...values, applicant_email: "bad" },
      returnResult: true,
    }),
  ).rejects.toThrow();
  // No mock path touches the executor.
  expect(execute).not.toHaveBeenCalled();
});
