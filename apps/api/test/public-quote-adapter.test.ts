import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock(
  "@savia/release-catalog/runtime",
  async () => import("@savia/release-catalog/legacy-runtime-test-fixture"),
);
import { makeConfig } from "@savia/studio-shared/metadata";
import { createExtensionRegistry } from "@savia/studio-shared/extension-package";
import quoteStoreManifest from "../../../store-ports/quotes/savia-extension.json";
import {
  PUBLIC_QUOTE_CONCURRENCY,
  createPublicQuoteAdapter,
} from "../src/public-forms/quote-adapter";
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
    "INSERT INTO studio_extension_installations(tenant_id,id,version,manifest) VALUES (?,'insurance.quotes','1.2.0','{}')",
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
it("keeps public links bound to the installed ZIP after a newer upload", async () => {
  const storeTenant = "public-quote-zip-test";
  await env.DB.prepare(
    "INSERT INTO plugin_store_artifacts(tenant_id,id,version,manifest,entry_js,sha256,size_bytes) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(
      storeTenant,
      quoteStoreManifest.id,
      quoteStoreManifest.version,
      JSON.stringify(quoteStoreManifest),
      "export default {}",
      "test-hash",
      1,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO studio_extension_installations(tenant_id,id,version,manifest) VALUES (?,?,?,?)",
  )
    .bind(
      storeTenant,
      quoteStoreManifest.id,
      quoteStoreManifest.version,
      JSON.stringify(quoteStoreManifest),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO extension_settings(tenant_id,extension_id,value,version,updated_at,updated_by_principal_id,created_at,created_by_principal_id) VALUES (?,?,?,1,'now','admin','now','admin')",
  )
    .bind(storeTenant, quoteStoreManifest.id, JSON.stringify(settings))
    .run();
  const adapter = createPublicQuoteAdapter({
    registry: createExtensionRegistry([]),
    executor: { execute: vi.fn() },
    mockProviders: true,
  });
  const { snapshot } = await adapter.publish({
    db: env.DB,
    tenant: storeTenant,
    domainId: "platform",
    object: { ...object, name: "cotizador_por_pasos" },
  });
  expect(snapshot).toMatchObject({
    extensionVersion: quoteStoreManifest.version,
  });
  const [major, minor, patch] = quoteStoreManifest.version
    .split(".")
    .map(Number);
  const uploadedManifest = {
    ...quoteStoreManifest,
    version: `${major}.${minor}.${patch + 1}`,
  };
  await env.DB.prepare(
    "INSERT INTO plugin_store_artifacts(tenant_id,id,version,manifest,entry_js,sha256,size_bytes) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(
      storeTenant,
      uploadedManifest.id,
      uploadedManifest.version,
      JSON.stringify(uploadedManifest),
      "export default {}",
      "newer-hash",
      1,
    )
    .run();
  await expect(
    adapter.assertAvailable?.({
      db: env.DB,
      tenant: storeTenant,
      domainId: "platform",
      objectName: "cotizador_por_pasos",
      snapshot,
    }),
  ).resolves.toBeUndefined();
  await expect(
    adapter.publish({
      db: env.DB,
      tenant: storeTenant,
      domainId: "platform",
      object: { ...object, name: "cotizador_por_pasos" },
    }),
  ).resolves.toMatchObject({
    snapshot: { extensionVersion: quoteStoreManifest.version },
  });
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
    /customer-secret|credentials|password|Ada|documentNumber|runId/,
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
    "UPDATE studio_extension_installations SET enabled=0 WHERE tenant_id=?",
  )
    .bind(tenant)
    .run();
  await expect(
    adapter.publish({ db: env.DB, tenant, domainId: "test", object }),
  ).rejects.toThrow();
  await env.DB.prepare(
    "UPDATE studio_extension_installations SET enabled=1 WHERE tenant_id=?",
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

it("quotes enabled providers concurrently while preserving frozen product order", async () => {
  const flowIds = [
    "sbs-producto-8",
    "sbs-producto-10",
    "sbs-producto-11",
    "equidad-basico-quote",
    "equidad-full-quote",
    "equidad-ligero-quote",
    "equidad-rce-quote",
    "liberty-basico-quote",
    "liberty-basico-pt-quote",
    "liberty-full-quote",
    "liberty-integral-quote",
    "mapfre-para-la-mujer-quote",
  ];
  const CONCURRENCY = PUBLIC_QUOTE_CONCURRENCY;
  const stored = await env.DB.prepare(
    "SELECT value FROM extension_settings WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(tenant)
    .first<{ value: string }>();
  const original = stored!.value;
  try {
    const next = JSON.parse(original);
    next.products = flowIds.map((id, index) => ({
      id,
      label: `Admin ${id}`,
      enabled: true,
      rank: index + 1,
    }));
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(JSON.stringify(next), tenant)
      .run();
    const resolvers = new Map<
      string,
      (value: { status: "succeeded"; output: unknown }) => void
    >();
    const execute = vi.fn(
      (
        _context: unknown,
        input: Record<string, unknown>,
      ): Promise<{ status: "succeeded"; output: unknown }> =>
        new Promise((resolve) => {
          resolvers.set(input["flowId"] as string, resolve);
        }),
    );
    const adapter = createPublicQuoteAdapter({ executor: { execute } });
    const { snapshot } = await adapter.publish({
      db: env.DB,
      tenant,
      domainId: "test",
      object,
    });
    const pending = adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "concurrent-submission",
      snapshot,
      values,
      returnResult: true,
    });
    // The first wave fills every slot before any finishes: sequential
    // execution would only ever keep one call in flight.
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(CONCURRENCY), {
      timeout: 15000,
    });
    // Blocked tasks wait for a free slot: the bound holds.
    expect(execute).toHaveBeenCalledTimes(CONCURRENCY);
    const started = () =>
      execute.mock.calls.map((call) => call[1]["flowId"] as string);
    // Release the first wave in reverse; the remaining tasks start as slots free up.
    for (const flowId of [...started()].reverse()) {
      resolvers.get(flowId)!({
        status: "succeeded",
        output: {
          type: "quote",
          data: { premiumTotal: 1000 + flowIds.indexOf(flowId) },
        },
      });
      resolvers.delete(flowId);
    }
    await vi.waitFor(
      () => expect(execute).toHaveBeenCalledTimes(flowIds.length),
      { timeout: 15000 },
    );
    const runIds = execute.mock.calls.map(
      (call) => (call[0] as { runId: string }).runId,
    );
    expect(new Set(runIds).size).toBe(flowIds.length);
    // Resolve the rest in reverse order; the result must still follow frozen order.
    await vi.waitFor(
      () => expect(resolvers.size).toBe(flowIds.length - CONCURRENCY),
      { timeout: 15000 },
    );
    for (const flowId of [...resolvers.keys()].reverse()) {
      resolvers.get(flowId)?.({
        status: "succeeded",
        output: {
          type: "quote",
          data: { premiumTotal: 1000 + flowIds.indexOf(flowId) },
        },
      });
    }
    const result = (await pending) as {
      quotes: { premiumTotal: number }[];
      unavailable: number;
    };
    expect(result.unavailable).toBe(0);
    expect(result.quotes.map((quote) => quote.premiumTotal)).toEqual(
      flowIds.map((_, index) => 1000 + index),
    );
  } finally {
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(original, tenant)
      .run();
  }
});
it("falls back to frozen plan highlights when providers report no coverage breakdown", async () => {
  const stored = await env.DB.prepare(
    "SELECT value FROM extension_settings WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(tenant)
    .first<{ value: string }>();
  const original = stored!.value;
  try {
    const next = JSON.parse(original);
    next.products = [
      { id: "sbs-producto-8", label: "Admin", enabled: true, rank: 1 },
      {
        id: "previsora-clasica-quote",
        label: "Admin",
        enabled: true,
        rank: 2,
      },
    ];
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(JSON.stringify(next), tenant)
      .run();
    // No data.coverages breakdown: the cards still describe each policy.
    const execute = vi.fn(async () => ({
      status: "succeeded" as const,
      output: { type: "quote", data: { premiumTotal: 2000000 } },
    }));
    const adapter = createPublicQuoteAdapter({ executor: { execute } });
    const { snapshot } = await adapter.publish({
      db: env.DB,
      tenant,
      domainId: "test",
      object,
    });
    const result = (await adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "highlights-submission",
      snapshot,
      values,
      returnResult: true,
    })) as { quotes: { coverages: string[] }[] };
    expect(result.quotes).toHaveLength(2);
    expect(result.quotes[0]).toMatchObject({ flowId: "sbs-producto-8" });
    expect(result.quotes[0].coverages).toContain(
      "Responsabilidad Civil: $3.000 Millones",
    );
    expect(result.quotes[1].coverages).toEqual(["Póliza todo riesgo autos"]);
  } finally {
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(original, tenant)
      .run();
  }
});
it("mirrors anonymous quotes into agency CRM records", async () => {
  const cotizacionesConfig = {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Nombre", required: true },
      ramo: { type: "Textbox", label: "Ramo" },
      placa: { type: "Textbox", label: "Placa" },
      valor_asegurado: { type: "Number", label: "Valor asegurado" },
      prima: { type: "Number", label: "Prima" },
      estado: {
        type: "Dropdown",
        label: "Estado",
        options: [
          { label: "Solicitada", value: "Solicitada" },
          { label: "Recibida", value: "Recibida" },
          { label: "Rechazada", value: "Rechazada" },
        ],
      },
    },
    fieldOrder: ["name", "ramo", "placa", "valor_asegurado", "prima", "estado"],
  };
  const detalleConfig = {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Referencia", required: true },
      cotizacion: {
        type: "Dropdown",
        label: "Cotización",
        options: [],
        config: { relation: "cotizaciones" },
      },
      aseguradora: { type: "Textbox", label: "Aseguradora" },
      producto: { type: "Textbox", label: "Producto" },
      flow_id: { type: "Textbox", label: "Flow ID" },
      estado: {
        type: "Dropdown",
        label: "Estado",
        options: [
          { label: "Solicitada", value: "Solicitada" },
          { label: "Recibida", value: "Recibida" },
          { label: "Error", value: "Error" },
        ],
      },
      prima: { type: "Number", label: "Prima" },
      error_mensaje: { type: "Textarea", label: "Mensaje de error" },
      run_id: { type: "Textbox", label: "ID de ejecución" },
    },
    fieldOrder: [
      "name",
      "cotizacion",
      "aseguradora",
      "producto",
      "flow_id",
      "estado",
      "prima",
      "error_mensaje",
      "run_id",
    ],
  };
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      tenant,
      "cotizaciones",
      "Cotizaciones",
      "",
      JSON.stringify(cotizacionesConfig),
      1,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      tenant,
      "cotizaciones_detalle",
      "Detalles",
      "",
      JSON.stringify(detalleConfig),
      1,
    )
    .run();
  const stored = await env.DB.prepare(
    "SELECT value FROM extension_settings WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(tenant)
    .first<{ value: string }>();
  const original = stored!.value;
  try {
    const next = JSON.parse(original);
    next.products = [
      { id: "sbs-producto-8", label: "Admin", enabled: true, rank: 1 },
      { id: "sbs-producto-10", label: "Admin", enabled: true, rank: 2 },
    ];
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(JSON.stringify(next), tenant)
      .run();
    const execute = vi.fn(
      async (_context: unknown, input: Record<string, unknown>) => {
        if (input["flowId"] === "sbs-producto-10")
          throw new Error("provider down");
        return {
          status: "succeeded" as const,
          output: { type: "quote", data: { premiumTotal: 1500 } },
        };
      },
    );
    const adapter = createPublicQuoteAdapter({ executor: { execute } });
    const { snapshot } = await adapter.publish({
      db: env.DB,
      tenant,
      domainId: "test",
      object,
    });
    const result = (await adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "mirror-submission",
      snapshot,
      values,
      returnResult: true,
    })) as { quotes: unknown[]; unavailable: number };
    expect(result.quotes).toHaveLength(1);
    expect(result.unavailable).toBe(1);
    const masterRow = await env.DB.prepare(
      "SELECT id, data, created_by FROM studio_records WHERE tenant_id=? AND object_name='cotizaciones'",
    )
      .bind(tenant)
      .first<{ id: string; data: string; created_by: string }>();
    const master = JSON.parse(masterRow!.data);
    // The public reference is the master name so the agency can match it.
    expect(master).toMatchObject({
      name: "mirror-submission",
      ramo: "Automóviles",
      placa: ["ABC", "123"].join(""),
      valor_asegurado: 50000000,
      estado: "Recibida",
      prima: 1500,
    });
    expect(masterRow!.created_by).toBe("public-form:mirror-submission");
    const detailRows = await env.DB.prepare(
      "SELECT data FROM studio_records WHERE tenant_id=? AND object_name='cotizaciones_detalle' ORDER BY data",
    )
      .bind(tenant)
      .all<{ data: string }>();
    expect(detailRows.results).toHaveLength(2);
    const details = detailRows.results.map((row) => JSON.parse(row.data));
    const received = details.find((detail) => detail.estado === "Recibida");
    const failed = details.find((detail) => detail.estado === "Error");
    expect(received).toMatchObject({
      cotizacion: masterRow!.id,
      prima: 1500,
    });
    expect(typeof received.run_id).toBe("string");
    expect(failed).toMatchObject({
      cotizacion: masterRow!.id,
    });
    expect(JSON.stringify(details)).not.toMatch(/provider down/);
  } finally {
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(original, tenant)
      .run();
    await env.DB.prepare(
      "DELETE FROM studio_records WHERE tenant_id=? AND object_name IN ('cotizaciones','cotizaciones_detalle')",
    )
      .bind(tenant)
      .run();
    await env.DB.prepare(
      "DELETE FROM studio_objects WHERE tenant_id=? AND name IN ('cotizaciones','cotizaciones_detalle')",
    )
      .bind(tenant)
      .run();
  }
});
it("reports per-product progress scoped to the submission policy", async () => {
  const flowIds = ["sbs-producto-8", "sbs-producto-10", "sbs-producto-11"];
  const stored = await env.DB.prepare(
    "SELECT value FROM extension_settings WHERE tenant_id=? AND extension_id='insurance.quotes'",
  )
    .bind(tenant)
    .first<{ value: string }>();
  const original = stored!.value;
  try {
    const next = JSON.parse(original);
    next.products = flowIds.map((id, index) => ({
      id,
      label: `Admin ${id}`,
      enabled: true,
      rank: index + 1,
    }));
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(JSON.stringify(next), tenant)
      .run();
    const resolvers = new Map<
      string,
      (value: { status: "succeeded" | "failed"; output: unknown }) => void
    >();
    const execute = vi.fn(
      (
        _context: unknown,
        input: Record<string, unknown>,
      ): Promise<{ status: "succeeded" | "failed"; output: unknown }> =>
        new Promise((resolve) => {
          resolvers.set(input["flowId"] as string, resolve);
        }),
    );
    const adapter = createPublicQuoteAdapter({ executor: { execute } });
    const { snapshot } = await adapter.publish({
      db: env.DB,
      tenant,
      domainId: "test",
      object,
    });
    const statusInput = {
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      snapshot,
      submission: "progress-submission",
    };
    const pending = adapter.execute({
      db: env.DB,
      tenant,
      domainId: "test",
      objectName: object.name,
      submissionId: "progress-submission",
      snapshot,
      values,
      returnResult: true,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3), {
      timeout: 15000,
    });
    const started = await adapter.quoteStatus!(statusInput);
    expect(started.items.map((item) => item.status)).toEqual([
      "quoting",
      "quoting",
      "quoting",
    ]);
    resolvers.get("sbs-producto-8")!({
      status: "succeeded",
      output: { type: "quote", data: { premiumTotal: 2000 } },
    });
    resolvers.get("sbs-producto-10")!({ status: "failed", output: {} });
    let status = started;
    await vi.waitFor(
      async () => {
        status = await adapter.quoteStatus!(statusInput);
        expect(status.items[1].status).toBe("unavailable");
      },
      { timeout: 15000 },
    );
    expect(status.items[0]).toMatchObject({
      flowId: "sbs-producto-8",
      status: "done",
    });
    expect(status.items[0].result).toMatchObject({ premiumTotal: 2000 });
    expect(status.items[2].status).toBe("quoting");
    // Another submission sees no runs: rows are scoped by run id prefix.
    const other = await adapter.quoteStatus!({
      ...statusInput,
      submission: "other-submission",
    });
    expect(other.items.every((item) => item.status === "waiting")).toBe(true);
    await expect(
      adapter.quoteStatus!({ ...statusInput, tenant: "other" }),
    ).rejects.toThrow();
    resolvers.get("sbs-producto-11")!({
      status: "succeeded",
      output: { type: "quote", data: { premiumTotal: 3000 } },
    });
    const result = (await pending) as {
      quotes: unknown[];
      unavailable: number;
    };
    expect(result.quotes).toHaveLength(2);
    expect(result.unavailable).toBe(1);
  } finally {
    await env.DB.prepare(
      "UPDATE extension_settings SET value=? WHERE tenant_id=? AND extension_id='insurance.quotes'",
    )
      .bind(original, tenant)
      .run();
  }
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
