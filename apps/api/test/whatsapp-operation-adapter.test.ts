import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createChannelOperationAdapter } from "../src/assistant/operation-adapter";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { defaultNativeConfiguration } from "../src/whatsapp/native";
import { setupChannelFixture } from "./whatsapp-channel-fixture";

async function selectedSession() {
  const fixture = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='Alice',allowed_collections=? WHERE id=?",
  )
    .bind('["cotizaciones","cotizaciones_detalle"]', fixture.employeeId)
    .run();
  await fixture.repository.configure({
    ...fixture.settings,
    native: { ...defaultNativeConfiguration, replyButtons: true },
  });
  await repo.configure(
    fixture.tenantId,
    fixture.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "quotes",
          employeeId: fixture.employeeId,
          title: "Consultar seguros",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: ["insurance"],
    },
    fixture.principal.id,
  );
  const access = await repo.getAccess({
    tenantId: fixture.tenantId,
    connectionId: fixture.connectionId,
    contact: "573001234567",
  });
  const menu = await repo.issueMenu(access);
  const session = (await repo.selectTask(access, "quotes", menu.id))!;
  const binding = (await fixture.repository.resolve(
    fixture.phoneNumberId,
    fixture.wabaId,
  ))!;
  return { fixture, repo, session, binding };
}

it("preflights enabled products once and reuses the verified form for this turn", async () => {
  const { fixture, repo, session, binding } = await selectedSession();
  let settingsReads = 0;
  const backend: typeof fetch = async (url) => {
    if (new URL(String(url)).pathname.endsWith("/settings")) {
      settingsReads++;
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [
              {
                id: "sura-auto",
                label: 'Auto Integral "actual"',
                enabled: true,
              },
              { id: "disabled-life", label: "Vida", enabled: false },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => backend,
  });

  const capabilities = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  expect(capabilities?.system).toContain('"id":"sura-auto"');
  expect(capabilities?.system).toContain(
    '"label":"Auto Integral \\"actual\\""',
  );
  expect(capabilities?.system).not.toMatch(/Hogar|Vida|Salud/i);
  expect(capabilities?.system).toMatch(/consent:false/i);
  expect(capabilities?.system).toMatch(
    /wait for explicit recorded consent|consent is recorded/i,
  );
  expect(settingsReads).toBe(1);

  const form = await (capabilities!.tools.savia_get_quote_form as any).execute(
    {},
  );
  expect(form.products).toEqual([
    { id: "sura-auto", label: 'Auto Integral "actual"' },
  ]);
  expect(settingsReads).toBe(1);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET status='inactive' WHERE id=?",
  )
    .bind(fixture.employeeId)
    .run();
  const denied = await (
    capabilities!.tools.savia_get_quote_form as any
  ).execute({});
  expect(denied).toMatchObject({ isError: true });
  expect(denied.products).toBeUndefined();
  expect(settingsReads).toBe(1);
});

it("removes quote tools and product claims when preflight cannot verify a catalog", async () => {
  const { repo, session, binding } = await selectedSession();
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () =>
      (async () =>
        new Response("unavailable", { status: 503 })) as typeof fetch,
  });

  const capabilities = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  expect(capabilities?.tools).not.toHaveProperty("savia_get_quote_form");
  expect(capabilities?.tools).not.toHaveProperty("savia_lookup_quote_vehicle");
  expect(capabilities?.system).toMatch(/catalog could not be verified/i);
  expect(capabilities?.system).not.toMatch(/Hogar|Vida|Salud/i);
});
