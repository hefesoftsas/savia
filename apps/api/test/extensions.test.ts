import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock(
  "@savia/release-catalog/runtime",
  async () => import("@savia/release-catalog/legacy-runtime-test-fixture"),
);
import { createApp } from "../src/app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([left], [right]) => left.localeCompare(right));

function app() {
  return createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
}

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
});

it("lists optional extension contributions supplied by the release catalog", async () => {
  const response = await app().request(
    "/v1/data-domains/platform/api/extensions",
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(
    body.data.map(
      (extension: { manifest: { id: string } }) => extension.manifest.id,
    ),
  ).toEqual([
    "insurance.accounting",
    "insurance.activities",
    "insurance.automation",
    "insurance.calendar",
    "insurance.campaigns",
    "insurance.carriers",
    "insurance.claims",
    "insurance.collections",
    "insurance.commissions",
    "insurance.communications",
    "insurance.compliance",
    "insurance.customer-portal",
    "insurance.data-quality",
    "insurance.document-generation",
    "insurance.documents",
    "insurance.endorsements",
    "insurance.issuance",
    "insurance.opportunities",
    "insurance.payments",
    "insurance.portfolio-dashboard",
    "insurance.quotes",
    "insurance.renewals",
    "insurance.reports",
    "insurance.service",
    "insurance.settlements",
  ]);
});

it("returns default settings for the installed insurance quotes extension", async () => {
  const api = app();
  const base = "/v1/data-domains/platform/api";
  const install = await api.request(
    `${base}/extensions/insurance.quotes/install`,
    { method: "POST" },
  );
  expect(install.status, await install.clone().text()).toBe(200);

  const settings = await api.request(
    `${base}/extensions/insurance.quotes/settings`,
  );
  expect(settings.status, await settings.clone().text()).toBe(200);
  const settingsData = (await settings.json()).data;
  expect(settingsData).toMatchObject({
    version: 0,
    value: {
      quotePages: { direct: true, wizard: true },
      vehicleLookup: { enabled: true },
    },
  });
  expect(settingsData.value.products).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "sbs-producto-8", enabled: true }),
      expect.objectContaining({
        id: "equidad-basico-quote",
        enabled: true,
      }),
      expect.objectContaining({ id: "liberty-basico-quote", enabled: true }),
      expect.objectContaining({
        id: "previsora-clasica-quote",
        enabled: true,
      }),
    ]),
  );
});

it("rejects an extension that is not supplied by the release catalog", async () => {
  const api = app();
  const base = "/v1/data-domains/platform/api";
  expect(
    (await api.request(`${base}/extensions/inventory.sync/summary`)).status,
  ).toBe(404);
});

it.each([
  [
    "insurance.collections",
    "insurance_receivables",
    {
      name: "AC-001",
      customer: "Example",
      due_date: "2026-09-19",
      amount: 100,
      paid: 0,
      stage: "pending",
    },
  ],
  [
    "insurance.renewals",
    "insurance_renewals",
    {
      name: "RN-001",
      customer: "Example",
      policy_reference: "POL-001",
      expiry_date: "2026-10-19",
      premium: 100,
      stage: "pending",
    },
  ],
  [
    "insurance.claims",
    "insurance_claims",
    {
      name: "CL-1",
      customer: "Example",
      policy_reference: "P-1",
      incident_date: "2026-09-01",
      amount: 100,
      paid: 0,
      stage: "reported",
    },
  ],
  [
    "insurance.commissions",
    "insurance_commissions",
    {
      name: "CM-1",
      customer: "Example",
      policy_reference: "P-1",
      amount: 100,
      paid: 0,
      seller_share: 20,
      due_date: "2026-09-19",
      stage: "pending",
    },
  ],
  [
    "insurance.endorsements",
    "insurance_endorsements",
    {
      name: "EN-1",
      customer: "Example",
      policy_reference: "P-1",
      kind: "coverage",
      requested_date: "2026-09-01",
      effective_date: "2026-09-19",
      additional_premium: 0,
      refund: 0,
      stage: "requested",
    },
  ],
  [
    "insurance.opportunities",
    "insurance_opportunities",
    {
      name: "OP-1",
      customer: "Example",
      owner: "Adviser",
      target_date: "2026-09-19",
      premium: 100,
      probability: 25,
      stage: "lead",
    },
  ],
  [
    "insurance.activities",
    "insurance_activities",
    {
      name: "Call",
      owner: "Adviser",
      due_date: "2026-09-19",
      kind: "call",
      importance: "normal",
      stage: "scheduled",
    },
  ],
  [
    "insurance.issuance",
    "insurance_issuance",
    {
      name: "ISS-1",
      customer: "Example",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      effective_date: "2026-09-05",
      end_date: "2027-09-05",
      premium: 100,
      stage: "requested",
    },
  ],
  [
    "insurance.documents",
    "insurance_documents",
    {
      name: "Signed application",
      customer: "Example",
      policy_reference: "ISS-1",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      kind: "application",
      stage: "requested",
    },
  ],
  [
    "insurance.service",
    "insurance_service",
    {
      name: "SR-1",
      customer: "Example",
      owner: "Adviser",
      kind: "query",
      channel: "email",
      received_date: "2026-09-01",
      due_date: "2026-09-10",
      stage: "received",
    },
  ],
] as const)(
  "installs, repairs and persists records for %s without duplicating the collection",
  async (extension, object, input) => {
    const api = app();
    const base = "/v1/data-domains/platform/api";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await api.request(
        `${base}/extensions/${extension}/install`,
        { method: "POST" },
      );
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const created = await api.request(`${base}/records/${object}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const record = (await created.json()).data;
    expect(record).toMatchObject({ ...input, _version: 1 });
    const updated = await api.request(
      `${base}/records/${object}/${record.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Follow up", _version: record._version }),
      },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    const conflict = await api.request(
      `${base}/records/${object}/${record.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Stale", _version: record._version }),
      },
    );
    expect(conflict.status).toBe(409);
    const listed = await api.request(
      `${base}/records/${object}?sort=id&order=ASC`,
    );
    expect((await listed.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: record.id,
          notes: "Follow up",
          _version: 2,
        }),
      ]),
    );
    const invalid = await api.request(`${base}/records/${object}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...input,
        stage: "not-a-stage",
        amount: -1,
        premium: -1,
      }),
    });
    expect(invalid.status).toBe(422);
  },
);

it.each([
  [
    "insurance.renewals",
    "insurance_renewals",
    {
      name: "Close renewal",
      customer: "Example",
      policy_reference: "P-1",
      expiry_date: "2026-10-01",
      premium: 100,
      stage: "renewed",
    },
  ],
  [
    "insurance.claims",
    "insurance_claims",
    {
      name: "Close claim",
      customer: "Example",
      policy_reference: "P-1",
      incident_date: "2026-09-01",
      amount: 100,
      paid: 0,
      stage: "closed",
    },
  ],
  [
    "insurance.endorsements",
    "insurance_endorsements",
    {
      name: "Issue endorsement",
      customer: "Example",
      policy_reference: "P-1",
      kind: "coverage",
      requested_date: "2026-09-01",
      effective_date: "2026-09-19",
      additional_premium: 0,
      refund: 0,
      stage: "issued",
    },
  ],
  [
    "insurance.opportunities",
    "insurance_opportunities",
    {
      name: "Win deal",
      customer: "Example",
      owner: "Adviser",
      target_date: "2026-09-19",
      premium: 100,
      probability: 100,
      stage: "won",
    },
  ],
  [
    "insurance.activities",
    "insurance_activities",
    {
      name: "Complete call",
      owner: "Adviser",
      due_date: "2026-09-19",
      kind: "call",
      importance: "normal",
      stage: "completed",
    },
  ],
] as const)(
  "enforces a documented outcome on the backend for %s",
  async (extension, object, input) => {
    const api = app(),
      base = "/v1/data-domains/platform/api";
    expect(
      (
        await api.request(`${base}/extensions/${extension}/install`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const create = (data: unknown) =>
      api.request(`${base}/records/${object}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    const missing = await create(input);
    expect(missing.status, await missing.clone().text()).toBe(422);
    const completed = await create({ ...input, outcome: "Documented result" });
    expect(completed.status, await completed.clone().text()).toBe(201);
  },
);

it("isolates optional plugin installations and collections between data domains", async () => {
  const api = app();
  for (const name of ["plugins_a", "plugins_b"]) {
    const created = await api.request("/v1/data-domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, label: name }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
  }
  for (const name of [
    "collections",
    "renewals",
    "claims",
    "commissions",
    "endorsements",
    "opportunities",
    "activities",
    "issuance",
    "documents",
    "service",
  ]) {
    const installed = await api.request(
      `/v1/data-domains/plugins_a/api/extensions/insurance.${name}/install`,
      { method: "POST" },
    );
    expect(installed.status, await installed.clone().text()).toBe(200);
  }
  const other = await api.request("/v1/data-domains/plugins_b/api/extensions");
  expect(
    (await other.json()).data
      .filter((entry: { builtIn: boolean }) => !entry.builtIn)
      .every((entry: { installed: unknown }) => entry.installed === null),
  ).toBe(true);
  const collections = await api.request(
    "/v1/data-domains/plugins_b/api/objects",
  );
  expect(
    (await collections.json()).data.filter((entry: { name: string }) =>
      entry.name.startsWith("insurance_"),
    ),
  ).toEqual([]);
});

it.each([
  [
    "issuance",
    {
      name: "ISS-1",
      customer: "Example",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      effective_date: "2026-09-05",
      end_date: "2027-09-05",
      premium: 100,
      stage: "delivered",
      policy_reference: "POL-1",
      issued_date: "2026-09-03",
      delivered_date: "2026-09-04",
    },
    ["policy_reference", "issued_date", "delivered_date"],
  ],
  [
    "documents",
    {
      name: "Signed application",
      customer: "Example",
      policy_reference: "ISS-1",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      kind: "application",
      stage: "approved",
      received_date: "2026-09-02",
      reviewed_date: "2026-09-03",
      evidence_reference: "FILE-1",
      outcome: "Reviewed",
    },
    ["received_date", "reviewed_date", "evidence_reference", "outcome"],
  ],
  [
    "service",
    {
      name: "SR-1",
      customer: "Example",
      owner: "Adviser",
      kind: "query",
      channel: "email",
      received_date: "2026-09-01",
      due_date: "2026-09-10",
      stage: "resolved",
      resolved_date: "2026-09-03",
      outcome: "Answer recorded",
    },
    ["resolved_date", "outcome"],
  ],
] as const)(
  "enforces completion evidence for %s on create and partial updates",
  async (name, input, required) => {
    const api = app(),
      base = "/v1/data-domains/platform/api";
    expect(
      (
        await api.request(`${base}/extensions/insurance.${name}/install`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const create = (data: unknown) =>
      api.request(`${base}/records/insurance_${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    for (const field of required) {
      const missing = { ...input, [field]: null };
      const response = await create(missing);
      expect(response.status, await response.clone().text()).toBe(422);
    }
    const response = await create(input);
    expect(response.status, await response.clone().text()).toBe(201);
    const record = (await response.json()).data;
    for (const field of required) {
      const patch = await api.request(
        `${base}/records/insurance_${name}/${record.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [field]: null, _version: record._version }),
        },
      );
      expect(patch.status, await patch.clone().text()).toBe(422);
    }
  },
);

it.each([
  ["payments", "insurance_payments", true],
  ["settlements", "insurance_settlements", true],
  ["accounting", "insurance_accounting", true],
  ["communications", "insurance_communications", false],
  ["carriers", "insurance_carriers", false],
  ["calendar", "insurance_calendar", false],
  ["campaigns", "insurance_campaigns", false],
  ["document-generation", "insurance_document_generation", false],
  ["data-quality", "insurance_data_quality", false],
  ["reports", "insurance_reports", false],
  ["compliance", "insurance_compliance", true],
  ["customer-portal", "insurance_customer_portal", false],
])(
  "installs expanded %s contributions and exposes their required backend state",
  async (name, object, settings) => {
    const api = app(),
      base = "/v1/data-domains/platform/api";
    const response = await api.request(
      `${base}/extensions/insurance.${name}/install`,
      { method: "POST" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const objects = await api.request(`${base}/objects`);
    expect(
      (await objects.json()).data.some(
        (item: { name: string }) => item.name === object,
      ),
    ).toBe(true);
    if (settings) {
      const read = await api.request(
        `${base}/extensions/insurance.${name}/settings`,
      );
      expect(read.status, await read.clone().text()).toBe(200);
      const state = (await read.json()).data;
      expect(state.version).toBeGreaterThanOrEqual(0);
    }
  },
);
