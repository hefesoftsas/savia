import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { processWorkflows } from "@savia/crm-server/workflows/runtime";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
const api = () =>
  createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
  );
const base = "/v1/data-domains/platform/api";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
) {
  const response = await api().request(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status, await response.clone().text()).toBe(status);
  return (await response.json()).data;
}
async function tick() {
  for (let i = 0; i < 4; i++)
    await processWorkflows(env.DB, async () => true, { maxSteps: 100 });
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
it("gates templates by installation and prepares repeatable native relations without activating drafts", async () => {
  expect(await request("/workflow-bundles")).toEqual([]);
  await request("/extensions/insurance.automation/install", "POST");
  const bundles = await request("/workflow-bundles");
  expect(bundles).toHaveLength(5);
  expect(
    bundles.find((bundle: any) => bundle.id === "insurance.links").missing,
  ).toContain("clientes");
  for (const id of [
    "portfolio-dashboard",
    "renewals",
    "activities",
    "opportunities",
    "issuance",
  ])
    await request(`/extensions/insurance.${id}/install`, "POST");
  await request(
    "/objects",
    "POST",
    {
      name: "clientes",
      label: "Clients",
      config: {
        version: 2,
        fieldOrder: ["name"],
        fields: {
          name: { type: "Textbox", label: "Name", labels: {}, required: true },
        },
      },
    },
    201,
  );
  for (const id of [
    "insurance.links",
    "insurance.issuance-policy",
    "insurance.policy-renewal",
    "insurance.opportunity-issuance",
    "insurance.renewal-followup",
  ]) {
    const first = await request(`/workflow-bundles/${id}/prepare`, "POST");
    const second = await request(`/workflow-bundles/${id}/prepare`, "POST");
    expect(second.workflows.map((w: any) => w.id)).toEqual(
      first.workflows.map((w: any) => w.id),
    );
    expect(second.workflows.every((w: any) => w.enabled === 0)).toBe(true);
  }
  const flows = await request("/workflows");
  expect(flows).toHaveLength(7);
  for (const flow of flows)
    await request(`/workflows/${flow.id}/publish`, "POST", {
      revision: flow.revision,
    });
});
it("generates linked renewals and activities once despite repeated policy updates", async () => {
  const client = await request(
    "/records/clientes",
    "POST",
    { name: "Example client" },
    201,
  );
  const policy = await request(
    "/records/polizas",
    "POST",
    {
      name: "POL-1",
      cliente: client.id,
      inicio: "2020-09-01",
      fin: "2021-09-01",
      prima: 100,
      estado: "Vigente",
    },
    201,
  );
  await request(`/records/polizas/${policy.id}`, "PATCH", {
    prima: 110,
    _version: policy._version,
  });
  await tick();
  const renewals = await request("/records/insurance_renewals");
  expect(renewals).toHaveLength(1);
  expect(renewals[0]).toMatchObject({
    term_policy_id: policy.id,
    customer_id: client.id,
    customer: "Example client",
  });
  const tasks = await request("/records/insurance_activities");
  expect(tasks).toHaveLength(1);
  expect(tasks[0].source_renewal_id).toBe(renewals[0].id);
  const invalid = await api().request(
    base + `/records/insurance_renewals/${renewals[0].id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: "not-a-client",
        _version: renewals[0]._version,
      }),
    },
  );
  expect(invalid.status).toBe(422);
});
it("generates one issuance from competing won events and preserves later manual edits", async () => {
  const opportunity = await request(
    "/records/insurance_opportunities",
    "POST",
    {
      name: "OP-1",
      customer: "Example",
      owner: "Adviser",
      target_date: "2026-09-19",
      premium: 100,
      probability: 100,
      stage: "won",
      outcome: "Customer accepted",
      coverage_start: "2026-10-01",
      coverage_end: "2027-10-01",
    },
    201,
  );
  await request(`/records/insurance_opportunities/${opportunity.id}`, "PATCH", {
    premium: 120,
    _version: opportunity._version,
  });
  await Promise.all([tick(), tick()]);
  const issues = await request("/records/insurance_issuance");
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    source_opportunity_id: opportunity.id,
    effective_date: "2026-10-01",
    end_date: "2027-10-01",
    stage: "requested",
  });
  await request(`/records/insurance_issuance/${issues[0].id}`, "PATCH", {
    notes: "Manual follow-up",
    _version: issues[0]._version,
  });
  await request(`/records/insurance_opportunities/${opportunity.id}`, "PATCH", {
    premium: 150,
    _version: 2,
  });
  await tick();
  const final = await request("/records/insurance_issuance");
  expect(final).toHaveLength(1);
  expect(final[0].notes).toBe("Manual follow-up");
});
it("preserves modified workflow drafts when the bundle is prepared again", async () => {
  const flows = await request("/workflows");
  const flow = flows.find((f: any) => f.id.includes("opportunity-issuance"));
  await request(`/workflows/${flow.id}`, "PUT", {
    revision: flow.revision,
    name: "Customized",
    definition: flow.definition,
  });
  await request(
    "/workflow-bundles/insurance.opportunity-issuance/prepare",
    "POST",
  );
  expect((await request(`/workflows/${flow.id}`)).name).toBe("Customized");
});

it("leaves reversed coverage for review instead of generating invalid issuance", async () => {
  await request(
    "/records/insurance_opportunities",
    "POST",
    {
      name: "OP-review",
      customer: "Client",
      owner: "Adviser",
      target_date: "2026-09-19",
      premium: 100,
      probability: 100,
      stage: "won",
      outcome: "Accepted",
      coverage_start: "2027-10-01",
      coverage_end: "2026-10-01",
    },
    201,
  );
  await tick();
  expect(
    (await request("/records/insurance_issuance")).some(
      (r: any) => r.name === "OP-review",
    ),
  ).toBe(false);
  expect(
    (await request("/workflow-inbox")).some((r: any) =>
      r.title.includes("Completar vigencia"),
    ),
  ).toBe(true);
});
it("rejects incompatible multiple relation fields before installing any draft", async () => {
  const { prepareWorkflowBundle } =
    await import("@savia/crm-server/workflows/bundles");
  const tenant = await env.DB.prepare(
    "SELECT tenant_id FROM crm_objects WHERE name='polizas' LIMIT 1",
  ).first<{ tenant_id: string }>();
  await expect(
    prepareWorkflowBundle(env.DB, tenant!.tenant_id, "owner", {
      id: "test.cardinality",
      label: "Test",
      description: "Test",
      collections: ["polizas"],
      fields: [
        {
          collection: "polizas",
          fields: {
            cliente: {
              type: "Dropdown",
              label: "Multiple clients",
              labels: {},
              config: { relation: "clientes", multiple: true },
            },
          },
        },
      ],
      workflows: [],
    }),
  ).rejects.toThrow("otra configuración");
});
it("rejects numeric matched-create keys during publication", async () => {
  await request(
    "/objects",
    "POST",
    {
      name: "unique_numbers",
      label: "Unique numbers",
      config: {
        version: 2,
        fieldOrder: ["number"],
        fields: {
          number: {
            type: "Number",
            label: "Number",
            labels: {},
            config: { unique: true },
          },
        },
      },
    },
    201,
  );
  const flow = await request(
    "/workflows",
    "POST",
    {
      name: "Unsupported match",
      definition: {
        trigger: { type: "manual" },
        nodes: [
          {
            id: "create",
            type: "create",
            collection: "unique_numbers",
            matchField: "number",
            values: { number: 1 },
          },
        ],
      },
    },
    201,
  );
  await request(
    `/workflows/${flow.id}/publish`,
    "POST",
    { revision: flow.revision },
    422,
  );
});
it("requires design and publish rights before preparing schemas", async () => {
  const { createCrmApp } = await import("@savia/crm-server");
  const { runtimeReleaseCatalog } =
    await import("@savia/release-catalog/runtime");
  const bundles = runtimeReleaseCatalog.workflowBundles;
  const app = createCrmApp("domain:unauthorized", {
    principalId: "viewer",
    workflowBundles: bundles,
    authorizeWorkflow: async ({ action }) =>
      action === "view" || action === "design",
  });
  const response = await app.request(
    "http://localhost/api/workflow-bundles/insurance.links/prepare",
    { method: "POST" },
    env,
  );
  expect(response.status).toBe(403);
});

it("does not create follow-up work for an already closed renewal", async () => {
  const before = await request("/records/insurance_activities");
  await request(
    "/records/insurance_renewals",
    "POST",
    {
      name: "Closed renewal",
      customer: "Client",
      policy_reference: "P-closed",
      expiry_date: "2026-09-19",
      premium: 100,
      stage: "renewed",
      outcome: "P-replacement",
    },
    201,
  );
  await tick();
  expect(await request("/records/insurance_activities")).toHaveLength(
    before.length,
  );
});
it("creates a new renewal for a later term without changing the previous case", async () => {
  const policies = await request("/records/polizas");
  const policy = policies.find((row: any) => row.name === "POL-1");
  const original = (await request("/records/insurance_renewals"))[0];
  await request(`/records/insurance_renewals/${original.id}`, "PATCH", {
    notes: "Preserve manual negotiation",
    _version: original._version,
  });
  await request(`/records/polizas/${policy.id}`, "PATCH", {
    fin: "2022-09-01",
    _version: policy._version,
  });
  await tick();
  const renewals = await request("/records/insurance_renewals");
  expect(
    renewals.filter((row: any) => row.term_policy_id === policy.id),
  ).toHaveLength(2);
  expect(renewals.find((row: any) => row.id === original.id).notes).toBe(
    "Preserve manual negotiation",
  );
});
it("creates a native policy once when an issuance becomes issued", async () => {
  const source = (await request("/records/insurance_issuance"))[0];
  await request(`/records/insurance_issuance/${source.id}`, "PATCH", {
    stage: "issued",
    policy_reference: "ISSUED-REAL-1",
    issued_date: "2026-09-20",
    _version: source._version,
  });
  await tick();
  const policies = (await request("/records/polizas")).filter(
    (row: any) => row.source_issuance_id === source.id,
  );
  expect(policies).toHaveLength(1);
  expect(policies[0]).toMatchObject({
    name: "ISSUED-REAL-1",
    inicio: source.effective_date,
    fin: source.end_date,
    prima: source.premium,
    estado: "Vigente",
  });
  const current = await request(`/records/insurance_issuance/${source.id}`);
  await request(`/records/insurance_issuance/${source.id}`, "PATCH", {
    premium: Number(source.premium) + 1,
    _version: current._version,
  });
  await tick();
  expect(
    (await request("/records/polizas")).filter(
      (row: any) => row.source_issuance_id === source.id,
    ),
  ).toHaveLength(1);
});
it("preserves legacy renewal cases when adopting per-term templates", async () => {
  const client = (await request("/records/clientes"))[0];
  const policy = await request(
    "/records/polizas",
    "POST",
    {
      name: "LEGACY-POL",
      cliente: client.id,
      inicio: "2020-01-01",
      fin: "2021-01-01",
      prima: 100,
      estado: "Vigente",
    },
    201,
  );
  const legacy = await request(
    "/records/insurance_renewals",
    "POST",
    {
      name: "Legacy case",
      customer: "Example client",
      policy_reference: "LEGACY-POL",
      source_policy_id: policy.id,
      expiry_date: "2021-01-01",
      premium: 100,
      stage: "pending",
      notes: "Keep negotiated terms",
    },
    201,
  );
  await tick();
  const cases = (await request("/records/insurance_renewals")).filter(
    (row: any) =>
      row.source_policy_id === policy.id || row.term_policy_id === policy.id,
  );
  expect(cases).toHaveLength(1);
  expect(cases[0]).toMatchObject({
    id: legacy.id,
    notes: "Keep negotiated terms",
  });
});
