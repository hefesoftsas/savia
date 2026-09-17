import { describe, expect, it, vi } from "vitest";
import { requestAssistantAction } from "./assistant-api";

describe("requestAssistantAction", () => {
  it("confirms a prepared command using the current bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      requestAssistantAction({
        apiUrl: "https://api.savia.test/",
        actionId: "action-17",
        operation: "confirm",
        accessToken: "current-access-token",
        fetcher,
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.savia.test/api/assistant/actions/action-17/confirm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { Authorization: "Bearer current-access-token" },
      }),
    );
  });

  it("surfaces the API error instead of accepting an unconfirmed command", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "La acción ya expiró." }), {
        status: 410,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      requestAssistantAction({
        apiUrl: "https://api.savia.test",
        actionId: "action-17",
        operation: "cancel",
        accessToken: "current-access-token",
        fetcher,
      }),
    ).rejects.toThrow("La acción ya expiró.");
  });
});
