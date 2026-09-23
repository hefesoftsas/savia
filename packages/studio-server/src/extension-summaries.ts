import type { Hono } from "hono";
import type { Env } from "./context";
import { fail } from "./context";
import { assertExtensionObjectRequirement } from "./extension-object-requirements";
import {
  extensionObjectRequirementsFor,
  isExtensionAvailable,
  type ExtensionOptions,
} from "./extensions";
import { getObject } from "./services";

export type ExtensionSummaryProvider = {
  id: string;
  objectName: string;
  summarize(records: readonly Record<string, unknown>[], asOf: string): unknown;
};

function providersFor(options: ExtensionOptions) {
  const providers = new Map<string, ExtensionSummaryProvider>();
  for (const provider of options.extensionSummaryProviders ?? []) {
    if (!options.extensionRegistry?.get(provider.id))
      throw new Error(
        `Summary provider ${provider.id} is not included in the extension registry.`,
      );
    if (providers.has(provider.id))
      throw new Error(`Summary provider ${provider.id} is duplicated.`);
    providers.set(provider.id, provider);
  }
  return providers;
}

function parseRecords(
  rows: readonly { data: string }[],
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        records.push(parsed as Record<string, unknown>);
    } catch {}
  }
  return records;
}

export function registerExtensionSummaries(
  app: Hono<Env>,
  options: ExtensionOptions = {},
) {
  const providers = providersFor(options);
  const objectRequirements = extensionObjectRequirementsFor(options);
  if (!providers.size) return;

  app.get("/api/extensions/:id/summary", async (c) => {
    const id = c.req.param("id");
    const provider = providers.get(id);
    if (!provider) return fail("Esta extensión no publica un resumen.", 404);
    if (
      !(await isExtensionAvailable(
        c.env.DB,
        c.get("tenant"),
        id,
        options.extensionRegistry,
      ))
    )
      return fail("La extensión no está activa en este espacio.", 404);

    const requirement = objectRequirements.get(id);
    if (requirement)
      await assertExtensionObjectRequirement(
        c.env.DB,
        c.get("tenant"),
        requirement,
      );
    else await getObject(c.env.DB, c.get("tenant"), provider.objectName);
    const rows = await c.env.DB.prepare(
      "SELECT data FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL",
    )
      .bind(c.get("tenant"), provider.objectName)
      .all<{ data: string }>();
    return c.json({
      data: provider.summarize(
        parseRecords(rows.results),
        new Date().toISOString(),
      ),
    });
  });
}
