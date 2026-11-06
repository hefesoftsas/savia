import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { createChannelOperationAdapter } from "../src/assistant/operation-adapter";
import { createWhatsappAssistant } from "../src/whatsapp/assistant";
import { createRoutedWhatsappGenerator } from "../src/whatsapp/channel-runtime";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";
import { processChannelActions } from "../src/whatsapp/action-jobs";
import { ChannelDrafts } from "../src/whatsapp/drafts";
import { defaultNativeConfiguration } from "../src/whatsapp/native";

const quoteInput = {
  vehicle: {
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2011,
    isNew: false,
    circulationCity: "11001",
    accessoriesValue: 0,
    declaredValue: 16000000,
  },
  applicant: {
    documentType: "CC",
    documentNumber: "123456789",
    firstName: "Test",
    surname: "User",
    gender: "F",
    birthDate: "1990-01-01",
    city: "11001",
    address: "Calle 1",
    phone: "3001234567",
    email: "test@example.test",
  },
};
it("quotes only after a contact-bound confirmation, links ownership before dispatch, and keeps customer summaries private", async () => {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='Alice',allowed_collections=? WHERE id=?",
  )
    .bind('["cotizaciones","cotizaciones_detalle"]', s.employeeId)
    .run();
  await s.repository.configure({
    ...s.settings,
    native: { ...defaultNativeConfiguration, replyButtons: true },
  });
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "quotes",
          employeeId: s.employeeId,
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
    s.principal.id,
  );
  let providerCalls = 0;
  const backend: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path.endsWith("/objects"))
      return Response.json({
        data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
      });
    if (path.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [
              {
                id: "liberty-full-quote",
                label: "Liberty · Full",
                enabled: true,
              },
            ],
          },
        },
      });
    if (path.endsWith("/actions/quote")) {
      if (body.input.flowId === "sura-autos-provider")
        return Response.json({
          data: {
            output: {
              data: {
                vehicle:
                  body.input.quoteInput.vehicle.plate === "TESTCAR"
                    ? quoteInput.vehicle
                    : { plate: "TESTNEW", productionYear: 2020 },
              },
            },
          },
        });
      const link = await env.DB.prepare(
        "SELECT resource_id FROM whatsapp_channel_resources WHERE connection_id=? AND contact=?",
      )
        .bind(s.connectionId, "573001234567")
        .first();
      expect(link).toBeTruthy();
      providerCalls++;
      return Response.json({
        data: {
          run: { runId: "test-run" },
          output: { data: { quoteNumber: "123", premiumTotal: 1000000 } },
        },
      });
    }
    if (init?.method === "POST")
      return Response.json({
        data: {
          id: path.endsWith("/cotizaciones") ? "master-test" : "detail-test",
          _version: 1,
        },
      });
    return Response.json({ data: { id: "saved", _version: 2 } });
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => backend,
  });
  const generate = createWhatsappAssistant({
    configuration: {
      effectiveConfigurationForTenant: async () => ({
        apiKey: "test",
        model: "test",
        tenantId: s.tenantId,
      }),
    },
    employees: {
      getById: async () => ({
        id: s.employeeId,
        agencyId: s.tenantId,
        status: "active",
        name: "Alice",
        systemPrompt: "",
        model: null,
        allowedCollections: ["cotizaciones", "cotizaciones_detalle"],
      }),
    },
    knowledge: async () => [],
    capabilities: adapter.capabilities,
    complete: async (input: any) => {
      const last = input.messages.at(-1).content;
      if (last === "TESTCAR") {
        await input.tools.savia_lookup_quote_vehicle.execute({
          plate: "TESTCAR",
        });
        await input.tools.savia_prepare_command.execute({
          domain: "insurance",
          command: "quote-auto",
          input: quoteInput,
        });
        return "Consent requested";
      }
      await input.tools.savia_prepare_command.execute({
        domain: "insurance",
        command: "quote-auto",
        input: { ...quoteInput, consent: true },
      });
      return "Prepared";
    },
  });
  const routed = createRoutedWhatsappGenerator(repo, generate);
  const sent: any[] = [];
  const send = vi.fn(async (_binding, reply) => {
    sent.push(reply);
    return `wamid.reply.${sent.length}`;
  });
  async function inbound(text: string, native?: any) {
    await s.repository.receive({
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      messageId: `input-${sent.length}`,
      contactPhone: "573001234567",
      text,
      timestamp: new Date().toISOString(),
      ...(native ? { native } : {}),
    });
    await processWhatsappInbox(s.repository, { ...routed, send });
  }
  // An unsolicited authorization cannot bypass the server-issued notice.
  await inbound("AUTORIZO");
  const earlySession = (await repo.getSession({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  }))!;
  expect(
    await new ChannelDrafts(repo, "test-secret").get(earlySession),
  ).toMatchObject({ consent: false });
  await inbound("TESTCAR");
  expect(providerCalls).toBe(0);
  expect(sent.at(-1)).toContain("Responde AUTORIZO");
  await inbound("AUTORIZO");
  expect(providerCalls).toBe(0);
  const preview = sent.at(-1);
  const credential =
    typeof preview === "string"
      ? preview.match(/CONFIRMAR [A-Z2-7]{10}/)![0]
      : preview.options[0].id;
  expect(typeof preview === "string" ? preview : preview.text).toContain(
    "Alice",
  );
  if (typeof preview === "string") await inbound(credential);
  else
    await inbound("Confirmar y cotizar", {
      kind: "choice",
      choiceType: "button",
      id: credential,
      title: "Confirmar y cotizar",
    });
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  expect(
    await processChannelActions(adapter.actions!, (action) =>
      adapter.execute(binding, action),
    ),
  ).toMatchObject({ completed: 1 });
  expect(providerCalls).toBe(1);
  await processChannelActions(adapter.actions!, (action) =>
    adapter.execute(binding, action),
  );
  expect(providerCalls).toBe(1);
  const session = (await repo.getSession({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  }))!;
  const caps = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  const result = await (caps!.tools.savia_get_quote_summary as any).execute({
    reference: "someone-elses-quote",
  });
  expect(result.quote).toBeNull();
  await (caps!.tools.savia_update_task_draft as any).execute({
    fields: { applicant: { surname: "Changed" } },
  });
  await (caps!.tools.savia_prepare_command as any).execute({
    domain: "insurance",
    command: "quote-auto",
    input: {
      ...quoteInput,
      applicant: { ...quoteInput.applicant, surname: "Changed" },
      consent: true,
    },
  });
  expect(caps!.reply!()).toContain("Responde AUTORIZO");
  expect(providerCalls).toBe(1);
  const outbox = await env.DB.prepare(
    "SELECT reply_text,reply_payload FROM whatsapp_inbox WHERE connection_id=?",
  )
    .bind(s.connectionId)
    .all<any>();
  expect(JSON.stringify(outbox.results)).not.toContain(credential);
  const history = await env.DB.prepare(
    "SELECT user_text,assistant_text FROM whatsapp_channel_history WHERE connection_id=?",
  )
    .bind(s.connectionId)
    .all<any>();
  expect(JSON.stringify(history.results)).not.toContain(credential);
  await (caps!.tools.savia_lookup_quote_vehicle as any).execute({
    plate: "TESTNEW",
  });
  const changedDraft = await new ChannelDrafts(repo, "test-secret").get(
    session,
  );
  expect(changedDraft.vehicle).toEqual({
    plate: "TESTNEW",
    productionYear: 2020,
  });
  expect(changedDraft.applicant).toMatchObject({ surname: "Changed" });
});
