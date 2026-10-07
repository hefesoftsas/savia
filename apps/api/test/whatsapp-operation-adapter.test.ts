import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import {
  createChannelOperationAdapter,
  type ChannelOperationDependencies,
} from "../src/assistant/operation-adapter";
import { PersonalActionPayloadCipher } from "../src/assistant/personal-action-payload";
import { ChannelDrafts } from "../src/whatsapp/drafts";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { defaultNativeConfiguration } from "../src/whatsapp/native";
import { setupChannelFixture } from "./whatsapp-channel-fixture";

async function selectedSession(staffMode = false, replyButtons = true) {
  const fixture = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='Alice',allowed_collections=? WHERE id=?",
  )
    .bind('["cotizaciones","cotizaciones_detalle"]', fixture.employeeId)
    .run();
  await fixture.repository.configure({
    ...fixture.settings,
    native: { ...defaultNativeConfiguration, replyButtons },
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
          audiences: staffMode ? ["external", "internal"] : ["external"],
        },
      ],
      staff: staffMode
        ? [
            {
              phone: "573001234567",
              label: "Tenant administrator",
              active: true,
              principalId: fixture.principal.id,
            },
          ]
        : [],
      internalCapabilities: staffMode ? ["insurance"] : [],
      externalCapabilities: staffMode ? [] : ["insurance"],
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

async function saveQuoteSummaryAction(
  fixture: Awaited<ReturnType<typeof setupChannelFixture>>,
  session: Awaited<ReturnType<typeof selectedSession>>["session"],
  generation: string,
  reference: string,
  insuredValue: number,
  createdAt: string,
) {
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
      (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
       action_json,token_hash,status,expires_at,created_at,result_json)
     VALUES(?,?,?,?,?,?,?,'{}','unused','completed',?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      fixture.connectionId,
      fixture.tenantId,
      session.access.contact,
      generation,
      session.employeeId,
      session.selectionRevision,
      createdAt,
      createdAt,
      JSON.stringify({ result: { reference, insuredValue } }),
    )
    .run();
}

async function executeConfirmedQuote(
  actionProductIds: string[],
  catalogProductIds: string[],
  quotePresentation?: ChannelOperationDependencies["quotePresentation"],
) {
  const { fixture, repo, session, binding } = await selectedSession();
  let settingsReads = 0;
  let providerCalls = 0;
  const writes: string[] = [];
  const backend: typeof fetch = async (url, init) => {
    const requestUrl = new URL(String(url));
    const path = requestUrl.pathname;
    if (path.endsWith("/settings")) {
      settingsReads++;
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "lookup" },
            products: catalogProductIds.map((id) => ({
              id,
              label: `Carrier · ${id}`,
              enabled: true,
            })),
          },
        },
      });
    }
    if (path.endsWith("/objects"))
      return Response.json({
        data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
      });
    if (path.endsWith("/actions/quote")) {
      providerCalls++;
      return Response.json({
        data: {
          run: { runId: "quote-run" },
          output: { data: { premiumTotal: 123456 } },
        },
      });
    }
    if (init?.method === "POST") {
      writes.push(path);
      return Response.json({
        data: {
          id: path.endsWith("/cotizaciones") ? "quote-master" : "quote-detail",
          _version: 1,
        },
      });
    }
    if (init?.method === "PATCH") {
      writes.push(path);
      return Response.json({ data: {} });
    }
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => backend,
    quotePresentation,
  });
  const action = {
    id: crypto.randomUUID(),
    session,
    revision: 1,
    domain: "insurance",
    command: "quote-auto",
    input: {
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
      products: actionProductIds,
      consent: true,
    },
  };
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
      (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
       action_json,token_hash,status,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,'{}','dispatching','dispatching',?,?)`,
  )
    .bind(
      action.id,
      fixture.connectionId,
      fixture.tenantId,
      session.access.contact,
      session.access.generation,
      session.employeeId,
      session.selectionRevision,
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  const result = adapter.execute(binding, action);
  return {
    result,
    actionId: action.id,
    settingsReads: () => settingsReads,
    providerCalls: () => providerCalls,
    writes,
  };
}

it("retains the model analysis and customer link in the delivered quote outcome", async () => {
  const received: string[] = [];
  const execution = await executeConfirmedQuote(
    ["confirmed-auto"],
    ["confirmed-auto"],
    () => ({
      record: (proposal) => {
        received.push(proposal.id);
      },
      finish: async (result) => ({
        ...result,
        publicUrl: "https://savia.test/public/quotes/opaque",
        recommendation: "Compare the verified proposal.",
      }),
    }),
  );
  const outcome = await execution.result;
  expect(outcome.result).toMatchObject({
    publicUrl: "https://savia.test/public/quotes/opaque",
    recommendation: "Compare the verified proposal.",
  });
  expect(received).toEqual(["confirmed-auto"]);
});

it("checks a changed confirmed product catalog before quote writes or provider dispatch", async () => {
  const execution = await executeConfirmedQuote(
    ["confirmed-auto"],
    ["new-auto"],
  );

  await expect(execution.result).rejects.toThrow(
    "Confirmed quote products changed",
  );

  expect(execution.settingsReads()).toBe(1);
  expect(execution.writes).toEqual([]);
  expect(execution.providerCalls()).toBe(0);
});

it("uses one bounded catalog read for a matching confirmed product", async () => {
  const execution = await executeConfirmedQuote(
    ["confirmed-auto"],
    ["confirmed-auto"],
  );

  await expect(execution.result).resolves.toMatchObject({ state: "completed" });

  expect(execution.settingsReads()).toBe(1);
  expect(execution.providerCalls()).toBe(1);
});

it("persists each product result for incremental delivery during execution", async () => {
  const execution = await executeConfirmedQuote(
    ["confirmed-auto"],
    ["confirmed-auto"],
  );
  await execution.result;
  const progress = await env.DB.prepare(
    "SELECT event_key,progress_text,status FROM whatsapp_channel_action_progress WHERE action_id=?",
  )
    .bind(execution.actionId)
    .all<{ event_key: string; progress_text: string; status: string }>();
  expect(progress.results).toHaveLength(1);
  expect(progress.results[0]).toMatchObject({
    event_key: "confirmed-auto",
    status: "pending",
  });
  expect(progress.results[0].progress_text).toContain("123.456");
});

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

it("uses only current-generation actions for a staff summary without a reference", async () => {
  const { fixture, repo, session, binding } = await selectedSession(true);
  const quoteRecordReads: string[] = [];
  const backend: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [{ id: "auto", label: "Auto", enabled: true }],
          },
        },
      });
    if (path.includes("/records/cotizaciones")) quoteRecordReads.push(path);
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
  await saveQuoteSummaryAction(
    fixture,
    session,
    session.access.generation,
    "current-cycle",
    16000000,
    new Date().toISOString(),
  );
  await saveQuoteSummaryAction(
    fixture,
    session,
    "previous-generation",
    "prior-cycle",
    42000000,
    "2999-01-01T00:00:00.000Z",
  );

  const result = await (
    capabilities!.tools.savia_get_quote_summary as any
  ).execute({});

  expect(result).toMatchObject({
    quote: { reference: "current-cycle", insuredValue: 16000000 },
    totalQuotes: 1,
  });
  expect(quoteRecordReads).toEqual([]);
});

it("allows a staff summary to query the tenant API by an explicit reference", async () => {
  const { repo, session, binding } = await selectedSession(true);
  let referenceFilter: unknown;
  const backend: typeof fetch = async (url) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [{ id: "auto", label: "Auto", enabled: true }],
          },
        },
      });
    if (requestUrl.pathname.endsWith("/objects"))
      return Response.json({
        data: [
          { name: "cotizaciones", recordCount: 1 },
          { name: "cotizaciones_detalle", recordCount: 1 },
        ],
      });
    if (requestUrl.pathname.endsWith("/records/cotizaciones")) {
      referenceFilter = JSON.parse(requestUrl.searchParams.get("filters")!);
      return Response.json({
        data: [
          {
            id: "quote-id",
            name: "prior-reference",
            estado: "Recibida",
            valor_asegurado: 42000000,
          },
        ],
        total: 1,
      });
    }
    if (requestUrl.pathname.endsWith("/records/cotizaciones_detalle"))
      return Response.json({ data: [], total: 0 });
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

  const result = await (
    capabilities!.tools.savia_get_quote_summary as any
  ).execute({ reference: "prior-reference" });

  expect(referenceFilter).toEqual({
    logic: "and",
    conditions: [{ field: "name", op: "eq", value: "prior-reference" }],
  });
  expect(result.quote).toMatchObject({ reference: "prior-reference" });
});

it("keeps an explicitly referenced external summary within the current generation", async () => {
  const { fixture, repo, session, binding } = await selectedSession();
  const backend: typeof fetch = async (url) => {
    if (new URL(String(url)).pathname.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [{ id: "auto", label: "Auto", enabled: true }],
          },
        },
      });
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
  await saveQuoteSummaryAction(
    fixture,
    session,
    session.access.generation,
    "current-cycle",
    16000000,
    new Date().toISOString(),
  );
  await saveQuoteSummaryAction(
    fixture,
    session,
    "previous-generation",
    "current-cycle",
    42000000,
    "2999-01-01T00:00:00.000Z",
  );

  const result = await (
    capabilities!.tools.savia_get_quote_summary as any
  ).execute({ reference: "current-cycle" });

  expect(result).toMatchObject({
    quote: { reference: "current-cycle", insuredValue: 16000000 },
    totalQuotes: 1,
  });
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

  const capabilities = await adapter.capabilities(
    {
      ...binding,
      channelSession: session,
    },
    { text: "Una nueva" } as any,
  );
  expect(capabilities?.tools).not.toHaveProperty("savia_get_quote_form");
  expect(capabilities?.tools).not.toHaveProperty("savia_lookup_quote_vehicle");
  expect(capabilities?.system).toMatch(/catalog could not be verified/i);
  expect(capabilities?.system).not.toMatch(/Hogar|Vida|Salud/i);
  expect(capabilities?.quoteFailed?.()).toBe(true);
  const greeting = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "Hola" } as any,
  );
  expect(greeting?.quoteFailed?.()).toBe(false);
  const information = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "Qué seguros ofrecen" } as any,
  );
  expect(information?.quoteFailed?.()).toBe(false);
});

it("prepares a staff quote after AUTORIZO using the same validated draft", async () => {
  const { repo, session, binding } = await selectedSession(true);
  const backend: typeof fetch = async (url) => {
    if (new URL(String(url)).pathname.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [
              { id: "sura-auto", label: "Auto Integral", enabled: true },
            ],
          },
        },
      });
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => backend,
  });
  const quote = {
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
  const firstTurn = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  await (firstTurn!.tools.savia_update_task_draft as any).execute({
    fields: {
      vehicle: quote.vehicle,
      applicant: {
        ...quote.applicant,
        name: "Test User",
        residenceCity: "Bogotá",
      },
    },
  });
  const consentRequest = await (
    firstTurn!.tools.savia_prepare_command as any
  ).execute({
    domain: "insurance",
    command: "quote-auto",
    input: { ...quote, consent: false },
  });
  expect(consentRequest).toMatchObject({ isError: true });
  expect(firstTurn!.reply!()).toContain("Responde AUTORIZO");

  const afterAuthorization = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  expect(afterAuthorization!.tools).not.toHaveProperty("savia_prepare_command");
  expect(afterAuthorization!.directReply).toMatchObject({ kind: "buttons" });
  expect((afterAuthorization!.directReply as any).text).not.toMatch(
    /"plate"|fasecoldaCode|documentNumber|Productos:/,
  );
  expect((afterAuthorization!.directReply as any).text).toContain(
    "Valor asegurado:",
  );
  expect(afterAuthorization!.reply).toBeUndefined();

  const bareConfirmation = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "Confirmar" } as any,
  );
  expect(bareConfirmation?.directReply).toMatch(/botón|código/i);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
    )
      .bind(session.access.connectionId, session.access.contact)
      .first("status"),
  ).toBe("pending");
  for (const text of ["Confirmo mi dirección", "Confirmar Direccion"]) {
    const ordinaryIntake = await adapter.capabilities(
      { ...binding, channelSession: session },
      { text } as any,
    );
    expect(ordinaryIntake?.directReply).toBeUndefined();
    expect(ordinaryIntake?.tools).toHaveProperty("savia_get_quote_form");
  }

  const rows = await env.DB.prepare(
    "SELECT id,status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
  )
    .bind(session.access.connectionId, session.access.contact)
    .all<{ id: string; status: string }>();
  expect(rows.results.map((row) => row.status)).toEqual(["pending"]);
  const quoteActionId = rows.results[0]!.id;

  const repeatedAuthorization = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  expect(repeatedAuthorization?.directReply).toMatch(
    /pendiente de confirmación/i,
  );
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND status='pending'",
    )
      .bind(session.access.connectionId, session.access.contact)
      .first("count"),
  ).toBe(1);

  for (const status of ["queued", "dispatching", "completed", "uncertain"]) {
    await env.DB.prepare(
      "UPDATE whatsapp_channel_actions SET status=? WHERE connection_id=? AND contact=?",
    )
      .bind(status, session.access.connectionId, session.access.contact)
      .run();
    const repeated = await adapter.capabilities(
      { ...binding, channelSession: session },
      { text: "AUTORIZO" } as any,
    );
    if (status === "uncertain")
      expect(repeated?.directReply).toMatch(/asesor/i);
    else if (status === "completed")
      expect(repeated?.directReply).toMatch(/ya fue procesada/i);
    else expect(repeated?.directReply).toMatch(/en procesamiento/i);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
      )
        .bind(session.access.connectionId, session.access.contact)
        .first("count"),
    ).toBe(1);
  }

  const cipher = new PersonalActionPayloadCipher("test-secret");
  const unrelatedActionIds: string[] = [];
  const oldQuoteTimestamp = new Date(Date.now() - 21 * 60_000).toISOString();
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET created_at=? WHERE id=?",
  )
    .bind(oldQuoteTimestamp, quoteActionId)
    .run();
  for (let index = 0; index < 11; index++) {
    const id = crypto.randomUUID();
    unrelatedActionIds.push(id);
    const createdAt = new Date(
      Date.parse(oldQuoteTimestamp) + (index + 1) * 1000,
    ).toISOString();
    const input = await cipher.seal({
      actionId: id,
      principalId: session.access.principalId ?? session.access.contact,
      payload: { collection: `unrelated-${index}` },
    });
    const actionJson = JSON.stringify({
      id,
      session,
      revision: 1,
      domain: "studio",
      command: "create-record",
      input: { sealedPayload: input },
    });
    await env.DB.prepare(
      "INSERT INTO whatsapp_channel_actions(id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,action_json,token_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?)",
    )
      .bind(
        id,
        session.access.connectionId,
        session.access.tenantId,
        session.access.contact,
        session.access.generation,
        session.employeeId,
        session.selectionRevision,
        actionJson,
        `unused-${index}`,
        new Date(Date.now() + 60_000).toISOString(),
        createdAt,
      )
      .run();
  }
  const oldUncertainAuthorization = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  expect(oldUncertainAuthorization?.directReply).toMatch(/asesor/i);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
    )
      .bind(session.access.connectionId, session.access.contact)
      .first("count"),
  ).toBe(12);
  for (const id of unrelatedActionIds) {
    await env.DB.prepare("DELETE FROM whatsapp_channel_actions WHERE id=?")
      .bind(id)
      .run();
  }
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET created_at=? WHERE id=?",
  )
    .bind(new Date().toISOString(), quoteActionId)
    .run();

  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='pending',expires_at=? WHERE id=?",
  )
    .bind(new Date(Date.now() - 1000).toISOString(), quoteActionId)
    .run();
  const expiredAuthorization = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  expect(expiredAuthorization?.directReply).toMatchObject({ kind: "buttons" });
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? ORDER BY created_at",
    )
      .bind(session.access.connectionId, session.access.contact)
      .all<{ status: string }>(),
  ).toMatchObject({
    results: [{ status: "cancelled" }, { status: "pending" }],
  });

  await (afterAuthorization!.tools.savia_update_task_draft as any).execute({
    fields: { applicant: { firstName: "Changed" } },
  });
  expect(
    await new ChannelDrafts(repo, "test-secret").get(session),
  ).toMatchObject({
    consent: false,
    consentPrompt: null,
  });
  const authorizationAfterEdit = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  expect(authorizationAfterEdit!.tools).toHaveProperty("savia_prepare_command");
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
    )
      .bind(session.access.connectionId, session.access.contact)
      .all<{ status: string }>(),
  ).toMatchObject({
    results: [{ status: "cancelled" }, { status: "cancelled" }],
  });
});

it("accepts a mixed-case confirmation code and explains expired confirmations", async () => {
  const { repo, session, binding } = await selectedSession(true, false);
  const backend: typeof fetch = async (url) => {
    if (new URL(String(url)).pathname.endsWith("/settings"))
      return Response.json({
        data: {
          value: {
            vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            products: [{ id: "sura-auto", label: "Auto", enabled: true }],
          },
        },
      });
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => backend,
  });
  const quote = {
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
  const firstTurn = await adapter.capabilities({
    ...binding,
    channelSession: session,
  });
  await (firstTurn!.tools.savia_update_task_draft as any).execute({
    fields: quote,
  });
  await (firstTurn!.tools.savia_prepare_command as any).execute({
    domain: "insurance",
    command: "quote-auto",
    input: { ...quote, consent: false },
  });
  const preview = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "AUTORIZO" } as any,
  );
  const previewText = preview?.directReply ?? preview?.reply?.();
  expect(typeof previewText).toBe("string");
  const code = /CONFIRMAR ([A-Z2-7]{10})/.exec(previewText as string)?.[1];
  expect(code).toBeDefined();

  const confirmed = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: `cOnFiRmAr ${code!.toLowerCase()}` } as any,
  );
  expect(confirmed?.directReply).toMatch(/Solicitud confirmada/i);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
    )
      .bind(session.access.connectionId, session.access.contact)
      .first("status"),
  ).toBe("queued");

  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='pending',expires_at=? WHERE connection_id=? AND contact=?",
  )
    .bind(
      new Date(Date.now() - 1000).toISOString(),
      session.access.connectionId,
      session.access.contact,
    )
    .run();
  const expired = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: `Confirmar ${code}` } as any,
  );
  expect(expired?.directReply).toMatch(/no está vigente/i);
  expect(expired?.directReply).not.toMatch(/AUTORIZO/);
  expect(expired?.directReply).toMatch(/menú/);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
    )
      .bind(session.access.connectionId, session.access.contact)
      .first("status"),
  ).toBe("expired");
  const bareExpired = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "Confirmar" } as any,
  );
  expect(bareExpired?.directReply).toMatch(/AUTORIZO/);
  expect(bareExpired?.directReply).toMatch(/menú/);

  const expiredQuote = await env.DB.prepare(
    "SELECT id FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?",
  )
    .bind(session.access.connectionId, session.access.contact)
    .first<{ id: string }>();
  const newerId = crypto.randomUUID();
  const newerPayload = await new PersonalActionPayloadCipher(
    "test-secret",
  ).seal({
    actionId: newerId,
    principalId: session.access.principalId ?? session.access.contact,
    payload: { collection: "example" },
  });
  const newerActionJson = JSON.stringify({
    id: newerId,
    session,
    revision: 1,
    domain: "studio",
    command: "create-record",
    input: { sealedPayload: newerPayload },
  });
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_actions(id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,action_json,token_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'completed',?,?)",
  )
    .bind(
      newerId,
      session.access.connectionId,
      session.access.tenantId,
      session.access.contact,
      session.access.generation,
      session.employeeId,
      session.selectionRevision,
      newerActionJson,
      "unused-newer",
      new Date(Date.now() + 60_000).toISOString(),
      new Date(Date.now() + 1000).toISOString(),
    )
    .run();
  const staleCode = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: `Confirmar ${code}` } as any,
  );
  expect(staleCode?.directReply).toMatch(/no está vigente/i);
  expect(staleCode?.directReply).not.toMatch(/procesada|AUTORIZO/i);
  const wrongCodeValue = [...code!]
    .map((character) => (character === "A" ? "B" : "A"))
    .join("");
  const wrongCode = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: `CONFIRMAR ${wrongCodeValue}` } as any,
  );
  expect(wrongCode?.directReply).toMatch(/no está vigente/i);
  expect(wrongCode?.directReply).not.toMatch(/procesada|AUTORIZO/i);
  const staleButton = await adapter.capabilities(
    { ...binding, channelSession: session },
    {
      native: {
        kind: "choice",
        id: `confirm:${expiredQuote!.id}:${"a".repeat(32)}`,
      },
    } as any,
  );
  expect(staleButton?.directReply).toMatch(/no está vigente/i);
  expect(staleButton?.directReply).not.toMatch(/procesada|AUTORIZO/i);
});

it("does not suggest AUTORIZO for an expired non-insurance action", async () => {
  const { repo, session, binding } = await selectedSession();
  const id = crypto.randomUUID();
  const cipher = new PersonalActionPayloadCipher("test-secret");
  const sealedPayload = await cipher.seal({
    actionId: id,
    principalId: session.access.principalId ?? session.access.contact,
    payload: { collection: "example" },
  });
  const actionJson = JSON.stringify({
    id,
    session,
    revision: 1,
    domain: "studio",
    command: "create-record",
    input: { sealedPayload },
  });
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_actions(id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,action_json,token_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'expired',?,?)",
  )
    .bind(
      id,
      session.access.connectionId,
      session.access.tenantId,
      session.access.contact,
      session.access.generation,
      session.employeeId,
      session.selectionRevision,
      actionJson,
      "unused",
      new Date(Date.now() - 1000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  const adapter = createChannelOperationAdapter({
    repository: repo,
    secret: "test-secret",
    backendForActor: async () => fetch,
  });

  const result = await adapter.capabilities(
    { ...binding, channelSession: session },
    { text: "Confirmar" } as any,
  );

  expect(result?.directReply).toMatch(/venció/i);
  expect(result?.directReply).toMatch(/menú/i);
  expect(result?.directReply).not.toMatch(/AUTORIZO/i);
});
