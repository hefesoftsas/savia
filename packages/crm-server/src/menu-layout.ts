import { dialectFor } from "@savia/db/dialect";
import type { Hono } from "hono";
import { z } from "zod";
import { type Env } from "./context";
import {
  normalizeMenuLayout,
  reconcileMenuLayout,
  screenMenuLayoutSchema,
  screenNamesFromLayout,
  type ScreenMenuLayout,
} from "@savia/crm-shared/screen-menu-layout";
import { reorderScreens } from "./schema";

export async function getMenuLayout(
  db: D1Database,
  tenant: string,
): Promise<ScreenMenuLayout | null> {
  const row = await db
    .prepare("SELECT menu_layout FROM crm_studio_settings WHERE tenant_id=?")
    .bind(tenant)
    .first<{ menu_layout: string | null }>();
  if (!row?.menu_layout) return null;
  try {
    return normalizeMenuLayout(
      screenMenuLayoutSchema.parse(JSON.parse(row.menu_layout)),
    );
  } catch {
    try {
      return normalizeMenuLayout(JSON.parse(row.menu_layout));
    } catch {
      return null;
    }
  }
}

export async function saveMenuLayout(
  db: D1Database,
  tenant: string,
  layout: ScreenMenuLayout,
): Promise<ScreenMenuLayout> {
  const parsed = screenMenuLayoutSchema.parse(layout);
  await db
    .prepare(
      `INSERT INTO crm_studio_settings (tenant_id, menu_layout, updated_at)
       VALUES (?, ?, ${dialectFor(db).utcNow()})
       ON CONFLICT(tenant_id) DO UPDATE SET
         menu_layout=excluded.menu_layout,
         updated_at=excluded.updated_at`,
    )
    .bind(tenant, JSON.stringify(parsed))
    .run();
  return parsed;
}

export async function listActiveScreenNames(db: D1Database, tenant: string) {
  const { results } = await db
    .prepare("SELECT name, config FROM crm_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string; config: string }>();
  return results
    .filter((row) => {
      try {
        const config = JSON.parse(row.config) as {
          studio?: { screen?: { hidden?: boolean } };
        };
        return !config.studio?.screen?.hidden;
      } catch {
        return true;
      }
    })
    .map((row) => row.name);
}

export async function reconcileStoredMenuLayout(
  db: D1Database,
  tenant: string,
): Promise<ScreenMenuLayout | null> {
  const activeNames = await listActiveScreenNames(db, tenant);
  const stored = await getMenuLayout(db, tenant);
  const reconciled = reconcileMenuLayout(stored, activeNames);
  if (
    stored &&
    JSON.stringify(stored.blocks) === JSON.stringify(reconciled.blocks)
  ) {
    return stored;
  }
  if (!reconciled.blocks.length) return null;
  await saveMenuLayout(db, tenant, reconciled);
  return reconciled;
}

const reorderBodySchema = z.union([
  z.object({ names: z.array(z.string().min(1)).min(1) }),
  z.object({ layout: screenMenuLayoutSchema }),
]);

export async function applyMenuLayout(
  db: D1Database,
  tenant: string,
  layout: ScreenMenuLayout,
) {
  const activeNames = await listActiveScreenNames(db, tenant);
  const reconciled = reconcileMenuLayout(layout, activeNames);
  await saveMenuLayout(db, tenant, reconciled);
  const names = screenNamesFromLayout(reconciled);
  if (names.length) await reorderScreens(db, tenant, names);
  return reconciled;
}

export function registerMenuLayout(app: Hono<Env>) {
  app.get("/api/studio/menu-layout", async (c) => {
    const layout = await reconcileStoredMenuLayout(c.env.DB, c.get("tenant"));
    return c.json({ data: layout });
  });

  app.put("/api/studio/menu-layout", async (c) => {
    const body = screenMenuLayoutSchema.parse(await c.req.json());
    const layout = await applyMenuLayout(c.env.DB, c.get("tenant"), body);
    return c.json({ data: layout });
  });

  app.put("/api/objects/reorder", async (c) => {
    const body = reorderBodySchema.parse(await c.req.json());
    if ("layout" in body) {
      const layout = await applyMenuLayout(
        c.env.DB,
        c.get("tenant"),
        body.layout,
      );
      return c.json({ data: layout });
    }
    const updated = await reorderScreens(c.env.DB, c.get("tenant"), body.names);
    return c.json({ data: updated });
  });
}
