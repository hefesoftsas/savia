import { beforeAll, it, expect } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
import {
  loadAccessPolicy,
  saveAccessRole,
  replaceAccessAssignments,
} from "../src/auth/access-repository";
import {
  blueprint,
  verifyAccess,
  requestInput,
} from "../../../packages/insurance-customer-portal/src/domain";
import { requirement } from "../../../packages/insurance-customer-portal/src/object";
import { makeConfig } from "@savia/studio-shared/metadata";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
const base = "/v1/dynamic-crm/101/api";
let ownPolicy: string,
  otherPolicy: string,
  ownRequest: string,
  otherRequest: string;
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
beforeAll(async () => {
  f = await createAccessFixture();
  const objects = [
    {
      name: "polizas",
      label: "Policies",
      config: makeConfig({
        name: { type: "Textbox", label: "Name" },
        cliente: { type: "Textbox", label: "Customer" },
        inicio: { type: "DateControl", label: "Start" },
        fin: { type: "DateControl", label: "End" },
        prima: { type: "Number", label: "Premium" },
        estado: { type: "Textbox", label: "Status" },
        private_notes: { type: "Textbox", label: "Internal notes" },
      }),
    },
    requirement.object,
  ];
  for (const object of objects) {
    const res = await f.request(
      "agency_admin",
      101,
      base + "/objects",
      json(object),
    );
    expect(res.status, await res.clone().text()).toBe(201);
  }
  async function create(object: string, body: unknown) {
    const response = await f.request(
      "agency_admin",
      101,
      base + "/records/" + object,
      json(body),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }
  ownPolicy = await create("polizas", {
    name: "Own policy",
    cliente: "customer-a",
    private_notes: "PRIVATE COMMISSION",
  });
  otherPolicy = await create("polizas", {
    name: "Other policy",
    cliente: "customer-b",
  });
  ownRequest = await create(
    "insurance_customer_portal",
    requestInput("customer-a", {
      name: "Own request",
      kind: "query",
      details: "Please send my certificate",
      policy_reference: ownPolicy,
    }),
  );
  otherRequest = await create(
    "insurance_customer_portal",
    requestInput("customer-b", {
      name: "Other request",
      kind: "query",
      details: "Please send my certificate",
      policy_reference: otherPolicy,
    }),
  );
  const admin = await f.actor("agency_admin");
  const initial = await loadAccessPolicy(f.db, admin, "tenant:101");
  const role = await saveAccessRole(f.db, admin, {
    scope: "tenant:101",
    name: "customer_a",
    label: "Customer A",
    description: "Customer portal fixture",
    enabled: true,
    expectedRevision: initial.revision,
    grants: blueprint("customer-a"),
  });
  await replaceAccessAssignments(f.db, admin, {
    scope: "tenant:101",
    principalId: f.principalId("viewer"),
    roleIds: [role.id],
    expectedRevision: role.revision,
  });
});
it("loads only the current authenticated policy and denies cross-customer row reads", async () => {
  const context = await f.request("viewer", 101, base + "/access-context");
  expect(context.status).toBe(200);
  const result = (await context.json()) as {
    data: Parameters<typeof verifyAccess>[0];
  };
  expect(verifyAccess(result.data)).toBe("customer-a");
  const list = await f.request("viewer", 101, base + "/records/polizas");
  expect(list.status).toBe(200);
  const rows = (await list.json()) as {
    total: number;
    data: Record<string, unknown>[];
  };
  expect(rows.total).toBe(1);
  expect(rows.data[0].id).toBe(ownPolicy);
  expect(rows.data[0]).not.toHaveProperty("private_notes");
  expect(
    (await f.request("viewer", 101, base + "/records/polizas/" + otherPolicy))
      .status,
  ).toBe(403);
});
it("enforces customer and initial status on native request creation", async () => {
  const input = requestInput("customer-a", {
    name: "A new claim",
    kind: "claim",
    details: "A new incident needs review",
    policy_reference: ownPolicy,
  });
  expect(
    (
      await f.request(
        "viewer",
        101,
        base + "/records/insurance_customer_portal",
        json(input),
      )
    ).status,
  ).toBe(201);
  for (const patch of [
    { customer_id: "customer-b" },
    { stage: "resolved" },
    { response: "Spoofed response" },
  ])
    expect(
      (
        await f.request(
          "viewer",
          101,
          base + "/records/insurance_customer_portal",
          json({ ...input, ...patch }),
        )
      ).status,
    ).toBe(403);
});
it("rejects edits to customer-visible responses and protects file lists by parent record", async () => {
  expect(
    (
      await f.request(
        "viewer",
        101,
        base + "/records/insurance_customer_portal/" + ownRequest,
        json({ response: "Forged", _version: 1 }, "PATCH"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.request(
        "viewer",
        101,
        base + "/files/insurance_customer_portal/" + ownRequest,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "viewer",
        101,
        base + "/files/insurance_customer_portal/" + otherRequest,
      )
    ).status,
  ).toBe(403);
  const form = new FormData();
  form.set("file", new File(["private"], "other.txt", { type: "text/plain" }));
  expect(
    (
      await f.request(
        "viewer",
        101,
        base + "/files/insurance_customer_portal/" + otherRequest,
        { method: "POST", body: form },
      )
    ).status,
  ).toBe(403);
});
it("uploads and downloads an attachment through the authorized parent request", async () => {
  const form = new FormData();
  form.set(
    "file",
    new File(["Customer evidence"], "evidence.txt", { type: "text/plain" }),
  );
  const response = await f.request(
    "viewer",
    101,
    base + "/files/insurance_customer_portal/" + ownRequest,
    { method: "POST", body: form },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const file = (await response.json()) as { data: { id: string } };
  const download = await f.request(
    "viewer",
    101,
    base + "/file/" + file.data.id + "/download",
  );
  expect(download.status).toBe(200);
  expect(new TextDecoder().decode(await download.arrayBuffer())).toBe(
    "Customer evidence",
  );
});
