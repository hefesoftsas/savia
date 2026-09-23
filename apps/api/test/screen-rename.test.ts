import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { makeConfig } from "@savia/studio-shared/metadata";
import {
  patchScreenMeta,
  screenMetaPatchSchema,
} from "@savia/studio-server/schema";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
it("validates and trims screen labels", () => {
  expect(
    screenMetaPatchSchema.parse({ label: "  Clientes  ", version: 1 }),
  ).toEqual({ label: "Clientes", version: 1 });
  for (const label of ["", "   ", "x".repeat(101)])
    expect(screenMetaPatchSchema.safeParse({ label }).success).toBe(false);
});
it("renames a source page without changing its name, schema or binding and rejects stale writes", async () => {
  const config = {
    ...makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    studio: {
      collection: { sourceId: "hubspot", resource: "contacts" },
      screen: { createMode: "page" },
    },
  };
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      "rename-test",
      "contacts",
      "Clientes HubSpot",
      "",
      JSON.stringify(config),
      7,
    )
    .run();
  const result = await patchScreenMeta(
    env.DB,
    "rename-test",
    "contacts",
    screenMetaPatchSchema.parse({ label: " Clientes " }),
    7,
  );
  expect(result).toMatchObject({
    name: "contacts",
    label: "Clientes",
    version: 8,
    config,
  });
  expect(
    await env.DB.prepare(
      "SELECT label,config,version FROM studio_objects WHERE tenant_id=? AND name=?",
    )
      .bind("rename-test", "contacts")
      .first(),
  ).toEqual({ label: "Clientes", config: JSON.stringify(config), version: 8 });
  await expect(
    patchScreenMeta(
      env.DB,
      "rename-test",
      "contacts",
      screenMetaPatchSchema.parse({ label: "Otro" }),
      7,
    ),
  ).rejects.toMatchObject({ status: 409 });
});

it("allows renaming a managed page while protecting its menu placement", async () => {
  const config = {
    ...makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
    studio: { business: "managed-customer" },
  };
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      "managed-rename",
      "customers",
      "Clientes",
      "",
      JSON.stringify(config),
      1,
    )
    .run();
  const result = await patchScreenMeta(
    env.DB,
    "managed-rename",
    "customers",
    screenMetaPatchSchema.parse({ label: "Mis clientes" }),
    1,
  );
  expect(result).toMatchObject({ label: "Mis clientes", config, version: 2 });
  await expect(
    patchScreenMeta(env.DB, "managed-rename", "customers", { hidden: true }, 2),
  ).rejects.toMatchObject({ status: 422 });
});
