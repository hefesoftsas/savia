import { describe, expect, it, vi } from "vitest";
import { createCrmApp } from "../src/index";
import { encryptSecret } from "../src/integrations";

const app = createCrmApp();
const integrationKey = "a".repeat(64);
const geocodingRows = new Map<string, string>();

function createEnv(extra: Record<string, unknown> = {}) {
  return {
    POC_LOCAL: "true",
    INTEGRATION_KEY: integrationKey,
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM crm_geocoding_settings")) {
              const encrypted = geocodingRows.get(String(args[0]));
              return encrypted ? { encrypted_geoapify_key: encrypted } : null;
            }
            return null;
          },
          run: async () => {
            if (sql.includes("INSERT INTO crm_geocoding_settings")) {
              geocodingRows.set(String(args[0]), String(args[1]));
            }
            if (sql.includes("DELETE FROM crm_geocoding_settings")) {
              geocodingRows.delete(String(args[0]));
            }
            return {};
          },
        }),
      }),
    },
    FILES: {},
    ...extra,
  } as any;
}

describe("geocoding settings api", () => {
  it("stores and reports geoapify configuration without returning the secret", async () => {
    geocodingRows.clear();
    const env = createEnv();

    const empty = await app.request(
      "http://localhost/api/settings/geocoding",
      { method: "GET" },
      env,
    );
    expect(await empty.json()).toEqual({
      geoapifyConfigured: false,
      geoapifyStored: false,
    });

    const saved = await app.request(
      "http://localhost/api/settings/geocoding",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geoapifyApiKey: "demo-geoapify-key-123" }),
      },
      env,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      geoapifyConfigured: true,
      geoapifyStored: true,
    });

    const configured = await app.request(
      "http://localhost/api/settings/geocoding",
      { method: "GET" },
      env,
    );
    expect(await configured.json()).toEqual({
      geoapifyConfigured: true,
      geoapifyStored: true,
    });
  });

  it("uses the stored geoapify key for address searches", async () => {
    geocodingRows.clear();
    const env = createEnv();
    geocodingRows.set(
      "demo",
      await encryptSecret(
        "demo-geoapify-key-123",
        integrationKey,
        "demo:geocoding",
      ),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        expect(url).toContain("api.geoapify.com");
        expect(url).toContain("demo-geoapify-key-123");
        return {
          ok: true,
          json: async () => ({
            features: [
              {
                properties: {
                  formatted: "Calle 100 # 10-20, Bogotá, Colombia",
                },
              },
            ],
          }),
        };
      }),
    );

    const response = await app.request(
      "http://localhost/api/geocoding/search?q=calle%20100&provider=geoapify",
      { method: "GET" },
      env,
    );
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data[0].value).toContain("Calle 100");
  });
});
