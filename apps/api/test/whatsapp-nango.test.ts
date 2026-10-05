import { describe, expect, it } from "vitest";
import { createWhatsappNangoClient } from "../src/whatsapp/nango";

function clientFor(payload: unknown) {
  return createWhatsappNangoClient(
    {
      baseUrl: "https://nango.test",
      apiKey: "test-key",
      whatsappIntegrationId: "whatsapp-business",
    },
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("WhatsApp Nango connection response", () => {
  it("reads organization ownership from Nango's documented end_user shape", async () => {
    const summary = await clientFor({
      id: 123,
      connection_id: "wa-connection",
      provider_config_key: "whatsapp-business",
      metadata: {},
      end_user: {
        id: "principal-1",
        organization: { id: "user:principal-1" },
      },
    }).getConnection("wa-connection", "whatsapp-business");

    expect(summary.organizationId).toBe("user:principal-1");
  });

  it("preserves a foreign nested organization and does not invent ownership", async () => {
    const foreign = await clientFor({
      end_user: { organization: { id: "user:someone-else" } },
    }).getConnection("wa-connection", "whatsapp-business");
    const missing = await clientFor({
      end_user: { id: "principal-1" },
    }).getConnection("wa-connection", "whatsapp-business");

    expect(foreign.organizationId).toBe("user:someone-else");
    expect(missing.organizationId).toBeNull();
  });

  it("continues to accept the legacy top-level organization shape", async () => {
    const summary = await clientFor({
      organization: { id: "user:principal-1" },
    }).getConnection("wa-connection", "whatsapp-business");

    expect(summary.organizationId).toBe("user:principal-1");
  });

  it("creates a reconnect session for the existing Nango connection", async () => {
    let requestedUrl: URL | undefined;
    let requestedBody: Record<string, unknown> | undefined;
    const nango = createWhatsappNangoClient(
      {
        baseUrl: "https://nango.test",
        apiKey: "test-key",
        whatsappIntegrationId: "whatsapp-business",
      },
      async (input, init) => {
        requestedUrl = new URL(String(input));
        requestedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            data: { token: "reconnect-token", expires_at: "later" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
    );

    const session = await nango.createReconnectSession({
      connectionId: "existing-connection",
      integrationId: "whatsapp-business",
    });

    expect(requestedUrl?.pathname).toBe("/connect/sessions/reconnect");
    expect(requestedBody).toEqual({
      connection_id: "existing-connection",
      integration_id: "whatsapp-business",
    });
    expect(session.token).toBe("reconnect-token");
  });

  it("parses a positive integer tenant ID from the Nango agency tag", async () => {
    const summary = await clientFor({
      tags: { agency_id: "42" },
    }).getConnection("wa-connection", "whatsapp-business");

    expect(summary.agencyId).toBe(42);
  });

  it.each([undefined, "", "0", "-42", "4.2", "4x", "9007199254740992"])(
    "fails closed for malformed Nango agency tag %s",
    async (agencyTag) => {
      const summary = await clientFor({
        tags: agencyTag === undefined ? {} : { agency_id: agencyTag },
      }).getConnection("wa-connection", "whatsapp-business");

      expect(summary.agencyId).toBeNull();
    },
  );
});

it("keeps attachment downloads on the Meta host and preserves multipart media uploads", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const nango = createWhatsappNangoClient(
    {
      baseUrl: "https://nango.test",
      apiKey: "test-key",
      whatsappIntegrationId: "whatsapp-business",
    },
    async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ id: "123456789" });
    },
  );
  const connection = {
    nangoConnectionId: "tenant-connection",
    nangoIntegrationId: "whatsapp-business",
  } as import("../src/whatsapp/contracts").ActiveWhatsappConnection;
  await expect(
    nango.proxy({
      connection,
      method: "GET",
      baseUrl: "https://evil.example",
      path: "/whatsapp_business/attachments/?mid=123",
    } as any),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  await nango.proxy({
    connection,
    method: "GET",
    baseUrl: "https://lookaside.fbsbx.com",
    path: "/whatsapp_business/attachments/?mid=123",
  } as any);
  expect(new Headers(calls[0].init?.headers).get("base-url-override")).toBe(
    "https://lookaside.fbsbx.com",
  );
  expect(new Headers(calls[0].init?.headers).get("retries")).toBe("0");
  const body = new FormData();
  body.set("messaging_product", "whatsapp");
  body.set("file", new Blob(["file"], { type: "text/plain" }), "file.txt");
  await nango.proxy({
    connection,
    method: "POST",
    path: "/v21.0/123456789/media",
    body,
  });
  expect(calls[1].init?.body).toBe(body);
  expect(new Headers(calls[1].init?.headers).has("content-type")).toBe(false);
});
