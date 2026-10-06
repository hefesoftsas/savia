import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createChannelOperationAdapter } from "../src/assistant/operation-adapter";
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
