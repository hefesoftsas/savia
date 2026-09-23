import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { createSaviaRequestApi } from "./savia-request-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetcher: typeof fetch) {
  return new ApiClient({
    baseUrl: "https://admin.test",
    tokenSource: { getAccessToken: async () => "access-token" },
    fetcher,
  });
}

describe("createSaviaRequestApi", () => {
  it("loads flow summaries through the authenticated Savia Request proxy", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse([{ id: "autos", name: "Autos", steps: [] }]),
      );
    const api = createSaviaRequestApi(createClient(fetcher));

    await expect(api.listFlows()).resolves.toEqual([
      { id: "autos", name: "Autos", steps: [] },
    ]);

    expect(fetcher).toHaveBeenCalledWith(
      "https://admin.test/v1/savia-request/api/flows",
      expect.objectContaining({ method: "GET" }),
    );
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer access-token");
  });

  it("sends every write operation to its matching proxy endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ path: "Cotizaciones" }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "copia", name: "Autos (copia)" }, 201),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ id: "version" }))
      .mockResolvedValueOnce(jsonResponse({ value: "secret" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, reverted: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, reverted: false }))
      .mockResolvedValueOnce(jsonResponse({ version: 1, flows: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const api = createSaviaRequestApi(createClient(fetcher));

    await api.createFolder("Cotizaciones");
    await api.removeFolder("Cotizaciones");
    await api.duplicateFlow("autos");
    await api.removeFlow("autos");
    await api.saveVariables("autos", [
      { key: "token", value: "masked", secret: true },
    ]);
    await api.publish("autos");
    await api.revealVariable("autos", "token");
    await api.resetVariable("autos", "token");
    await api.resetFlow("autos");
    await api.exportSecrets();
    await api.importSecrets({ version: 1, exportedAt: "hoy", flows: [] });

    expect(
      fetcher.mock.calls.map(([url, init]) => [
        url.toString(),
        init?.method,
        init?.body,
      ]),
    ).toEqual([
      [
        "https://admin.test/v1/savia-request/api/folders",
        "POST",
        '{"path":"Cotizaciones"}',
      ],
      [
        "https://admin.test/v1/savia-request/api/folders",
        "DELETE",
        '{"path":"Cotizaciones"}',
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/duplicate",
        "POST",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos",
        "DELETE",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/variables",
        "PUT",
        '[{"key":"token","value":"masked","secret":true}]',
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/publish",
        "POST",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/variables/reveal",
        "POST",
        '{"key":"token"}',
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/variables/token",
        "DELETE",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/flows/autos/reset",
        "POST",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/variables/export",
        "GET",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/variables/import",
        "POST",
        '{"version":1,"exportedAt":"hoy","flows":[]}',
      ],
    ]);
  });

  it("scopes every endpoint to the selected tenant", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse([]));
    const api = createSaviaRequestApi(createClient(fetcher), {
      tenant: "agency:101",
    });

    await api.listFlows();
    await api.readFlow("autos");

    expect(fetcher.mock.calls.map(([url]) => url.toString())).toEqual([
      "https://admin.test/v1/savia-request/api/flows?tenant=agency%3A101",
      "https://admin.test/v1/savia-request/api/flows/autos?tenant=agency%3A101",
    ]);
  });

  it("fetches bundle status and syncs through the scoped endpoints", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ ok: true }));
    const api = createSaviaRequestApi(createClient(fetcher), {
      tenant: "agency:101",
    });

    await api.bundleStatus();
    await api.syncBundle({ force: true });

    expect(
      fetcher.mock.calls.map(([url, init]) => [
        url.toString(),
        init?.method,
        init?.body,
      ]),
    ).toEqual([
      [
        "https://admin.test/v1/savia-request/api/bundles/insurance-auto-light/status?tenant=agency%3A101",
        "GET",
        undefined,
      ],
      [
        "https://admin.test/v1/savia-request/api/bundles/insurance-auto-light/sync?tenant=agency%3A101",
        "POST",
        '{"force":true}',
      ],
    ]);
  });
});
