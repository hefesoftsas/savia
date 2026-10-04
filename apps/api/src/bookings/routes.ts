import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  bookingAgendaEntrySchema,
  bookingAgendaRangeSchema,
} from "@savia/studio-shared/booking-agenda-contracts";
import { actorFromContext } from "../auth/middleware";
import { SAVIA_READ_SCOPE } from "../auth/oauth-resource";
import { BookingAgenda } from "./agenda";
import { authorizeBranding } from "../tenant-branding/service";
import {
  captchaConfiguration,
  captchaIdentity,
  publicFormChallenge,
  verifyCaptcha,
  type CaptchaOptions,
} from "../public-forms/captcha";
import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../personal-integrations/contracts";
import { createBookingCalendarAdapter } from "./calendar";
import {
  bootstrapSchema,
  settingsSchema,
  reservationSchema,
  managementBootstrapSchema,
  revisionSchema,
  ownAvailabilitySchema,
  calendarGrantSchema,
  agendaGrantSchema,
  publicBookingSchema,
  slotQuerySchema,
  bookingPublicLinkInputSchema,
  availabilityRangeQuerySchema,
  availabilityRangeSchema,
  publicSlotQuerySchema,
  type BookingSettings,
} from "./contracts";
import {
  resolveBookingLink,
  assertBookingLinkSelection,
  ensureLegacyBookingLink,
  bookingLinkView,
  bookingLinkToken,
  bookingShortCode,
  type BookingLinkRow,
} from "./public-links";
import {
  getPublicAvailability,
  getBookingAvailability,
} from "./public-availability";
import { admitBookingRequest, findBookingAdmission } from "./public-policy";
import { digest, dateInZone, slotsForDate } from "./domain";
import {
  candidates,
  readSettings,
  saveSettings,
  publishedSettings,
  readGrant,
  nativeBusy,
  findRequest,
  createReservation,
  managedBooking,
  reservationView,
  changeReservation,
  readBooking,
  type BookingRow,
} from "./repository";

export type BookingOptions = {
  captcha?: CaptchaOptions;
  nango?: PersonalIntegrationNangoClient;
  calendarSecret?: string;
  shortener?: { shorten(url: string): Promise<string> };
  now?: () => number;
};
const unavailable = () =>
  new HTTPException(503, {
    message:
      "Calendar availability is temporarily unavailable. Reconnect your calendar or try again.",
  });
const conflict = () =>
  new HTTPException(409, {
    message: "That time is no longer available. Choose another time.",
  });
const params = z.object({ tenantId: z.coerce.number().int().positive() });
const objectResponse = z.record(z.string(), z.unknown());
const rangeSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 93 * 86400000,
  );
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success)
    throw new HTTPException(422, {
      message: p.error.issues[0]?.message ?? "Invalid input.",
    });
  return p.data;
}
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Send a JSON object." });
  }
  return parsed(schema, value);
}
function origin(options: BookingOptions) {
  return options.captcha?.publicOrigin ?? "http://localhost:5173";
}
const pageUrl = (options: BookingOptions, token: string) =>
  new URL(`/public/bookings/${token}`, origin(options)).toString();
const manageUrl = (options: BookingOptions, token: string) =>
  new URL(`/public/bookings/manage/${token}`, origin(options)).toString();
export function registerBookingRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options: BookingOptions = {},
) {
  const now = options.now ?? Date.now;
  const agenda = new BookingAgenda(db, {
    secret: options.calendarSecret,
    nango: options.nango,
  });
  const calendar = options.nango
    ? createBookingCalendarAdapter(db, options.nango)
    : undefined;
  const captcha = {
    ...options.captcha,
    rateLimiter: options.captcha?.rateLimiter ?? {
      limit: async () => ({ success: true }),
    },
  };
  const limitBody = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "Request is too large." }, 413),
  });
  app.use("/v1/tenants/:tenantId/booking", limitBody);
  app.use("/v1/tenants/:tenantId/booking/*", limitBody);
  app.use(
    "/api/public/bookings/*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: "Request is too large." }, 413),
    }),
  );
  app.use("/api/public/bookings/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    const window = Math.floor(now() / 60000),
      ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const bucket = await digest(
      `${window}:${ip}:${c.req.method === "GET" ? "read" : "write"}:${c.req.path.split("/")[4] === "manage" ? c.req.path.split("/")[5] : c.req.path.split("/")[4]}`,
    );
    const row = await db
      .prepare(
        "INSERT INTO tenant_booking_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=tenant_booking_rate_limits.count+1 RETURNING count",
      )
      .bind(bucket, now() + 120000)
      .first<{ count: number }>();
    if (!row || row.count > (c.req.method === "GET" ? 120 : 20))
      throw new HTTPException(429, {
        message: "Too many booking requests. Try again shortly.",
      });
    if (
      options.captcha?.rateLimiter &&
      !(
        await options.captcha.rateLimiter.limit({
          key: `booking:${await digest(ip)}`,
        })
      ).success
    )
      throw new HTTPException(429, { message: "Too many requests." });
    await next();
  });
  function route(
    method: "get" | "put" | "post" | "delete",
    path: string,
    handler: (c: Context) => Promise<Response>,
    input?: z.ZodType,
    query?: z.ZodObject,
    response: z.ZodType = objectResponse,
    created = false,
  ) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method,
        path,
        tags: ["Booking"],
        security: path.startsWith("/api/public") ? [] : undefined,
        request: {
          params: z.object({
            ...(path.includes("{tenantId}") ? params.shape : {}),
            ...(path.includes("{id}") ? { id: z.string().uuid() } : {}),
            ...(path.includes("{token}") ? { token: z.string() } : {}),
          }),
          ...(input
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: input } },
                },
              }
            : {}),
          ...(query ? { query } : {}),
        },
        responses: {
          200: {
            description: "Booking response",
            content: {
              "application/json": { schema: z.object({ data: response }) },
            },
          },
          ...(created
            ? {
                201: {
                  description: "Confirmed reservation",
                  content: {
                    "application/json": {
                      schema: z.object({ data: response }),
                    },
                  },
                },
              }
            : {}),
          400: { description: "Malformed input" },
          403: { description: "Access or verification denied" },
          404: { description: "Unavailable resource" },
          409: { description: "Slot or revision conflict" },
          422: { description: "Invalid input" },
          429: { description: "Request limit" },
          503: { description: "Provider unavailable" },
        },
      }),
    );
    app.on(method.toUpperCase(), path.replace(/\{([^}]+)\}/g, ":$1"), handler);
  }
  const tenant = (c: Context) =>
    parsed(params, { tenantId: c.req.param("tenantId") }).tenantId;
  route(
    "get",
    "/v1/personal-integrations/bookings",
    async (c) => {
      c.header("Cache-Control", "no-store");
      const actor = actorFromContext(c);
      if (
        !actor.principal.isActive ||
        actor.credential?.kind === "personal-api-key" ||
        (actor.credential?.kind === "oauth" &&
          !actor.credential.scopes.includes(SAVIA_READ_SCOPE))
      )
        throw new HTTPException(403, {
          message: "Booking agenda access denied.",
        });
      const range = parsed(bookingAgendaRangeSchema, c.req.query());
      const from = new Date(range.from).toISOString();
      const to = new Date(range.to).toISOString();
      const result = await db
        .prepare(
          `SELECT
             b.id,
             b.tenant_id AS "tenantId",
             t.id_slug AS "tenantSlug",
             t.name AS "tenantName",
             b.service_name AS "serviceName",
             b.professional_name AS "professionalName",
             b.customer_name AS "customerName",
             b.customer_email AS "customerEmail",
             b.starts_at AS "startsAt",
             b.ends_at AS "endsAt",
             b.status,
             b.version,
             b.calendar_provider AS "calendarProvider",
             b.external_id AS "externalId",
             b.calendar_connection_id AS "savedConnectionId",
             c.id AS "activeConnectionId",
             s.config AS "settingsConfig"
           FROM tenant_bookings b
           JOIN tenants t ON t.id = b.tenant_id
           LEFT JOIN tenant_booking_settings s ON s.tenant_id = b.tenant_id
           LEFT JOIN personal_integration_connections c
             ON c.id = b.calendar_connection_id
            AND c.principal_id = b.principal_id
            AND c.provider = b.calendar_provider
            AND c.disconnected_at IS NULL
            AND c.id = (
              SELECT active_connection.id
              FROM personal_integration_connections active_connection
              WHERE active_connection.principal_id = b.principal_id
                AND active_connection.provider = b.calendar_provider
                AND active_connection.disconnected_at IS NULL
              ORDER BY active_connection.updated_at DESC
              LIMIT 1
            )
           WHERE b.principal_id = ?
             AND b.tenant_id IN (
               SELECT m.tenant_id
               FROM identity_tenant_membership m
               JOIN identity_principal p ON p.id = m.principal_id
               WHERE m.principal_id = ?
                 AND m.is_active = 1
                 AND p.is_active = 1
             )
             AND b.status = 'confirmed'
             AND t.kind = 'commercial'
             AND b.starts_at < ?
             AND b.ends_at > ?
           ORDER BY b.starts_at, b.id
           LIMIT 2001`,
        )
        .bind(actor.principal.id, actor.principal.id, to, from)
        .all<{
          id: string;
          tenantId: number;
          tenantSlug: string;
          tenantName: string;
          serviceName: string;
          professionalName: string;
          customerName: string;
          customerEmail: string;
          startsAt: string;
          endsAt: string;
          status: "confirmed";
          version: number;
          calendarProvider: "google_calendar" | "outlook" | null;
          externalId: string | null;
          savedConnectionId: string | null;
          activeConnectionId: string | null;
          settingsConfig: string | null;
        }>();
      if (result.results.length > 2000)
        throw new HTTPException(422, {
          message:
            "The booking agenda is too large. Request a shorter date range.",
        });
      const data = result.results.map((row) => {
        let timeZone = "UTC";
        if (row.settingsConfig) {
          try {
            const configured = JSON.parse(row.settingsConfig).timeZone;
            if (typeof configured === "string") {
              const valid =
                bookingAgendaEntrySchema.shape.timeZone.safeParse(configured);
              if (valid.success) timeZone = valid.data;
            }
          } catch {
            // Keep the safe UTC fallback when persisted settings are malformed.
          }
        }
        return {
          id: row.id,
          tenantId: row.tenantId,
          tenantSlug: row.tenantSlug,
          tenantName: row.tenantName,
          serviceName: row.serviceName,
          professionalName: row.professionalName,
          customerName: row.customerName,
          customerEmail: row.customerEmail,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          timeZone,
          status: row.status,
          version: row.version,
          externalEvent:
            row.savedConnectionId &&
            row.activeConnectionId === row.savedConnectionId &&
            row.calendarProvider &&
            row.externalId
              ? { provider: row.calendarProvider, id: row.externalId }
              : null,
        };
      });
      return c.json({ data });
    },
    undefined,
    bookingAgendaRangeSchema,
    z.array(bookingAgendaEntrySchema),
  );
  async function authorizeHistory(c: Context, id: number) {
    const actor = actorFromContext(c),
      platform = actor.globalRoles.includes("platform_admin"),
      own = actor.memberships.filter(
        (m) => m.isActive && (m.tenantId ?? m.agencyId) === id,
      );
    if (!actor.principal.isActive || (!platform && !own.length))
      throw new HTTPException(403, { message: "Reservation access denied." });
    const tenant = await db
      .prepare("SELECT 1 FROM tenants WHERE id=? AND kind='commercial'")
      .bind(id)
      .first();
    if (!tenant)
      throw new HTTPException(404, { message: "Tenant unavailable." });
    return {
      canManage:
        platform ||
        own.some((m) => ["tenant_admin", "agency_admin"].includes(m.role)),
    };
  }
  async function bootstrap(c: Context, id: number) {
    const actor = actorFromContext(c),
      auth = await authorizeBranding(db, actor, id),
      state = await readSettings(db, id, auth.tenant.name),
      eligible = await candidates(db, id);
    const grant = await readGrant(db, id, actor.principal.id);
    const connection = grant
      ? await createPersonalIntegrationRepository(db).findActiveConnection(
          actor.principal.id,
          grant.provider,
        )
      : null;
    return {
      settings: auth.canManage
        ? state.settings
        : {
            ...state.settings,
            professionals: state.settings.professionals.filter(
              (p) => p.principalId === actor.principal.id,
            ),
            services: state.settings.services
              .filter((s) =>
                s.professionalIds.some((p) =>
                  state.settings.professionals.some(
                    (x) => x.id === p && x.principalId === actor.principal.id,
                  ),
                ),
              )
              .map((s) => ({
                ...s,
                professionalIds: s.professionalIds.filter((p) =>
                  state.settings.professionals.some(
                    (x) => x.id === p && x.principalId === actor.principal.id,
                  ),
                ),
              })),
          },
      candidates: auth.canManage
        ? eligible
        : eligible.filter((p) => p.principalId === actor.principal.id),
      canManage: auth.canManage,
      principalId: actor.principal.id,
      agenda: await agenda.status(id, actor.principal.id),
      publicUrl: state.publicToken ? pageUrl(options, state.publicToken) : null,
      calendar: {
        provider: grant?.provider ?? null,
        status: !grant
          ? "not_connected"
          : connection?.id === grant.connection_id &&
              connection.status === "connected"
            ? "connected"
            : "reconnect_required",
      },
    };
  }
  async function loadBusy(
    tenantId: number,
    principalId: string,
    from: string,
    to: string,
    exceptId?: string,
    refresh = false,
  ) {
    const busy = await nativeBusy(
      db,
      tenantId,
      principalId,
      from,
      to,
      exceptId,
    );
    const grant = await readGrant(db, tenantId, principalId);
    const currentBooking = exceptId
      ? await readBooking(db, tenantId, exceptId)
      : null;
    const excludeEvent =
      currentBooking?.calendar_provider &&
      currentBooking.external_id &&
      currentBooking.calendar_connection_id
        ? {
            provider: currentBooking.calendar_provider,
            id: currentBooking.external_id,
            connectionId: currentBooking.calendar_connection_id,
          }
        : undefined;
    if (grant) {
      if (!calendar) throw unavailable();
      try {
        busy.push(
          ...(await calendar.busy({
            principalId,
            provider: grant.provider,
            connectionId: grant.connection_id,
            from,
            to,
            ...(excludeEvent?.provider === grant.provider &&
            excludeEvent.connectionId === grant.connection_id
              ? { excludeExternalId: excludeEvent.id }
              : {}),
          })),
        );
      } catch {
        throw unavailable();
      }
    }
    try {
      busy.push(
        ...(await agenda.busy({
          tenantId,
          principalId,
          from,
          to,
          refresh,
          excludeEvent,
          skipConnectionId: grant?.connection_id,
        })),
      );
    } catch {
      throw unavailable();
    }
    return { busy, grant };
  }
  async function slots(
    state: { tenantId: number; settings: BookingSettings },
    query: z.infer<typeof slotQuerySchema>,
    exceptId?: string,
    refresh = false,
  ) {
    const professional = state.settings.professionals.find(
        (p) => p.id === query.professionalId && p.enabled,
      ),
      service = state.settings.services.find(
        (s) =>
          s.id === query.serviceId &&
          s.enabled &&
          s.professionalIds.includes(query.professionalId),
      );
    if (!professional || !service)
      throw new HTTPException(404, {
        message: "Service or professional unavailable.",
      });
    const eligible = await candidates(db, state.tenantId);
    if (!eligible.some((p) => p.principalId === professional.principalId))
      throw conflict();
    const center = Date.parse(`${query.date}T12:00:00Z`);
    if (Math.abs(center - now()) > 183 * 86400000)
      throw new HTTPException(422, {
        message: "Choose a date in the booking horizon.",
      });
    const from = new Date(center - 36 * 3600000).toISOString(),
      to = new Date(center + 36 * 3600000).toISOString();
    const { busy, grant } = await loadBusy(
      state.tenantId,
      professional.principalId,
      from,
      to,
      exceptId,
      refresh,
    );
    return {
      professional,
      service,
      grant,
      busy,
      professionalName: eligible.find(
        (p) => p.principalId === professional.principalId,
      )!.displayName,
      slots: slotsForDate(
        state.settings,
        professional,
        service,
        query.date,
        busy,
        now(),
      ),
      timeZone: state.settings.timeZone,
    };
  }
  const root = "/v1/tenants/{tenantId}/booking";
  route(
    "put",
    `${root}/agenda`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c);
      await authorizeBranding(db, actor, id);
      const input = await body(c, agendaGrantSchema);
      const state = await readSettings(db, id);
      if (
        input.enabled &&
        !state.settings.professionals.some(
          (p) => p.principalId === actor.principal.id && p.enabled,
        )
      )
        throw new HTTPException(403, {
          message: "An enabled professional is required.",
        });
      await agenda.authorize(id, actor.principal.id, input.enabled);
      return c.json({ data: await bootstrap(c, id) });
    },
    agendaGrantSchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "get",
    root,
    async (c) => c.json({ data: await bootstrap(c, tenant(c)) }),
    undefined,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    root,
    async (c) => {
      const id = tenant(c);
      await authorizeBranding(db, actorFromContext(c), id, true);
      await saveSettings(db, id, await body(c, settingsSchema));
      return c.json({ data: await bootstrap(c, id) });
    },
    settingsSchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    `${root}/availability`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c);
      await authorizeBranding(db, actor, id);
      const input = await body(c, ownAvailabilitySchema),
        state = await readSettings(db, id);
      if (
        !state.settings.professionals.some(
          (p) => p.principalId === actor.principal.id && p.enabled,
        )
      )
        throw new HTTPException(403, {
          message: "An enabled professional is required.",
        });
      await saveSettings(
        db,
        id,
        parsed(settingsSchema, {
          ...state.settings,
          version: input.version,
          professionals: state.settings.professionals.map((p) =>
            p.principalId === actor.principal.id
              ? { ...p, weekly: input.weekly, exceptions: input.exceptions }
              : p,
          ),
        }),
      );
      return c.json({ data: await bootstrap(c, id) });
    },
    ownAvailabilitySchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "put",
    `${root}/calendar`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c);
      await authorizeBranding(db, actor, id);
      const input = await body(c, calendarGrantSchema);
      if (input.provider === null) {
        await db
          .prepare(
            "DELETE FROM tenant_booking_calendar_grants WHERE tenant_id=? AND principal_id=?",
          )
          .bind(id, actor.principal.id)
          .run();
      } else {
        const state = await readSettings(db, id);
        if (
          !state.settings.professionals.some(
            (p) => p.principalId === actor.principal.id && p.enabled,
          )
        )
          throw new HTTPException(403, {
            message: "An enabled professional is required.",
          });
        const connection = await createPersonalIntegrationRepository(
          db,
        ).findActiveConnection(actor.principal.id, input.provider);
        if (!calendar || !connection || connection.status !== "connected")
          throw unavailable();
        await db
          .prepare(
            "INSERT INTO tenant_booking_calendar_grants(tenant_id,principal_id,provider,connection_id) VALUES(?,?,?,?) ON CONFLICT(tenant_id,principal_id) DO UPDATE SET provider=excluded.provider,connection_id=excluded.connection_id",
          )
          .bind(id, actor.principal.id, input.provider, connection.id)
          .run();
      }
      return c.json({ data: await bootstrap(c, id) });
    },
    calendarGrantSchema,
    undefined,
    bootstrapSchema,
  );
  route(
    "get",
    `${root}/reservations`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c),
        auth = await authorizeHistory(c, id);
      const range = parsed(rangeSchema, {
        from:
          c.req.query("from") ?? new Date(now() - 7 * 86400000).toISOString(),
        to: c.req.query("to") ?? new Date(now() + 60 * 86400000).toISOString(),
      });
      const r = await db
        .prepare(
          `SELECT * FROM tenant_bookings WHERE tenant_id=? AND starts_at>=? AND starts_at<? ${auth.canManage ? "" : "AND principal_id=?"} ORDER BY starts_at LIMIT 500`,
        )
        .bind(
          id,
          new Date(range.from).toISOString(),
          new Date(range.to).toISOString(),
          ...(auth.canManage ? [] : [actor.principal.id]),
        )
        .all<BookingRow>();
      const rows = await Promise.all(
        r.results.map(async (row) => {
          const reservation = await reservationView(db, row);
          const grant = await readGrant(db, id, row.principal_id);
          const connection = grant
            ? await createPersonalIntegrationRepository(
                db,
              ).findActiveConnection(row.principal_id, grant.provider)
            : null;
          return {
            ...reservation,
            canGenerateConference:
              row.status === "confirmed" &&
              !["ready", "pending", "unsupported"].includes(
                reservation.conference?.status ?? "",
              ) &&
              Boolean(
                connection?.status === "connected" &&
                connection.id === grant?.connection_id &&
                (!row.calendar_provider ||
                  (row.calendar_provider === grant?.provider &&
                    row.calendar_connection_id === grant?.connection_id)),
              ),
          };
        }),
      );
      return c.json({
        data: rows,
      });
    },
    undefined,
    rangeSchema,
    z.array(reservationSchema),
  );
  route(
    "post",
    `${root}/reservations/{id}/conference`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c),
        auth = await authorizeHistory(c, id),
        input = await body(c, revisionSchema),
        row = await readBooking(db, id, c.req.param("id")!);
      if (!row)
        throw new HTTPException(404, { message: "Reservation unavailable." });
      if (!auth.canManage && row.principal_id !== actor.principal.id)
        throw new HTTPException(403, { message: "Reservation access denied." });
      if (row.status !== "confirmed" || row.version !== input.version)
        throw conflict();

      const current = await reservationView(db, row);
      if (
        current.conference?.status === "ready" ||
        current.conference?.status === "pending" ||
        current.conference?.status === "unsupported"
      )
        return c.json({ data: current });

      const professionalState = await readSettings(db, id);
      const professionalActive = await db
        .prepare(
          "SELECT 1 FROM tenants t JOIN identity_principal p ON p.id=? AND p.is_active=1 JOIN identity_tenant_membership m ON m.tenant_id=t.id AND m.principal_id=p.id AND m.is_active=1 WHERE t.id=? AND t.kind='commercial' AND t.is_active=1",
        )
        .bind(row.principal_id, id)
        .first();
      if (
        !professionalActive ||
        !professionalState.settings.professionals.some(
          (professional) =>
            professional.id === row.professional_id &&
            professional.principalId === row.principal_id &&
            professional.enabled,
        )
      )
        throw new HTTPException(409, {
          message:
            "The assigned professional is no longer eligible for calendar actions.",
        });

      const grant = await readGrant(db, id, row.principal_id);
      if (!grant)
        throw new HTTPException(409, {
          message:
            "Connect an eligible calendar before generating a video link.",
        });
      const connection = await createPersonalIntegrationRepository(
        db,
      ).findActiveConnection(row.principal_id, grant.provider);
      if (
        !connection ||
        connection.status !== "connected" ||
        connection.id !== grant.connection_id
      )
        throw new HTTPException(409, {
          message:
            "Reconnect an eligible calendar before generating a video link.",
        });
      if (
        row.calendar_provider &&
        (row.calendar_provider !== grant.provider ||
          row.calendar_connection_id !== grant.connection_id)
      )
        throw new HTTPException(409, {
          message:
            "Reconnect the calendar used for this reservation before generating a video link.",
        });

      const conferenceProvider =
        grant.provider === "google_calendar" ? "google_meet" : "teams";
      await db.batch([
        db
          .prepare(
            "UPDATE tenant_bookings SET calendar_provider=?,calendar_connection_id=?,conference_provider=?,conference_url=NULL,conference_status='pending' WHERE tenant_id=? AND id=? AND status='confirmed' AND version=? AND (calendar_provider IS NULL OR (calendar_provider=? AND calendar_connection_id=?)) AND (conference_status IS NULL OR conference_status='failed') AND NOT EXISTS(SELECT 1 FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_until>?)",
          )
          .bind(
            grant.provider,
            grant.connection_id,
            conferenceProvider,
            id,
            row.id,
            input.version,
            grant.provider,
            grant.connection_id,
            id,
            row.id,
            now(),
          ),
        db
          .prepare(
            "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,due_at) SELECT ?,?,?,?,'calendar',? WHERE EXISTS(SELECT 1 FROM tenant_bookings WHERE tenant_id=? AND id=? AND status='confirmed' AND version=? AND conference_status='pending') AND NOT EXISTS(SELECT 1 FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_until>?) ON CONFLICT(tenant_id,booking_id,revision,kind) DO UPDATE SET status='pending',attempts=0,due_at=excluded.due_at,lease_until=NULL,lease_token=NULL,error_code=NULL WHERE tenant_booking_jobs.status IN ('failed','skipped','completed')",
          )
          .bind(
            crypto.randomUUID(),
            id,
            row.id,
            row.version,
            now(),
            id,
            row.id,
            row.version,
            id,
            row.id,
            now(),
          ),
      ]);
      const refreshed = await readBooking(db, id, row.id);
      if (
        !refreshed ||
        refreshed.status !== "confirmed" ||
        refreshed.version !== input.version
      )
        throw conflict();
      if (refreshed.conference_status !== "pending")
        throw new HTTPException(409, {
          message:
            "Calendar sync is in progress. Retry generating the video link shortly.",
        });
      return c.json({ data: await reservationView(db, refreshed) });
    },
    revisionSchema,
    undefined,
    reservationSchema,
  );
  route(
    "post",
    `${root}/reservations/{id}/cancel`,
    async (c) => {
      const id = tenant(c),
        actor = actorFromContext(c),
        auth = await authorizeHistory(c, id),
        input = await body(c, revisionSchema),
        row = await readBooking(db, id, c.req.param("id")!);
      if (!row)
        throw new HTTPException(404, { message: "Reservation unavailable." });
      if (!auth.canManage && row.principal_id !== actor.principal.id)
        throw new HTTPException(403, { message: "Reservation access denied." });
      const state = await readSettings(db, id);
      const changed = await changeReservation(db, row, state.settings, {
        version: input.version,
        cancel: true,
      });
      return c.json({ data: await reservationView(db, changed) });
    },
    revisionSchema,
    undefined,
    reservationSchema,
  );
  const linkRoot = `${root}/public-links`;
  async function linkAccess(c: Context) {
    const id = tenant(c),
      auth = await authorizeBranding(db, actorFromContext(c), id),
      state = await readSettings(db, id);
    const own = state.settings.professionals.find(
      (p) => p.principalId === actorFromContext(c).principal.id && p.enabled,
    );
    return { id, auth, state, own, actor: actorFromContext(c) };
  }
  route("get", linkRoot, async (c) => {
    const { id, auth, own } = await linkAccess(c);
    await ensureLegacyBookingLink(db, id);
    let rows = await db
      .prepare(
        "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND deleted_at IS NULL AND (?=1 OR (scope_kind='professional' AND professional_id=?)) ORDER BY legacy DESC,id",
      )
      .bind(id, auth.canManage ? 1 : 0, own?.id ?? "")
      .all<BookingLinkRow>();
    let assignedCode = false;
    for (const link of rows.results) {
      if (link.short_code) continue;
      const code = bookingShortCode();
      const update = await db
        .prepare(
          "UPDATE tenant_booking_public_links SET short_code=? WHERE tenant_id=? AND id=? AND short_code IS NULL AND deleted_at IS NULL",
        )
        .bind(code, id, link.id)
        .run();
      assignedCode ||= update.meta.changes > 0;
    }
    if (assignedCode)
      rows = await db
        .prepare(
          "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND deleted_at IS NULL AND (?=1 OR (scope_kind='professional' AND professional_id=?)) ORDER BY legacy DESC,id",
        )
        .bind(id, auth.canManage ? 1 : 0, own?.id ?? "")
        .all<BookingLinkRow>();
    return c.json({
      data: {
        links: rows.results
          .filter(
            (l) =>
              auth.canManage ||
              (l.scope_kind === "professional" &&
                l.professional_id === own?.id),
          )
          .map((l) => bookingLinkView(l, origin(options))),
      },
    });
  });
  route(
    "post",
    linkRoot,
    async (c) => {
      const { id, auth, state, own, actor } = await linkAccess(c),
        input = await body(c, bookingPublicLinkInputSchema);
      if (
        !auth.canManage &&
        (input.scope.kind !== "professional" ||
          input.scope.professionalId !== own?.id)
      )
        throw new HTTPException(403, {
          message: "Booking link access denied.",
        });
      const eligible = await candidates(db, id);
      const scopedProfessionalId =
        input.scope.kind === "professional" ? input.scope.professionalId : null;
      const professional =
        input.scope.kind === "professional"
          ? state.settings.professionals.find(
              (p) =>
                p.id === scopedProfessionalId &&
                p.enabled &&
                eligible.some((e) => e.principalId === p.principalId),
            )
          : undefined;
      if (
        !state.settings.enabled ||
        !state.settings.published ||
        (input.scope.kind === "professional" && !professional)
      )
        throw new HTTPException(422, {
          message: "Configure and publish booking before sharing.",
        });
      const scopeProfessionals = state.settings.professionals.filter(
        (p) =>
          p.enabled &&
          eligible.some((e) => e.principalId === p.principalId) &&
          (!professional || p.id === professional.id),
      );
      if (
        !state.settings.services.some(
          (service) =>
            service.enabled &&
            (!input.serviceId || service.id === input.serviceId) &&
            service.professionalIds.some((id) =>
              scopeProfessionals.some((p) => p.id === id),
            ),
        )
      )
        throw new HTTPException(422, {
          message:
            "Assign an enabled service to this professional before sharing.",
        });
      const expiresAt =
        input.expiresAt === undefined
          ? new Date(now() + 30 * 86400000).toISOString()
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt).toISOString();
      if (expiresAt && Date.parse(expiresAt) <= now())
        throw new HTTPException(422, { message: "Choose a future expiry." });
      const row: BookingLinkRow = {
        id: crypto.randomUUID(),
        tenant_id: id,
        created_by: actor.principal.id,
        token: bookingLinkToken(),
        scope_kind: input.scope.kind,
        professional_id: professional?.id ?? null,
        service_id: input.serviceId,
        expires_at: expiresAt,
        revoked_at: null,
        daily_limit: input.dailyLimit,
        version: 1,
        legacy: 0,
        short_code: bookingShortCode(),
      };
      await db
        .prepare(
          "INSERT INTO tenant_booking_public_links(id,tenant_id,created_by,token,scope_kind,professional_id,service_id,expires_at,revoked_at,daily_limit,version,legacy,short_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          row.id,
          id,
          row.created_by,
          row.token,
          row.scope_kind,
          row.professional_id,
          row.service_id,
          row.expires_at,
          null,
          row.daily_limit,
          1,
          0,
          row.short_code!,
        )
        .run();
      if (options.shortener) {
        try {
          const shortUrl = await options.shortener.shorten(
            pageUrl(options, row.token),
          );
          await db
            .prepare(
              "UPDATE tenant_booking_public_links SET short_url=? WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND short_url IS NULL",
            )
            .bind(shortUrl, id, row.id)
            .run();
          row.short_url = shortUrl;
        } catch {
          // The persisted Savia-hosted short code remains available.
        }
      }
      return c.json({ data: bookingLinkView(row, origin(options)) }, 201);
    },
    bookingPublicLinkInputSchema,
    undefined,
    objectResponse,
    true,
  );
  route(
    "post",
    `${linkRoot}/{id}/revoke`,
    async (c) => {
      const { id, auth, own } = await linkAccess(c),
        input = await body(c, revisionSchema);
      const link = await db
        .prepare(
          "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND id=? AND deleted_at IS NULL",
        )
        .bind(id, c.req.param("id"))
        .first<BookingLinkRow>();
      if (
        !link ||
        (!auth.canManage &&
          (link.scope_kind !== "professional" ||
            link.professional_id !== own?.id))
      )
        throw new HTTPException(404, { message: "Booking link unavailable." });
      const changed = await db
        .prepare(
          "UPDATE tenant_booking_public_links SET revoked_at=?,version=version+1 WHERE tenant_id=? AND id=? AND version=? AND deleted_at IS NULL RETURNING *",
        )
        .bind(new Date(now()).toISOString(), id, link.id, input.version)
        .first<BookingLinkRow>();
      if (!changed)
        throw new HTTPException(409, {
          message: "The link changed. Refresh and try again.",
        });
      return c.json({ data: bookingLinkView(changed, origin(options)) });
    },
    revisionSchema,
  );
  route("post", `${linkRoot}/{id}/short-url`, async (c) => {
    const { id, auth, own } = await linkAccess(c);
    const link = await db
      .prepare(
        "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
      )
      .bind(id, c.req.param("id"), new Date(now()).toISOString())
      .first<BookingLinkRow>();
    if (
      !link ||
      (!auth.canManage &&
        (link.scope_kind !== "professional" ||
          link.professional_id !== own?.id))
    )
      throw new HTTPException(404, { message: "Booking link unavailable." });
    if (link.short_url) return c.json({ data: { shortUrl: link.short_url } });
    if (options.shortener) {
      try {
        const shortUrl = await options.shortener.shorten(
          pageUrl(options, link.token),
        );
        await db
          .prepare(
            "UPDATE tenant_booking_public_links SET short_url=? WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND short_url IS NULL",
          )
          .bind(shortUrl, id, link.id)
          .run();
        const saved = await db
          .prepare(
            "SELECT short_url FROM tenant_booking_public_links WHERE tenant_id=? AND id=? AND deleted_at IS NULL",
          )
          .bind(id, link.id)
          .first<{ short_url: string | null }>();
        if (saved?.short_url)
          return c.json({ data: { shortUrl: saved.short_url } });
      } catch {
        // Keep the Savia-hosted URL available when Shlink is unreachable.
      }
    }
    if (!link.short_code) {
      const code = bookingShortCode();
      await db
        .prepare(
          "UPDATE tenant_booking_public_links SET short_code=? WHERE tenant_id=? AND id=? AND short_code IS NULL AND deleted_at IS NULL",
        )
        .bind(code, id, link.id)
        .run();
    }
    const current = await db
      .prepare(
        "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND id=? AND deleted_at IS NULL",
      )
      .bind(id, link.id)
      .first<BookingLinkRow>();
    if (!current)
      throw new HTTPException(404, { message: "Booking link unavailable." });
    return c.json({
      data: {
        shortUrl: bookingLinkView(current, origin(options)).shortUrl,
      },
    });
  });
  route(
    "delete",
    `${linkRoot}/{id}`,
    async (c) => {
      const { id, auth, own } = await linkAccess(c),
        input = await body(c, revisionSchema),
        link = await db
          .prepare(
            "SELECT * FROM tenant_booking_public_links WHERE tenant_id=? AND id=? AND deleted_at IS NULL",
          )
          .bind(id, c.req.param("id"))
          .first<BookingLinkRow>();
      if (
        !link ||
        (!auth.canManage &&
          (link.scope_kind !== "professional" ||
            link.professional_id !== own?.id))
      )
        throw new HTTPException(404, { message: "Booking link unavailable." });
      const changed = await db
        .prepare(
          "UPDATE tenant_booking_public_links SET deleted_at=?,version=version+1 WHERE tenant_id=? AND id=? AND version=? AND deleted_at IS NULL RETURNING id",
        )
        .bind(new Date(now()).toISOString(), id, link.id, input.version)
        .first();
      if (!changed)
        throw new HTTPException(409, {
          message: "The link changed. Refresh and try again.",
        });
      return c.json({ data: { deleted: true } });
    },
    revisionSchema,
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/s/b/{code}",
      security: [],
      tags: ["Booking"],
      request: {
        params: z.object({ code: z.string().regex(/^[a-f0-9]{16}$/) }),
      },
      responses: {
        302: { description: "Redirect to the public booking page" },
        404: { description: "Unavailable link" },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      c.header("X-Robots-Tag", "noindex, nofollow");
      c.header("Referrer-Policy", "no-referrer");
      const { code } = c.req.valid("param");
      const link = await db
        .prepare(
          "SELECT token FROM tenant_booking_public_links WHERE short_code=? AND deleted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
        )
        .bind(code, new Date(now()).toISOString())
        .first<{ token: string }>();
      if (!link)
        throw new HTTPException(404, { message: "Booking page unavailable." });
      await resolveBookingLink(db, link.token, now());
      return c.redirect(pageUrl(options, link.token), 302);
    },
  );
  const publicRoot = "/api/public/bookings/{token}";
  route("get", publicRoot, async (c) => {
    const state = await resolveBookingLink(db, c.req.param("token")!, now()),
      eligible = await candidates(db, state.tenantId);
    const professionals = state.settings.professionals
      .filter(
        (p) =>
          p.enabled && eligible.some((e) => e.principalId === p.principalId),
      )
      .map((p) => ({
        id: p.id,
        name: eligible.find((e) => e.principalId === p.principalId)!
          .displayName,
      }));
    const config = captchaConfiguration(captcha);
    return c.json({
      data: {
        id: state.publicToken,
        title: state.settings.title,
        description: state.settings.description,
        timeZone: state.settings.timeZone,
        cancellationMinutes: state.settings.cancellationMinutes,
        linkScope: state.scope,
        fixedProfessionalId:
          state.scope.kind === "professional"
            ? state.scope.professionalId
            : null,
        fixedServiceId: state.serviceId,
        horizonDays: state.settings.horizonDays,
        leadMinutes: state.settings.leadMinutes,
        services: state.settings.services
          .filter((s) => s.enabled)
          .map(
            ({ id, name, description, durationMinutes, professionalIds }) => ({
              id,
              name,
              description,
              durationMinutes,
              professionalIds: professionalIds.filter((id) =>
                professionals.some((p) => p.id === id),
              ),
            }),
          ),
        professionals,
        captcha: {
          captchaProvider: config.provider,
          ...(config.provider === "turnstile"
            ? { siteKey: config.siteKey }
            : {}),
        },
      },
    });
  });
  route("get", `${publicRoot}/challenge`, async (c) => {
    await resolveBookingLink(db, c.req.param("token")!, now());
    return c.json(await publicFormChallenge(captcha, c.req.param("token")!));
  });
  route(
    "get",
    `${publicRoot}/slots`,
    async (c) => {
      const state = await resolveBookingLink(db, c.req.param("token")!, now()),
        query = parsed(publicSlotQuerySchema, c.req.query()),
        result = await slots(state, {
          ...query,
          ...assertBookingLinkSelection(
            state,
            query.serviceId,
            query.professionalId,
          ),
        });
      return c.json({
        data: { slots: result.slots, timeZone: result.timeZone },
      });
    },
    undefined,
    publicSlotQuerySchema,
  );
  route(
    "get",
    `${publicRoot}/availability`,
    async (c) => {
      const link = await resolveBookingLink(db, c.req.param("token")!, now());
      const result = await getPublicAvailability(
        link,
        parsed(availabilityRangeQuerySchema, c.req.query()),
        {
          now,
          loadBusy: async (principalId, from, to) =>
            (await loadBusy(link.tenantId, principalId, from, to)).busy,
        },
      );
      return c.json({ data: result });
    },
    undefined,
    availabilityRangeQuerySchema,
    availabilityRangeSchema,
  );
  route(
    "post",
    `${publicRoot}/reservations`,
    async (c) => {
      const token = c.req.param("token")!,
        state = await resolveBookingLink(db, token, now()),
        input = await body(c, publicBookingSchema),
        key = parsed(
          z
            .string()
            .min(8)
            .max(150)
            .regex(/^[A-Za-z0-9_-]+$/),
          c.req.header("Idempotency-Key"),
        );
      const normalized = {
        ...input,
        ...assertBookingLinkSelection(
          state,
          input.serviceId,
          input.professionalId,
        ),
        startsAt: new Date(input.startsAt).toISOString(),
        customerEmail: input.customerEmail.toLowerCase(),
      };
      const hash = await digest(
          JSON.stringify({
            ...normalized,
            customerLocale:
              normalized.customerLocale === "en"
                ? undefined
                : normalized.customerLocale,
            captchaToken: undefined,
          }),
        ),
        requestKey = `${token}:${key}`;
      const existing = await findRequest(db, state.tenantId, requestKey);
      const response = async (row: BookingRow, status: 200 | 201) =>
        c.json(
          {
            data: {
              reservation: await reservationView(db, row),
              managementUrl: manageUrl(options, row.manage_token),
            },
          },
          status,
        );
      if (existing) {
        if (existing.request_hash !== hash)
          throw new HTTPException(409, {
            message: "This request key was already used for different details.",
          });
        return response(existing, 200);
      }
      const admitted = await findBookingAdmission(db, requestKey, hash);
      if (!admitted) {
        await verifyCaptcha(captcha, {
          token: input.captchaToken,
          submissionId: crypto.randomUUID(),
          formId: token,
          ip: c.req.header("cf-connecting-ip") ?? "unknown",
        });
        const config = captchaConfiguration(captcha);
        await admitBookingRequest(db, {
          link: state,
          requestKey,
          requestHash: hash,
          ipHash: await digest(
            config.secretKey +
              ":" +
              (c.req.header("cf-connecting-ip") ?? "unknown"),
          ),
          captchaIdentityHash:
            config.provider === "disabled"
              ? null
              : await digest(captchaIdentity(captcha, input.captchaToken).key),
          now: now(),
        });
      }
      const result = await slots(
          state,
          {
            serviceId: input.serviceId,
            professionalId: normalized.professionalId,
            date: dateInZone(input.startsAt, state.settings.timeZone),
          },
          undefined,
          true,
        ),
        selected = result.slots.find((s) => s.startsAt === normalized.startsAt);
      if (!selected) {
        const start = Date.parse(normalized.startsAt);
        const end =
          start +
          (result.service.durationMinutes + result.service.bufferMinutes) *
            60000;
        if (
          result.busy.some(
            (interval) =>
              Date.parse(interval.start) < end &&
              Date.parse(interval.end) > start,
          )
        )
          return c.json(
            {
              error: {
                code: "BOOKING_TIME_CONFLICT",
                message:
                  "This time conflicts with another meeting or appointment. Choose another available time.",
              },
            },
            409,
          );
        throw conflict();
      }
      const row: BookingRow = {
        id: crypto.randomUUID(),
        tenant_id: state.tenantId,
        professional_id: normalized.professionalId,
        principal_id: result.professional.principalId,
        service_id: input.serviceId,
        service_name: result.service.name,
        professional_name: result.professionalName,
        starts_at: selected.startsAt,
        ends_at: selected.endsAt,
        buffer_minutes: result.service.bufferMinutes,
        customer_name: input.customerName,
        customer_email: normalized.customerEmail,
        customer_locale: input.customerLocale,
        manage_token:
          crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", ""),
        request_key: requestKey,
        request_hash: hash,
        status: "confirmed",
        version: 1,
        calendar_provider: result.grant?.provider ?? null,
        calendar_connection_id: result.grant?.connection_id ?? null,
        external_id: null,
        created_at: new Date(now()).toISOString(),
      };
      try {
        await createReservation(db, row, state.settings, state.id, now());
      } catch (e) {
        const replay = await findRequest(db, state.tenantId, requestKey);
        if (replay && replay.request_hash === hash)
          return response(replay, 200);
        throw e;
      }
      return response(row, 201);
    },
    publicBookingSchema,
    undefined,
    z.object({ reservation: reservationSchema, managementUrl: z.string() }),
    true,
  );
  const cutoff = (row: BookingRow, settings: BookingSettings) => {
    if (
      Date.parse(row.starts_at) - now() <
      settings.cancellationMinutes * 60000
    )
      throw new HTTPException(409, {
        message:
          "The cancellation or rescheduling deadline has passed. Contact the business.",
      });
  };
  async function reschedulingContext(
    row: BookingRow,
    state: Awaited<ReturnType<typeof readSettings>>,
  ) {
    cutoff(row, state.settings);
    if (row.status !== "confirmed") throw conflict();
    // The private capability remains independent of public sharing-link lifecycle.
    await publishedSettings(db, state.publicToken ?? "");
    const professional = state.settings.professionals.find(
      (p) => p.id === row.professional_id && p.enabled,
    );
    const service = state.settings.services.find(
      (s) =>
        s.id === row.service_id &&
        s.enabled &&
        s.professionalIds.includes(row.professional_id),
    );
    if (
      !professional ||
      professional.principalId !== row.principal_id ||
      !service
    )
      throw new HTTPException(404, {
        message: "Service or professional unavailable.",
      });
    if (
      !(await candidates(db, row.tenant_id)).some(
        (p) => p.principalId === professional.principalId,
      )
    )
      throw conflict();
    if (
      service.durationMinutes !==
        (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000 ||
      service.bufferMinutes !== row.buffer_minutes
    )
      throw new HTTPException(409, {
        message:
          "The service changed. Contact the business to update this reservation.",
      });
    return { settings: state.settings, professional, service };
  }
  const management = "/api/public/bookings/manage/{token}";
  route(
    "get",
    management,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        state = await readSettings(db, row.tenant_id);
      let canReschedule = false;
      try {
        await reschedulingContext(row, state);
        canReschedule = true;
      } catch (error) {
        if (
          !(error instanceof HTTPException) ||
          ![404, 409].includes(error.status)
        )
          throw error;
      }
      let publicUrl: string | null = null;
      if (state.publicToken) {
        try {
          await resolveBookingLink(db, state.publicToken, now());
          publicUrl = pageUrl(options, state.publicToken);
        } catch (error) {
          if (!(error instanceof HTTPException) || error.status !== 404)
            throw error;
        }
      }
      return c.json({
        data: {
          reservation: await reservationView(db, row),
          publicUrl,
          timeZone: state.settings.timeZone,
          cancellationMinutes: state.settings.cancellationMinutes,
          horizonDays: state.settings.horizonDays,
          leadMinutes: state.settings.leadMinutes,
          canReschedule,
        },
      });
    },
    undefined,
    undefined,
    managementBootstrapSchema,
  );
  route(
    "get",
    `${management}/availability`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!);
      const state = await readSettings(db, row.tenant_id);
      const context = await reschedulingContext(row, state);
      const query = parsed(availabilityRangeQuerySchema, c.req.query());
      if (
        query.serviceId !== row.service_id ||
        (query.professionalId && query.professionalId !== row.professional_id)
      )
        throw new HTTPException(404, {
          message: "Service or professional unavailable.",
        });
      return c.json({
        data: await getBookingAvailability(context, query, {
          now,
          loadBusy: async (principalId, from, to) =>
            (await loadBusy(row.tenant_id, principalId, from, to, row.id)).busy,
        }),
      });
    },
    undefined,
    availabilityRangeQuerySchema,
    availabilityRangeSchema,
  );
  route(
    "get",
    `${management}/slots`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        state = await readSettings(db, row.tenant_id);
      await reschedulingContext(row, state);
      const date = parsed(z.string().date(), c.req.query("date"));
      const result = await slots(
        { tenantId: row.tenant_id, settings: state.settings },
        {
          serviceId: row.service_id,
          professionalId: row.professional_id,
          date,
        },
        row.id,
      );
      return c.json({
        data: { slots: result.slots, timeZone: result.timeZone },
      });
    },
    undefined,
    z.object({ date: z.string() }),
  );

  route(
    "post",
    `${management}/cancel`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        input = await body(c, revisionSchema),
        state = await readSettings(db, row.tenant_id);
      cutoff(row, state.settings);
      return c.json({
        data: await reservationView(
          db,
          await changeReservation(db, row, state.settings, {
            version: input.version,
            cancel: true,
          }),
        ),
      });
    },
    revisionSchema,
    undefined,
    reservationSchema,
  );
  const rescheduleSchema = z
    .object({
      version: z.number().int().positive(),
      startsAt: z.string().datetime({ offset: true }),
    })
    .strict();
  route(
    "post",
    `${management}/reschedule`,
    async (c) => {
      const row = await managedBooking(db, c.req.param("token")!),
        input = await body(c, rescheduleSchema),
        state = await readSettings(db, row.tenant_id);
      cutoff(row, state.settings);
      await publishedSettings(db, state.publicToken ?? "");
      if (
        !state.settings.enabled ||
        !state.settings.published ||
        row.version !== input.version ||
        row.status !== "confirmed"
      )
        throw conflict();
      if (
        !state.settings.professionals.some(
          (professional) =>
            professional.id === row.professional_id &&
            professional.principalId === row.principal_id,
        )
      )
        throw new HTTPException(404, {
          message: "Service or professional unavailable.",
        });
      const startsAt = new Date(input.startsAt).toISOString();
      if (startsAt === row.starts_at)
        return c.json({ data: await reservationView(db, row) });
      const result = await slots(
          { tenantId: row.tenant_id, settings: state.settings },
          {
            serviceId: row.service_id,
            professionalId: row.professional_id,
            date: dateInZone(startsAt, state.settings.timeZone),
          },
          row.id,
          true,
        ),
        selected = result.slots.find((s) => s.startsAt === startsAt);
      if (!selected) {
        const start = Date.parse(startsAt);
        const end =
          start +
          (result.service.durationMinutes + result.service.bufferMinutes) *
            60000;
        if (
          result.busy.some(
            (interval) =>
              Date.parse(interval.start) < end &&
              Date.parse(interval.end) > start,
          )
        )
          return c.json(
            {
              error: {
                code: "BOOKING_TIME_CONFLICT",
                message:
                  "This time conflicts with another meeting or appointment. Choose another available time.",
              },
            },
            409,
          );
        throw conflict();
      }
      if (
        result.service.durationMinutes !==
          (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000 ||
        result.service.bufferMinutes !== row.buffer_minutes
      )
        throw new HTTPException(409, {
          message:
            "The service changed. Contact the business to update this reservation.",
        });
      return c.json({
        data: await reservationView(
          db,
          await changeReservation(db, row, state.settings, {
            version: input.version,
            startsAt: selected.startsAt,
            endsAt: selected.endsAt,
          }),
        ),
      });
    },
    rescheduleSchema,
    undefined,
    reservationSchema,
  );
}
