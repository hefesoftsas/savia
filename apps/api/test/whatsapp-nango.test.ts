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
