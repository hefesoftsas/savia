import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { canManageWhatsappAssistant } from "./assistant-routes";
import { channelConfigurationSchema } from "./channel-contracts";
import { WhatsappChannelRepository } from "./channel-repository";

const dataSchema = z.object({
  configuration: channelConfigurationSchema.nullable(),
  employees: z.array(z.object({ id: z.string(), name: z.string() })),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
});
const get = createRoute({
  method: "get",
  path: "/v1/whatsapp/channel",
  tags: ["WhatsApp"],
  summary: "Read task roster and staff registry",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    query: z.object({ agencyId: z.coerce.number().int().positive() }),
  },
  responses: {
    200: {
      description: "Channel configuration",
      content: {
        "application/json": { schema: z.object({ data: dataSchema }) },
      },
    },
    403: { description: "Tenant administrator required" },
    409: { description: "Sender unavailable" },
  },
});
const put = createRoute({
  method: "put",
  path: "/v1/whatsapp/channel",
  tags: ["WhatsApp"],
  summary: "Configure published tasks and staff phone assignments",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            agencyId: z.number().int().positive(),
            configuration: channelConfigurationSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: {
        "application/json": {
          schema: z.object({ data: channelConfigurationSchema }),
        },
      },
    },
    403: { description: "Tenant administrator required" },
    409: {
      description: "Sender unavailable or a legacy message is processing",
    },
    422: { description: "Invalid employee or staff assignment" },
  },
});

export function registerWhatsappChannelRoutes(
  app: OpenAPIHono,
  db: D1Database,
) {
  const repo = new WhatsappChannelRepository(db);
  const connection = (tenant: number) =>
    db
      .prepare(
        "SELECT id FROM tenant_whatsapp_connections WHERE tenant_id=? AND disconnected_at IS NULL",
      )
      .bind(tenant)
      .first<{ id: string }>();
  app.openapi(get, async (c) => {
    const tenant = c.req.valid("query").agencyId;
    if (!canManageWhatsappAssistant(actorFromContext(c), tenant))
      return c.json({ error: "Tenant administrator required" }, 403);
    const sender = await connection(tenant);
    if (!sender) return c.json({ error: "Sender unavailable" }, 409);
    const [settings, employees, members] = await Promise.all([
      repo.settings(tenant, sender.id),
      db
        .prepare(
          "SELECT id,name FROM assistant_virtual_employees WHERE agency_id=? AND status='active' ORDER BY name",
        )
        .bind(tenant)
        .all<{ id: string; name: string }>(),
      db
        .prepare(
          "SELECT p.id,p.display_name AS name FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1 ORDER BY p.display_name",
        )
        .bind(tenant)
        .all<{ id: string; name: string }>(),
    ]);
    return c.json(
      {
        data: {
          configuration: settings?.config ?? null,
          employees: employees.results,
          members: members.results,
        },
      },
      200,
    );
  });
  app.openapi(put, async (c) => {
    const { agencyId: tenant, configuration } = c.req.valid("json");
    const actor = actorFromContext(c);
    if (!canManageWhatsappAssistant(actor, tenant))
      return c.json({ error: "Tenant administrator required" }, 403);
    const sender = await connection(tenant);
    if (!sender) return c.json({ error: "Sender unavailable" }, 409);
    const old = await repo.settings(tenant, sender.id);
    const cutover = configuration.routingEnabled && !old?.config.routingEnabled;
    if (
      cutover &&
      (await db
        .prepare(
          "SELECT message_id FROM whatsapp_inbox WHERE connection_id=? AND state IN ('generating','responding')",
        )
        .bind(sender.id)
        .first())
    )
      return c.json(
        { error: "A legacy message is processing; save after it finishes" },
        409,
      );
    try {
      await repo.configure(
        tenant,
        sender.id,
        configuration,
        actor.principal.id,
      );
      if (cutover)
        await db
          .prepare(
            "UPDATE whatsapp_inbox SET state='failed',failure_code='routing_cutover' WHERE connection_id=? AND state='pending'",
          )
          .bind(sender.id)
          .run();
      return c.json({ data: configuration }, 200);
    } catch {
      return c.json({ error: "Employee or staff assignment unavailable" }, 422);
    }
  });
}
