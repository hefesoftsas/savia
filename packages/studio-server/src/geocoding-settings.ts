import { dialectFor } from "@savia/db/dialect";
import type { Hono } from "hono";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./integrations";
import { type Env, fail } from "./context";

const settingsSchema = z.object({
  geoapifyApiKey: z.string().trim().min(10).max(200).optional(),
  clearGeoapifyApiKey: z.boolean().optional(),
});

function encryptionContext(tenant: string) {
  return `${tenant}:geocoding`;
}

export async function getGeoapifyApiKey(
  db: D1Database,
  tenant: string,
  integrationKey: string | undefined,
  envKey?: string,
) {
  const row = await db
    .prepare(
      "SELECT encrypted_geoapify_key FROM crm_geocoding_settings WHERE tenant_id=?",
    )
    .bind(tenant)
    .first<{ encrypted_geoapify_key?: string | null }>();
  if (row?.encrypted_geoapify_key)
    return decryptSecret(
      row.encrypted_geoapify_key,
      integrationKey,
      encryptionContext(tenant),
    );
  return envKey?.trim() || undefined;
}

export function registerGeocodingSettings(app: Hono<Env>) {
  app.get("/api/settings/geocoding", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT encrypted_geoapify_key, updated_at FROM crm_geocoding_settings WHERE tenant_id=?",
    )
      .bind(c.get("tenant"))
      .first<{
        encrypted_geoapify_key?: string | null;
        updated_at?: string | null;
      }>();
    return c.json({
      geoapifyConfigured: !!(
        row?.encrypted_geoapify_key || c.env.GEOAPIFY_API_KEY
      ),
      geoapifyStored: !!row?.encrypted_geoapify_key,
      ...(row?.updated_at ? { updatedAt: row.updated_at } : {}),
    });
  });

  app.put("/api/settings/geocoding", async (c) => {
    const input = settingsSchema.parse(await c.req.json());
    const tenant = c.get("tenant");
    if (input.clearGeoapifyApiKey) {
      await c.env.DB.prepare(
        "DELETE FROM crm_geocoding_settings WHERE tenant_id=?",
      )
        .bind(tenant)
        .run();
      return c.json({
        geoapifyConfigured: !!c.env.GEOAPIFY_API_KEY,
        geoapifyStored: false,
      });
    }
    if (!input.geoapifyApiKey) fail("Indica la API key de Geoapify.");
    const encrypted = await encryptSecret(
      input.geoapifyApiKey,
      c.env.INTEGRATION_KEY,
      encryptionContext(tenant),
    );
    await c.env.DB.prepare(
      `INSERT INTO crm_geocoding_settings (tenant_id, encrypted_geoapify_key, updated_at)
       VALUES (?, ?, ${dialectFor(c.env.DB).utcNow()})
       ON CONFLICT(tenant_id) DO UPDATE SET
         encrypted_geoapify_key=excluded.encrypted_geoapify_key,
         updated_at=excluded.updated_at`,
    )
      .bind(tenant, encrypted)
      .run();
    return c.json({ geoapifyConfigured: true, geoapifyStored: true });
  });
}
