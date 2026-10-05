import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import type { AppActor } from "../auth/types";
import { WhatsappInboundRepository } from "./inbound-repository";

const tenantQuery = z.object({ agencyId: z.coerce.number().int().positive() });
const contact = z
  .string()
  .max(32)
  .transform((value) => value.replace(/\s/g, "").replace(/^\+/, ""))
  .pipe(z.string().regex(/^[1-9]\d{6,14}$/));
const settingsInput = z
  .object({
    agencyId: z.number().int().positive(),
    employeeId: z.string().trim().min(1).max(255),
    enabled: z.boolean(),
    allowedContacts: z
      .array(contact)
      .max(20)
      .transform((values) => [...new Set(values)]),
  })
  .refine(
    (input) => !input.enabled || input.allowedContacts.length > 0,
    "Enabled assistants require an explicit contact allowlist",
  );
const settingsOutput = z.object({
  connectionId: z.string(),
  tenantId: z.number(),
  employeeId: z.string(),
  enabled: z.boolean(),
  allowedContacts: z.array(z.string()),
  updatedBy: z.string(),
});
const responseSchema = z.object({
  data: z.object({
    settings: settingsOutput.nullable(),
    employees: z.array(z.object({ id: z.string(), name: z.string() })),
    webhookReady: z.boolean(),
  }),
});

export function canManageWhatsappAssistant(
  actor: AppActor,
  tenantId: number,
): boolean {
  if (actor.credential?.kind === "personal-api-key") return false;
  return (
    actor.globalRoles.includes("platform_admin") ||
    actor.memberships.some(
      (membership) =>
        membership.isActive &&
        (membership.tenantId ?? membership.agencyId) === tenantId &&
        ["tenant_admin", "agency_admin"].includes(membership.role),
    )
  );
}

const getRoute = createRoute({
  method: "get",
  path: "/v1/whatsapp/assistant",
  tags: ["WhatsApp"],
  summary: "Read the tenant's WhatsApp assistant binding",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: tenantQuery },
  responses: {
    200: {
      description: "Tenant assistant settings",
      content: { "application/json": { schema: responseSchema } },
    },
    403: { description: "Tenant administrator required" },
  },
});
const putRoute = createRoute({
  method: "put",
  path: "/v1/whatsapp/assistant",
  tags: ["WhatsApp"],
  summary: "Configure the tenant's WhatsApp assistant and pilot contacts",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: settingsInput } },
    },
  },
  responses: {
    200: {
      description: "Updated settings",
      content: {
        "application/json": { schema: z.object({ data: settingsOutput }) },
      },
    },
    403: { description: "Tenant administrator required" },
    409: { description: "A connected sender is required" },
    422: { description: "The employee is unavailable for this tenant" },
    503: { description: "Webhook secrets are not configured" },
  },
});

export function registerWhatsappAssistantRoutes(
  app: OpenAPIHono,
  db: D1Database,
  webhookReady = false,
) {
  const repository = new WhatsappInboundRepository(db);
  app.openapi(getRoute, async (context) => {
    const tenantId = context.req.valid("query").agencyId;
    if (!canManageWhatsappAssistant(actorFromContext(context), tenantId))
      return context.json({ error: "Tenant administrator required" }, 403);
    const employees = await db
      .prepare(
        "SELECT id, name FROM assistant_virtual_employees WHERE agency_id = ? AND status = 'active' ORDER BY name",
      )
      .bind(tenantId)
      .all<{ id: string; name: string }>();
    return context.json(
      {
        data: {
          settings: (await repository.getSettings(tenantId)) ?? null,
          employees: employees.results,
          webhookReady,
        },
      },
      200,
    );
  });
  app.openapi(putRoute, async (context) => {
    const input = context.req.valid("json");
    const actor = actorFromContext(context);
    if (!canManageWhatsappAssistant(actor, input.agencyId))
      return context.json({ error: "Tenant administrator required" }, 403);
    if (input.enabled && !webhookReady)
      return context.json(
        { error: "WhatsApp webhook secrets are not configured" },
        503,
      );
    const employee = await db
      .prepare(
        "SELECT id FROM assistant_virtual_employees WHERE id = ? AND agency_id = ? AND (? = 0 OR status = 'active')",
      )
      .bind(input.employeeId, input.agencyId, input.enabled ? 1 : 0)
      .first();
    if (!employee)
      return context.json(
        { error: "Employee unavailable for this tenant" },
        422,
      );
    const existing = !input.enabled
      ? await repository.getSettings(input.agencyId)
      : undefined;
    const connection = existing
      ? { id: existing.connectionId }
      : await db
          .prepare(
            "SELECT c.id FROM tenant_whatsapp_connections c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ? AND c.disconnected_at IS NULL AND t.is_active = 1 AND (? = 0 OR (c.status = 'connected' AND c.phone_number_id IS NOT NULL AND c.waba_id IS NOT NULL))",
          )
          .bind(input.agencyId, input.enabled ? 1 : 0)
          .first<{ id: string }>();
    if (!connection)
      return context.json({ error: "A connected sender is required" }, 409);
    const settings = {
      connectionId: connection.id,
      tenantId: input.agencyId,
      employeeId: input.employeeId,
      enabled: input.enabled,
      allowedContacts: input.allowedContacts,
      updatedBy: actor.principal.id,
    };
    await repository.configure(settings);
    return context.json({ data: settings }, 200);
  });
}
