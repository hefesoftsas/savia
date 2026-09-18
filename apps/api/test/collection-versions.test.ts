import { seedTenantAgency } from "./tenant-fixtures";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createRealtimeHubClient } from "../src/realtime/hub-client";
import { agencyAdministratorAuthenticator } from "./auth-fixtures";
import { makeConfig } from "@savia/crm-shared/metadata";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
);
beforeAll(async () => {
  for (const [, sql] of migrations.sort(([a], [b]) => a.localeCompare(b)))
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await seedTenantAgency(env.DB, 101);
});

const prefix = "/v1/dynamic-crm/101/api";
const headers = { "content-type": "application/json" };

function app() {
  return createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    agencyAdministratorAuthenticator(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createRealtimeHubClient(env.REALTIME_HUB),
  );
}

async function defineObject() {
  const response = await app().request(`${prefix}/objects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "delta_widgets",
      label: "Widgets",
      description: "Delta sync probe",
      config: makeConfig({
        name: { type: "Textbox", label: "Nombre", required: true },
      }),
    }),
  });
  expect(response.status).toBe(201);
}

async function versionRow() {
  return env.DB.prepare(
    "SELECT version FROM crm_collection_versions WHERE tenant_id=? AND collection=?",
  )
    .bind("agency:101", "delta_widgets")
    .first<{ version: number }>();
}

async function connectRecords(): Promise<{
  received: Array<Record<string, unknown>>;
}> {
  const ticketed = await app().request("/v1/realtime/ticket", {
    method: "POST",
    headers,
    body: JSON.stringify({ topics: ["records"], tenantId: 101 }),
  });
  expect(ticketed.status).toBe(201);
  const { ticket } = (
    (await ticketed.json()) as { data: { ticket: string } }
  ).data;
  const stub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("tenant:101"));
  const upgrade = await stub.fetch(
    `https://realtime.internal/session?ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(upgrade.status).toBe(101);
  const socket = upgrade.webSocket!;
  (socket as unknown as { accept?: () => void }).accept?.();
  const received: Array<Record<string, unknown>> = [];
  socket.addEventListener("message", (event) => {
    received.push(JSON.parse(String(event.data)));
  });
  return { received };
}

async function waitFor(
  received: Array<Record<string, unknown>>,
  predicate: (message: Record<string, unknown>) => boolean,
) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const found = received.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for realtime message, got: ${JSON.stringify(received)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Collection versions for delta sync", () => {
  it("bumps the version on record mutations and publishes it", async () => {
    await defineObject();
    expect(await versionRow()).toBeNull();
    const { received } = await connectRecords();

    const created = await app().request(`${prefix}/published/delta_widgets`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Uno" }),
    });
    expect(created.status).toBe(201);

    const first = await waitFor(
      received,
      (message) => message.type === "created",
    );
    expect(first).toMatchObject({
      topic: "records",
      collection: "delta_widgets",
      version: 1,
    });
    expect(await versionRow()).toMatchObject({ version: 1 });

    const { data }: any = await created.json();
    const updated = await app().request(
      `${prefix}/published/delta_widgets/${data.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ _version: data._version, name: "Uno!" }),
      },
    );
    expect(updated.status).toBe(200);

    const second = await waitFor(
      received,
      (message) => message.type === "updated",
    );
    expect(second).toMatchObject({ version: 2 });
    expect(await versionRow()).toMatchObject({ version: 2 });
  });
});
