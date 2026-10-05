import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import type { AppActor } from "../src/auth/types";
import { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";
import type { WhatsappChatMessage } from "../src/whatsapp/inbound-contracts";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";
import {
  createWhatsappAssistant,
  sendWhatsappReply,
} from "../src/whatsapp/assistant";
import type {
  WhatsappNangoClient,
  WhatsappProxyRequest,
} from "../src/whatsapp/contracts";
import { createWhatsappRepository } from "../src/whatsapp/repository";
import { registerWhatsappWebhook } from "../src/whatsapp/webhook";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([left], [right]) => left.localeCompare(right));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

let fixtureNumber = 900000;
const appSecret = "synthetic-meta-app-secret";
const verifyToken = "synthetic-meta-verify-token";
const contactA = "+15550009001";
const contactB = "+15550009002";
const disallowedContact = "+15550009003";

async function signedRequest(
  app: OpenAPIHono,
  input: {
    messageId: string;
    contact: string;
    text: string;
    timestamp?: string;
  },
) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789000002",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123456789000001" },
              messages: [
                {
                  id: input.messageId,
                  from: input.contact,
                  timestamp:
                    input.timestamp ?? String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const signature = `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return app.request("/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
}

it("persists and replies to signed Meta text once with tenant and contact scoped history", async () => {
  const tenantId = ++fixtureNumber;
  const now = new Date().toISOString();
  const phoneNumberId = "123456789000001";
  const wabaId = "123456789000002";
  await env.DB.prepare(
    `INSERT INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at)
     VALUES(?,?,?,1,'commercial',?,?)`,
  )
    .bind(
      tenantId,
      `wa-direct-flow-${tenantId}`,
      "Synthetic WhatsApp tenant",
      now,
      now,
    )
    .run();

  const principal = await upsertPrincipal(env.DB, {
    issuer: "whatsapp-direct-flow-test",
    subject: String(tenantId),
    email: `${tenantId}@whatsapp-direct-flow.test`,
    displayName: "Synthetic owner",
  });
  const membershipId = `wa-direct-membership-${tenantId}`;
  await env.DB.prepare(
    `INSERT INTO identity_tenant_membership
       (id,principal_id,tenant_id,role,is_active,created_at,updated_at)
     VALUES(?,?,?,'tenant_admin',1,?,?)`,
  )
    .bind(membershipId, principal.id, tenantId, now, now)
    .run();

  const actor: AppActor = {
    principal,
    globalRoles: [],
    memberships: [
      {
        id: membershipId,
        principalId: principal.id,
        agencyId: tenantId,
        tenantId,
        role: "tenant_admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const connection = await createWhatsappRepository(env.DB).saveConnection({
    agencyId: tenantId,
    actor,
    nangoConnectionId: `synthetic-nango-${tenantId}`,
    nangoIntegrationId: "synthetic-whatsapp-integration",
    status: "connected",
    phoneNumberId,
    wabaId,
  });
  const employee = await new VirtualEmployeesRepository(env.DB).create({
    agencyId: tenantId,
    name: "Synthetic support employee",
    handle: `synthetic-support-${tenantId}`,
    systemPrompt: "Answer from the supplied synthetic policy context.",
    allowedCollections: [],
  });
  const repository = new WhatsappInboundRepository(env.DB);
  await repository.configure({
    connectionId: connection.id,
    tenantId,
    employeeId: employee.id,
    enabled: true,
    allowedContacts: [contactA, contactB],
    updatedBy: principal.id,
  });

  const completions: Array<{
    model: string;
    system: string;
    messages: WhatsappChatMessage[];
  }> = [];
  const assistant = createWhatsappAssistant({
    configuration: {
      effectiveConfigurationForTenant: async (
        _principalId,
        requestedTenantId,
      ) => ({
        apiKey: "synthetic-openrouter-key",
        model: "synthetic/provider-model",
        allowedModels: ["synthetic/provider-model"],
        tenantId: requestedTenantId,
      }),
    },
    employees: new VirtualEmployeesRepository(env.DB),
    knowledge: async (employeeId) => {
      expect(employeeId).toBe(employee.id);
      return [{ text: "Synthetic support policy: answer politely." }];
    },
    complete: async (input) => {
      completions.push(input);
      const current = input.messages.at(-1)?.content ?? "missing question";
      return `Synthetic reply to: ${current}`;
    },
  });

  const providerRequests: WhatsappProxyRequest[] = [];
  let providerSequence = 0;
  const nango: Pick<WhatsappNangoClient, "proxy"> = {
    proxy: async (request) => {
      providerRequests.push(request);
      providerSequence += 1;
      return Response.json({
        messages: [{ id: `wamid.synthetic-reply-${providerSequence}` }],
      });
    },
  };
  const app = new OpenAPIHono();
  registerWhatsappWebhook(app, { repository, appSecret, verifyToken });
  const process = () =>
    processWhatsappInbox(repository, {
      generate: assistant,
      send: (binding, text, contact) =>
        sendWhatsappReply(nango, binding, text, contact),
    });

  const first = {
    messageId: "wamid.synthetic-contact-a-1",
    contact: contactA,
    text: "Synthetic question A1",
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const firstAccepted = await signedRequest(app, first);
  expect(firstAccepted.status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT state,provider_timestamp FROM whatsapp_inbox WHERE message_id=?",
    )
      .bind(first.messageId)
      .first<{ state: string; provider_timestamp: string }>(),
  ).toMatchObject({ state: "pending" });
  expect(completions).toHaveLength(0);
  expect(providerRequests).toHaveLength(0);

  expect(await process()).toEqual({ processed: 1, failed: 0 });
  expect(completions[0].messages).toEqual([
    { role: "user", content: "Synthetic question A1" },
  ]);
  expect(providerRequests).toHaveLength(1);
  expect(providerRequests[0]).toMatchObject({
    method: "POST",
    path: `/v21.0/${phoneNumberId}/messages`,
    connection: { id: connection.id, tenantId },
    body: {
      messaging_product: "whatsapp",
      to: contactA,
      type: "text",
      text: { body: "Synthetic reply to: Synthetic question A1" },
    },
  });

  expect((await signedRequest(app, first)).status).toBe(200);
  expect(await process()).toEqual({ processed: 0, failed: 0 });
  expect(providerRequests).toHaveLength(1);
  expect(completions).toHaveLength(1);

  const otherContact = {
    messageId: "wamid.synthetic-contact-b-1",
    contact: contactB,
    text: "Synthetic question B1",
  };
  expect((await signedRequest(app, otherContact)).status).toBe(200);
  expect(await process()).toEqual({ processed: 1, failed: 0 });
  expect(completions[1].messages).toEqual([
    { role: "user", content: "Synthetic question B1" },
  ]);

  const second = {
    messageId: "wamid.synthetic-contact-a-2",
    contact: contactA,
    text: "Synthetic question A2",
  };
  expect((await signedRequest(app, second)).status).toBe(200);
  expect(await process()).toEqual({ processed: 1, failed: 0 });
  expect(completions[2].messages).toEqual([
    { role: "user", content: "Synthetic question A1" },
    { role: "assistant", content: "Synthetic reply to: Synthetic question A1" },
    { role: "user", content: "Synthetic question A2" },
  ]);
  expect(completions[2].messages).not.toContainEqual({
    role: "user",
    content: "Synthetic question B1",
  });

  const rejected = await signedRequest(app, {
    messageId: "wamid.synthetic-disallowed-contact-1",
    contact: disallowedContact,
    text: "Synthetic disallowed question",
  });
  expect(rejected.status).toBe(200);
  expect(await process()).toEqual({ processed: 0, failed: 0 });
  expect(providerRequests).toHaveLength(3);
  expect(completions).toHaveLength(3);
});
