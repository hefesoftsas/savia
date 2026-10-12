import { describe, expect, it, vi } from "vitest";
import { guardedFetch } from "./outbound-policy";

describe("preview outbound policy", () => {
  it.each([
    "https://example.com",
    "http://127.0.0.1",
    new Request("https://example.com/redirect"),
  ])("rejects before making a network request: %s", async (input) => {
    const network = vi.fn<typeof fetch>();
    const restricted = guardedFetch(network, {
      SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED: "false",
    });
    await expect(restricted(input)).rejects.toThrow(
      "External services are disabled",
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("requires an explicit enabled setting", async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    expect(
      await (
        await guardedFetch(network, {
          SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED: "true",
        })("https://example.com")
      ).text(),
    ).toBe("ok");
  });
});
